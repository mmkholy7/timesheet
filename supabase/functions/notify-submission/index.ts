// Emails the approver(s) when an employee submits a timesheet.
// Invoked from the app: sb.functions.invoke('notify-submission', { body: { timesheet_id } })
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cors, json, sendEmail } from '../_shared/util.ts'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://ts.uably.com'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { timesheet_id } = await req.json()
    if (!timesheet_id) return json({ error: 'timesheet_id required' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: ts } = await admin
      .from('timesheets')
      .select('id, week_start, user_id, profiles(email, full_name)')
      .eq('id', timesheet_id)
      .single()
    if (!ts) return json({ error: 'timesheet not found' }, 404)

    // Distinct customers present on the sheet
    const { data: entries } = await admin
      .from('timesheet_entries')
      .select('projects(customer_id, customers(name))')
      .eq('timesheet_id', timesheet_id)

    const customers = new Map<string, string>()
    for (const e of entries ?? []) {
      const p: any = (e as any).projects
      if (p?.customer_id) customers.set(p.customer_id, p.customers?.name ?? '')
    }

    const employeeName = (ts as any).profiles?.full_name || (ts as any).profiles?.email || 'An employee'
    let notified = 0

    for (const [customerId, customerName] of customers) {
      const { data: links } = await admin
        .from('approver_links')
        .select('manager_id')
        .eq('employee_id', ts.user_id)
        .eq('customer_id', customerId)

      const ids = (links ?? []).map((l: any) => l.manager_id)
      if (!ids.length) continue

      const { data: mgrs } = await admin.from('profiles').select('email').in('id', ids)
      for (const m of mgrs ?? []) {
        if (!(m as any).email) continue
        await sendEmail(
          [(m as any).email],
          `Timesheet approval requested — ${employeeName}, week of ${ts.week_start}`,
          `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1c1c1a">
             <p><strong>${employeeName}</strong> submitted a timesheet for
             <strong>${customerName}</strong> (week of <strong>${ts.week_start}</strong>) and it is awaiting your approval.</p>
             <p><a href="${APP_URL}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Review &amp; approve &rarr;</a></p>
           </div>`
        )
        notified++
      }
    }

    return json({ ok: true, notified })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
