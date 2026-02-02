import { useNavigate } from 'react-router-dom'

interface LoginProps {
  onLogin: () => void
}

export const Login = ({ onLogin }: LoginProps) => {
  const navigate = useNavigate()

  const handleGoogleLogin = () => {
    onLogin()
    navigate('/portfolio', { replace: true })
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
        <p className="login-footnote">Only Google OAuth is enabled for this app.</p>
      </div>
    </div>
  )
}
