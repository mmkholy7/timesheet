import { allSheets, profile, emailTimesheetPDF } from './data.js'
import { buildRangePDF } from './pdf.js'
import { weekKey } from './timesheet.js'
import { toast } from './ui.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const selected = new Set()

function weekHrs(wk) {
  return allSheets[wk].rows.reduce((a, r) => a + r.hours.reduce((b, h) => b + (+h || 0), 0), 0)
}
function parseLocal(wk) { const [y, m, d] = wk.split('-').map(Number); return new Date(y, m - 1, d) }
function weekRangeLabel(wk) {
  const s = parseLocal(wk), e = new Date(s); e.setDate(e.getDate() + 6)
  return `${MONTHS[s.getMonth()]} ${s.getDate()} – ${MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`
}

function trackedWeeks() {
  // Most-recent first; only weeks that have any hours logged.
  return Object.keys(allSheets).filter(wk => weekHrs(wk) > 0).sort().reverse()
}

export function openSendPdf() {
  const weeks = trackedWeeks()
  if (!weeks.length) { toast('No hours logged yet — nothing to send.'); return }
  selected.clear()
  document.getElementById('send-to').value = profile?.email || ''
  renderWeekList(weeks)
  document.getElementById('sendpdf-modal').classList.add('open')
}

export function closeSendPdf() {
  document.getElementById('sendpdf-modal').classList.remove('open')
}

function renderWeekList(weeks) {
  document.getElementById('sp-weeks').innerHTML = weeks.map(wk => `
    <label class="sp-week">
      <input type="checkbox" data-wk="${wk}" ${selected.has(wk) ? 'checked' : ''}>
      <span class="sp-week-label">${weekRangeLabel(wk)}</span>
      <span class="sp-week-hrs">${weekHrs(wk).toFixed(1)} h</span>
    </label>`).join('')

  document.querySelectorAll('#sp-weeks input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.checked ? selected.add(cb.dataset.wk) : selected.delete(cb.dataset.wk)
      updateSummary()
    })
  })
  updateSummary()
}

function updateSummary() {
  const total = [...selected].reduce((a, wk) => a + weekHrs(wk), 0)
  const n = selected.size
  document.getElementById('sp-summary').textContent =
    n ? `${n} week${n > 1 ? 's' : ''} · ${total.toFixed(1)} h selected` : 'No weeks selected'
  document.getElementById('sp-send').disabled = n === 0
  const dl = document.getElementById('sp-download')
  if (dl) dl.disabled = n === 0
}

// Quick selectors: 'week' = current week, 'month' = all weeks in current month, 'clear'.
export function sendPdfQuick(which) {
  const all = trackedWeeks()
  if (which === 'clear') { selected.clear() }
  else if (which === 'week') {
    const cur = weekKey(new Date())
    if (allSheets[cur] && weekHrs(cur) > 0) selected.add(cur)
    else toast('No hours on the current week.')
  } else if (which === 'month') {
    const now = new Date()
    all.forEach(wk => {
      const d = parseLocal(wk)
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) selected.add(wk)
    })
    if (!selected.size) toast('No hours logged this month.')
  }
  renderWeekList(all)
}

function periodLabel(chosen) {
  if (chosen.length === 1) return `Week of ${weekRangeLabel(chosen[0])}`
  // All in one calendar month? → "June 2026"
  const months = new Set(chosen.map(wk => { const d = parseLocal(wk); return `${d.getFullYear()}-${d.getMonth()}` }))
  if (months.size === 1) {
    const d = parseLocal(chosen[0])
    return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]} ${d.getFullYear()}`
  }
  return `${chosen.length} weeks`
}

// Shared: turn the current selection into a built range PDF. Returns null (and
// toasts) if nothing valid is selected.
function buildSelectedPdf() {
  const chosen = [...selected].sort()
  if (!chosen.length) { toast('Select at least one week.'); return null }

  const weeks = chosen.map(wk => ({
    weekStart: wk,
    rows: allSheets[wk].rows.filter(r => r.hours.reduce((a, h) => a + (+h || 0), 0) > 0)
  })).filter(w => w.rows.length)
  if (!weeks.length) { toast('Selected weeks have no hours.'); return null }

  const label = periodLabel(chosen)
  const fileTag = chosen.length === 1 ? chosen[0] : `${chosen[0]}_to_${chosen[chosen.length - 1]}`
  const built = buildRangePDF({ employee: profile?.email, periodLabel: label, fileTag }, weeks)
  return { ...built, label }
}

export async function sendPdfNow() {
  const to = document.getElementById('send-to').value.trim()
  if (!to) { toast('Enter a recipient email.'); return }
  const built = buildSelectedPdf()
  if (!built) return

  const btn = document.getElementById('sp-send')
  btn.disabled = true; btn.textContent = 'Sending…'
  const ok = await emailTimesheetPDF({ to, periodLabel: built.label, base64: built.base64, filename: built.filename })
  btn.disabled = false; btn.textContent = 'Send PDF'
  if (ok) { toast(`Sent to ${to} ✓`); closeSendPdf() }
}

// Download the selected week(s)/month locally instead of emailing.
export function downloadPdfNow() {
  const built = buildSelectedPdf()
  if (!built) return
  built.doc.save(built.filename)
  toast('Downloaded ✓')
  closeSendPdf()
}
