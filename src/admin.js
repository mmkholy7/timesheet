import {
  loadProfiles, loadCustomers, loadAllProjects, addProject, addCustomer, setProjectActive,
  loadApproverLinks, assignApprover, removeApproverLink, createUserAccount, updateProfileRole,
  loadAuditLog
} from './data.js'
import { toast } from './ui.js'

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }

const ROLES = ['employee', 'manager', 'admin']
let profiles = [], customers = [], allProjects = []

export async function renderAdmin() {
  ;[profiles, customers, allProjects] = await Promise.all([loadProfiles(), loadCustomers(), loadAllProjects()])
  await Promise.all([renderUsers(), renderApprovers(), renderProjects()])
}

// ── Activity log (its own page) ──
export async function renderLogs() {
  const logs = await loadAuditLog()
  const fmt = (iso) => new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
  const details = (d) => {
    if (!d) return '—'
    const s = typeof d === 'string' ? d : JSON.stringify(d)
    return esc(s.length > 80 ? s.slice(0, 80) + '…' : s)
  }
  const rows = logs.length ? logs.map(l => `
    <tr>
      <td class="lg-time">${esc(fmt(l.created_at))}</td>
      <td>${esc(l.user_email || '—')}${l.user_role ? `<span class="lg-role">${esc(l.user_role)}</span>` : ''}</td>
      <td>${esc(l.action)}</td>
      <td>${esc(l.entity_type || '')}${l.entity_id ? ` <span class="lg-ent">${esc(l.entity_id)}</span>` : ''}</td>
      <td class="lg-details">${details(l.details)}</td>
      <td class="lg-ip">${esc(l.ip || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="ad-empty">No activity yet.</td></tr>'

  document.getElementById('admin-logs').innerHTML = `
    <div class="grid-wrap">
      <table class="admin-table">
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}

// Reload profiles and re-render the views that depend on them.
async function refreshProfiles() {
  profiles = await loadProfiles()
  renderUsers(); renderApprovers()
}

// ── Users ──
function renderUsers() {
  const roleOpts = (sel) => ROLES.map(r => `<option${r === sel ? ' selected' : ''}>${r}</option>`).join('')

  const rows = profiles.length ? profiles.map(p => `
    <tr>
      <td>${esc(p.email)}</td>
      <td>${esc(p.full_name || '')}</td>
      <td><select class="role-select" data-id="${p.id}">${roleOpts(p.role)}</select></td>
    </tr>`).join('') : '<tr><td colspan="3" class="ad-empty">No users yet.</td></tr>'

  document.getElementById('admin-users').innerHTML = `
    <div class="admin-form">
      <div class="af-field af-grow"><label>Email</label><input id="us-email" type="email" placeholder="person@uably.com"></div>
      <div class="af-field af-grow"><label>Full name</label><input id="us-name" placeholder="optional"></div>
      <div class="af-field"><label>Role</label><select id="us-role">${roleOpts('employee')}</select></div>
      <button class="btn btn-primary btn-sm" id="us-add">Add user</button>
    </div>
    <table class="admin-table">
      <thead><tr><th>Email</th><th>Name</th><th>Role</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`

  document.getElementById('us-add').addEventListener('click', async () => {
    const email = document.getElementById('us-email').value
    const name = document.getElementById('us-name').value.trim()
    const role = document.getElementById('us-role').value
    if (!email) { toast('Enter an email.'); return }
    const btn = document.getElementById('us-add')
    btn.disabled = true; btn.textContent = 'Adding…'
    const ok = await createUserAccount(email, name, role)
    btn.disabled = false; btn.textContent = 'Add user'
    if (ok) refreshProfiles()
  })

  document.querySelectorAll('#admin-users .role-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      if (await updateProfileRole(sel.dataset.id, sel.value)) { toast('Role updated ✓'); refreshProfiles() }
    })
  })
}

