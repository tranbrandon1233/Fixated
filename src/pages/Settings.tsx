import { useCallback, useEffect, useMemo, useState } from 'react'
import { SectionHeader } from '../components/ui/SectionHeader'
import type { Role } from '../types/dashboard'
import { formatRelativeRefreshTime } from '../utils/refresh'
import { bumpRefreshCounter } from '../utils/refreshCounter'
import {
  clearYouTubeSummaryCache,
  fetchAndCacheYouTubeSummary,
  startYouTubeRefresh,
  waitForYouTubeRefresh,
} from '../utils/youtube'

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
    void bumpRefreshCounter()
      .then((payload) => {
        setRefreshCount24h(payload.refreshCount)
      })
      .catch(() => null)
  }, [onDataRefreshed])

  const handleRefreshNow = () => {
    if (!canRefreshData) return
    if (isRefreshing) return
    setIsRefreshing(true)
    setRefreshMessage('Refreshing data...')
    void startYouTubeRefresh()
      .then((job) =>
        waitForYouTubeRefresh(job.jobId, {
          onProgress: (status) => {
            if (status.status === 'running' && status.channelsTotal > 0) {
              setRefreshMessage(
                `Refreshing data... ${Math.min(status.channelsProcessed, status.channelsTotal)}/${status.channelsTotal} channels`,
              )
            }
          },
        }),
      )
      .then((status) => {
        if (status.status === 'failed') {
          throw new Error(status.errorMessage || 'Refresh failed.')
        }
        const refreshedAt = Date.now()
        clearYouTubeSummaryCache()
        return fetchAndCacheYouTubeSummary({ force: true }).then(() => refreshedAt)
      })
      .then((refreshedAt) => {
        recordSuccessfulRefresh(refreshedAt)
        setRefreshMessage('Data refreshed successfully.')
      })
      .catch(() => {
        setRefreshMessage('Unable to refresh data.')
      })
      .finally(() => setIsRefreshing(false))
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
