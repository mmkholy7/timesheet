import * as XLSX from 'xlsx'
import { allSheets } from './data.js'
import { fmtDate, fmtShort, getWeekDays, weekKey, currentWeekStart } from './timesheet.js'
import { toast } from './ui.js'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function exportExcel() {
  const wb = XLSX.utils.book_new()
  const sortedWeeks = Object.keys(allSheets).sort()

  if (sortedWeeks.length === 0) {
    toast('No data to export yet.')
    return
  }

  // All-time flat sheet
  const allRows = [['Week', 'Status', 'Rate', 'Project Code', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Weekly Total']]
  sortedWeeks.forEach(wk => {
    const s = allSheets[wk]
    s.rows.forEach(row => {
      const total = row.hours.reduce((a, b) => a + (+b || 0), 0)
      allRows.push([wk, s.status, row.rate, row.proj, ...row.hours.map(h => +h || 0), total])
    })
  })
  const allWs = XLSX.utils.aoa_to_sheet(allRows)
  allWs['!cols'] = [{ wch: 12 }, { wch: 11 }, { wch: 28 }, { wch: 38 }, ...Array(7).fill({ wch: 8 }), { wch: 13 }]
  XLSX.utils.book_append_sheet(wb, allWs, 'All Time')

  // Per-week sheets (last 8 weeks)
  sortedWeeks.slice(-8).forEach(wk => {
    const s = allSheets[wk]
    const days = getWeekDays(new Date(wk))
    const headers = ['Rate', 'Project Code', ...days.map(d => `${DAYS[d.getDay()]} ${fmtShort(d)}`), 'Weekly Total']
    const rows = [headers]
    s.rows.forEach(row => {
      const total = row.hours.reduce((a, b) => a + (+b || 0), 0)
      rows.push([row.rate, row.proj, ...row.hours.map(h => +h || 0), total])
    })
    const colTotals = ['', 'DAILY TOTAL']
    for (let i = 0; i < 7; i++) colTotals.push(s.rows.reduce((a, r) => a + (+r.hours[i] || 0), 0))
    colTotals.push(s.rows.reduce((a, r) => a + r.hours.reduce((b, h) => b + (+h || 0), 0), 0))
    rows.push(colTotals)

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 28 }, { wch: 38 }, ...Array(7).fill({ wch: 13 }), { wch: 13 }]
    XLSX.utils.book_append_sheet(wb, ws, `W-${wk.replace(/-/g, '').slice(2)}`)
  })

  const fname = `Timesheet_${fmtDate(new Date())}.xlsx`
  XLSX.writeFile(wb, fname)
  toast('Excel exported!')
}
