import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { Campaigns } from './pages/Campaigns'
import { Channel } from './pages/Channel'
import { Login } from './pages/Login'
import { Portfolio } from './pages/Portfolio'
import { ReportBuilder } from './pages/ReportBuilder'
import { ReportViewer } from './pages/ReportViewer'
import { Settings } from './pages/Settings'
import type { Role } from './types/dashboard'
import { useTheme } from './theme/useTheme'
import { fetchSessionStatus, logout } from './utils/auth'
import { persistLastDataRefreshAt, readLastDataRefreshAt } from './utils/refresh'

const roleOptions: Role[] = ['admin', 'internal', 'brand']

const App = () => {
  const [isAuthed, setIsAuthed] = useState(() => {
    if (localStorage.getItem('auth_provider') === 'google') return true

    const searchParams = new URLSearchParams(window.location.search)
    const isGoogleLoginSuccess =
      window.location.pathname === '/login' &&
      searchParams.get('status') === 'success' &&
      searchParams.get('provider') === 'google'

    if (isGoogleLoginSuccess) {
      localStorage.setItem('auth_provider', 'google')
      return true
    }

    return false
  })
  const [isSessionChecking, setIsSessionChecking] = useState(() =>
    localStorage.getItem('auth_provider') === 'google',
  )
  const [role, setRole] = useState<Role>('internal')
  const [lastDataRefreshAt, setLastDataRefreshAt] = useState<number | null>(() =>
    readLastDataRefreshAt(),
  )
  const { mode, toggle } = useTheme()

  const roleLabel = useMemo(() => {
    if (role === 'admin') return 'Admin'
    if (role === 'brand') return 'Brand Viewer'
    return 'Internal'
  }, [role])

  const handleLogin = (provider: 'google') => {
    localStorage.setItem('auth_provider', provider)
    setIsAuthed(true)
    setIsSessionChecking(false)
  }

  const handleLogout = () => {
    void logout()
    localStorage.removeItem('auth_provider')
    setIsAuthed(false)
    setIsSessionChecking(false)
  }

  const handleDataRefreshed = useCallback((timestamp?: number) => {
    const nextTimestamp = timestamp ?? Date.now()
    setLastDataRefreshAt(nextTimestamp)
    persistLastDataRefreshAt(nextTimestamp)
  }, [])

  useEffect(() => {
    let cancelled = false

    const verifySession = async () => {
      if (localStorage.getItem('auth_provider') !== 'google') {
        if (!cancelled) setIsSessionChecking(false)
        return
      }

      const status = await fetchSessionStatus()
      if (cancelled) return
      if (!status.authenticated) {
        localStorage.removeItem('auth_provider')
        setIsAuthed(false)
      }
      setIsSessionChecking(false)
    }

    void verifySession()
    return () => {
      cancelled = true
    }
  }, [])

  if (isSessionChecking) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <p className="login-footnote">Checking session...</p>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthed ? <Navigate to="/portfolio" replace /> : <Login onLogin={handleLogin} />
        }
      />
      <Route
        element={
          isAuthed ? (
            <AppLayout
              role={role}
              roleLabel={roleLabel}
              roleOptions={roleOptions}
              onRoleChange={setRole}
              lastDataRefreshAt={lastDataRefreshAt}
              themeMode={mode}
              onToggleTheme={toggle}
              onLogout={handleLogout}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<Navigate to="/portfolio" replace />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/channels" element={<Channel />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/reports" element={<ReportBuilder />} />
        <Route
          path="/settings"
          element={
            <Settings
              lastDataRefreshAt={lastDataRefreshAt}
              onDataRefreshed={handleDataRefreshed}
            />
          }
        />
      </Route>
      <Route
        path="/report-view"
        element={isAuthed ? <ReportViewer /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to={isAuthed ? '/portfolio' : '/login'} replace />} />
    </Routes>
  )
}

export default App
