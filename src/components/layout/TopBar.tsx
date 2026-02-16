import { useEffect, useMemo, useState } from 'react'
import { formatRelativeRefreshTime } from '../../utils/refresh'

interface TopBarProps {
  title: string
  lastDataRefreshAt: number | null
  themeMode: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void
}

export const TopBar = ({
  title,
  lastDataRefreshAt,
  themeMode,
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
        <button className="ghost-button" onClick={onLogout}>
          Log out
        </button>
      </div>
    </header>
  )
}
