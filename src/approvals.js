import { loadApprovals, loadApprovalEntries, decideApproval, profile, logAction, loadMyApproverKeys } from './data.js'
import { toast } from './ui.js'
import { buildTimesheetPDF } from './pdf.js'
import { sb } from './supabase.js'
import { refreshNotifications } from './notify.js'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }
function rowHours(h) { return (h || []).reduce((a, x) => a + (+x || 0), 0) }
function dayCell(v) { const n = +v || 0; return n ? n.toFixed(1) : '<span class="ae-zero">–</span>' }
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function fmtStamp(iso) { return iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '' }

let cache = []
let focusId = null   // an approval id to scroll to / highlight on next render

// Called from the bell dropdown: jump to Approvals and spotlight one card.
export function focusApproval(id) {
  focusId = id
  window.setView('approvals')   // triggers renderApprovals
}

export async function renderApprovals() {
  const list = document.getElementById('approvals-list')
  list.innerHTML = '<div class="dash-empty">Loading…</div>'

  // Only what THIS user is the assigned approver for (not their own, not — for
  // admins — everyone's).
  const myKeys = await loadMyApproverKeys()
  cache = (await loadApprovals()).filter(a => myKeys.has(`${a.timesheets?.user_id}:${a.project_id}`))
  // Load each approval's entries up front so cards + downloads have the detail.
  for (const a of cache) a._entries = await loadApprovalEntries(a.timesheets.id, a.project_id)

  const pending = cache.filter(a => a.status === 'Pending')
  const approved = cache.filter(a => a.status === 'Approved')
  const rejected = cache.filter(a => a.status === 'Rejected')

  if (!pending.length && !approved.length && !rejected.length) {
    list.innerHTML = '<div class="dash-empty">No timesheets awaiting your approval. 🎉</div>'
    return
  }

  list.innerHTML = ''
  if (pending.length) {
    list.appendChild(sectionTitle(`Awaiting your approval (${pending.length})`))
    pending.forEach(a => list.appendChild(card(a)))
  }
  if (approved.length) {
    list.appendChild(sectionTitle(`Approved (${approved.length})`))
    approved.forEach(a => list.appendChild(card(a)))
  }
  if (rejected.length) {
    list.appendChild(sectionTitle(`Rejected (${rejected.length})`))
    rejected.forEach(a => list.appendChild(card(a)))
  }

  list.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = cache.find(x => x.id === btn.dataset.id)
      if (btn.dataset.act === 'download') downloadPdf(a)
      else decide(btn, a, btn.dataset.act)
    })
  })

  // If we arrived here from a bell notification, spotlight that card.
  if (focusId) {
    const card = list.querySelector(`[data-approval-id="${focusId}"]`)
    focusId = null
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' })
      card.classList.add('approval-flash')
      setTimeout(() => card.classList.remove('approval-flash'), 1800)
    }
  }
}

function sectionTitle(text) {
  const h = document.createElement('div')
  h.className = 'appr-section'
  h.textContent = text
  return h
}

function card(a) {
  const ts = a.timesheets
  const emp = ts?.profiles?.full_name || ts?.profiles?.email || 'Employee'
  const total = (a._entries || []).reduce((s, e) => s + rowHours(e.hours), 0)
  const projLabel = a.projects?.code || a.projects?.customers?.name || 'Project'

  let actions
  if (a.status === 'Approved') {
    actions = `<span class="status-badge submitted">✓ Approved ${esc(fmtStamp(a.decided_at))}</span>
       <button class="btn btn-sm btn-primary" data-act="download" data-id="${a.id}">⬇ Download PDF</button>`
  } else if (a.status === 'Rejected') {
    actions = `<span class="status-badge rejected">✕ Rejected ${esc(fmtStamp(a.decided_at))}</span>`
  } else {
    actions = `<button class="btn btn-sm" data-act="reject" data-id="${a.id}">Reject</button>
       <button class="btn btn-sm btn-primary" data-act="approve" data-id="${a.id}">✓ Approve</button>`
  }

  const commentRow = a.comment
    ? `<div class="approval-comment"><strong>Reason:</strong> ${esc(a.comment)}</div>`
    : ''

  const el = document.createElement('div')
  el.className = 'approval-card'
  el.dataset.approvalId = a.id
  el.innerHTML = `
    <div class="approval-head">
      <div>
        <div class="approval-emp">${esc(emp)}</div>
        <div class="approval-sub">${esc(projLabel)} · Week of ${ts.week_start} · <strong>${total.toFixed(1)} h</strong></div>
      </div>
      <div class="approval-actions">${actions}</div>
    </div>
    ${commentRow}
    <table class="approval-entries">
      <thead><tr><th>Rate</th><th>Project</th>${DAYS.map(d => `<th class="ae-day">${d}</th>`).join('')}<th>Total</th></tr></thead>
      <tbody>${(a._entries || []).map(e => `<tr>
        <td>${esc(e.rate)}</td>
        <td>${esc(e.projects?.code || '')}</td>
        ${DAYS.map((_, i) => `<td class="ae-day">${dayCell((e.hours || [])[i])}</td>`).join('')}
        <td class="ae-hrs">${rowHours(e.hours).toFixed(1)} h</td>
      </tr>`).join('')}</tbody>
    </table>`
  return el
}

