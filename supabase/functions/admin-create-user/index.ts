// Creates an auth user directly in the database (no invite email required) and
// sets their role + full name. Admin-only. Idempotent on email — if the user
// already exists it just updates their profile. Invoked from the Admin screen:
//   sb.functions.invoke('admin-create-user',
//     { body: { email, full_name, role } })
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

const ROLES = ['employee', 'manager', 'admin']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { email: rawEmail, full_name, role: rawRole } = await req.json()
    const email = String(rawEmail ?? '').trim().toLowerCase()
    const role = ROLES.includes(rawRole) ? rawRole : 'employee'
    if (!email) return json({ error: 'email is required' }, 400)

    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Only an admin may create users. Verify the caller's role.
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'not authenticated' }, 401)
    const { data: me } = await admin.from('profiles').select('role, organization_id').eq('id', user.id).single()
    if (me?.role !== 'admin') return json({ error: 'admin only' }, 403)

    // Already a user? Just update their profile (don't recreate).
    const { data: existing } = await admin
      .from('profiles').select('id').ilike('email', email).maybeSingle()

    let userId = existing?.id ?? null
    let created = false

    if (!userId) {
      // email_confirm:true → the row is created and usable immediately, no email
      // sent. The person signs in with Google/Microsoft using this email, or
      // uses "Forgot password" to set one.
      const { data: made, error: cErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: full_name || '' }
      })
      if (cErr || !made?.user) return json({ error: 'create failed: ' + (cErr?.message ?? 'unknown') }, 400)
      userId = made.user.id
      created = true
      // handle_new_user trigger inserts the profile; make sure it's there.
      await admin.from('profiles').upsert(
        { id: userId, email, full_name: full_name || '' }, { onConflict: 'id', ignoreDuplicates: true }
      )
    }

    const patch: Record<string, unknown> = { role }
    if (full_name) patch.full_name = full_name
    // New users inherit the creating admin's organization so they can see that
    // org's projects immediately. Existing users keep whatever org they have.
    if (created && me?.organization_id) patch.organization_id = me.organization_id
    const { error: uErr } = await admin.from('profiles').update(patch).eq('id', userId)
    if (uErr) return json({ error: 'profile update failed: ' + uErr.message }, 400)

    return json({ ok: true, user_id: userId, created })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
