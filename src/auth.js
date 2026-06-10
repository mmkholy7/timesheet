import { sb } from './supabase.js'

let authMode = 'signin'
let recovering = false
let handlers = {}

export function initAuth(opts) {
  handlers = opts // { onSignIn, onSignOut, onRecovery }

  // A password-reset/invite link lands with `type=recovery` in the URL hash.
  // Detect it synchronously, before supabase-js consumes the hash, so we show
  // the "set new password" screen instead of dropping the user into the app.
  if (window.location.hash.includes('type=recovery')) recovering = true

  // supabase-js auto-processes the token in the URL (detectSessionInUrl is on),
  // then emits these events.
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { recovering = true; handlers.onRecovery(); return }
    if (event === 'SIGNED_OUT') { recovering = false; handlers.onSignOut(); return }
    if (event === 'SIGNED_IN' && session) {
      if (recovering) { handlers.onRecovery(); return }
      handlers.onSignIn(session.user)
    }
  })

  // Existing session on load (normal revisit).
  sb.auth.getSession().then(({ data: { session } }) => {
    if (recovering) { handlers.onRecovery(); return }
    if (session) handlers.onSignIn(session.user)
    else handlers.onSignOut()
  })
}

export async function requestPasswordReset() {
  const email = document.getElementById('auth-email').value.trim()
  if (!email) { showAuthErr('Enter your email above first, then click “Forgot password?”'); return }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  })
  if (error) { showAuthErr(error.message); return }
  showAuthErr('Password reset link sent — check your email.')
}

export async function updatePassword() {
  const pw = document.getElementById('recovery-password').value
  const btn = document.getElementById('recovery-btn')
  document.getElementById('recovery-err').style.display = 'none'

  if (!pw || pw.length < 6) { showRecoveryErr('Password must be at least 6 characters.'); return }

  btn.disabled = true; btn.textContent = 'Updating…'
  const { data, error } = await sb.auth.updateUser({ password: pw })
  btn.disabled = false; btn.textContent = 'Update password'

  if (error) { showRecoveryErr(error.message); return }
  recovering = false
  history.replaceState(null, '', window.location.pathname) // strip the recovery hash
  handlers.onSignIn(data.user)
}

export async function handleAuth() {
  const email = document.getElementById('auth-email').value.trim()
  const password = document.getElementById('auth-password').value
  const errEl = document.getElementById('auth-err')
  const btn = document.getElementById('auth-btn')

  errEl.style.display = 'none'
  if (!email || !password) { showAuthErr('Please enter email and password.'); return }

  btn.disabled = true
  btn.textContent = authMode === 'signin' ? 'Signing in…' : 'Creating account…'

  const result = authMode === 'signin'
    ? await sb.auth.signInWithPassword({ email, password })
    : await sb.auth.signUp({ email, password })

  btn.disabled = false
  btn.textContent = authMode === 'signin' ? 'Sign in' : 'Create account'

  if (result.error) { showAuthErr(result.error.message); return }
  if (authMode === 'signup' && !result.data.session) {
    showAuthErr('Check your email to confirm your account, then sign in.')
  }
}

export async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  })
  if (error) showAuthErr(error.message)
  // On success the browser redirects to Google, then back to the app where
  // supabase-js picks up the session and fires SIGNED_IN.
}

export async function signOut() {
  await sb.auth.signOut()
}

export function toggleAuthMode() {
  authMode = authMode === 'signin' ? 'signup' : 'signin'
  const signin = authMode === 'signin'
  document.getElementById('auth-title').textContent = signin ? 'Welcome back' : 'Create your account'
  document.getElementById('auth-sub').textContent = signin ? 'Sign in to access your timesheets' : 'Sign up to start tracking your time'
  document.getElementById('auth-btn').textContent = signin ? 'Sign in' : 'Create account'
  document.getElementById('auth-toggle-text').textContent = signin ? "Don't have an account?" : 'Already have an account?'
  document.getElementById('auth-toggle-link').textContent = signin ? 'Sign up' : 'Sign in'
  document.getElementById('auth-err').style.display = 'none'
}

function showAuthErr(msg) {
  const el = document.getElementById('auth-err')
  el.textContent = msg
  el.style.display = 'block'
}

function showRecoveryErr(msg) {
  const el = document.getElementById('recovery-err')
  el.textContent = msg
  el.style.display = 'block'
}
