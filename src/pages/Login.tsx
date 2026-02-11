import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getGoogleLoginUrl } from '../utils/auth'

interface LoginProps {
  onLogin: (provider: 'google') => void
}

export const Login = ({ onLogin }: LoginProps) => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const status = searchParams.get('status')
  const provider = searchParams.get('provider')
  const errorMessage =
    searchParams.get('message') ??
    searchParams.get('error_description') ??
    (status === 'error' ? 'Google login failed. Please try again.' : null)

  useEffect(() => {
    if (status === 'success' && provider === 'google') {
      onLogin('google')
      navigate('/portfolio', { replace: true })
    }
  }, [navigate, onLogin, provider, status])

  const handleGoogleLogin = () => {
    window.location.assign(getGoogleLoginUrl())
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-badge">Fixated</span>
          <h1>Sign in to your workspace</h1>
          <p>Use your Google account to continue to the portfolio dashboard.</p>
        </div>
        <button className="google-button" type="button" onClick={handleGoogleLogin}>
          Continue with Google
        </button>
        {errorMessage ? <p className="login-error">{errorMessage}</p> : null}
        <p className="login-footnote">Google OAuth is required to access the dashboard.</p>
      </div>
    </div>
  )
}
