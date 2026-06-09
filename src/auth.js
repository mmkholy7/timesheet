import { sb } from './supabase.js'

let authMode = 'signin'

export function initAuth({ onSignIn, onSignOut }) {
  // Listen for auth state changes
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) onSignIn(session.user)
    if (event === 'SIGNED_OUT') onSignOut()
  })

  // Check existing session on load
  sb.auth.getSession().then(({ data: { session } }) => {
    if (session) onSignIn(session.user)
    else onSignOut()
  })
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

export async function signOut() {
  await sb.auth.signOut()
}

export function toggleAuthMode() {
  authMode = authMode === 'signin' ? 'signup' : 'signin'
  document.getElementById('auth-btn').textContent = authMode === 'signin' ? 'Sign in' : 'Create account'
  document.getElementById('auth-toggle-text').textContent = authMode === 'signin' ? "Don't have an account?" : 'Already have an account?'
  document.getElementById('auth-toggle-link').textContent = authMode === 'signin' ? 'Sign up' : 'Sign in'
  document.getElementById('auth-err').style.display = 'none'
}

function showAuthErr(msg) {
  const el = document.getElementById('auth-err')
  el.textContent = msg
  el.style.display = 'block'
}
