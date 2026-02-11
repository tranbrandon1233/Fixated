import { useMemo, useState } from 'react'
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
import { logout } from './utils/auth'

const roleOptions: Role[] = ['admin', 'internal', 'brand']

const App = () => {
  const [isAuthed, setIsAuthed] = useState(
    () => localStorage.getItem('auth_provider') === 'google',
  )
  const [role, setRole] = useState<Role>('internal')
  const { mode, toggle } = useTheme()

  const roleLabel = useMemo(() => {
    if (role === 'admin') return 'Admin'
    if (role === 'brand') return 'Brand Viewer'
    return 'Internal'
  }, [role])

  const handleLogin = (provider: 'google') => {
    localStorage.setItem('auth_provider', provider)
    setIsAuthed(true)
  }

  const handleLogout = () => {
    void logout()
    localStorage.removeItem('auth_provider')
    setIsAuthed(false)
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
        <Route path="/settings" element={<Settings />} />
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
