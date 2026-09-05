import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

function readableAuthError(error) {
  if (!error) return ''
  if (error.message === 'Invalid login credentials') {
    return 'That email and password combination did not work.'
  }
  if (error.message?.toLowerCase().includes('email not confirmed')) {
    return 'Confirm your email before signing in.'
  }
  if (error.message?.toLowerCase().includes('password')) {
    return error.message
  }
  return 'Something went wrong. Please try again.'
}

export default function AuthDialog({ onClose }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const emailInput = useRef(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.setTimeout(() => emailInput.current?.focus(), 80)
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [busy, onClose])

  const isSignUp = mode === 'signup'
  const passwordsMismatch = isSignUp && confirmPassword.length > 0 && password !== confirmPassword
  const canSubmit = email && password && (!isSignUp || (confirmPassword && !passwordsMismatch)) && !busy

  function switchMode(nextMode) {
    setMode(nextMode)
    setPassword('')
    setConfirmPassword('')
    setMessage(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage(null)

    if (isSignUp && password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }

    setBusy(true)
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (data.session) {
          onClose()
        } else {
          setMessage({ type: 'success', text: 'Check your email to confirm your account, then sign in.' })
          setPassword('')
          setConfirmPassword('')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        onClose()
      }
    } catch (error) {
      setMessage({ type: 'error', text: readableAuthError(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-heading">
        <button className="auth-close" type="button" aria-label="Close account dialog" onClick={onClose} disabled={busy}>×</button>
        <p className="eyebrow">Your account</p>
        <h2 id="auth-heading">{isSignUp ? 'Create your account' : 'Welcome back'}</h2>
        <p className="auth-intro">
          {isSignUp ? 'A simple sign-in for your Spendary space.' : 'Sign in with your email and password.'}
        </p>

        <div className="auth-tabs" role="tablist" aria-label="Account action">
          <button type="button" role="tab" aria-selected={!isSignUp} className={!isSignUp ? 'active' : ''} onClick={() => switchMode('signin')}>Sign in</button>
          <button type="button" role="tab" aria-selected={isSignUp} className={isSignUp ? 'active' : ''} onClick={() => switchMode('signup')}>Create account</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label>
            <span>Email</span>
            <input ref={emailInput} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
          </label>
          <label>
            <span>Password</span>
            <input type="password" autoComplete={isSignUp ? 'new-password' : 'current-password'} minLength="6" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" required />
          </label>
          {isSignUp && (
            <label>
              <span>Confirm password</span>
              <input type="password" autoComplete="new-password" minLength="6" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} aria-invalid={passwordsMismatch} aria-describedby={passwordsMismatch ? 'password-match-error' : undefined} placeholder="Enter it again" required />
              {passwordsMismatch && <small id="password-match-error" className="field-error">Passwords do not match.</small>}
            </label>
          )}

          {message && <p className={`auth-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}

          <button className="auth-submit" type="submit" disabled={!canSubmit}>
            {busy ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'} <span aria-hidden="true">↗</span>
          </button>
        </form>
      </section>
    </div>
  )
}
