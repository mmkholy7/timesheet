import {
  loadProfiles, loadCustomers, loadAllProjects, addProject, addCustomer, setProjectActive,
  loadApproverLinks, assignApprover, removeApproverLink, createUserAccount, updateProfileRole,
  loadAuditLog, loadOrganizations, addOrganization, deleteOrganization, deleteCustomer, deleteProject,
  updateProfileOrg
} from './data.js'
import { toast } from './ui.js'

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }

const ROLES = ['employee', 'manager', 'admin']
let profiles = [], customers = [], allProjects = [], organizations = []

export async function renderAdmin() {
  ;[profiles, customers, allProjects, organizations] =
    await Promise.all([loadProfiles(), loadCustomers(), loadAllProjects(), loadOrganizations()])
  await Promise.all([renderUsers(), renderApprovers(), renderOrganizations(), renderProjects()])
}

// ── Organizations (tenants) ──
async function renderOrganizations() {
  const rows = organizations.length ? organizations.map(o => `
    <tr>
      <td>${esc(o.name)}</td>
      <td><span class="lg-ent">${esc(o.slug)}</span></td>
      <td class="ad-right"><button class="btn btn-sm btn-danger" data-org-del="${o.id}" data-name="${esc(o.name)}">Delete</button></td>
    </tr>`).join('') : '<tr><td colspan="3" class="ad-empty">No organizations yet.</td></tr>'

  document.getElementById('admin-orgs').innerHTML = `
    <div class="admin-form">
      <div class="af-field af-grow"><label>Organization name</label><input id="og-name" placeholder="e.g. Acme Corp"></div>
      <button class="btn btn-primary btn-sm" id="og-add">Add organization</button>
    </div>
    <table class="admin-table">
      <thead><tr><th>Name</th><th>Slug</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`

  document.getElementById('og-add').addEventListener('click', async () => {
    const name = document.getElementById('og-name').value.trim()
    if (!name) { toast('Enter an organization name.'); return }
    if (await addOrganization(name)) {
      toast('Organization added ✓')
      organizations = await loadOrganizations()
      renderOrganizations(); renderProjects()
    }
  })
  document.querySelectorAll('#admin-orgs button[data-org-del]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm(`Delete organization "${b.dataset.name}"? This permanently removes its customers, projects and all logged hours for them, and un-assigns its users. This cannot be undone.`)) return
      if (await deleteOrganization(b.dataset.orgDel)) {
        toast('Organization deleted')
        ;[organizations, customers, allProjects] = await Promise.all([loadOrganizations(), loadCustomers(), loadAllProjects()])
        renderOrganizations(); renderProjects()
      }
    })
  })
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
  const orgOpts = (sel) => `<option value="">— none —</option>` +
    organizations.map(o => `<option value="${o.id}"${o.id === sel ? ' selected' : ''}>${esc(o.name)}</option>`).join('')

  const rows = profiles.length ? profiles.map(p => `
    <tr>
      <td>${esc(p.email)}</td>
      <td>${esc(p.full_name || '')}</td>
      <td><select class="org-select" data-id="${p.id}">${orgOpts(p.organization_id)}</select></td>
      <td><select class="role-select" data-id="${p.id}">${roleOpts(p.role)}</select></td>
    </tr>`).join('') : '<tr><td colspan="4" class="ad-empty">No users yet.</td></tr>'

  document.getElementById('admin-users').innerHTML = `
    <div class="admin-form">
      <div class="af-field af-grow"><label>Email</label><input id="us-email" type="email" placeholder="person@uably.com"></div>
      <div class="af-field af-grow"><label>Full name</label><input id="us-name" placeholder="optional"></div>
      <div class="af-field"><label>Role</label><select id="us-role">${roleOpts('employee')}</select></div>
      <button class="btn btn-primary btn-sm" id="us-add">Add user</button>
    </div>
    <table class="admin-table">
      <thead><tr><th>Email</th><th>Name</th><th>Organization</th><th>Role</th></tr></thead>
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

  document.querySelectorAll('#admin-users .org-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      if (await updateProfileOrg(sel.dataset.id, sel.value)) { toast('Organization updated ✓'); refreshProfiles() }
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
      <div class="af-field af-grow"><label>Approver email</label><input id="ap-email" type="email" placeholder="approver@example.com"></div>
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

// ── Customers ──
async function renderCustomers() {
  const orgOpts = organizations.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')

  const rows = customers.length ? customers.map(c => `
    <tr>
      <td>${esc(c.name)}</td>
      <td>${esc(c.organizations?.name || '— unassigned —')}</td>
      <td class="ad-right"><button class="btn btn-sm btn-danger" data-cust-del="${c.id}" data-name="${esc(c.name)}">Delete</button></td>
    </tr>`).join('') : '<tr><td colspan="3" class="ad-empty">No customers yet.</td></tr>'

  document.getElementById('admin-customers').innerHTML = `
    <div class="admin-form">
      <div class="af-field"><label>Organization</label><select id="cu-org">${orgOpts || '<option value="">Add an organization first</option>'}</select></div>
      <div class="af-field af-grow"><label>Customer name</label><input id="cu-name" placeholder="e.g. WSP"></div>
      <button class="btn btn-primary btn-sm" id="cu-add">Add customer</button>
    </div>
    <table class="admin-table">
      <thead><tr><th>Customer</th><th>Organization</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`

  document.getElementById('cu-add').addEventListener('click', async () => {
    const org = document.getElementById('cu-org').value
    const name = document.getElementById('cu-name').value.trim()
    if (!name) { toast('Enter a customer name.'); return }
    if (await addCustomer(name, org)) {
      toast('Customer added ✓')
      customers = await loadCustomers()
      renderProjects(); renderApprovers()   // renderProjects also re-renders Customers
    }
  })
  document.querySelectorAll('#admin-customers button[data-cust-del]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm(`Delete customer "${b.dataset.name}"? This permanently removes its projects and all logged hours for them. This cannot be undone.`)) return
      if (await deleteCustomer(b.dataset.custDel)) {
        toast('Customer deleted')
        ;[customers, allProjects] = await Promise.all([loadCustomers(), loadAllProjects()])
        renderProjects(); renderApprovers()   // renderProjects also re-renders Customers
      }
    })
  })
}

// ── Projects ──
async function renderProjects() {
  await renderCustomers()
  const projects = await loadAllProjects()
  const custOpts = customers.map(c =>
    `<option value="${c.id}">${esc(c.organizations?.name ? c.organizations.name + ' · ' : '')}${esc(c.name)}</option>`).join('')

  const rows = projects.length ? projects.map(p => `
    <tr class="${p.active ? '' : 'ad-inactive'}">
      <td>${esc(p.customers?.name || '')}</td>
      <td>${esc(p.code)}</td>
      <td>${esc(p.description || '')}</td>
      <td>${p.active ? '<span class="status-badge submitted">Active</span>' : '<span class="status-badge">Inactive</span>'}</td>
      <td class="ad-right">
        <button class="btn btn-sm" data-toggle="${p.id}" data-active="${p.active}">${p.active ? 'Deactivate' : 'Activate'}</button>
        <button class="btn btn-sm btn-danger" data-proj-del="${p.id}" data-name="${esc(p.code)}">Delete</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="5" class="ad-empty">No projects yet.</td></tr>'

  document.getElementById('admin-projects').innerHTML = `
    <div class="admin-form">
      <div class="af-field"><label>Customer</label><select id="pr-cust">${custOpts || '<option value="">Add a customer first</option>'}</select></div>
      <div class="af-field af-grow"><label>Project code</label><input id="pr-code" placeholder="IDGC1000567 - …"></div>
      <div class="af-field"><label>Description</label><input id="pr-desc" placeholder="optional"></div>
      <button class="btn btn-primary btn-sm" id="pr-add">Add project</button>
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
  document.querySelectorAll('#admin-projects button[data-toggle]').forEach(b => {
    b.addEventListener('click', async () => {
      const active = b.dataset.active === 'true'
      if (await setProjectActive(b.dataset.toggle, !active)) renderProjects()
    })
  })
  document.querySelectorAll('#admin-projects button[data-proj-del]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm(`Delete project "${b.dataset.name}"? This permanently removes all logged hours and approvals for it. This cannot be undone.`)) return
      if (await deleteProject(b.dataset.projDel)) {
        toast('Project deleted')
        allProjects = await loadAllProjects()
        renderProjects(); renderApprovers()
      }
    })
  })
}
