import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SectionHeader } from '../components/ui/SectionHeader'
import { formatRelativeRefreshTime } from '../utils/refresh'
import { bumpRefreshCounter } from '../utils/refreshCounter'
import { getYouTubeConnectUrl } from '../utils/auth'
import {
  clearYouTubeConnectionsCache,
  clearYouTubeSummaryCache,
  disconnectYouTubeChannels,
  fetchAndCacheYouTubeSummary,
  fetchYouTubeConnections,
  startYouTubeRefresh,
  waitForYouTubeRefresh,
} from '../utils/youtube'

type PlatformKey = 'youtube' | 'instagram' | 'tiktok' | 'x'
type RoleKey = 'admin' | 'internal' | 'brandViewers'

interface SettingsProps {
  lastDataRefreshAt: number | null
  onDataRefreshed: (timestamp?: number) => void
}

export const Settings = ({ lastDataRefreshAt, onDataRefreshed }: SettingsProps) => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const status = searchParams.get('status')
  const provider = searchParams.get('provider')
  const youtubeAuthMessage =
    searchParams.get('message') ??
    searchParams.get('error_description') ??
    'YouTube connection failed. Please try again.'
  const isYoutubeSuccess = provider === 'youtube' && status === 'success'
  const isYoutubeError = provider === 'youtube' && status === 'error'

  const [youtubeAccounts, setYoutubeAccounts] = useState(0)
  const [youtubeChannelNames, setYoutubeChannelNames] = useState<string[]>([])
  const [youtubeStatusMessage, setYoutubeStatusMessage] = useState<string | null>(() => {
    if (isYoutubeSuccess) {
      return 'YouTube account connected successfully.'
    }
    if (isYoutubeError) return youtubeAuthMessage
    return null
  })
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformKey | null>(null)
  const [selectedRole, setSelectedRole] = useState<RoleKey | null>(null)
  const [selectedYouTubeChannels, setSelectedYouTubeChannels] = useState<string[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshClock, setRefreshClock] = useState(() => Date.now())
  const [refreshCount24h, setRefreshCount24h] = useState<number | null>(null)

  const fetchConnections = useCallback(async () => {
    try {
      const payload = await fetchYouTubeConnections()
      const channelNames = payload.connections
        .map((connection) => connection.channelName?.trim())
        .filter((name): name is string => Boolean(name))
      setYoutubeChannelNames(channelNames)
      setYoutubeAccounts(payload.count)
    } catch {
      setYoutubeStatusMessage('Unable to load YouTube connections.')
    }
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRefreshClock(Date.now())
    }, 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (provider === 'youtube') return
    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return
      void fetchConnections()
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [fetchConnections, provider])

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

  useEffect(() => {
    if (provider !== 'youtube') return
    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return
      if (isYoutubeSuccess) {
        clearYouTubeSummaryCache()
        void fetchConnections()
        setYoutubeStatusMessage('YouTube account connected successfully. Click Refresh now to load analytics.')
      } else {
        void fetchConnections()
      }
      if (isYoutubeError) {
        setYoutubeStatusMessage(youtubeAuthMessage)
      }
    }, 0)
    navigate('/settings', { replace: true })
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [fetchConnections, isYoutubeError, isYoutubeSuccess, navigate, provider, recordSuccessfulRefresh, youtubeAuthMessage])

  const youtubeConnectionLabel = useMemo(() => {
    const noun = youtubeAccounts === 1 ? 'account' : 'accounts'
    return `YouTube • ${youtubeAccounts} ${noun}`
  }, [youtubeAccounts])

  const resolvedYoutubeChannelNames = useMemo(() => {
    if (youtubeAccounts === 0) return []
    if (youtubeChannelNames.length >= youtubeAccounts) {
      return youtubeChannelNames.slice(0, youtubeAccounts)
    }
    return [
      ...youtubeChannelNames,
      ...Array.from(
        { length: youtubeAccounts - youtubeChannelNames.length },
        (_, index) => `Channel ${youtubeChannelNames.length + index + 1}`,
      ),
    ]
  }, [youtubeAccounts, youtubeChannelNames])

  const platformItems: Array<{ key: PlatformKey; label: string; accountCount: number }> = [
    { key: 'youtube', label: youtubeConnectionLabel, accountCount: youtubeAccounts },
    { key: 'instagram', label: 'Instagram • 5 accounts', accountCount: 5 },
    { key: 'tiktok', label: 'TikTok • 4 accounts', accountCount: 4 },
    { key: 'x', label: 'X • 2 accounts', accountCount: 2 },
  ]

  const roleItems: Array<{ key: RoleKey; label: string }> = [
    { key: 'admin', label: 'Admin: 4 users' },
    { key: 'internal', label: 'Internal: 18 users' },
    { key: 'brandViewers', label: 'Brand viewers: 6 users' },
  ]

  const handleConnectYouTube = () => {
    window.location.assign(getYouTubeConnectUrl())
  }

  const handleDisconnectYouTube = () => {
    clearYouTubeConnectionsCache()
    clearYouTubeSummaryCache()
    void disconnectYouTubeChannels()
      .then(() => fetchConnections())
      .catch(() => null)
    setYoutubeAccounts(0)
    setYoutubeChannelNames([])
    setSelectedYouTubeChannels([])
    setYoutubeStatusMessage('Disconnected all YouTube accounts.')
  }

  const toggleYouTubeChannelSelection = (channelName: string) => {
    setSelectedYouTubeChannels((current) =>
      current.includes(channelName)
        ? current.filter((value) => value !== channelName)
        : [...current, channelName],
    )
  }

  const handleDisconnectSelectedYouTube = () => {
    const selectedConnectedChannels = resolvedYoutubeChannelNames.filter((name) =>
      selectedYouTubeChannels.includes(name),
    )
    if (!selectedConnectedChannels.length) {
      setYoutubeStatusMessage('Select at least one YouTube channel to disconnect.')
      return
    }

    clearYouTubeConnectionsCache()
    clearYouTubeSummaryCache()
    void disconnectYouTubeChannels(selectedConnectedChannels)
      .then(() => fetchConnections())
      .catch(() => null)
    const selectedSet = new Set(selectedConnectedChannels)
    const remainingChannels = resolvedYoutubeChannelNames.filter((name) => !selectedSet.has(name))
    const noun = selectedConnectedChannels.length === 1 ? 'channel' : 'channels'

    setYoutubeChannelNames(remainingChannels)
    setYoutubeAccounts(remainingChannels.length)
    setSelectedYouTubeChannels([])
    setYoutubeStatusMessage(`Disconnected ${selectedConnectedChannels.length} YouTube ${noun}.`)
  }

  const handleRefreshNow = () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    setYoutubeStatusMessage('Refreshing YouTube data...')
    void startYouTubeRefresh()
      .then((job) =>
        waitForYouTubeRefresh(job.jobId, {
          onProgress: (status) => {
            if (status.status === 'running' && status.channelsTotal > 0) {
              setYoutubeStatusMessage(
                `Refreshing YouTube data... ${Math.min(status.channelsProcessed, status.channelsTotal)}/${status.channelsTotal} channels`,
              )
            }
          },
        }),
      )
      .then((status) => {
        if (status.status === 'failed') {
          throw new Error(status.errorMessage || 'YouTube refresh failed.')
        }
        const refreshedAt = Date.now()
        return fetchAndCacheYouTubeSummary({ force: true }).then((summary) => ({ summary, refreshedAt }))
      })
      .then(({ summary, refreshedAt }) => {
        const connectedChannelNames = summary.channels
          .map((channel) => channel.name?.trim())
          .filter((name): name is string => Boolean(name))
        setYoutubeChannelNames(connectedChannelNames)
        setYoutubeAccounts(connectedChannelNames.length)
        recordSuccessfulRefresh(refreshedAt)
        setYoutubeStatusMessage('YouTube data refreshed successfully.')
      })
      .catch(() => {
        setYoutubeStatusMessage('Unable to refresh YouTube data.')
      })
      .finally(() => setIsRefreshing(false))
  }

  const selectedConnectedYouTubeCount = resolvedYoutubeChannelNames.filter((name) =>
    selectedYouTubeChannels.includes(name),
  ).length

  return (
    <>
      <SectionHeader
        title="Account Connections"
        subtitle="Connect owned and operated accounts to unlock analytics."
      />
      <div className="grid grid-2">
        <div className="card">
          <div className="split">
            <div>
              <div className="section-title">Connected platforms</div>
              <div className="section-subtitle">OAuth tokens encrypted at rest.</div>
            </div>
            <span className={`pill ${youtubeAccounts > 0 ? 'success' : ''}`}>
              {youtubeAccounts > 0 ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <div className="filter-bar" style={{ marginTop: '16px' }}>
            {platformItems.map((item) => (
              <button
                key={item.key}
                className={`filter-chip ${
                  selectedPlatform === item.key && item.accountCount > 0 ? 'active' : ''
                }`}
                onClick={() =>
                  setSelectedPlatform((current) => {
                    const next = current === item.key ? null : item.key
                    if (next !== 'youtube') setSelectedYouTubeChannels([])
                    return next
                  })
                }
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
         
          <div className="filter-bar" style={{ marginTop: '12px' }}>
            <button className="primary-button" onClick={handleConnectYouTube} type="button">
              Add YouTube Account
            </button>
          </div>
          {selectedPlatform === 'youtube' && youtubeAccounts > 0 ? (
            <div className="filter-bar" style={{ marginTop: '10px' }}>
              <button
                className="ghost-button"
                aria-disabled={selectedConnectedYouTubeCount === 0}
                disabled={selectedConnectedYouTubeCount === 0}
                onClick={selectedConnectedYouTubeCount > 0 ? handleDisconnectSelectedYouTube : undefined}
                style={selectedConnectedYouTubeCount === 0 ? { pointerEvents: 'none', opacity: 0.6 } : undefined}
                type="button"
              >
                Disconnect selected
              </button>
              <button className="ghost-button" onClick={handleDisconnectYouTube} type="button">
                Disconnect all YouTube
              </button>
            </div>
          ) : null}
          {selectedPlatform === 'youtube' && resolvedYoutubeChannelNames.length ? (
            <div style={{ marginTop: '12px' }}>
              <div className="section-subtitle">Select YouTube channels to disconnect</div>
              <div className="check-row" style={{ marginTop: '8px' }}>
                {resolvedYoutubeChannelNames.map((channelName) => (
                  <label className="check-pill" key={channelName}>
                    <input
                      checked={selectedYouTubeChannels.includes(channelName)}
                      onChange={() => toggleYouTubeChannelSelection(channelName)}
                      type="checkbox"
                    />
                    {channelName}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {youtubeStatusMessage ? (
            <p className="section-subtitle" style={{ marginTop: '12px' }}>
              {youtubeStatusMessage}
            </p>
          ) : null}
        
        </div>
        <div className="card">
          <div className="section-title">Access & roles</div>
          <div className="section-subtitle">Row-level access and brand viewers.</div>
          <div className="filter-bar" style={{ marginTop: '16px' }}>
            {roleItems.map((item) => (
              <button
                key={item.key}
                className={`filter-chip ${selectedRole === item.key ? 'active' : ''}`}
                onClick={() => setSelectedRole((current) => (current === item.key ? null : item.key))}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        
        </div>
      </div>
      <div className="card">
        <div className="section-title">Data refresh</div>
        <div className="section-subtitle">Daily refresh with hourly campaign pacing updates.</div>
        <div className="filter-bar" style={{ marginTop: '16px' }}>
          <button className="ghost-button" type="button" onClick={handleRefreshNow} disabled={isRefreshing}>
            {isRefreshing ? 'Refreshing...' : 'Refresh now'}
          </button>
          <span className="filter-chip">Last refresh: {lastRefreshLabel}</span>
          {refreshCount24h !== null ? (
            <span className="filter-chip">Refreshes in last 24h: {refreshCount24h}</span>
          ) : null}
        </div>
      </div>
    </>
  )
}
