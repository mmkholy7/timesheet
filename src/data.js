import { sb } from './supabase.js'
import { toast, setSyncStatus } from './ui.js'

export let allSheets = {}
export let projects = []      // active projects: [{ id, code, description, customer_id, customers:{name} }]
export let profile = null     // current user's profile row: { id, email, role }
let currentUserId = null
let saveTimer = null

export function setUser(userId) {
  currentUserId = userId
}

// Load the signed-in user's profile (role gates admin/manager features later)
export async function loadProfile() {
  const { data, error } = await sb
    .from('profiles')
    .select('id, email, full_name, role, organization_id, organizations(name, logo_url)')
    .eq('id', currentUserId)
    .single()
  if (error) { toast('Error loading profile: ' + error.message); return null }
  profile = data
  return profile
}

// Load the active project codes used to populate the dropdown
export async function loadProjects() {
  const { data, error } = await sb
    .from('projects')
    .select('id, code, description, customer_id, customers(name)')
    .eq('active', true)
    .order('code')
  if (error) { toast('Error loading projects: ' + error.message); return }
  projects = data || []
}

export function newRow() {
  const first = projects[0]
  return {
    rate: 'Regular - Hourly',
    project_id: first ? first.id : null,
    proj: first ? first.code : '',
    hours: [0, 0, 0, 0, 0, 0, 0]
  }
}

export function getLocalSheet(wk) {
  if (!allSheets[wk]) {
    allSheets[wk] = { status: 'Draft', rows: [newRow()], _dirty: false }
  }
  return allSheets[wk]
}

// Postgres numeric[] can arrive as strings; coerce to a clean 7-number array
function normalizeHours(h) {
  const arr = Array.isArray(h) ? h.map(Number) : []
  while (arr.length < 7) arr.push(0)
  return arr.slice(0, 7).map(n => (Number.isFinite(n) ? n : 0))
}

export async function loadAllSheets() {
  const { data, error } = await sb
    .from('timesheets')
    .select('id, week_start, status, timesheet_entries(id, rate, hours, project_id, projects(code))')
    .eq('user_id', currentUserId)

  if (error) { toast('Error loading data: ' + error.message); return }

  allSheets = {}
  ;(data || []).forEach(row => {
    const rows = (row.timesheet_entries || []).map(e => ({
      entry_id: e.id,
      rate: e.rate,
      project_id: e.project_id,
      proj: e.projects?.code || '',
      hours: normalizeHours(e.hours)
    }))
    allSheets[row.week_start] = {
      id: row.id,
      status: row.status,
      rows: rows.length ? rows : [newRow()],
      _dirty: false
    }
  })
}

export async function saveSheet(wk) {
  const sheet = allSheets[wk]
  if (!sheet) return

  setSyncStatus('saving', 'Saving…')

  // 1) Upsert the week container
  const tsPayload = {
    user_id: currentUserId,
    week_start: wk,
    status: sheet.status,
    updated_at: new Date().toISOString()
  }
  const tsRes = sheet.id
    ? await sb.from('timesheets').update(tsPayload).eq('id', sheet.id).select().single()
    : await sb.from('timesheets').insert(tsPayload).select().single()

  if (tsRes.error) {
    setSyncStatus('error', 'Save failed')
    toast('Save error: ' + tsRes.error.message)
    return
  }
  sheet.id = tsRes.data.id

  // 2) Replace the entries (simplest reliable sync for small sheets)
  const { error: delErr } = await sb
    .from('timesheet_entries')
    .delete()
    .eq('timesheet_id', sheet.id)
  if (delErr) {
    setSyncStatus('error', 'Save failed')
    toast('Save error: ' + delErr.message)
    return
  }

  const entries = sheet.rows
    .filter(r => r.project_id)                 // a project is required by the schema
    .map(r => ({
      timesheet_id: sheet.id,
      project_id: r.project_id,
      rate: r.rate,
      hours: r.hours
    }))

  if (entries.length) {
    const { error: insErr } = await sb.from('timesheet_entries').insert(entries)
    if (insErr) {
      setSyncStatus('error', 'Save failed')
      toast('Save error: ' + insErr.message)
      return
    }
  }

  sheet._dirty = false
  setSyncStatus('saved', 'Saved ✓')
  setTimeout(() => setSyncStatus('', ''), 2000)
}

export function scheduleSave(wk) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveSheet(wk), 900)
}

export function clearSheets() {
  allSheets = {}
  currentUserId = null
  profile = null
}

// ── Approvals ──

// Distinct projects that actually have hours logged (each needs its own
// approval). Projects selected but left at 0h are skipped so they don't create
// empty approvals / blank PDFs.
function projectsInSheet(sheet) {
  const ids = new Set()
  sheet.rows.forEach(r => {
    if (r.project_id && r.hours.some(h => +h > 0)) ids.add(r.project_id)
  })
  return [...ids]
}

