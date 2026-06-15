import { allSheets, getLocalSheet, newRow, scheduleSave, saveSheet, projects, createApprovalsForSheet, logAction, recallSheet as recallSheetDb, loadCustomers, addProject, loadMyApprovals, myApprovals, loadApprovedDetail, profile, loadMyRoutedProjectIds } from './data.js'
import { toast } from './ui.js'
import { sb } from './supabase.js'
import { refreshNotifications } from './notify.js'
import { buildApprovedPDF } from './pdf.js'

const RATES = ['Regular - Hourly', 'Overtime - Hourly', 'Double Time', 'Stat Holiday']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export let currentWeekStart = getWeekStart(new Date())

// Pull the current user's approval state (approved / rejected per week) and
// re-render so the lock + banners reflect it.
export async function refreshApprovals() {
  await loadMyApprovals()
  render()
}

// Weekend (Sun = day index 0, Sat = day index 6) is hidden by default.
let showWeekend = false
function visibleDays() {
  return showWeekend ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]
}
export function toggleWeekend() {
  showWeekend = !showWeekend
  render()
}

export function getWeekStart(d) {
  const dt = new Date(d)
  dt.setDate(dt.getDate() - dt.getDay())
  dt.setHours(0, 0, 0, 0)
  return dt
}

export function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fmtShort(d) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function weekKey(dt) {
  return fmtDate(getWeekStart(dt))
}

export function getWeekDays(start) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return d
  })
}

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function render() {
  const wk = weekKey(currentWeekStart)
  const days = getWeekDays(currentWeekStart)
  const end = days[6]
  const sheet = getLocalSheet(wk)
  const today = fmtDate(new Date())

  document.getElementById('week-label').textContent = `${fmtShort(currentWeekStart)} – ${fmtShort(end)} ${end.getFullYear()}`
  document.getElementById('meta-start').textContent = fmtDate(currentWeekStart)
  document.getElementById('meta-end').textContent = fmtDate(end)
  document.getElementById('sheet-id').textContent = `Week of ${wk}`

  // An approved week (any project approved) is locked: read-only until recalled.
  const appr = myApprovals[wk]
  const locked = !!(appr && appr.approved)

  const badge = document.getElementById('status-badge')
  badge.textContent = locked ? 'Approved' : sheet.status
  badge.className = 'status-badge' + (locked ? ' approved' : (sheet.status === 'Submitted' ? ' submitted' : ''))

  // Recall is available once submitted (and is the way to unlock an approved week).
  const recallBtn = document.getElementById('recall-btn')
  if (recallBtn) recallBtn.style.display = (sheet.status === 'Submitted' || locked) ? '' : 'none'
  // Submitting an approved/locked week is meaningless — hide those actions.
  const submitBtn = document.getElementById('submit-btn')
  const submitSendBtn = document.getElementById('submitsend-btn')
  if (submitBtn) submitBtn.style.display = locked ? 'none' : ''
  if (submitSendBtn) submitSendBtn.style.display = locked ? 'none' : ''
  // Approved week → offer the invoice-ready approved PDF.
  const dlApprovedBtn = document.getElementById('download-approved-btn')
  if (dlApprovedBtn) dlApprovedBtn.style.display = locked ? '' : 'none'

  // Lock notice for an approved week.
  const lockBanner = document.getElementById('lock-banner')
  if (lockBanner) {
    lockBanner.style.display = locked ? '' : 'none'
    if (locked) lockBanner.innerHTML = `<strong>Approved — locked.</strong> This week has been approved and can't be edited. <span class="rb-hint">Recall it to make changes.</span>`
  }

  // Show the approver's rejection reason(s) for this week, if any.
  const banner = document.getElementById('reject-banner')
  if (banner) {
    const rej = appr && appr.rejected
    if (rej && rej.length) {
      banner.style.display = ''
      banner.innerHTML = `<strong>Returned by your approver.</strong> ` +
        rej.map(r => `${escHtml(r.project)}${r.comment ? ' — ' + escHtml(r.comment) : ''}`).join(' · ') +
        ` <span class="rb-hint">Fix and resubmit.</span>`
    } else {
      banner.style.display = 'none'
    }
  }

  // Disable the add-row / add-project actions while locked.
  const addRowBtn = document.getElementById('addrow-btn')
  const addProjBtn = document.getElementById('addproj-btn')
  if (addRowBtn) addRowBtn.disabled = locked
  if (addProjBtn) addProjBtn.disabled = locked

  const visible = visibleDays()

  // Header
  let hdr = '<tr><th style="min-width:155px">Rate</th><th style="min-width:210px">Project Code</th>'
  days.forEach((d, di) => {
    if (!visible.includes(di)) return
    const isToday = fmtDate(d) === today
    hdr += `<th><div class="day-col-header${isToday ? ' today' : ''}">
      <span class="day-name">${DAYS[d.getDay()]}</span>
      <span class="day-date">${MONTHS[d.getMonth()]} ${d.getDate()}</span>
    </div></th>`
  })
  hdr += '<th>Total</th><th></th></tr>'
  document.getElementById('ts-thead').innerHTML = hdr

  // Body
  const dis = locked ? ' disabled' : ''
  const tbody = document.getElementById('ts-tbody')
  tbody.innerHTML = ''
  sheet.rows.forEach((row, ri) => {
    const tr = document.createElement('tr')
    let td = `<td><select class="rate-select" data-ri="${ri}"${dis}>${RATES.map(r =>
      `<option${r === row.rate ? ' selected' : ''}>${r}</option>`).join('')}</select></td>`
    const projOpts = projects.map(p =>
      `<option value="${p.id}"${p.id === row.project_id ? ' selected' : ''}>${escHtml(p.code)}</option>`).join('')
    td += `<td><select class="proj-select" data-ri="${ri}"${dis}><option value="">— select project —</option>${projOpts}</select></td>`
    row.hours.forEach((h, di) => {
      if (!visible.includes(di)) return
      td += `<td><input class="hours-input${h > 0 ? ' has-value' : ''}" type="number" min="0" max="24" step="0.25" value="${h || ''}" placeholder="0" data-ri="${ri}" data-di="${di}"${dis}></td>`
    })
    const rowTotal = row.hours.reduce((a, b) => a + (+b || 0), 0)
    td += `<td class="total-cell">${rowTotal.toFixed(2)}</td>`
    td += `<td class="col-delete"><button class="btn btn-sm btn-danger" data-ri="${ri}"${dis}>✕</button></td>`
    tr.innerHTML = td
    tbody.appendChild(tr)
  })

  // Footer
  const colTotals = Array(7).fill(0)
  sheet.rows.forEach(row => row.hours.forEach((h, i) => { colTotals[i] += (+h || 0) }))
  const grand = colTotals.reduce((a, b) => a + b, 0)
  document.getElementById('meta-total').textContent = grand.toFixed(2)

  let ft = '<tr class="tfoot-row"><td>Daily Total</td><td></td>'
  colTotals.forEach((t, i) => { if (!visible.includes(i)) return; ft += `<td>${t.toFixed(2)}</td>` })
  ft += `<td>${grand.toFixed(2)}</td><td></td></tr>`
  document.getElementById('ts-tfoot').innerHTML = ft

  const wkndBtn = document.getElementById('weekend-btn')
  if (wkndBtn) wkndBtn.textContent = showWeekend ? '− Hide weekend' : '+ Show weekend'

  updateSummary()
  bindTableEvents()
}

