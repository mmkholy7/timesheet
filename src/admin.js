import {
  loadProfiles, loadCustomers, loadAllProjects, addProject, addCustomer, setProjectActive,
  loadApproverLinks, assignApprover, removeApproverLink
} from './data.js'
import { toast } from './ui.js'

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }

let profiles = [], customers = []

export async function renderAdmin() {
  ;[profiles, customers] = await Promise.all([loadProfiles(), loadCustomers()])
  await Promise.all([renderApprovers(), renderProjects()])
}

// ── Approvers ──
async function renderApprovers() {
  const links = await loadApproverLinks()
  const empOpts = profiles.map(p => `<option value="${p.id}">${esc(p.email)}</option>`).join('')
  const custOpts = customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')

  const rows = links.length ? links.map(l => `
    <tr>
      <td>${esc(l.employee?.email || '')}</td>
      <td>${esc(l.customers?.name || '')}</td>
      <td>${esc(l.manager?.email || '')}</td>
      <td class="ad-right"><button class="btn btn-sm btn-danger" data-rm="${l.id}">Remove</button></td>
    </tr>`).join('') : '<tr><td colspan="4" class="ad-empty">No approvers assigned yet.</td></tr>'

  document.getElementById('admin-approvers').innerHTML = `
    <div class="admin-form">
      <div class="af-field"><label>Employee</label><select id="ap-emp">${empOpts}</select></div>
      <div class="af-field"><label>Customer</label><select id="ap-cust">${custOpts}</select></div>
      <div class="af-field af-grow"><label>Approver email</label><input id="ap-email" type="email" placeholder="boss@wsp.com"></div>
      <button class="btn btn-primary btn-sm" id="ap-assign">Assign approver</button>
    </div>
    <table class="admin-table">
      <thead><tr><th>Employee</th><th>Customer</th><th>Approver</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`

  // default the employee select to the current admin (first match is fine)
  document.getElementById('ap-assign').addEventListener('click', async () => {
    const emp = document.getElementById('ap-emp').value
    const cust = document.getElementById('ap-cust').value
    const email = document.getElementById('ap-email').value
    const btn = document.getElementById('ap-assign')
    btn.disabled = true; btn.textContent = 'Assigning…'
    const ok = await assignApprover(emp, cust, email)
    btn.disabled = false; btn.textContent = 'Assign approver'
    if (ok) { toast('Approver assigned ✓'); renderApprovers() }
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
    if (await addProject(cust, code, desc)) { toast('Project added ✓'); renderProjects() }
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
