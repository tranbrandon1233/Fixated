import { useEffect, useMemo, useState } from 'react'
import type { Role } from '../../types/dashboard'
import { formatRelativeRefreshTime } from '../../utils/refresh'

interface TopBarProps {
  title: string
  role: Role
  roleLabel: string
  roleOptions: Role[]
  lastDataRefreshAt: number | null
  themeMode: 'light' | 'dark'
  onRoleChange: (role: Role) => void
  onToggleTheme: () => void
  onLogout: () => void
}

export const TopBar = ({
  title,
  role,
  roleLabel,
  roleOptions,
  lastDataRefreshAt,
  themeMode,
  onRoleChange,
  onToggleTheme,
  onLogout,
}: TopBarProps) => {
  const [refreshClock, setRefreshClock] = useState(() => Date.now())

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRefreshClock(Date.now())
    }, 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  const refreshLabel = useMemo(
    () => formatRelativeRefreshTime(lastDataRefreshAt, refreshClock),
    [lastDataRefreshAt, refreshClock],
  )

  return (
    <header className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="filter-bar">
        <span className="filter-chip static">Data refreshed {refreshLabel}</span>
        <button className="ghost-button" onClick={onToggleTheme}>
          Theme: {themeMode === 'dark' ? 'Dark' : 'Light'}
        </button>
      
        <label className="filter-chip">
          Role:
          <select
            value={role}
            onChange={(event) => onRoleChange(event.target.value as Role)}
            className="role-select"
          >
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {option === 'admin' ? 'Admin' : option === 'brand' ? 'Brand Viewer' : 'Internal'}
              </option>
            ))}
          </select>
        </label>
        <span className="filter-chip bg-black">{roleLabel}</span>
        <button className="ghost-button" onClick={onLogout}>
          Log out
        </button>
      </div>
    </header>
  )
}
