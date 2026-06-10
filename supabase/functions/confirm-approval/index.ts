// Emails employee + approving manager a timestamped PDF when a timesheet is approved.
// Invoked from the app after the manager approves:
//   sb.functions.invoke('confirm-approval', { body: { approval_id, pdf_base64, filename } })
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cors, json, sendEmail } from '../_shared/util.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { approval_id, pdf_base64, filename } = await req.json()
    if (!approval_id) return json({ error: 'approval_id required' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Identify the approving manager from the caller's JWT
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
      .select('id, status, decided_at, customers(name), timesheets(week_start, profiles(email, full_name))')
      .eq('id', approval_id)
      .single()
    if (!ap) return json({ error: 'approval not found' }, 404)

    const t: any = (ap as any).timesheets
    const employeeEmail = t?.profiles?.email ?? null
    const employeeName = t?.profiles?.full_name || employeeEmail || 'Employee'
    const customerName = (ap as any).customers?.name ?? ''
    const recipients = [employeeEmail, managerEmail].filter(Boolean) as string[]
    if (!recipients.length) return json({ error: 'no recipients' }, 400)

    const stamp = new Date((ap as any).decided_at).toISOString().replace('T', ' ').slice(0, 19)

    await sendEmail(
      recipients,
      `✓ Timesheet approved — ${employeeName}, week of ${t?.week_start} (${customerName})`,
      `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1c1c1a">
         <p>The timesheet for <strong>${employeeName}</strong> — <strong>${customerName}</strong>,
         week of <strong>${t?.week_start}</strong> — was <strong>approved</strong>.</p>
         <p style="color:#6b7280">Approved by ${managerEmail ?? 'manager'} · ${stamp} UTC</p>
         <p>A timestamped PDF copy is attached for your records.</p>
       </div>`,
      pdf_base64 ? [{ filename: filename || 'timesheet.pdf', content: pdf_base64 }] : undefined
    )

    return json({ ok: true, recipients })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
