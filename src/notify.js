import { loadApprovals } from './data.js'

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }

let open = false

// Refresh the bell badge + dropdown from the approvals the current user can see.
export async function refreshNotifications() {
  const bell = document.getElementById('notif')
  if (!bell || bell.style.display === 'none') return   // not an approver

  const pending = (await loadApprovals()).filter(a => a.status === 'Pending')

  const badge = document.getElementById('notif-badge')
  badge.textContent = pending.length
  badge.style.display = pending.length ? '' : 'none'

  const list = document.getElementById('notif-list')
  if (!pending.length) {
    list.innerHTML = '<div class="notif-empty">Nothing pending. 🎉</div>'
    return
  }
  list.innerHTML = pending.map(a => {
    const ts = a.timesheets
    const emp = esc(ts?.profiles?.full_name || ts?.profiles?.email || 'Employee')
    const proj = esc(a.projects?.code || a.projects?.customers?.name || 'Project')
    return `<button class="notif-item">
      <div class="notif-emp">${emp}</div>
      <div class="notif-meta">${proj} · Week of ${ts.week_start}</div>
    </button>`
  }).join('')
  list.querySelectorAll('.notif-item').forEach(b =>
    b.addEventListener('click', () => { closeNotif(); window.setView('approvals') }))
}

export function toggleNotif() {
  open = !open
  document.getElementById('notif-panel').classList.toggle('open', open)
  if (open) refreshNotifications()
}

export function closeNotif() {
  open = false
  document.getElementById('notif-panel').classList.remove('open')
}

// Close the dropdown when clicking anywhere outside the bell.
document.addEventListener('click', (e) => {
  if (open && !e.target.closest('#notif')) closeNotif()
})
