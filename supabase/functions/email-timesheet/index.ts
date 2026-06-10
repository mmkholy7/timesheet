// Emails a timesheet PDF (built client-side) to a chosen address. Auth-gated —
// any signed-in user may send; the email is sent on their behalf and CC'd to
// them. Invoked from the app's "Email PDF" dialog:
//   sb.functions.invoke('email-timesheet',
//     { body: { to, period, pdf_base64, filename } })
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── inlined helpers (self-contained so it can be pasted into the dashboard editor) ──
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
type Attachment = { filename: string; content: string }
async function sendEmail(to: string[], subject: string, html: string, attachments?: Attachment[]) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) throw new Error('RESEND_API_KEY not set')
  const from = Deno.env.get('MAIL_FROM') ?? 'Timesheet <no-reply@uably.com>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, attachments })
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
  return res.json()
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { to, period, pdf_base64, filename } = await req.json()
    const recipient = String(to ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(recipient)) return json({ error: 'a valid "to" email is required' }, 400)
    if (!pdf_base64) return json({ error: 'pdf_base64 is required' }, 400)

    const url = Deno.env.get('SUPABASE_URL')!
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'not authenticated' }, 401)

    const sender = user.email ?? 'a Timesheet user'
    const periodText = period ? String(period) : 'timesheet'
    // Send to the recipient and copy the sender (dedup if they're the same).
    const recipients = recipient === (user.email ?? '').toLowerCase()
      ? [recipient]
      : [recipient, user.email].filter(Boolean) as string[]

    await sendEmail(
      recipients,
      `Timesheet — ${periodText}`,
      `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1c1c1a">
         <p><strong>${sender}</strong> shared a timesheet (${periodText}).</p>
         <p>The PDF is attached.</p>
       </div>`,
      [{ filename: filename || 'timesheet.pdf', content: pdf_base64 }]
    )

    return json({ ok: true, recipients })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
