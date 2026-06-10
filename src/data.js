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
    .select('id, email, full_name, role')
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

// Distinct customers present in a sheet's entries (each needs its own approval)
function customersInSheet(sheet) {
  const ids = new Set()
  sheet.rows.forEach(r => {
    const p = projects.find(x => x.id === r.project_id)
    if (p) ids.add(p.customer_id)
  })
  return [...ids]
}

// On submit, ensure a Pending approval row exists per customer in the sheet
export async function createApprovalsForSheet(wk) {
  const sheet = allSheets[wk]
  if (!sheet || !sheet.id) return
  const rows = customersInSheet(sheet).map(customer_id => ({
    timesheet_id: sheet.id,
    customer_id,
    status: 'Pending'
  }))
  if (!rows.length) return
  // Insert any missing approval rows (ON CONFLICT DO NOTHING). We don't update
  // existing ones here because employees can't write approval status (RLS).
  const { error } = await sb
    .from('approvals')
    .upsert(rows, { onConflict: 'timesheet_id,customer_id', ignoreDuplicates: true })
  if (error) toast('Approval routing error: ' + error.message)
}

// Manager view: pending approvals visible to the current user (RLS-scoped)
export async function loadApprovals() {
  const { data, error } = await sb
    .from('approvals')
    .select('id, status, customer_id, decided_at, customers(name), timesheets(id, week_start, user_id, profiles(email, full_name))')
    .order('status', { ascending: true })
  if (error) { toast('Error loading approvals: ' + error.message); return [] }
  return data || []
}

// Load the entries the manager is allowed to see for one approval (their customer only)
export async function loadApprovalEntries(timesheetId, customerId) {
  const { data, error } = await sb
    .from('timesheet_entries')
    .select('rate, hours, projects(code, customer_id)')
    .eq('timesheet_id', timesheetId)
  if (error) { toast('Error loading entries: ' + error.message); return [] }
  // RLS already restricts to this manager's customers; filter to this approval's customer
  return (data || []).filter(e => e.projects?.customer_id === customerId)
}

// ── Admin: profiles, customers, projects, approver links ──

export async function loadProfiles() {
  const { data, error } = await sb.from('profiles').select('id, email, full_name, role').order('email')
  if (error) { toast('Error loading users: ' + error.message); return [] }
  return data || []
}

export async function loadCustomers() {
  const { data, error } = await sb.from('customers').select('id, name, code').order('name')
  if (error) { toast('Error loading customers: ' + error.message); return [] }
  return data || []
}

export async function addCustomer(name, code) {
  const { error } = await sb.from('customers').insert({ name, code: code || null })
  if (error) { toast('Add customer failed: ' + error.message); return false }
  return true
}

export async function addProject(customer_id, code, description) {
  const { error } = await sb.from('projects').insert({ customer_id, code, description: description || null, active: true })
  if (error) { toast('Add project failed: ' + error.message); return false }
  await loadProjects()
  return true
}

export async function setProjectActive(id, active) {
  const { error } = await sb.from('projects').update({ active }).eq('id', id)
  if (error) { toast('Update failed: ' + error.message); return false }
  await loadProjects()
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
    .select('id, customers(name), manager:profiles!approver_links_manager_id_fkey(email), employee:profiles!approver_links_employee_id_fkey(email)')
  if (error) { toast('Error loading approvers: ' + error.message); return [] }
  return data || []
}

export async function removeApproverLink(id) {
  const { error } = await sb.from('approver_links').delete().eq('id', id)
  if (error) { toast('Remove failed: ' + error.message); return false }
  return true
}

// Assign an approver (by email) to an employee for a customer.
// The approver must already exist as a user (invite them in Supabase Auth first).
export async function assignApprover(employeeId, customerId, approverEmail) {
  const email = (approverEmail || '').trim().toLowerCase()
  if (!email) { toast('Enter the approver email.'); return false }

  const { data: prof, error } = await sb
    .from('profiles').select('id, role').ilike('email', email).maybeSingle()
  if (error) { toast('Lookup failed: ' + error.message); return false }
  if (!prof) {
    toast('No user with that email yet — invite them in Supabase → Authentication → Users, then assign.')
    return false
  }

  if (prof.role !== 'manager' && prof.role !== 'admin') {
    const { error: rErr } = await sb.from('profiles').update({ role: 'manager' }).eq('id', prof.id)
    if (rErr) { toast('Could not set manager role: ' + rErr.message); return false }
  }

  const { error: lErr } = await sb.from('approver_links').upsert(
    { manager_id: prof.id, employee_id: employeeId, customer_id: customerId },
    { onConflict: 'manager_id,employee_id,customer_id', ignoreDuplicates: true }
  )
  if (lErr) { toast('Link failed: ' + lErr.message); return false }
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
    .select('id, decided_at, customer_id, timesheets(id, week_start, user_id)')
    .single()
  if (error) { toast('Decision failed: ' + error.message); return null }
  return data
}
