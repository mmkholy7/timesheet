import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WSP_RED = [224, 36, 27]

// Draw the WSP wordmark in the top-right corner of the page.
function wspMark(doc) {
  const w = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  doc.setTextColor(WSP_RED[0], WSP_RED[1], WSP_RED[2])
  doc.text('wsp', w - 40, 46, { align: 'right' })
  doc.setTextColor(30)
}

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
  wspMark(doc)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110)
  const subtitle = [meta.customer && `Customer: ${meta.customer}`, meta.project && `Project: ${meta.project}`]
    .filter(Boolean).join('   ·   ')
  doc.text(subtitle, 40, 62)

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
    headStyles: { fillColor: WSP_RED, textColor: 255 },
    columnStyles: { 0: { cellWidth: 120 }, 1: { cellWidth: 200 } },
    didParseCell: (d) => {
      // Body only — otherwise a single-row table makes the header match and
      // repaints it light, hiding the white day labels.
      if (d.section === 'body' && d.row.index === body.length - 1) {
        d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [245, 245, 244]
      }
    }
  })

  // Approval / timestamp footer.
  // Note: jsPDF's built-in fonts only support WinAnsi, so no unicode glyphs
  // (✓, em dashes, etc.) — they corrupt the text. Plain ASCII only here.
  let y = doc.lastAutoTable.finalY + 28
  doc.setFontSize(10); doc.setTextColor(30)
  if (meta.status === 'Approved' && meta.approvedBy) {
    const label = 'Approved'
    doc.setFont('helvetica', 'bold'); doc.setTextColor(22, 163, 74)
    doc.text(label, 40, y)
    const lw = doc.getTextWidth(label)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(90)
    doc.text(`by ${meta.approvedBy}  ·  ${fmtStamp(meta.decidedAt)}`, 40 + lw + 8, y)
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function weekShort(wk) {
  const [y, m, d] = wk.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${MONTHS[dt.getMonth()]} ${dt.getDate()}`
}

// Build a single PDF covering multiple weeks as one combined table, labelled by
// week (Sun..Sat columns), with a single grand total.
// meta: { employee, periodLabel, fileTag }
// weeks: [{ weekStart: 'YYYY-MM-DD', rows: [{ rate, proj, hours[7] }] }]
export function buildRangePDF(meta, weeks) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const generatedAt = new Date()
  const grand = weeks.reduce((a, w) => a + totalHours(w.rows), 0)

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
  doc.text('Timesheet', 40, 44)
  wspMark(doc)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110)
  doc.text(meta.periodLabel || '', 40, 62)

  doc.setTextColor(30); doc.setFontSize(10)
  const infoX = 40, infoY = 88, gap = 240
  const line = (x, y, label, val) => {
    doc.setTextColor(140); doc.text(label, x, y)
    doc.setTextColor(30); doc.setFont('helvetica', 'bold'); doc.text(String(val || '—'), x, y + 14)
    doc.setFont('helvetica', 'normal')
  }
  line(infoX, infoY, 'Employee', meta.employee)
  line(infoX + gap, infoY, 'Weeks', String(weeks.length))
  line(infoX + gap * 2, infoY, 'Total Hours', grand.toFixed(2))

  const head = [['Week', 'Rate', 'Project Code', ...DAYS, 'Total']]
  const body = []
  weeks.forEach(w => {
    const label = weekShort(w.weekStart)
    w.rows.forEach(r => body.push([
      label, r.rate, r.proj,
      ...r.hours.map(h => (+h || 0) === 0 ? '' : (+h).toString()),
      totalRow(r).toFixed(2)
    ]))
  })
  body.push(['', '', 'GRAND TOTAL', '', '', '', '', '', '', '', grand.toFixed(2)])

  autoTable(doc, {
    head, body, startY: 120,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: WSP_RED, textColor: 255 },
    columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 92 }, 2: { cellWidth: 150 } },
    didParseCell: (d) => {
      if (d.section === 'body' && d.row.index === body.length - 1) {
        d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [245, 245, 244]
      }
    }
  })

  let y = doc.lastAutoTable.finalY + 24
  doc.setTextColor(150); doc.setFontSize(8)
  doc.text(`Generated ${fmtStamp(generatedAt.toISOString())} · UTC`, 40, y)

  const filename = `Timesheet_${(meta.employee || 'user').split('@')[0]}_${meta.fileTag || 'range'}.pdf`
  const base64 = doc.output('datauristring').split(',')[1]
  return { doc, base64, filename }
}
