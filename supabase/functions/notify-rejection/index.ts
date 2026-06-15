// Emails the employee when their timesheet is rejected, including the reason.
// Invoked from the app after the manager rejects:
//   sb.functions.invoke('notify-rejection', { body: { approval_id, comment } })
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const { approval_id, comment } = await req.json()
    if (!approval_id) return json({ error: 'approval_id required' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Identify the rejecting manager from the caller's JWT
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await userClient.auth.getUser()
    const managerEmail = user?.email ?? null

    const { data: ap } = await admin
      .from('approvals')
      .select('id, status, decided_at, comment, projects(code, customers(name)), timesheets(week_start, profiles(email, full_name))')
      .eq('id', approval_id)
      .single()
    if (!ap) return json({ error: 'approval not found' }, 404)

    const t: any = (ap as any).timesheets
    const employeeEmail = t?.profiles?.email ?? null
    const employeeName = t?.profiles?.full_name || employeeEmail || 'Employee'
    const projectCode = (ap as any).projects?.code ?? ''
    const customerName = (ap as any).projects?.customers?.name ?? projectCode
    const reason = comment || (ap as any).comment || ''

    if (!employeeEmail) return json({ error: 'no employee email' }, 400)

    const stamp = new Date((ap as any).decided_at).toISOString().replace('T', ' ').slice(0, 19)
    const reasonHtml = reason
      ? `<p><strong>Reason:</strong> ${reason.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`
      : ''

    await sendEmail(
      [employeeEmail],
      `✕ Timesheet returned — ${employeeName}, week of ${t?.week_start} (${customerName})`,
      `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1c1c1a">
         <p>Your timesheet for <strong>${customerName}</strong>,
         week of <strong>${t?.week_start}</strong>, has been <strong>returned</strong> by your approver.</p>
         ${reasonHtml}
         <p style="color:#6b7280">Returned by ${managerEmail ?? 'manager'} · ${stamp} UTC</p>
         <p>Your timesheet has been unlocked — please fix and resubmit.</p>
       </div>`
    )

    return json({ ok: true, recipient: employeeEmail })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
