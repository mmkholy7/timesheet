import Chart from 'chart.js/auto'
import { allSheets, myApprovals } from './data.js'
import { weekKey, fmtShort, goToWeek } from './timesheet.js'

// Accent ramp followed by a neutral grey ramp (reads well on the dark theme)
const PALETTE = ['#e0241b', '#f0473b', '#f76b60', '#fb8e85', '#fdb0a9', '#5a6373', '#7b8494', '#9aa2b0', '#b9bfca', '#d4d8df']
const GRID = '#232a37'
const TICK = '#7b8494'

let charts = []

// Status colours: green = approved, amber = pending, red = rejected, grey = draft.
const C_APPROVED = '#34d399', C_REJECTED = '#e0241b', C_PENDING = '#fbbf24', C_DRAFT = '#5a6373'

function sumHours(rows) {
  return rows.reduce((a, r) => a + r.hours.reduce((b, h) => b + (+h || 0), 0), 0)
}

// Split one week's hours across approval statuses, by each row's project.
function weekStatusHours(wk) {
  const a = myApprovals[wk]
  const sheet = allSheets[wk]
  const out = { approved: 0, pending: 0, rejected: 0, draft: 0 }
  sheet.rows.forEach(r => {
    const h = r.hours.reduce((x, y) => x + (+y || 0), 0)
    if (h <= 0) return
    if (a && a.approvedIds.has(r.project_id)) out.approved += h
    else if (a && a.rejectedIds.has(r.project_id)) out.rejected += h
    else if (a && a.pendingIds.has(r.project_id)) out.pending += h
    else if (sheet.status === 'Submitted') out.pending += h
    else out.draft += h
  })
  return out
}

function destroyCharts() {
  charts.forEach(c => c.destroy())
  charts = []
}

function el(id) { return document.getElementById(id) }
function setStat(id, val) { el(id).innerHTML = `${val.toFixed(1)}<span class="unit">h</span>` }

