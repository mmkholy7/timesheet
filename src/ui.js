let toastTimer = null

export function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800)
}

export function setSyncStatus(cls, msg) {
  const el = document.getElementById('sync-status')
  el.className = 'sync-indicator' + (cls ? ' ' + cls : '')
  el.textContent = msg
}

export function showLoading() {
  document.getElementById('loading').classList.remove('hidden')
}

export function hideLoading() {
  document.getElementById('loading').classList.add('hidden')
}

export function showAuth() {
  document.getElementById('auth-screen').classList.add('visible')
  document.getElementById('app-screen').classList.remove('visible')
}

export function showApp(userEmail) {
  document.getElementById('auth-screen').classList.remove('visible')
  document.getElementById('app-screen').classList.add('visible')
  document.getElementById('topbar-user').textContent = userEmail
}
