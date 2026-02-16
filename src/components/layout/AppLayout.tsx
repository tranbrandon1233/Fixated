import { Outlet, useLocation } from 'react-router-dom'
import type { Role } from '../../types/dashboard'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

interface AppLayoutProps {
  role: Role
  lastDataRefreshAt: number | null
  themeMode: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void
}

const routeTitles: Record<string, string> = {
  '/portfolio': 'Portfolio Overview',
  '/channels': 'Channel Drilldown',
  '/campaigns': 'Campaign ROI',
  '/organizations': 'Organizations',
  '/reports': 'Brand Report Builder',
  '/settings': 'Account Settings',
}

export const AppLayout = ({
  role,
  lastDataRefreshAt,
  themeMode,
  onToggleTheme,
  onLogout,
}: AppLayoutProps) => {
  const location = useLocation()
  const title = routeTitles[location.pathname] ?? 'Dashboard'

  return (
    <div className="app-shell">
      <Sidebar role={role} />
      <div className="content-area">
        <TopBar
          title={title}
          lastDataRefreshAt={lastDataRefreshAt}
          themeMode={themeMode}
          onToggleTheme={onToggleTheme}
          onLogout={onLogout}
        />
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