function bindTableEvents() {
  const wk = weekKey(currentWeekStart)

  document.querySelectorAll('.rate-select').forEach(el => {
    el.addEventListener('change', e => {
      const ri = +e.target.dataset.ri
      allSheets[wk].rows[ri].rate = e.target.value
      scheduleSave(wk)
      render()
    })
  })

  document.querySelectorAll('.proj-select').forEach(el => {
    el.addEventListener('change', e => {
      const ri = +e.target.dataset.ri
      const pid = e.target.value || null
      const row = getLocalSheet(wk).rows[ri]
      row.project_id = pid
      const p = projects.find(x => x.id === pid)
      row.proj = p ? p.code : ''
      scheduleSave(wk)
    })
  })

  document.querySelectorAll('.hours-input').forEach(el => {
    el.addEventListener('input', e => {
      const ri = +e.target.dataset.ri
      const di = +e.target.dataset.di
      getLocalSheet(wk).rows[ri].hours[di] = +e.target.value || 0
      scheduleSave(wk)
      render()
    })
  })

  document.querySelectorAll('.col-delete button').forEach(el => {
    el.addEventListener('click', e => {
      const ri = +e.target.dataset.ri
      const rows = allSheets[wk].rows
      if (rows.length === 1) rows[0] = newRow()
      else rows.splice(ri, 1)
      scheduleSave(wk)
      render()
    })
  })
}

