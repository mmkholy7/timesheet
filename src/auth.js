import { sb } from './supabase.js'
import { toast } from './ui.js'

let authMode = 'signin'
let recovering = false
let handlers = {}

export function initAuth(opts) {
  handlers = opts // { onSignIn, onSignOut, onRecovery }

  // A password-reset/invite link lands with `type=recovery` in the URL hash.
  // Detect it synchronously, before supabase-js consumes the hash, so we show
  // the "set new password" screen instead of dropping the user into the app.
  if (window.location.hash.includes('type=recovery')) recovering = true

  // Surface OAuth / redirect errors that come back in the URL (e.g. a failed
  // Google/Microsoft sign-in) instead of silently showing the login page.
  const errParams = new URLSearchParams(
    (window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '') ||
    window.location.search.slice(1)
  )
  const oauthErr = errParams.get('error_description') || errParams.get('error')
  if (oauthErr) {
    showAuthErr(decodeURIComponent(oauthErr).replace(/\+/g, ' '))
    history.replaceState(null, '', window.location.pathname)
  }

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

// Passwordless email OTP. Sends a 6-digit code instead of a magic link so
// corporate scanners (Microsoft Safe Links / Defender for Cloud Apps) can't
// consume a single-use link before the user clicks it. Requires the Supabase
// "Magic Link" email template to use {{ .Token }} instead of {{ .ConfirmationURL }}.
export async function requestEmailCode() {
  const email = document.getElementById('auth-email').value.trim()
  if (!email) { showAuthErr('Enter your email above first, then click “Email me a code”.'); return }
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
  if (error) { showAuthErr(error.message); return }
  document.getElementById('pw-field').style.display = 'none'
  document.getElementById('auth-btn').style.display = 'none'
  document.getElementById('code-field').style.display = ''
  document.getElementById('code-btn').style.display = ''
  document.getElementById('auth-code').focus()
  const e = document.getElementById('auth-err')
  e.textContent = `Code sent to ${email}. Enter it above (check spam/quarantine).`
  e.style.display = 'block'
}

export async function verifyEmailCode() {
  const email = document.getElementById('auth-email').value.trim()
  const token = document.getElementById('auth-code').value.trim()
  if (!token) { showAuthErr('Enter the code from your email.'); return }
  const btn = document.getElementById('code-btn')
  btn.disabled = true; btn.textContent = 'Verifying…'
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' })
  btn.disabled = false; btn.textContent = 'Verify code & sign in'
  if (error) { showAuthErr(error.message); return }
  // onAuthStateChange → SIGNED_IN drives the app load from here.
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

// Signed-in user changing their own password from inside the app (distinct
// from the logged-out "forgot password" email flow above).
export async function changePassword() {
  const pw = document.getElementById('cp-password').value
  const confirm = document.getElementById('cp-confirm').value
  const btn = document.getElementById('cp-btn')
  const err = document.getElementById('cp-err')
  err.style.display = 'none'

  if (!pw || pw.length < 6) { showCpErr('Password must be at least 6 characters.'); return }
  if (pw !== confirm) { showCpErr('Passwords do not match.'); return }

  btn.disabled = true; btn.textContent = 'Updating…'
  const { error } = await sb.auth.updateUser({ password: pw })
  btn.disabled = false; btn.textContent = 'Update password'
  if (error) { showCpErr(error.message); return }

  document.getElementById('cp-password').value = ''
  document.getElementById('cp-confirm').value = ''
  closeChangePassword()
  toast('Password updated ✓')
}

function showCpErr(msg) {
  const el = document.getElementById('cp-err')
  el.textContent = msg
  el.style.display = 'block'
}

export function openChangePassword() {
  document.getElementById('cp-err').style.display = 'none'
  document.getElementById('cp-password').value = ''
  document.getElementById('cp-confirm').value = ''
  document.getElementById('changepw-modal').classList.add('open')
  document.getElementById('cp-password').focus()
}

export function closeChangePassword() {
  document.getElementById('changepw-modal').classList.remove('open')
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

export async function signInWithMicrosoft() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'azure',                              // Supabase's id for Microsoft / Entra
    options: { redirectTo: window.location.origin, scopes: 'email' }
  })
  if (error) showAuthErr(error.message)
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
