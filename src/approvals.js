import { loadApprovals, loadApprovalEntries, decideApproval, profile, logAction } from './data.js'
import { toast } from './ui.js'
import { buildTimesheetPDF } from './pdf.js'
import { sb } from './supabase.js'
import { refreshNotifications } from './notify.js'

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }
function rowHours(h) { return (h || []).reduce((a, x) => a + (+x || 0), 0) }
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function fmtStamp(iso) { return iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '' }

let cache = []

export async function renderApprovals() {
  const list = document.getElementById('approvals-list')
  list.innerHTML = '<div class="dash-empty">Loading…</div>'

  cache = await loadApprovals()
  // Load each approval's entries up front so cards + downloads have the detail.
  for (const a of cache) a._entries = await loadApprovalEntries(a.timesheets.id, a.project_id)

  const pending = cache.filter(a => a.status === 'Pending')
  const approved = cache.filter(a => a.status === 'Approved')

  if (!pending.length && !approved.length) {
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

  list.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = cache.find(x => x.id === btn.dataset.id)
      if (btn.dataset.act === 'download') downloadPdf(a)
      else decide(btn, a, btn.dataset.act)
    })
  })
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
  const isApproved = a.status === 'Approved'

  const actions = isApproved
    ? `<span class="status-badge submitted">✓ Approved ${esc(fmtStamp(a.decided_at))}</span>
       <button class="btn btn-sm btn-primary" data-act="download" data-id="${a.id}">⬇ Download PDF</button>`
    : `<button class="btn btn-sm" data-act="reject" data-id="${a.id}">Reject</button>
       <button class="btn btn-sm btn-primary" data-act="approve" data-id="${a.id}">✓ Approve</button>`

  const el = document.createElement('div')
  el.className = 'approval-card'
  el.innerHTML = `
    <div class="approval-head">
      <div>
        <div class="approval-emp">${esc(emp)}</div>
        <div class="approval-sub">${esc(projLabel)} · Week of ${ts.week_start} · <strong>${total.toFixed(1)} h</strong></div>
      </div>
      <div class="approval-actions">${actions}</div>
    </div>
    <table class="approval-entries">
      <thead><tr><th>Rate</th><th>Project</th><th>Hours</th></tr></thead>
      <tbody>${(a._entries || []).map(e => `<tr>
        <td>${esc(e.rate)}</td>
        <td>${esc(e.projects?.code || '')}</td>
        <td class="ae-hrs">${rowHours(e.hours).toFixed(1)} h</td>
      </tr>`).join('')}</tbody>
    </table>`
  return el
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
    decidedAt: a.decided_at
  }, rows)
}

function downloadPdf(a) {
  const { doc, filename } = buildPdf(a)
  doc.save(filename)
}

async function decide(btn, approval, act) {
  const decision = act === 'approve' ? 'Approved' : 'Rejected'
  btn.disabled = true; btn.textContent = decision === 'Approved' ? 'Approving…' : 'Rejecting…'

  const result = await decideApproval(approval.id, decision)
  if (!result) { btn.disabled = false; return }

  logAction(`approval: ${decision.toLowerCase()}`, 'approval', approval.id, {
    employee: approval.timesheets?.profiles?.email,
    project: approval.projects?.code,
    week: approval.timesheets?.week_start
  })

  if (decision === 'Approved') {
    approval.status = 'Approved'
    approval.decided_at = result.decided_at
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