// On submit, ensure a Pending approval row exists per project in the sheet
export async function createApprovalsForSheet(wk) {
  const sheet = allSheets[wk]
  if (!sheet || !sheet.id) return
  const rows = projectsInSheet(sheet).map(project_id => ({
    timesheet_id: sheet.id,
    project_id,
    status: 'Pending'
  }))
  if (!rows.length) return
  // Insert any missing approval rows (ON CONFLICT DO NOTHING). We don't update
  // existing ones here because employees can't write approval status (RLS).
  const { error } = await sb
    .from('approvals')
    .upsert(rows, { onConflict: 'timesheet_id,project_id', ignoreDuplicates: true })
  if (error) toast('Approval routing error: ' + error.message)
}

// The (employee_id:project_id) pairs the current user is the ASSIGNED approver
// for. Used to scope the approval queue/bell to only what's assigned to them —
// RLS also lets admins read every approval and lets a manager read their own
// submissions, neither of which belong in a personal approval queue.
export async function loadMyApproverKeys() {
  const { data, error } = await sb
    .from('approver_links')
    .select('employee_id, project_id')
    .eq('manager_id', currentUserId)
  if (error) return new Set()
  return new Set((data || []).map(l => `${l.employee_id}:${l.project_id}`))
}

// Manager view: pending approvals visible to the current user (RLS-scoped)
export async function loadApprovals() {
  const { data, error } = await sb
    .from('approvals')
    .select('id, status, project_id, decided_at, projects(code, customers(name)), timesheets(id, week_start, user_id, profiles(email, full_name))')
    .order('status', { ascending: true })
  if (error) { toast('Error loading approvals: ' + error.message); return [] }
  return data || []
}

// Load the entries the manager is allowed to see for one approval (their project only)
export async function loadApprovalEntries(timesheetId, projectId) {
  const { data, error } = await sb
    .from('timesheet_entries')
    .select('rate, hours, project_id, projects(code)')
    .eq('timesheet_id', timesheetId)
    .eq('project_id', projectId)
  if (error) { toast('Error loading entries: ' + error.message); return [] }
  return data || []
}

// ── Admin: profiles, customers, projects, approver links ──

// ── Audit log ──

// Append an audit entry. Identity + IP are stamped server-side by a trigger;
// we only send what was done. Logging must never block the user's action.
export async function logAction(action, entity_type = null, entity_id = null, details = null) {
  try {
    await sb.from('audit_log').insert({
      action, entity_type,
      entity_id: entity_id != null ? String(entity_id) : null,
      details
    })
  } catch { /* swallow — auditing is best-effort */ }
}

export async function loadAuditLog(limit = 200) {
  const { data, error } = await sb
    .from('audit_log')
    .select('id, created_at, user_email, user_role, action, entity_type, entity_id, details, ip')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) { toast('Error loading logs: ' + error.message); return [] }
  return data || []
}

export async function loadProfiles() {
  const { data, error } = await sb.from('profiles').select('id, email, full_name, role').order('email')
  if (error) { toast('Error loading users: ' + error.message); return [] }
  return data || []
}

// Admin: create a user directly in the DB (via the admin-create-user function)
// and set their role. Idempotent — re-adding an existing email just updates it.
export async function createUserAccount(email, fullName, role) {
  const e = (email || '').trim().toLowerCase()
  if (!e) { toast('Enter an email.'); return false }
  try {
    const { data, error } = await sb.functions.invoke('admin-create-user', {
      body: { email: e, full_name: fullName || '', role: role || 'employee' }
    })
    if (error || data?.error) { toast('Add user failed: ' + (data?.error || error.message)); return false }
    toast(data.created ? `User ${e} created ✓` : `User ${e} already existed — updated ✓`)
    logAction(data.created ? 'user: created' : 'user: updated', 'user', e, { role: role || 'employee' })
    return true
  } catch {
    toast('This needs the admin-create-user function deployed.')
    return false
  }
}

// Email a timesheet PDF (built client-side) to an address via the
// email-timesheet edge function. The sender is always CC'd.
export async function emailTimesheetPDF({ to, periodLabel, base64, filename }) {
  try {
    const { data, error } = await sb.functions.invoke('email-timesheet', {
      body: { to, period: periodLabel, pdf_base64: base64, filename }
    })
    if (error || data?.error) { toast('Send failed: ' + await fnError(error, data)); return false }
    return true
  } catch {
    toast('This needs the email-timesheet function deployed.')
    return false
  }
}

// Pull the real message out of a Supabase function error. On a non-2xx the
// thrown error only says "non-2xx status code"; the useful detail is in the
// Response body on error.context.
async function fnError(error, data) {
  if (data?.error) return data.error
  if (error?.context && typeof error.context.json === 'function') {
    try { const b = await error.context.json(); if (b?.error) return b.error } catch { /* not json */ }
  }
  return error?.message || 'unknown error'
}