export function updateSummary() {
  const wk = weekKey(currentWeekStart)
  const sheet = getLocalSheet(wk)
  const weekHrs = sheet.rows.reduce((a, r) => a + r.hours.reduce((b, h) => b + (+h || 0), 0), 0)
  document.getElementById('sum-week').textContent = weekHrs.toFixed(1) + ' h'

  const mn = currentWeekStart.getMonth()
  const yr = currentWeekStart.getFullYear()
  let mhrs = 0, thrs = 0

  Object.entries(allSheets).forEach(([k, v]) => {
    const d = new Date(k)
    const wkHrs = v.rows.reduce((a, r) => a + r.hours.reduce((b, h) => b + (+h || 0), 0), 0)
    if (d.getMonth() === mn && d.getFullYear() === yr) mhrs += wkHrs
    thrs += wkHrs
  })

  document.getElementById('sum-month').textContent = mhrs.toFixed(1) + ' h'
  document.getElementById('sum-total').textContent = thrs.toFixed(1) + ' h'
}

export function addRow() {
  const wk = weekKey(currentWeekStart)
  getLocalSheet(wk).rows.push(newRow())
  scheduleSave(wk)
  render()
}

// Mark the week Submitted and create Pending approval rows (per project), but
// do NOT email anyone. Shared by both submit actions.
async function markSubmitted(wk) {
  const sheet = getLocalSheet(wk)
  if (!sheet.rows.some(r => r.project_id && r.hours.some(h => +h > 0))) {
    toast('Add hours to a project before submitting.'); return false
  }
  // Warn about projects with hours that have no approver assigned — their
  // approval would route to nobody and silently never appear in any queue.
  const routed = await loadMyRoutedProjectIds()
  const unrouted = [...new Map(
    sheet.rows
      .filter(r => r.project_id && r.hours.some(h => +h > 0) && !routed.has(r.project_id))
      .map(r => [r.project_id, r.proj || r.project_id])
  ).values()]
  if (unrouted.length) {
    const ok = confirm(
      `No approver is assigned for:\n\n• ${unrouted.join('\n• ')}\n\n` +
      `Those hours won't reach anyone for approval until an admin assigns an approver ` +
      `(Admin → Approvers). Submit anyway?`
    )
    if (!ok) return false
  }
  sheet.status = 'Submitted'
  await saveSheet(wk)
  await createApprovalsForSheet(wk)           // route to approver(s) per project
  const hrs = sheet.rows.reduce((a, r) => a + r.hours.reduce((b, h) => b + (+h || 0), 0), 0)
  logAction('timesheet: submitted', 'timesheet', wk, { hours: +hrs.toFixed(2) })
  render()
  return true
}

// "Submit" — record the week as submitted (and route to approvers) without
// emailing. Works for a fresh Draft and for resubmitting a rejected week.
export async function submitSheet() {
  const wk = weekKey(currentWeekStart)
  const appr = myApprovals[wk]
  const resubmit = appr && appr.rejected && appr.rejected.length
  if (!(await markSubmitted(wk))) return    // sets Submitted + (re)routes approvals
  await refreshApprovals()                  // clear the reject banner / refresh state
  toast(resubmit ? 'Resubmitted ✓ (approver not notified)' : 'Submitted ✓ (approver not notified)')
}

// "Submit & send for approval" — submit, route, and email the approver(s).
export async function submitAndSend() {
  const wk = weekKey(currentWeekStart)
  const sheet = getLocalSheet(wk)
  if (!(await markSubmitted(wk))) return    // sets Submitted + (re)routes approvals

  let emailed = false
  try {
    const { data, error } = await sb.functions.invoke('notify-submission', { body: { timesheet_id: sheet.id } })
    emailed = !error && !data?.error
  } catch { emailed = false }

  if (emailed) {
    logAction('timesheet: sent for approval', 'timesheet', wk)
    toast('Sent for approval — your approver has been notified ✓')
  } else {
    toast('Submitted — but the approver email did not send. Check an approver is assigned.')
  }
  await refreshApprovals()                  // clear the reject banner / refresh state
}

// "Recall" — pull a submitted week back to Draft for editing/resubmission.
export async function recallSheet() {
  const wk = weekKey(currentWeekStart)
  const sheet = getLocalSheet(wk)
  if (sheet.status !== 'Submitted') { toast('Only submitted weeks can be recalled.'); return }
  if (!confirm('Recall this week back to Draft? Any pending or completed approvals for it will be removed, and you can resubmit after editing.')) return
  const btn = document.getElementById('recall-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Recalling…' }
  const ok = await recallSheetDb(wk)
  if (btn) { btn.disabled = false; btn.textContent = '↩ Recall' }
  if (ok) {
    toast('Recalled to Draft ✓')
    refreshApprovals()       // approval rows are gone now — clear lock + banners
    refreshNotifications()   // update the approver's pending-approval bell
  }
}