export function renderDashboard() {
  destroyCharts()

  const weeks = Object.keys(allSheets).sort()
  const byWeek = weeks.map(wk => ({ wk, hrs: sumHours(allSheets[wk].rows) }))
  const total = byWeek.reduce((a, w) => a + w.hrs, 0)

  // Stat cards
  const now = new Date()
  const curWk = weekKey(now)
  const weekHrs = allSheets[curWk] ? sumHours(allSheets[curWk].rows) : 0
  let monthHrs = 0
  weeks.forEach(wk => {
    const d = new Date(wk)
    if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
      monthHrs += sumHours(allSheets[wk].rows)
    }
  })
  setStat('stat-total', total)
  setStat('stat-week', weekHrs)
  setStat('stat-month', monthHrs)
  el('stat-submitted').textContent = Object.values(allSheets).filter(s => s.status === 'Submitted').length
  el('stat-weeks').textContent = byWeek.filter(w => w.hrs > 0).length

  renderRecentWeeks(byWeek)

  // Empty state
  const hasData = total > 0
  el('dash-empty').style.display = hasData ? 'none' : 'block'
  el('chart-week').closest('.chart-grid').style.display = hasData ? 'grid' : 'none'
  el('recent-weeks').closest('.chart-card').style.display = hasData ? 'block' : 'none'
  if (!hasData) return

  // Aggregate by project / rate
  const byProject = {}
  const byRate = {}
  weeks.forEach(wk => allSheets[wk].rows.forEach(r => {
    const h = r.hours.reduce((a, x) => a + (+x || 0), 0)
    if (h <= 0) return
    const pk = r.proj || '—'
    byProject[pk] = (byProject[pk] || 0) + h
    byRate[r.rate] = (byRate[r.rate] || 0) + h
  }))

  const baseOpts = { responsive: true, maintainAspectRatio: false }

  // Bar: hours by week (last 10), stacked by approval status so the approved
  // portion of each week reads green.
  const recent = byWeek.slice(-10)
  const rs = recent.map(w => weekStatusHours(w.wk))
  charts.push(new Chart(el('chart-week'), {
    type: 'bar',
    data: {
      labels: recent.map(w => fmtShort(new Date(w.wk))),
      datasets: [
        { label: 'Approved', data: rs.map(s => s.approved), backgroundColor: C_APPROVED, stack: 's', maxBarThickness: 46 },
        { label: 'Pending', data: rs.map(s => s.pending), backgroundColor: C_PENDING, stack: 's', maxBarThickness: 46 },
        { label: 'Rejected', data: rs.map(s => s.rejected), backgroundColor: C_REJECTED, stack: 's', maxBarThickness: 46 },
        { label: 'Draft', data: rs.map(s => s.draft), backgroundColor: C_DRAFT, stack: 's', maxBarThickness: 46 }
      ]
    },
    options: {
      ...baseOpts,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: '#b3bac7' } },
        tooltip: { callbacks: { footer: () => 'Click to open this week' } }
      },
      // Click a bar → jump to that week's timesheet
      onClick: (_evt, elements) => {
        const wk = recent[elements[0]?.index]?.wk
        if (wk) { goToWeek(wk); window.setView('timesheet') }
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'
      },
      scales: {
        y: { stacked: true, beginAtZero: true, grid: { color: GRID }, ticks: { color: TICK } },
        x: { stacked: true, grid: { display: false }, ticks: { color: TICK } }
      }
    }
  }))

  // Donut helper
  const donut = (canvasId, dataObj) => {
    const entries = Object.entries(dataObj)
    return new Chart(el(canvasId), {
      type: 'doughnut',
      data: {
        labels: entries.map(([k]) => k.split(' - ')[0]),     // short label
        datasets: [{ data: entries.map(([, v]) => v), backgroundColor: PALETTE, borderColor: '#11151e', borderWidth: 2 }]
      },
      options: {
        ...baseOpts,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: '#b3bac7' } },
          tooltip: { callbacks: { label: c => ` ${entries[c.dataIndex][0]}: ${c.parsed.toFixed(1)} h` } }
        }
      }
    })
  }

  charts.push(donut('chart-project', byProject))
  charts.push(donut('chart-rate', byRate))

  // Hours by approval status — approved shows green.
  const byStatus = { Approved: 0, Pending: 0, Rejected: 0, Draft: 0 }
  weeks.forEach(wk => {
    const s = weekStatusHours(wk)
    byStatus.Approved += s.approved
    byStatus.Pending += s.pending
    byStatus.Rejected += s.rejected
    byStatus.Draft += s.draft
  })
  const STATUS_COLOR = { Approved: C_APPROVED, Pending: C_PENDING, Rejected: C_REJECTED, Draft: C_DRAFT }
  const statusEntries = Object.entries(byStatus).filter(([, v]) => v > 0)
  if (statusEntries.length) {
    charts.push(new Chart(el('chart-status'), {
      type: 'doughnut',
      data: {
        labels: statusEntries.map(([k]) => k),
        datasets: [{ data: statusEntries.map(([, v]) => v), backgroundColor: statusEntries.map(([k]) => STATUS_COLOR[k]), borderColor: '#11151e', borderWidth: 2 }]
      },
      options: {
        ...baseOpts,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: '#b3bac7' } },
          tooltip: { callbacks: { label: c => ` ${statusEntries[c.dataIndex][0]}: ${c.parsed.toFixed(1)} h` } }
        }
      }
    }))
  }
}

function parseLocal(wk) {
  const [y, m, d] = wk.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function weekLabel(wk) {
  const s = parseLocal(wk)
  const e = new Date(s)
  e.setDate(e.getDate() + 6)
  return `${fmtShort(s)} – ${fmtShort(e)}`
}

function renderRecentWeeks(byWeek) {
  const recent = [...byWeek].reverse().slice(0, 8)   // most recent first
  const max = Math.max(...recent.map(w => w.hrs), 1)
  el('recent-weeks').innerHTML = recent.map(w => {
    const appr = myApprovals[w.wk]
    const status = allSheets[w.wk].status
    let badge
    if (appr && appr.allApproved) badge = '<span class="status-badge approved">Approved</span>'
    else if (appr && appr.rejected && appr.rejected.length) badge = '<span class="status-badge rejected">Rejected</span>'
    else if (status === 'Submitted') badge = '<span class="status-badge submitted">Submitted</span>'
    else badge = '<span class="status-badge">Draft</span>'
    const pct = Math.round((w.hrs / max) * 100)
    return `<tr>
      <td class="rt-week">${weekLabel(w.wk)}</td>
      <td class="rt-bar"><div class="rt-bar-track"><div class="rt-bar-fill" style="width:${pct}%"></div></div></td>
      <td>${badge}</td>
      <td class="rt-hours">${w.hrs.toFixed(1)} h</td>
    </tr>`
  }).join('')
}
