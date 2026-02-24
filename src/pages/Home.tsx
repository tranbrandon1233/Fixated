import { Link } from 'react-router-dom'

export const Home = () => (
  <div className="home-shell">
    <main className="home-card">
      <span className="home-badge">Fixated Dashboard</span>
      <h1>Track engagement over time and report performance with confidence.</h1>
      <p>
        Fixated Dashboard helps teams monitor social media engagement rates over time and generate
        performance reports for X and YouTube.
      </p>
      <div className="home-actions">
        <Link className="primary-button" to="/login">
          Sign in
        </Link>
      </div>
      <p style={{fontSize: '12px', color: '#666' }}>
          <a href="https://fixated.com/policy/privacy" target="_blank" rel="noreferrer">
            Privacy Policy
          </a>
          <span aria-hidden="true"> | </span>
          <a href="https://fixated.com/policy/terms" target="_blank" rel="noreferrer">
            Terms of Service
          </a>
        </p>
    </main>
  </div>
)

