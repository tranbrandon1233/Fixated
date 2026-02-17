import { useEffect, useMemo, useState } from 'react'
import type { Role } from '../../types/dashboard'
import { formatRelativeRefreshTime } from '../../utils/refresh'
import { refreshAllConnectedAccountData } from '../../utils/dataRefresh'
import { fetchRefreshCounterStatus, RefreshCounterLimitError } from '../../utils/refreshCounter'

interface TopBarProps {
  title: string
  role: Role
  lastDataRefreshAt: number | null
  onDataRefreshed: (timestamp?: number) => void
  themeMode: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void
}

export const TopBar = ({
  title,
  role,
  lastDataRefreshAt,
  onDataRefreshed,
  themeMode,
  onToggleTheme,
  onLogout,
}: TopBarProps) => {
  const [refreshClock, setRefreshClock] = useState(() => Date.now())
  const [isRefreshingData, setIsRefreshingData] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const canRefreshData = role === 'admin'

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

  const formatNextWindowLabel = (isoTimestamp: string | null) => {
    if (!isoTimestamp) return 'in 24 hours'
    const parsed = Date.parse(isoTimestamp)
    if (!Number.isFinite(parsed)) return 'in 24 hours'
    return new Date(parsed).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  }

  const handleRefreshData = () => {
    if (!canRefreshData || isRefreshingData) return
    void (async () => {
      setIsRefreshingData(true)
      try {
        setRefreshMessage('Checking refresh allowance...')
        const status = await fetchRefreshCounterStatus()
        if (status.refreshesRemaining <= 0) {
          const nextWindowLabel = formatNextWindowLabel(status.nextWindowStartsAt)
          window.alert(`Daily refresh limit reached. You can refresh again ${nextWindowLabel}.`)
          setRefreshMessage(`Daily refresh limit reached. Next window: ${nextWindowLabel}.`)
          return
        }

        const shouldRefresh = window.confirm(
          `You have ${status.refreshesRemaining} of ${status.refreshLimit} refreshes remaining in this 24-hour window. Refresh now?`,
        )
        if (!shouldRefresh) {
          setRefreshMessage(null)
          return
        }

        const result = await refreshAllConnectedAccountData({
          onProgress: (message) => setRefreshMessage(message),
        })
        onDataRefreshed(result.refreshedAt)
        const remainingLabel =
          result.refreshesRemaining !== null ? ` ${result.refreshesRemaining} remaining today.` : ''
        setRefreshMessage(`Data refreshed successfully.${remainingLabel}`)
      } catch (error) {
        if (error instanceof RefreshCounterLimitError) {
          const nextWindowLabel = formatNextWindowLabel(error.payload.nextWindowStartsAt)
          window.alert(`Daily refresh limit reached. You can refresh again ${nextWindowLabel}.`)
          setRefreshMessage(`Daily refresh limit reached. Next window: ${nextWindowLabel}.`)
        } else {
          setRefreshMessage('Unable to refresh data.')
        }
      } finally {
        setIsRefreshingData(false)
      }
    })()
  }

  return (
    <header className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="filter-bar">
        <span className="filter-chip static">Data refreshed {refreshLabel}</span>
        {canRefreshData ? (
          <button
            className="ghost-button"
            type="button"
            onClick={handleRefreshData}
            disabled={isRefreshingData}
          >
            {isRefreshingData ? 'Refreshing...' : 'Refresh data'}
          </button>
        ) : null}
        {refreshMessage ? <span className="filter-chip static">{refreshMessage}</span> : null}
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
