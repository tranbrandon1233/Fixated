import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SectionHeader } from '../components/ui/SectionHeader'
import { getYouTubeConnectUrl } from '../utils/auth'

const YOUTUBE_ACCOUNTS_KEY = 'youtube_connected_accounts'
const YOUTUBE_CHANNEL_NAMES_KEY = 'youtube_connected_channel_names'
const loadYouTubeAccounts = () => {
  const value = Number(localStorage.getItem(YOUTUBE_ACCOUNTS_KEY))
  if (Number.isNaN(value) || value < 0) return 0
  return value
}
const loadYouTubeChannelNames = () => {
  try {
    const raw = localStorage.getItem(YOUTUBE_CHANNEL_NAMES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}
const normalizeChannelName = (value: string) => value.trim().toLowerCase()
const isExistingYouTubeChannel = (existingNames: string[], channelName: string) => {
  const normalized = normalizeChannelName(channelName)
  return existingNames.some((name) => normalizeChannelName(name) === normalized)
}

type PlatformKey = 'youtube' | 'instagram' | 'tiktok' | 'x'
type RoleKey = 'admin' | 'internal' | 'brandViewers'

export const Settings = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const status = searchParams.get('status')
  const provider = searchParams.get('provider')
  const connectedYouTubeChannelName = searchParams.get('youtube_channel_name')?.trim() ?? ''
  const youtubeAuthMessage =
    searchParams.get('message') ??
    searchParams.get('error_description') ??
    'YouTube connection failed. Please try again.'
  const isYoutubeSuccess = provider === 'youtube' && status === 'success'
  const isYoutubeError = provider === 'youtube' && status === 'error'

  const [youtubeAccounts, setYoutubeAccounts] = useState(() => {
    const persistedAccounts = loadYouTubeAccounts()
    if (!isYoutubeSuccess) return persistedAccounts
    if (!connectedYouTubeChannelName) return persistedAccounts + 1
    const existingNames = loadYouTubeChannelNames()
    const shouldAdd = !isExistingYouTubeChannel(existingNames, connectedYouTubeChannelName)
    return persistedAccounts + (shouldAdd ? 1 : 0)
  })
  const [youtubeChannelNames, setYoutubeChannelNames] = useState<string[]>(() => {
    const existingNames = loadYouTubeChannelNames()
    const persistedAccounts = loadYouTubeAccounts()
    const shouldAdd =
      isYoutubeSuccess &&
      (!connectedYouTubeChannelName ||
        !isExistingYouTubeChannel(existingNames, connectedYouTubeChannelName))
    const initialAccounts = persistedAccounts + (shouldAdd ? 1 : 0)
    if (isYoutubeSuccess) {
      const nextName = connectedYouTubeChannelName || `Channel ${existingNames.length + 1}`
      if (shouldAdd) return [...existingNames, nextName].slice(0, initialAccounts)
    }
    return existingNames.slice(0, initialAccounts)
  })
  const [youtubeStatusMessage, setYoutubeStatusMessage] = useState<string | null>(() => {
    if (isYoutubeSuccess) {
      const existingNames = loadYouTubeChannelNames()
      if (connectedYouTubeChannelName && isExistingYouTubeChannel(existingNames, connectedYouTubeChannelName)) {
        return `YouTube channel "${connectedYouTubeChannelName}" is already connected.`
      }
      return 'YouTube account connected successfully.'
    }
    if (isYoutubeError) return youtubeAuthMessage
    return null
  })
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformKey | null>(null)
  const [selectedRole, setSelectedRole] = useState<RoleKey | null>(null)
  const [selectedYouTubeChannels, setSelectedYouTubeChannels] = useState<string[]>([])

  useEffect(() => {
    localStorage.setItem(YOUTUBE_ACCOUNTS_KEY, String(youtubeAccounts))
  }, [youtubeAccounts])

  useEffect(() => {
    localStorage.setItem(YOUTUBE_CHANNEL_NAMES_KEY, JSON.stringify(youtubeChannelNames))
  }, [youtubeChannelNames])

  useEffect(() => {
    if (provider !== 'youtube') return
    navigate('/settings', { replace: true })
  }, [navigate, provider])

  const youtubeConnectionLabel = useMemo(() => {
    const noun = youtubeAccounts === 1 ? 'account' : 'accounts'
    return `YouTube • ${youtubeAccounts} ${noun}`
  }, [youtubeAccounts])

  const resolvedYoutubeChannelNames = useMemo(() => {
    if (youtubeAccounts === 0) return []
    if (youtubeChannelNames.length >= youtubeAccounts) return youtubeChannelNames.slice(0, youtubeAccounts)
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

    const selectedSet = new Set(selectedConnectedChannels)
    const remainingChannels = resolvedYoutubeChannelNames.filter((name) => !selectedSet.has(name))
    const noun = selectedConnectedChannels.length === 1 ? 'channel' : 'channels'

    setYoutubeChannelNames(remainingChannels)
    setYoutubeAccounts(remainingChannels.length)
    setSelectedYouTubeChannels([])
    setYoutubeStatusMessage(`Disconnected ${selectedConnectedChannels.length} YouTube ${noun}.`)
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
          <button className="ghost-button" type="button">
            Refresh now
          </button>
          <span className="filter-chip">Last refresh: 2 hours ago</span>
        </div>
      </div>
    </>
  )
}