// Admin: change a user's role (RLS lets admins update any profile).
export async function updateProfileRole(id, role) {
  const { error } = await sb.from('profiles').update({ role }).eq('id', id)
  if (error) { toast('Role update failed: ' + error.message); return false }
  logAction('user: role changed', 'user', id, { to: role })
  return true
}

export async function loadCustomers() {
  const { data, error } = await sb.from('customers').select('id, name, code').order('name')
  if (error) { toast('Error loading customers: ' + error.message); return [] }
  return data || []
}

export async function addCustomer(name, code) {
  const { error } = await sb.from('customers').insert({ name, code: code || null })
  if (error) { toast('Add customer failed: ' + error.message); return false }
  logAction('customer: created', 'customer', name)
  return true
}

export async function addProject(customer_id, code, description) {
  const { error } = await sb.from('projects').insert({ customer_id, code, description: description || null, active: true })
  if (error) { toast('Add project failed: ' + error.message); return false }
  await loadProjects()
  logAction('project: created', 'project', code, { description: description || null })
  return true
}

export async function setProjectActive(id, active) {
  const { error } = await sb.from('projects').update({ active }).eq('id', id)
  if (error) { toast('Update failed: ' + error.message); return false }
  await loadProjects()
  logAction(active ? 'project: activated' : 'project: deactivated', 'project', id)
  return true
}

export async function loadAllProjects() {
  const { data, error } = await sb
    .from('projects')
    .select('id, code, description, active, customer_id, customers(name)')
    .order('code')
  if (error) { toast('Error loading projects: ' + error.message); return [] }
  return data || []
}

export async function loadApproverLinks() {
  const { data, error } = await sb
    .from('approver_links')
    .select('id, projects(code, customers(name)), manager:profiles!approver_links_manager_id_fkey(email), employee:profiles!approver_links_employee_id_fkey(email)')
  if (error) { toast('Error loading approvers: ' + error.message); return [] }
  return data || []
}

export async function removeApproverLink(id) {
  const { error } = await sb.from('approver_links').delete().eq('id', id)
  if (error) { toast('Remove failed: ' + error.message); return false }
  logAction('approver: removed', 'approver_link', id)
  return true
}

// Assign an approver (by email) to an employee for a project.
// If the approver isn't a user yet, the `invite-approver` edge function invites
// them and creates the link server-side (service role). Existing users are
// linked directly here without needing the function deployed.
export async function assignApprover(employeeId, projectId, approverEmail) {
  const email = (approverEmail || '').trim().toLowerCase()
  if (!email) { toast('Enter the approver email.'); return false }

  const { data: prof, error } = await sb
    .from('profiles').select('id, role').ilike('email', email).maybeSingle()
  if (error) { toast('Lookup failed: ' + error.message); return false }

  // Not a user yet → ask the edge function to invite them and create the link.
  if (!prof) {
    try {
      const { data, error: fErr } = await sb.functions.invoke('invite-approver', {
        body: { employee_id: employeeId, project_id: projectId, approver_email: email }
      })
      if (fErr || data?.error) {
        toast('Invite failed: ' + (data?.error || fErr.message) +
          ' — or add them in Supabase → Authentication → Users, then assign.')
        return false
      }
      toast(`Invited ${email} ✓`)
      logAction('approver: invited & assigned', 'approver_link', projectId, { approver: email })
      return true
    } catch {
      toast('No user with that email yet, and the invite service is not deployed. ' +
        'Invite them in Supabase → Authentication → Users, then assign.')
      return false
    }
  }

  if (prof.role !== 'manager' && prof.role !== 'admin') {
    const { error: rErr } = await sb.from('profiles').update({ role: 'manager' }).eq('id', prof.id)
    if (rErr) { toast('Could not set manager role: ' + rErr.message); return false }
  }

  const { error: lErr } = await sb.from('approver_links').upsert(
    { manager_id: prof.id, employee_id: employeeId, project_id: projectId },
    { onConflict: 'manager_id,employee_id,project_id', ignoreDuplicates: true }
  )
  if (lErr) { toast('Link failed: ' + lErr.message); return false }
  logAction('approver: assigned', 'approver_link', projectId, { approver: email })
  return true
}

export async function decideApproval(approvalId, decision, comment = null) {
  const { data, error } = await sb
    .from('approvals')
    .update({
      status: decision,                 // 'Approved' | 'Rejected'
      decided_by: currentUserId,
      decided_at: new Date().toISOString(),
      comment
    })
    .eq('id', approvalId)
    .select('id, decided_at, project_id, timesheets(id, week_start, user_id)')
    .single()
  if (error) { toast('Decision failed: ' + error.message); return null }
  return data
}