// Best-effort public IP (IPv6 when the connection is v6). Browsers can't read
// their own IP, so we ask an echo service; failure just yields ''.
async function clientIp() {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const r = await fetch('https://api64.ipify.org?format=json', { signal: ctrl.signal })
    clearTimeout(t)
    const j = await r.json()
    return j.ip || ''
  } catch { return '' }
}

// Download the approved week as an invoice-ready PDF, stamped with who approved
// each project and when, plus a provenance footer (downloader, time, IP). Only
// the approved projects are included.
export async function downloadApproved() {
  const wk = weekKey(currentWeekStart)
  const sheet = getLocalSheet(wk)
  if (!sheet.id) { toast('Nothing to download.'); return }

  const btn = document.getElementById('download-approved-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…' }
  const details = await loadApprovedDetail(sheet.id)
  if (!details.length) {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Approved PDF' }
    toast('No approved projects on this week yet.'); return
  }

  const approvedIds = new Set(details.map(d => d.project_id))
  const rows = sheet.rows
    .filter(r => approvedIds.has(r.project_id) && r.hours.some(h => +h > 0))
    .map(r => ({ rate: r.rate, proj: r.proj, hours: r.hours }))
  if (!rows.length) {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Approved PDF' }
    toast('Approved projects have no hours.'); return
  }

  const ip = await clientIp()
  if (btn) { btn.disabled = false; btn.textContent = '⬇ Approved PDF' }

  const days = getWeekDays(currentWeekStart)
  const { doc, filename } = buildApprovedPDF(
    {
      employee: profile?.email,
      weekStart: fmtDate(currentWeekStart),
      weekEnd: fmtDate(days[6]),
      downloadedBy: profile?.email,
      downloadedAt: new Date().toISOString(),
      ip
    },
    rows,
    details.map(d => ({ code: d.code, approver: d.approver, decided_at: d.decided_at }))
  )
  doc.save(filename)
  logAction('timesheet: downloaded approved', 'timesheet', wk, { ip })
  toast('Approved timesheet downloaded ✓')
}

// ── Self-service: add a new project code from the timesheet ──

export async function openAddProject() {
  const sel = document.getElementById('np-cust')
  sel.innerHTML = '<option value="">Loading…</option>'
  document.getElementById('np-code').value = ''
  document.getElementById('np-desc').value = ''
  document.getElementById('addproj-modal').classList.add('open')
  const customers = await loadCustomers()
  sel.innerHTML = customers.length
    ? customers.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')
    : '<option value="">No customers — ask an admin to add one</option>'
}

export function closeAddProject() {
  document.getElementById('addproj-modal').classList.remove('open')
}

export async function saveNewProject() {
  const cust = document.getElementById('np-cust').value
  const code = document.getElementById('np-code').value.trim()
  const desc = document.getElementById('np-desc').value.trim()
  if (!cust || !code) { toast('Pick a customer and enter a project code.'); return }
  const btn = document.getElementById('np-save')
  btn.disabled = true; btn.textContent = 'Adding…'
  const ok = await addProject(cust, code, desc)   // reloads the global projects list
  btn.disabled = false; btn.textContent = 'Add project code'
  if (!ok) return
  toast('Project code added ✓')
  closeAddProject()
  // Drop the new code into the current row if it doesn't have one yet.
  const wk = weekKey(currentWeekStart)
  const sheet = getLocalSheet(wk)
  const added = projects.find(p => p.code === code)
  const blank = sheet.rows.find(r => !r.project_id)
  if (added && blank) { blank.project_id = added.id; blank.proj = added.code; scheduleSave(wk) }
  render()
}

export function prevWeek() {
  currentWeekStart = new Date(currentWeekStart)
  currentWeekStart.setDate(currentWeekStart.getDate() - 7)
  render()
}

export function nextWeek() {
  currentWeekStart = new Date(currentWeekStart)
  currentWeekStart.setDate(currentWeekStart.getDate() + 7)
  render()
}

export function goToday() {
  currentWeekStart = getWeekStart(new Date())
  render()
}

// Jump to a specific week by its 'YYYY-MM-DD' start key (parsed in local time
// so the date doesn't shift across timezones). Used by the dashboard drill-down.
export function goToWeek(wk) {
  const [y, m, d] = wk.split('-').map(Number)
  currentWeekStart = getWeekStart(new Date(y, m - 1, d))
  render()
}