// ── Approvers ──
async function renderApprovers() {
  const links = await loadApproverLinks()
  const empOpts = profiles.map(p => `<option value="${p.id}">${esc(p.email)}</option>`).join('')
  const projOpts = allProjects.filter(p => p.active).map(p =>
    `<option value="${p.id}">${esc(p.customers?.name ? p.customers.name + ' · ' : '')}${esc(p.code)}</option>`).join('')

  const rows = links.length ? links.map(l => `
    <tr>
      <td>${esc(l.employee?.email || '')}</td>
      <td>${esc(l.projects?.customers?.name ? l.projects.customers.name + ' · ' : '')}${esc(l.projects?.code || '')}</td>
      <td>${esc(l.manager?.email || '')}</td>
      <td class="ad-right"><button class="btn btn-sm btn-danger" data-rm="${l.id}">Remove</button></td>
    </tr>`).join('') : '<tr><td colspan="4" class="ad-empty">No approvers assigned yet.</td></tr>'

  document.getElementById('admin-approvers').innerHTML = `
    <div class="admin-form">
      <div class="af-field"><label>Employee</label><select id="ap-emp">${empOpts}</select></div>
      <div class="af-field af-grow"><label>Project</label><select id="ap-proj">${projOpts}</select></div>
      <div class="af-field af-grow"><label>Approver email</label><input id="ap-email" type="email" placeholder="boss@wsp.com"></div>
      <button class="btn btn-primary btn-sm" id="ap-assign">Assign approver</button>
    </div>
    <table class="admin-table">
      <thead><tr><th>Employee</th><th>Project</th><th>Approver</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`

  document.getElementById('ap-assign').addEventListener('click', async () => {
    const emp = document.getElementById('ap-emp').value
    const proj = document.getElementById('ap-proj').value
    const email = document.getElementById('ap-email').value
    if (!emp || !proj) { toast('Pick an employee and a project.'); return }
    const btn = document.getElementById('ap-assign')
    btn.disabled = true; btn.textContent = 'Assigning…'
    const ok = await assignApprover(emp, proj, email)
    btn.disabled = false; btn.textContent = 'Assign approver'
    if (ok) refreshProfiles()   // also surfaces a newly invited approver in Users
  })
  document.querySelectorAll('#admin-approvers button[data-rm]').forEach(b => {
    b.addEventListener('click', async () => {
      if (await removeApproverLink(b.dataset.rm)) { toast('Removed'); renderApprovers() }
    })
  })
}

// ── Projects & customers ──
async function renderProjects() {
  const projects = await loadAllProjects()
  const custOpts = customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')

  const rows = projects.length ? projects.map(p => `
    <tr class="${p.active ? '' : 'ad-inactive'}">
      <td>${esc(p.customers?.name || '')}</td>
      <td>${esc(p.code)}</td>
      <td>${esc(p.description || '')}</td>
      <td>${p.active ? '<span class="status-badge submitted">Active</span>' : '<span class="status-badge">Inactive</span>'}</td>
      <td class="ad-right"><button class="btn btn-sm" data-toggle="${p.id}" data-active="${p.active}">${p.active ? 'Deactivate' : 'Activate'}</button></td>
    </tr>`).join('') : '<tr><td colspan="5" class="ad-empty">No projects yet.</td></tr>'

  document.getElementById('admin-projects').innerHTML = `
    <div class="admin-form">
      <div class="af-field"><label>Customer</label><select id="pr-cust">${custOpts}</select></div>
      <div class="af-field af-grow"><label>Project code</label><input id="pr-code" placeholder="IDGC1000567 - …"></div>
      <div class="af-field"><label>Description</label><input id="pr-desc" placeholder="optional"></div>
      <button class="btn btn-primary btn-sm" id="pr-add">Add project</button>
    </div>
    <div class="admin-form">
      <div class="af-field af-grow"><label>New customer</label><input id="cu-name" placeholder="e.g. WSP"></div>
      <button class="btn btn-sm" id="cu-add">Add customer</button>
    </div>
    <table class="admin-table">
      <thead><tr><th>Customer</th><th>Project Code</th><th>Description</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`

  document.getElementById('pr-add').addEventListener('click', async () => {
    const cust = document.getElementById('pr-cust').value
    const code = document.getElementById('pr-code').value.trim()
    const desc = document.getElementById('pr-desc').value.trim()
    if (!cust || !code) { toast('Pick a customer and enter a code.'); return }
    if (await addProject(cust, code, desc)) {
      toast('Project added ✓')
      allProjects = await loadAllProjects()
      renderProjects(); renderApprovers()
    }
  })
  document.getElementById('cu-add').addEventListener('click', async () => {
    const name = document.getElementById('cu-name').value.trim()
    if (!name) { toast('Enter a customer name.'); return }
    if (await addCustomer(name)) { toast('Customer added ✓'); customers = await loadCustomers(); renderProjects(); renderApprovers() }
  })
  document.querySelectorAll('#admin-projects button[data-toggle]').forEach(b => {
    b.addEventListener('click', async () => {
      const active = b.dataset.active === 'true'
      if (await setProjectActive(b.dataset.toggle, !active)) renderProjects()
    })
  })
}
