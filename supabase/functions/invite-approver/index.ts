// Invites a not-yet-registered approver and links them to an employee/project.
// Admin-only. Invoked from the Admin screen when the entered approver email
// doesn't match an existing user:
//   sb.functions.invoke('invite-approver',
//     { body: { employee_id, project_id, approver_email } })
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://ts.uably.com'

// ── inlined helpers (self-contained so it can be pasted into the dashboard editor) ──
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { employee_id, project_id, approver_email } = await req.json()
    const email = String(approver_email ?? '').trim().toLowerCase()
    if (!employee_id || !project_id || !email) {
      return json({ error: 'employee_id, project_id and approver_email are required' }, 400)
    }

    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Only an admin may invite/assign approvers. Verify the caller's role.
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'not authenticated' }, 401)
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (me?.role !== 'admin') return json({ error: 'admin only' }, 403)

    // Find or invite the approver, then make sure they have a manager profile.
    let managerId: string | null = null
    const { data: existing } = await admin
      .from('profiles').select('id').ilike('email', email).maybeSingle()

    if (existing) {
      managerId = existing.id
    } else {
      const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(
        email, { redirectTo: APP_URL }
      )
      if (invErr || !invited?.user) {
        return json({ error: 'invite failed: ' + (invErr?.message ?? 'unknown') }, 400)
      }
      managerId = invited.user.id
      // The on_auth_user_created trigger inserts the profile; ensure it exists.
      await admin.from('profiles').upsert(
        { id: managerId, email }, { onConflict: 'id', ignoreDuplicates: true }
      )
    }

    await admin.from('profiles').update({ role: 'manager' })
      .eq('id', managerId).neq('role', 'admin')

    const { error: linkErr } = await admin.from('approver_links').upsert(
      { manager_id: managerId, employee_id, project_id },
      { onConflict: 'manager_id,employee_id,project_id', ignoreDuplicates: true }
    )
    if (linkErr) return json({ error: 'link failed: ' + linkErr.message }, 400)

    return json({ ok: true, manager_id: managerId, invited: !existing })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
