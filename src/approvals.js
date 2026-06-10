import { loadApprovals, loadApprovalEntries, decideApproval, profile } from './data.js'
import { toast } from './ui.js'
import { buildTimesheetPDF } from './pdf.js'
import { sb } from './supabase.js'

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }
function rowHours(h) { return (h || []).reduce((a, x) => a + (+x || 0), 0) }
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

let cache = []

export async function renderApprovals() {
  const list = document.getElementById('approvals-list')
  list.innerHTML = '<div class="dash-empty">Loading…</div>'

  cache = (await loadApprovals()).filter(a => a.status === 'Pending')
  if (!cache.length) {
    list.innerHTML = '<div class="dash-empty">No timesheets awaiting your approval. 🎉</div>'
    return
  }

  list.innerHTML = ''
  for (const a of cache) {
    const ts = a.timesheets
    const emp = ts?.profiles?.full_name || ts?.profiles?.email || 'Employee'
    const entries = await loadApprovalEntries(ts.id, a.project_id)
    a._entries = entries
    const total = entries.reduce((s, e) => s + rowHours(e.hours), 0)
    const projLabel = a.projects?.code || a.projects?.customers?.name || 'Project'

    const card = document.createElement('div')
    card.className = 'approval-card'
    card.innerHTML = `
      <div class="approval-head">
        <div>
          <div class="approval-emp">${esc(emp)}</div>
          <div class="approval-sub">${esc(projLabel)} · Week of ${ts.week_start} · <strong>${total.toFixed(1)} h</strong></div>
        </div>
        <div class="approval-actions">
          <button class="btn btn-sm" data-act="reject" data-id="${a.id}">Reject</button>
          <button class="btn btn-sm btn-primary" data-act="approve" data-id="${a.id}">✓ Approve</button>
        </div>
      </div>
      <table class="approval-entries">
        <thead><tr><th>Rate</th><th>Project</th><th>Hours</th></tr></thead>
        <tbody>${entries.map(e => `<tr>
          <td>${esc(e.rate)}</td>
          <td>${esc(e.projects?.code || '')}</td>
          <td class="ae-hrs">${rowHours(e.hours).toFixed(1)} h</td>
        </tr>`).join('')}</tbody>
      </table>`
    list.appendChild(card)
  }

  list.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', () => decide(btn, btn.dataset.id, btn.dataset.act))
  })
}

async function decide(btn, approvalId, act) {
  const approval = cache.find(a => a.id === approvalId)
  const decision = act === 'approve' ? 'Approved' : 'Rejected'
  btn.disabled = true; btn.textContent = decision === 'Approved' ? 'Approving…' : 'Rejecting…'

  const result = await decideApproval(approvalId, decision)
  if (!result) { btn.disabled = false; return }

  if (decision === 'Approved') await emailApproval(approval, result)

  toast(`Timesheet ${decision.toLowerCase()} ✓`)
  renderApprovals()
}

async function emailApproval(approval, result) {
  const ts = approval.timesheets
  const rows = (approval._entries || []).map(e => ({ rate: e.rate, proj: e.projects?.code || '', hours: e.hours }))
  const { base64, filename } = buildTimesheetPDF({
    employee: ts.profiles?.email,
    weekStart: ts.week_start,
    weekEnd: addDays(ts.week_start, 6),
    status: 'Approved',
    customer: approval.projects?.customers?.name,
    project: approval.projects?.code,
    approvedBy: profile?.email,
    decidedAt: result.decided_at
  }, rows)

  try {
    const { error } = await sb.functions.invoke('confirm-approval', {
      body: { approval_id: approval.id, pdf_base64: base64, filename }
    })
    if (error) toast('Approved — but confirmation email failed.')
  } catch {
    toast('Approved. (Email service not connected yet.)')
  }
}
