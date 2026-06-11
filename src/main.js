import './style.css'
import { initAuth, handleAuth, signOut, toggleAuthMode, requestPasswordReset, updatePassword, signInWithGoogle, signInWithMicrosoft, requestEmailCode, verifyEmailCode } from './auth.js'
import { loadAllSheets, loadProfile, loadProjects, setUser, clearSheets, logAction } from './data.js'
import { render, addRow, submitSheet, submitAndSend, prevWeek, nextWeek, goToday, toggleWeekend } from './timesheet.js'
import { exportExcel } from './export.js'
import { openSendPdf, closeSendPdf, sendPdfQuick, sendPdfNow } from './sendpdf.js'
import { renderDashboard } from './dashboard.js'
import { renderApprovals } from './approvals.js'
import { renderAdmin, renderLogs } from './admin.js'
import { refreshNotifications, toggleNotif } from './notify.js'
import { showLoading, hideLoading, showAuth, showApp, showRecovery, toast } from './ui.js'

const VIEWS = {
  dashboard: { el: 'dashboard-view', nav: 'nav-dashboard', title: 'Dashboard' },
  timesheet: { el: 'timesheet-view', nav: 'nav-timesheet', title: 'Timesheet' },
  approvals: { el: 'approvals-view', nav: 'nav-approvals', title: 'Approvals' },
  admin: { el: 'admin-view', nav: 'nav-admin', title: 'Admin' },
  logs: { el: 'logs-view', nav: 'nav-logs', title: 'Activity Log' }
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
  if (view === 'logs') renderLogs()
}
window.setView = setView
window.comingSoon = (name) => toast(`${name} is coming in the next update.`)

// Swap the sidebar logo to the org's brand, or hide it if no org is assigned.
function applyOrgBrand(org) {
  const el = document.getElementById('sidebar-logo')
  if (!el) return
  if (org?.logo_url) {
    el.src = org.logo_url
    el.alt = org.name
    el.style.display = ''
  } else {
    el.style.display = 'none'
  }
}

// Role-gated nav: managers+admins see Approvals (+ the notification bell);
// admins also see Admin.
export function applyRoleNav(role) {
  const canApprove = role === 'manager' || role === 'admin'
  document.getElementById('nav-approvals').style.display = canApprove ? '' : 'none'
  document.getElementById('nav-admin').style.display = (role === 'admin') ? '' : 'none'
  document.getElementById('nav-logs').style.display = (role === 'admin') ? '' : 'none'
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
window.signOut = async () => {
  await logAction('auth: signed out', 'session')   // log while the session is still valid
  await signOut()
}
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
    applyOrgBrand(prof?.organizations)
    await loadProjects()
    await loadAllSheets()
    applyRoleNav(prof?.role)
    hideLoading()
    render()
    setView('dashboard')
    // Log the sign-in once per browser session (a plain reload reuses the
    // session, so it shouldn't record a new login).
    if (!sessionStorage.getItem('ts_login_logged')) {
      sessionStorage.setItem('ts_login_logged', '1')
      logAction('auth: signed in', 'session')
    }
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
    sessionStorage.removeItem('ts_login_logged')   // so the next sign-in re-logs
    clearSheets()
    hideLoading()
    showAuth()
  },
  onRecovery: () => {
    hideLoading()
    showRecovery()
  }
})
