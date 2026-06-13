// Reminds approvers about timesheets that have been pending more than a week.
// Meant to be called on a schedule (see 0015_schedule_reminders.sql), e.g. daily.
// Sends at most one reminder per approval per week (tracked by reminded_at).
//
// Optional protection: set CRON_SECRET in the function's env and pass it as the
// `x-cron-secret` header; if CRON_SECRET is unset, any caller may trigger it
// (it only sends reminder emails, so this is low-risk).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://ts.uably.com'
const OVERDUE_DAYS = 7

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
async function sendEmail(to: string[], subject: string, html: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) throw new Error('RESEND_API_KEY not set')
  const from = Deno.env.get('MAIL_FROM') ?? 'Timesheet <ts@ts.uably.com>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html })
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
  return res.json()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const secret = Deno.env.get('CRON_SECRET')
    if (secret && req.headers.get('x-cron-secret') !== secret) {
      return json({ error: 'forbidden' }, 403)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const cutoff = new Date(Date.now() - OVERDUE_DAYS * 86400000).toISOString()

    // Pending approvals older than the cutoff that haven't been reminded recently.
    const { data: due, error } = await admin
      .from('approvals')
      .select('id, project_id, reminded_at, created_at, projects(code), timesheets(week_start, user_id, profiles(email, full_name))')
      .eq('status', 'Pending')
      .lt('created_at', cutoff)
    if (error) return json({ error: error.message }, 500)

    let reminded = 0
    for (const a of due ?? []) {
      // Skip if reminded within the last week.
      if ((a as any).reminded_at && new Date((a as any).reminded_at).toISOString() > cutoff) continue

      const ts = (a as any).timesheets
      const employee = ts?.profiles?.full_name || ts?.profiles?.email || 'An employee'
      const projectCode = (a as any).projects?.code ?? ''

      // Who approves this employee for this project.
      const { data: links } = await admin
        .from('approver_links')
        .select('manager_id')
        .eq('employee_id', ts?.user_id)
        .eq('project_id', (a as any).project_id)
      const ids = (links ?? []).map((l: any) => l.manager_id)
      if (!ids.length) continue

      const { data: mgrs } = await admin.from('profiles').select('email').in('id', ids)
      const emails = (mgrs ?? []).map((m: any) => m.email).filter(Boolean)
      if (!emails.length) continue

      const days = Math.floor((Date.now() - new Date((a as any).created_at).getTime()) / 86400000)
      await sendEmail(
        emails,
        `Reminder: timesheet pending your approval — ${employee}`,
        `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1c1c1a">
           <p>You have <strong>1 pending timesheet</strong> awaiting approval.</p>
           <p><strong>${employee}</strong> submitted <strong>${projectCode}</strong> (week of
           <strong>${ts?.week_start}</strong>) <strong>${days} days ago</strong> and it is still pending.</p>
           <p><a href="${APP_URL}" style="display:inline-block;background:#e0241b;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Review &amp; approve &rarr;</a></p>
         </div>`
      )
      await admin.from('approvals').update({ reminded_at: new Date().toISOString() }).eq('id', (a as any).id)
      reminded++
    }

    return json({ ok: true, checked: (due ?? []).length, reminded })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
