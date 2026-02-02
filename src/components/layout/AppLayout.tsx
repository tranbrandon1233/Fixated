import { Outlet, useLocation } from 'react-router-dom'
import type { Role } from '../../types/dashboard'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

interface AppLayoutProps {
  role: Role
  roleLabel: string
  roleOptions: Role[]
  onRoleChange: (role: Role) => void
  themeMode: 'light' | 'dark'
  onToggleTheme: () => void
}

const routeTitles: Record<string, string> = {
  '/portfolio': 'Portfolio Overview',
  '/channels': 'Channel Drilldown',
  '/campaigns': 'Campaign ROI',
  '/reports': 'Brand Report Builder',
  '/settings': 'Account Settings',
}

export const AppLayout = ({
  role,
  roleLabel,
  roleOptions,
  onRoleChange,
  themeMode,
  onToggleTheme,
}: AppLayoutProps) => {
  const location = useLocation()
  const title = routeTitles[location.pathname] ?? 'Dashboard'

  return (
    <div className="app-shell">
      <Sidebar role={role} />
      <div className="content-area">
        <TopBar
          title={title}
          role={role}
          roleLabel={roleLabel}
          roleOptions={roleOptions}
          onRoleChange={onRoleChange}
          themeMode={themeMode}
          onToggleTheme={onToggleTheme}
        />
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
