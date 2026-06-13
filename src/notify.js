import { loadApprovals, loadMyApproverKeys } from './data.js'
import { toast } from './ui.js'

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }

const OVERDUE_DAYS = 7
const DAY_MS = 86400000
let open = false
let overdueWarned = false   // only toast the "over a week" warning once per session

function ageDays(iso) {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS)
}

// Refresh the bell badge + dropdown from the approvals the current user can see.
export async function refreshNotifications() {
  const bell = document.getElementById('notif')
  if (!bell || bell.style.display === 'none') return   // not an approver

  const myKeys = await loadMyApproverKeys()
  const pending = (await loadApprovals()).filter(a =>
    a.status === 'Pending' && myKeys.has(`${a.timesheets?.user_id}:${a.project_id}`))

  const overdue = pending.filter(a => ageDays(a.created_at) >= OVERDUE_DAYS)

  const badge = document.getElementById('notif-badge')
  badge.textContent = pending.length
  badge.style.display = pending.length ? '' : 'none'
  // Flag the bell when something has been waiting too long.
  bell.classList.toggle('has-overdue', overdue.length > 0)

  // Pop a one-time heads-up when there are week-old pending timesheets.
  if (overdue.length && !overdueWarned) {
    overdueWarned = true
    toast(`You have ${overdue.length} timesheet${overdue.length > 1 ? 's' : ''} pending over a week — please review.`)
  }
  if (!overdue.length) overdueWarned = false

  const list = document.getElementById('notif-list')
  if (!pending.length) {
    list.innerHTML = '<div class="notif-empty">Nothing pending. 🎉</div>'
    return
  }
  list.innerHTML = pending.map(a => {
    const ts = a.timesheets
    const emp = esc(ts?.profiles?.full_name || ts?.profiles?.email || 'Employee')
    const proj = esc(a.projects?.code || a.projects?.customers?.name || 'Project')
    const days = ageDays(a.created_at)
    const late = days >= OVERDUE_DAYS
      ? `<span class="notif-overdue">${days}d waiting</span>` : ''
    return `<button class="notif-item" data-id="${a.id}">
      <div class="notif-emp">${emp}${late}</div>
      <div class="notif-meta">${proj} · Week of ${ts.week_start}</div>
    </button>`
  }).join('')
  list.querySelectorAll('.notif-item').forEach(b =>
    b.addEventListener('click', () => { closeNotif(); window.focusApproval(b.dataset.id) }))
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
