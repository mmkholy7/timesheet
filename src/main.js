import './style.css'
import { initAuth, handleAuth, signOut, toggleAuthMode, requestPasswordReset, updatePassword, signInWithGoogle, signInWithMicrosoft, requestEmailCode, verifyEmailCode } from './auth.js'
import { loadAllSheets, loadProfile, loadProjects, setUser, clearSheets } from './data.js'
import { render, addRow, submitSheet, submitAndSend, prevWeek, nextWeek, goToday, toggleWeekend } from './timesheet.js'
import { exportExcel } from './export.js'
import { openSendPdf, closeSendPdf, sendPdfQuick, sendPdfNow } from './sendpdf.js'
import { renderDashboard } from './dashboard.js'
import { renderApprovals } from './approvals.js'
import { renderAdmin } from './admin.js'
import { refreshNotifications, toggleNotif } from './notify.js'
import { showLoading, hideLoading, showAuth, showApp, showRecovery, toast } from './ui.js'

const VIEWS = {
  dashboard: { el: 'dashboard-view', nav: 'nav-dashboard', title: 'Dashboard' },
  timesheet: { el: 'timesheet-view', nav: 'nav-timesheet', title: 'Timesheet' },
  approvals: { el: 'approvals-view', nav: 'nav-approvals', title: 'Approvals' },
  admin: { el: 'admin-view', nav: 'nav-admin', title: 'Admin' }
}

// ── Sidebar view switching ──
function setView(view) {
  Object.entries(VIEWS).forEach(([k, v]) => {
    document.getElementById(v.el).classList.toggle('visible', k === view)
    const nav = document.getElementById(v.nav)
    if (nav) nav.classList.toggle('active', k === view)
  })
  document.getElementById('header-title').textContent = VIEWS[view].title
  if (view === 'dashboard') renderDashboard()
  if (view === 'approvals') renderApprovals()
  if (view === 'admin') renderAdmin()
}
window.setView = setView
window.comingSoon = (name) => toast(`${name} is coming in the next update.`)

// Role-gated nav: managers+admins see Approvals (+ the notification bell);
// admins also see Admin.
export function applyRoleNav(role) {
  const canApprove = role === 'manager' || role === 'admin'
  document.getElementById('nav-approvals').style.display = canApprove ? '' : 'none'
  document.getElementById('nav-admin').style.display = (role === 'admin') ? '' : 'none'
  document.getElementById('notif').style.display = canApprove ? '' : 'none'
}

// ── Wire up global button handlers (called from HTML onclick) ──
window.handleAuth = handleAuth
window.toggleAuthMode = toggleAuthMode
window.requestPasswordReset = requestPasswordReset
window.requestEmailCode = requestEmailCode
window.verifyEmailCode = verifyEmailCode
window.updatePassword = updatePassword
window.signInWithGoogle = signInWithGoogle
window.signInWithMicrosoft = signInWithMicrosoft
window.signOut = async () => { await signOut(); }
window.addRow = addRow
window.submitSheet = submitSheet
window.submitAndSend = submitAndSend
window.prevWeek = prevWeek
window.nextWeek = nextWeek
window.goToday = goToday
window.toggleWeekend = toggleWeekend
window.exportExcel = exportExcel
window.toggleNotif = toggleNotif
window.openSendPdf = openSendPdf
window.closeSendPdf = closeSendPdf
window.sendPdfQuick = sendPdfQuick
window.sendPdfNow = sendPdfNow

// ── Boot ──
showLoading()

initAuth({
  onSignIn: async (user) => {
    setUser(user.id)
    showApp(user.email)
    const prof = await loadProfile()
    await loadProjects()
    await loadAllSheets()
    applyRoleNav(prof?.role)
    hideLoading()
    render()
    setView('dashboard')
    // Approvers: load the pending-approval bell now, then keep it fresh.
    if (prof?.role === 'manager' || prof?.role === 'admin') {
      refreshNotifications()
      clearInterval(window._notifTimer)
      window._notifTimer = setInterval(refreshNotifications, 60000)
    }
    // Diagnostic: type `whoami` in the browser console to see your loaded role
    window.whoami = { email: user.email, role: prof?.role }
    console.log('[timesheet] signed in as', user.email, '· role:', prof?.role)
  },
  onSignOut: () => {
    clearInterval(window._notifTimer)
    clearSheets()
    hideLoading()
    showAuth()
  },
  onRecovery: () => {
    hideLoading()
    showRecovery()
  }
})
