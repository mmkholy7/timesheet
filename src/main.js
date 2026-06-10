import './style.css'
import { initAuth, handleAuth, signOut, toggleAuthMode, requestPasswordReset, updatePassword, signInWithGoogle, signInWithMicrosoft } from './auth.js'
import { loadAllSheets, loadProfile, loadProjects, setUser, clearSheets } from './data.js'
import { render, addRow, submitSheet, prevWeek, nextWeek, goToday } from './timesheet.js'
import { exportExcel } from './export.js'
import { renderDashboard } from './dashboard.js'
import { renderApprovals } from './approvals.js'
import { profile } from './data.js'
import { showLoading, hideLoading, showAuth, showApp, showRecovery, toast } from './ui.js'

const VIEWS = {
  dashboard: { el: 'dashboard-view', nav: 'nav-dashboard', title: 'Dashboard' },
  timesheet: { el: 'timesheet-view', nav: 'nav-timesheet', title: 'Timesheet' },
  approvals: { el: 'approvals-view', nav: 'nav-approvals', title: 'Approvals' }
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
}
window.setView = setView
window.comingSoon = (name) => toast(`${name} is coming in the next update.`)

// Show the Approvals nav only for managers/admins
export function applyRoleNav() {
  const role = profile?.role
  document.getElementById('nav-approvals').style.display =
    (role === 'manager' || role === 'admin') ? '' : 'none'
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
