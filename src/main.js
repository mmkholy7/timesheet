import './style.css'
import { initAuth, handleAuth, signOut, toggleAuthMode, requestPasswordReset, updatePassword } from './auth.js'
import { loadAllSheets, setUser, clearSheets } from './data.js'
import { render, addRow, submitSheet, prevWeek, nextWeek, goToday } from './timesheet.js'
import { exportExcel } from './export.js'
import { showLoading, hideLoading, showAuth, showApp, showRecovery } from './ui.js'

// ── Wire up global button handlers (called from HTML onclick) ──
window.handleAuth = handleAuth
window.toggleAuthMode = toggleAuthMode
window.requestPasswordReset = requestPasswordReset
window.updatePassword = updatePassword
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
    await loadAllSheets()
    hideLoading()
    render()
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
