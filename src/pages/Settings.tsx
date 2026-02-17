import { useCallback, useEffect, useMemo, useState } from 'react'
import { SectionHeader } from '../components/ui/SectionHeader'
import type { Role } from '../types/dashboard'
import { formatRelativeRefreshTime } from '../utils/refresh'
import { refreshAllConnectedAccountData } from '../utils/dataRefresh'
import { fetchRefreshCounterStatus, RefreshCounterLimitError } from '../utils/refreshCounter'

interface SettingsProps {
  role: Role
  lastDataRefreshAt: number | null
  onDataRefreshed: (timestamp?: number) => void
}

export const Settings = ({ role, lastDataRefreshAt, onDataRefreshed }: SettingsProps) => {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [refreshClock, setRefreshClock] = useState(() => Date.now())
  const [refreshCount24h, setRefreshCount24h] = useState<number | null>(null)
  const canRefreshData = role === 'admin'

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRefreshClock(Date.now())
    }, 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  const lastRefreshLabel = useMemo(
    () => formatRelativeRefreshTime(lastDataRefreshAt, refreshClock),
    [lastDataRefreshAt, refreshClock],
  )

  const recordSuccessfulRefresh = useCallback((refreshedAt: number) => {
    onDataRefreshed(refreshedAt)
  }, [onDataRefreshed])

  const formatNextWindowLabel = (isoTimestamp: string | null) => {
    if (!isoTimestamp) return 'in 24 hours'
    const parsed = Date.parse(isoTimestamp)
    if (!Number.isFinite(parsed)) return 'in 24 hours'
    return new Date(parsed).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  }

  const handleRefreshNow = () => {
    if (!canRefreshData) return
    if (isRefreshing) return
    void (async () => {
      setIsRefreshing(true)
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
        recordSuccessfulRefresh(result.refreshedAt)
        if (result.refreshCount24h !== null) {
          setRefreshCount24h(result.refreshCount24h)
        }
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
        setIsRefreshing(false)
      }
    })()
  }

  return (
    <>
      <SectionHeader
        title="Settings"
        subtitle="Organization connections are managed from the Organizations page."
      />
    
      <div className="card">
        <div className="section-title">Data refresh</div>
        <div className="section-subtitle">Refreshes YouTube reporting data and campaign pacing inputs.</div>
        <div className="filter-bar" style={{ marginTop: '16px' }}>
          <button
            className="ghost-button"
            type="button"
            onClick={handleRefreshNow}
            disabled={isRefreshing || !canRefreshData}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh now'}
          </button>
          <span className="filter-chip">Last refresh: {lastRefreshLabel}</span>
          {refreshCount24h !== null ? (
            <span className="filter-chip">Refreshes in last 24h: {refreshCount24h}</span>
          ) : null}
        </div>
        {refreshMessage ? (
          <div className="section-subtitle" style={{ marginTop: '10px' }}>
            {refreshMessage}
          </div>
        ) : null}
      </div>
    </>
  )
}