// Best-effort public IP. Browsers can't read their own IP, so ask an echo service.
async function clientIp() {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const r = await fetch('https://api64.ipify.org?format=json', { signal: ctrl.signal })
    clearTimeout(t)
    return (await r.json()).ip || ''
  } catch { return '' }
}

// SHA-256 of "ip|timestamp" — ties the approval to the approver's network identity.
async function hashIpTimestamp(ip, timestamp) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${timestamp}`))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Build the approved (or to-be-approved) PDF for one approval.
function buildPdf(a) {
  const ts = a.timesheets
  const rows = (a._entries || []).map(e => ({ rate: e.rate, proj: e.projects?.code || '', hours: e.hours }))
  return buildTimesheetPDF({
    employee: ts.profiles?.email,
    weekStart: ts.week_start,
    weekEnd: addDays(ts.week_start, 6),
    status: a.status === 'Approved' ? 'Approved' : 'Submitted',
    customer: a.projects?.customers?.name,
    project: a.projects?.code,
    approvedBy: a.status === 'Approved' ? profile?.email : null,
    decidedAt: a.decided_at,
    approvalIpHash: a.ip_hash || null
  }, rows)
}

function downloadPdf(a) {
  const { doc, filename } = buildPdf(a)
  doc.save(filename)
}

async function decide(btn, approval, act) {
  const decision = act === 'approve' ? 'Approved' : 'Rejected'

  // Rejection: ask the approver for a reason so the employee knows what to fix.
  let comment = null
  if (decision === 'Rejected') {
    comment = (window.prompt('Reason for rejecting (the employee will see this):', '') || '').trim()
    if (!comment) { toast('Rejection cancelled — a reason is required.'); return }
  }

  btn.disabled = true; btn.textContent = decision === 'Approved' ? 'Approving…' : 'Rejecting…'

  // Capture IP and pre-compute the timestamp so hash and DB value are identical.
  const ip = await clientIp()
  const decidedAt = new Date().toISOString()
  const ipHash = await hashIpTimestamp(ip, decidedAt)

  const result = await decideApproval(approval.id, decision, comment, decidedAt, ipHash)
  if (!result) { btn.disabled = false; return }

  logAction(`approval: ${decision.toLowerCase()}`, 'approval', approval.id, {
    employee: approval.timesheets?.profiles?.email,
    project: approval.projects?.code,
    week: approval.timesheets?.week_start,
    comment: comment || undefined,
    ip_hash: ipHash
  })

  if (decision === 'Approved') {
    approval.status = 'Approved'
    approval.decided_at = result.decided_at
    approval.ip_hash = ipHash            // locally computed — never depends on DB round-trip
    downloadPdf(approval)                 // hand the approver the signed PDF immediately
    await emailApproval(approval, result) // …and email a copy (employee + approver)
  }

  toast(`Timesheet ${decision.toLowerCase()} ✓`)
  renderApprovals()
  refreshNotifications()   // update the pending-approval bell
}

async function emailApproval(approval, result) {
  const { base64, filename } = buildPdf(approval)
  try {
    const { error } = await sb.functions.invoke('confirm-approval', {
      body: { approval_id: approval.id, pdf_base64: base64, filename }
    })
    if (error) toast('Approved — but confirmation email failed.')
  } catch {
    toast('Approved. (Email service not connected yet.)')
  }
}
