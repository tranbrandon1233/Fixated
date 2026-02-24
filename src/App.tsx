import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { Campaigns } from './pages/Campaigns'
import { Channel } from './pages/Channel'
import { ExportPreview } from './pages/ExportPreview'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Portfolio } from './pages/Portfolio'
import { Organizations } from './pages/Organizations'
import { ReportBuilder } from './pages/ReportBuilder'
import { ReportViewer } from './pages/ReportViewer'
import { Settings } from './pages/Settings'
import type { Role } from './types/dashboard'
import { useTheme } from './theme/useTheme'
import { fetchSessionStatus, logout } from './utils/auth'
import { clearInstagramConnectionsCache, clearInstagramSummaryCache } from './utils/instagram'
import { persistLastDataRefreshAt, readLastDataRefreshAt } from './utils/refresh'
import { clearXSummaryCache } from './utils/x'
import { clearYouTubeConnectionsCache, clearYouTubeSummaryCache } from './utils/youtube'

const AUTH_USER_ID_STORAGE_KEY = 'fixated.auth.userId'

const clearDashboardAccountCaches = () => {
  clearYouTubeSummaryCache()
  clearYouTubeConnectionsCache()
  clearInstagramSummaryCache()
  clearInstagramConnectionsCache()
  clearXSummaryCache()
}

const syncAuthedUserId = (nextUserId: string) => {
  const normalizedNextUserId = nextUserId.trim()
  const previousUserId = localStorage.getItem(AUTH_USER_ID_STORAGE_KEY) ?? ''
  if (!normalizedNextUserId) {
    if (previousUserId) {
      clearDashboardAccountCaches()
    }
    localStorage.removeItem(AUTH_USER_ID_STORAGE_KEY)
    return
  }
  if (previousUserId && previousUserId !== normalizedNextUserId) {
    clearDashboardAccountCaches()
  }
  localStorage.setItem(AUTH_USER_ID_STORAGE_KEY, normalizedNextUserId)
}

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
  const [role, setRole] = useState<Role>('admin')
  const [lastDataRefreshAt, setLastDataRefreshAt] = useState<number | null>(() =>
    readLastDataRefreshAt(),
  )
  const { mode, toggle } = useTheme()
  const isBrandViewer = role === 'brand'
  const defaultAuthedPath = isBrandViewer ? '/report-view' : '/portfolio'

  const handleLogin = (provider: 'google') => {
    clearDashboardAccountCaches()
    localStorage.removeItem(AUTH_USER_ID_STORAGE_KEY)
    localStorage.setItem('auth_provider', provider)
    setIsAuthed(true)
    setIsSessionChecking(false)
  }

  const handleLogout = () => {
    void logout()
    clearDashboardAccountCaches()
    localStorage.removeItem(AUTH_USER_ID_STORAGE_KEY)
    localStorage.removeItem('auth_provider')
    setIsAuthed(false)
    setIsSessionChecking(false)
    setRole('admin')
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
        syncAuthedUserId('')
        if (!cancelled) setIsSessionChecking(false)
        return
      }

      const status = await fetchSessionStatus()
      if (cancelled) return
      if (!status.authenticated && !status.transientError) {
        syncAuthedUserId('')
        localStorage.removeItem('auth_provider')
        setIsAuthed(false)
        setRole('admin')
      } else if (status.authenticated) {
        syncAuthedUserId(status.userId ?? '')
        setRole(status.role ?? 'admin')
      }
      setIsSessionChecking(false)
    }

    void verifySession()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isAuthed || localStorage.getItem('auth_provider') !== 'google') return

    let cancelled = false

    const checkForSessionTimeout = async () => {
      const status = await fetchSessionStatus()
      if (cancelled) return
      if (!status.authenticated && !status.transientError) {
        syncAuthedUserId('')
        localStorage.removeItem('auth_provider')
        setIsAuthed(false)
        setRole('admin')
        setIsSessionChecking(false)
        return
      }
      if (status.authenticated) {
        syncAuthedUserId(status.userId ?? '')
        setRole(status.role ?? 'admin')
      }
    }

    const intervalId = window.setInterval(() => {
      void checkForSessionTimeout()
    }, 30_000)

    const handleWindowFocus = () => {
      void checkForSessionTimeout()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForSessionTimeout()
      }
    }

    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    void checkForSessionTimeout()

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isAuthed])

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
        path="/"
        element={isAuthed ? <Navigate to={defaultAuthedPath} replace /> : <Home />}
      />
      <Route
        path="/login"
        element={
          isAuthed ? <Navigate to={defaultAuthedPath} replace /> : <Login onLogin={handleLogin} />
        }
      />
      <Route
        element={
          isAuthed ? (
            isBrandViewer ? (
              <Navigate to="/report-view" replace />
            ) : (
              <AppLayout
                role={role}
                lastDataRefreshAt={lastDataRefreshAt}
                onDataRefreshed={handleDataRefreshed}
                themeMode={mode}
                onToggleTheme={toggle}
                onLogout={handleLogout}
              />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/channels" element={<Channel />} />
        <Route path="/campaigns" element={<Campaigns role={role} />} />
        <Route path="/organizations" element={<Organizations role={role} />} />
        <Route path="/reports" element={<ReportBuilder role={role} />} />
        <Route
          path="/settings"
          element={
            role === 'admin'
              ? (
                  <Settings
                    role={role}
                    lastDataRefreshAt={lastDataRefreshAt}
                    onDataRefreshed={handleDataRefreshed}
                  />
                )
              : <Navigate to="/portfolio" replace />
          }
        />
      </Route>
      <Route
        path="/report-view"
        element={isAuthed ? <ReportViewer onLogout={handleLogout} /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/exports/preview"
        element={isAuthed ? <ExportPreview /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to={isAuthed ? defaultAuthedPath : '/'} replace />} />
    </Routes>
  )
}

export default App
