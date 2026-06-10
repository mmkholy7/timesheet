import Chart from 'chart.js/auto'
import { allSheets } from './data.js'
import { weekKey, fmtShort } from './timesheet.js'

const PALETTE = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#14b8a6', '#ef4444', '#f97316', '#84cc16']

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
  el('stat-weeks').textContent = byWeek.filter(w => w.hrs > 0).length

  // Empty state
  const hasData = total > 0
  el('dash-empty').style.display = hasData ? 'none' : 'block'
  el('chart-week').closest('.chart-grid').style.display = hasData ? 'grid' : 'none'
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
      datasets: [{ data: recent.map(w => w.hrs), backgroundColor: '#6366f1', borderRadius: 6, maxBarThickness: 46 }]
    },
    options: {
      ...baseOpts,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#f1f1f0' }, ticks: { color: '#9ca3af' } },
        x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
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
        datasets: [{ data: entries.map(([, v]) => v), backgroundColor: PALETTE, borderWidth: 0 }]
      },
      options: {
        ...baseOpts,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: '#6b7280' } },
          tooltip: { callbacks: { label: c => ` ${entries[c.dataIndex][0]}: ${c.parsed.toFixed(1)} h` } }
        }
      }
    })
  }

  charts.push(donut('chart-project', byProject))
  charts.push(donut('chart-rate', byRate))
}
