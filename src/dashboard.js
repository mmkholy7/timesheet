import Chart from 'chart.js/auto'
import { allSheets } from './data.js'
import { weekKey, fmtShort, goToWeek } from './timesheet.js'

// WSP red ramp followed by a neutral grey ramp (reads well on the dark theme)
const PALETTE = ['#e0241b', '#f0473b', '#f76b60', '#fb8e85', '#fdb0a9', '#5a6373', '#7b8494', '#9aa2b0', '#b9bfca', '#d4d8df']
const GRID = '#232a37'
const TICK = '#7b8494'

let charts = []

function sumHours(rows) {
  return rows.reduce((a, r) => a + r.hours.reduce((b, h) => b + (+h || 0), 0), 0)
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

  // Bar: hours by week (last 10)
  const recent = byWeek.slice(-10)
  charts.push(new Chart(el('chart-week'), {
    type: 'bar',
    data: {
      labels: recent.map(w => fmtShort(new Date(w.wk))),
      datasets: [{ data: recent.map(w => w.hrs), backgroundColor: '#e0241b', borderRadius: 6, maxBarThickness: 46 }]
    },
    options: {
      ...baseOpts,
      plugins: {
        legend: { display: false },
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
        y: { beginAtZero: true, grid: { color: GRID }, ticks: { color: TICK } },
        x: { grid: { display: false }, ticks: { color: TICK } }
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
    const status = allSheets[w.wk].status
    const badge = status === 'Submitted'
      ? '<span class="status-badge submitted">Submitted</span>'
      : '<span class="status-badge">Draft</span>'
    const pct = Math.round((w.hrs / max) * 100)
    return `<tr>
      <td class="rt-week">${weekLabel(w.wk)}</td>
      <td class="rt-bar"><div class="rt-bar-track"><div class="rt-bar-fill" style="width:${pct}%"></div></div></td>
      <td>${badge}</td>
      <td class="rt-hours">${w.hrs.toFixed(1)} h</td>
    </tr>`
  }).join('')
}
