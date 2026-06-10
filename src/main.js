import './style.css'
import { initAuth, handleAuth, signOut, toggleAuthMode, requestPasswordReset, updatePassword, signInWithGoogle } from './auth.js'
import { loadAllSheets, loadProfile, loadProjects, setUser, clearSheets } from './data.js'
import { render, addRow, submitSheet, prevWeek, nextWeek, goToday } from './timesheet.js'
import { exportExcel } from './export.js'
import { renderDashboard } from './dashboard.js'
import { showLoading, hideLoading, showAuth, showApp, showRecovery, toast } from './ui.js'

// ── Sidebar view switching ──
function setView(view) {
  const isDash = view === 'dashboard'
  document.getElementById('dashboard-view').classList.toggle('visible', isDash)
  document.getElementById('timesheet-view').classList.toggle('visible', !isDash)
  document.getElementById('nav-dashboard').classList.toggle('active', isDash)
  document.getElementById('nav-timesheet').classList.toggle('active', !isDash)
  document.getElementById('header-title').textContent = isDash ? 'Dashboard' : 'Timesheet'
  if (isDash) renderDashboard()
}
window.setView = setView
window.comingSoon = (name) => toast(`${name} is coming in the next update.`)

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
