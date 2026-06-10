import './style.css'
import { initAuth, handleAuth, signOut, toggleAuthMode, requestPasswordReset, updatePassword, signInWithGoogle, signInWithMicrosoft } from './auth.js'
import { loadAllSheets, loadProfile, loadProjects, setUser, clearSheets } from './data.js'
import { render, addRow, submitSheet, prevWeek, nextWeek, goToday, toggleWeekend } from './timesheet.js'
import { exportExcel } from './export.js'
import { renderDashboard } from './dashboard.js'
import { renderApprovals } from './approvals.js'
import { renderAdmin } from './admin.js'
import { profile } from './data.js'
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

// Role-gated nav: managers+admins see Approvals; admins also see Admin
export function applyRoleNav() {
  const role = profile?.role
  document.getElementById('nav-approvals').style.display =
    (role === 'manager' || role === 'admin') ? '' : 'none'
  document.getElementById('nav-admin').style.display = (role === 'admin') ? '' : 'none'
}

// ── Wire up global button handlers (called from HTML onclick) ──
window.handleAuth = handleAuth
window.toggleAuthMode = toggleAuthMode
window.requestPasswordReset = requestPasswordReset
window.updatePassword = updatePassword
window.signInWithGoogle = signInWithGoogle
window.signInWithMicrosoft = signInWithMicrosoft
window.signOut = async () => { await signOut(); }
window.addRow = addRow
window.submitSheet = submitSheet
window.prevWeek = prevWeek
window.nextWeek = nextWeek
window.goToday = goToday
window.toggleWeekend = toggleWeekend
window.exportExcel = exportExcel

// ── Boot ──
showLoading()

initAuth({
  onSignIn: async (user) => {
    setUser(user.id)
    showApp(user.email)
    await loadProfile()
    await loadProjects()
    await loadAllSheets()
    applyRoleNav()
    hideLoading()
    render()
    setView('dashboard')
    // Diagnostic: type `whoami` in the browser console to see your loaded role
    window.whoami = { email: user.email, role: profile?.role }
    console.log('[timesheet] signed in as', user.email, '· role:', profile?.role)
  },
  onSignOut: () => {
    clearSheets()
    hideLoading()
    showAuth()
  },
  onRecovery: () => {
    hideLoading()
    showRecovery()
  }
})
