import './style.css'
import { initAuth, handleAuth, signOut, toggleAuthMode, requestPasswordReset, updatePassword, signInWithGoogle } from './auth.js'
import { loadAllSheets, loadProfile, loadProjects, setUser, clearSheets } from './data.js'
import { render, addRow, submitSheet, prevWeek, nextWeek, goToday } from './timesheet.js'
import { exportExcel } from './export.js'
import { renderDashboard } from './dashboard.js'
import { showLoading, hideLoading, showAuth, showApp, showRecovery } from './ui.js'

// ── Dashboard / Timesheet view switching ──
function setView(view) {
  const dash = document.getElementById('dashboard-view')
  const ts = document.getElementById('timesheet-view')
  const tabDash = document.getElementById('tab-dashboard')
  const tabTs = document.getElementById('tab-timesheet')
  const isDash = view === 'dashboard'
  dash.classList.toggle('visible', isDash)
  ts.classList.toggle('visible', !isDash)
  tabDash.classList.toggle('active', isDash)
  tabTs.classList.toggle('active', !isDash)
  if (isDash) renderDashboard()
}
window.setView = setView

// ── Wire up global button handlers (called from HTML onclick) ──
window.handleAuth = handleAuth
window.toggleAuthMode = toggleAuthMode
window.requestPasswordReset = requestPasswordReset
window.updatePassword = updatePassword
window.signInWithGoogle = signInWithGoogle
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
