import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Build a timestamped timesheet PDF.
// meta: { employee, weekStart, weekEnd, status, customer, approvedBy, decidedAt }
// rows: [{ rate, proj, hours[7] }]
// Returns { doc, base64, filename }
export function buildTimesheetPDF(meta, rows) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const generatedAt = new Date()

  // Header
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
  doc.text('Timesheet', 40, 44)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110)
  doc.text(meta.customer ? `Customer: ${meta.customer}` : '', 40, 62)

  doc.setTextColor(30); doc.setFontSize(10)
  const infoX = 40, infoY = 88, gap = 200
  const line = (x, y, label, val) => {
    doc.setTextColor(140); doc.text(label, x, y)
    doc.setTextColor(30); doc.setFont('helvetica', 'bold'); doc.text(String(val || '—'), x, y + 14)
    doc.setFont('helvetica', 'normal')
  }
  line(infoX, infoY, 'Employee', meta.employee)
  line(infoX + gap, infoY, 'Week', `${meta.weekStart} – ${meta.weekEnd}`)
  line(infoX + gap * 2, infoY, 'Status', meta.status)
  line(infoX + gap * 3, infoY, 'Total Hours', totalHours(rows).toFixed(2))

  // Table
  const head = [['Rate', 'Project Code', ...DAYS, 'Total']]
  const body = rows.map(r => [
    r.rate,
    r.proj,
    ...r.hours.map(h => (+h || 0) === 0 ? '' : (+h).toString()),
    totalRow(r).toFixed(2)
  ])
  const dayTotals = Array(7).fill(0)
  rows.forEach(r => r.hours.forEach((h, i) => { dayTotals[i] += (+h || 0) }))
  body.push(['', 'Daily Total', ...dayTotals.map(t => t.toFixed(2)), totalHours(rows).toFixed(2)])

  autoTable(doc, {
    head, body, startY: 124,
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [28, 28, 26], textColor: 255 },
    columnStyles: { 0: { cellWidth: 120 }, 1: { cellWidth: 200 } },
    didParseCell: (d) => {
      if (d.row.index === body.length - 1) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [245, 245, 244] }
    }
  })

  // Approval / timestamp footer
  let y = doc.lastAutoTable.finalY + 28
  doc.setFontSize(10); doc.setTextColor(30)
  if (meta.status === 'Approved' && meta.approvedBy) {
    doc.setFont('helvetica', 'bold'); doc.text('✓ Approved', 40, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(90)
    doc.text(`by ${meta.approvedBy}  ·  ${fmtStamp(meta.decidedAt)}`, 110, y)
    y += 18
  }
  doc.setTextColor(150); doc.setFontSize(8)
  doc.text(`Generated ${fmtStamp(generatedAt.toISOString())} · UTC`, 40, y)

  const filename = `Timesheet_${(meta.employee || 'user').split('@')[0]}_${meta.weekStart}.pdf`
  const base64 = doc.output('datauristring').split(',')[1]   // strip data: prefix
  return { doc, base64, filename }
}

function totalRow(r) { return r.hours.reduce((a, h) => a + (+h || 0), 0) }
function totalHours(rows) { return rows.reduce((a, r) => a + totalRow(r), 0) }
function fmtStamp(iso) {
  const d = new Date(iso)
  return d.toISOString().replace('T', ' ').slice(0, 19)
}
