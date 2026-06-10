import { allSheets, getLocalSheet, newRow, scheduleSave, saveSheet, projects, createApprovalsForSheet } from './data.js'
import { toast } from './ui.js'
import { sb } from './supabase.js'

const RATES = ['Regular - Hourly', 'Overtime - Hourly', 'Double Time', 'Stat Holiday']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export let currentWeekStart = getWeekStart(new Date())

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

  const badge = document.getElementById('status-badge')
  badge.textContent = sheet.status
  badge.className = 'status-badge' + (sheet.status === 'Submitted' ? ' submitted' : '')

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
  const tbody = document.getElementById('ts-tbody')
  tbody.innerHTML = ''
  sheet.rows.forEach((row, ri) => {
    const tr = document.createElement('tr')
    let td = `<td><select class="rate-select" data-ri="${ri}"><option>${RATES.map(r =>
      `<option${r === row.rate ? ' selected' : ''}>${r}</option>`).join('')}</select></td>`
    td = `<td><select class="rate-select" data-ri="${ri}">${RATES.map(r =>
      `<option${r === row.rate ? ' selected' : ''}>${r}</option>`).join('')}</select></td>`
    const projOpts = projects.map(p =>
      `<option value="${p.id}"${p.id === row.project_id ? ' selected' : ''}>${escHtml(p.code)}</option>`).join('')
    td += `<td><select class="proj-select" data-ri="${ri}"><option value="">— select project —</option>${projOpts}</select></td>`
    row.hours.forEach((h, di) => {
      if (!visible.includes(di)) return
      td += `<td><input class="hours-input${h > 0 ? ' has-value' : ''}" type="number" min="0" max="24" step="0.25" value="${h || ''}" placeholder="0" data-ri="${ri}" data-di="${di}"></td>`
    })
    const rowTotal = row.hours.reduce((a, b) => a + (+b || 0), 0)
    td += `<td class="total-cell">${rowTotal.toFixed(2)}</td>`
    td += `<td class="col-delete"><button class="btn btn-sm btn-danger" data-ri="${ri}">✕</button></td>`
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

export async function submitSheet() {
  const wk = weekKey(currentWeekStart)
  const sheet = getLocalSheet(wk)
  if (sheet.status === 'Submitted') { toast('Already submitted.'); return }
  if (!sheet.rows.some(r => r.project_id && r.hours.some(h => +h > 0))) {
    toast('Add hours to a project before submitting.'); return
  }
  sheet.status = 'Submitted'
  await saveSheet(wk)
  await createApprovalsForSheet(wk)           // route to approver(s) per customer
  try {
    await sb.functions.invoke('notify-submission', { body: { timesheet_id: sheet.id } })
  } catch { /* email service optional until Resend is configured */ }
  render()
  toast('Submitted — your approver has been notified ✓')
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
