import type { ChannelSummary, DemographicPoint, PostSummary, TimeSeriesPoint } from '../types/dashboard'
import { resolveAuthBaseUrl } from './baseUrl'

const apiBaseUrl = resolveAuthBaseUrl()

export interface YouTubeSummary {
  channels: ChannelSummary[]
  topPosts: PostSummary[]
  timeSeries: TimeSeriesPoint[]
  ageDistribution: DemographicPoint[]
  genderDistribution: DemographicPoint[]
  topGeos: DemographicPoint[]
}

export interface YouTubeConnection {
  channelId: string
  channelName: string
}

interface YouTubeConnectionsResponse {
  count: number
  connections: YouTubeConnection[]
}

export interface YouTubeRefreshStartResponse {
  ok: boolean
  jobId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
}

export interface YouTubeRefreshStatusResponse {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  requestedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  channelsTotal: number
  channelsProcessed: number
  errorMessage: string
  meta: Record<string, unknown>
}

let lastKnownConnectionCount = 0
let lastKnownConnections: YouTubeConnection[] = []
let cachedSummary: YouTubeSummary | null = null
let cachedSummaryUpdatedAt = 0
let inFlightSummaryRequest: Promise<YouTubeSummary> | null = null
const YOUTUBE_SUMMARY_CACHE_KEY = 'fixated.youtube.summary'
const YOUTUBE_SUMMARY_CACHE_UPDATED_AT_KEY = 'fixated.youtube.summary.updatedAt'
const YOUTUBE_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000

const normalizeConnections = (payload: unknown): YouTubeConnectionsResponse => {
  if (!payload || typeof payload !== 'object') {
    return { count: 0, connections: [] }
  }
  const data = payload as Partial<YouTubeConnectionsResponse>
  return {
    count: Number.isFinite(data.count)
      ? Number(data.count)
      : Array.isArray(data.connections)
        ? data.connections.length
        : 0,
    connections: Array.isArray(data.connections) ? data.connections : [],
  }
}

const readYouTubeConnections = async (): Promise<YouTubeConnectionsResponse> => {
  const response = await fetch(`${apiBaseUrl}/api/youtube/connections`, {
    credentials: 'include',
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('Unable to load YouTube connections.')
  }
  const payload = await response.json().catch(() => null)
  return normalizeConnections(payload)
}

export const clearYouTubeConnectionsCache = () => {
  lastKnownConnectionCount = 0
  lastKnownConnections = []
}

const normalizeSummary = (payload: unknown): YouTubeSummary => {
  if (!payload || typeof payload !== 'object') {
    return {
      channels: [],
      topPosts: [],
      timeSeries: [],
      ageDistribution: [],
      genderDistribution: [],
      topGeos: [],
    }
  }
  const data = payload as {
    channels?: ChannelSummary[]
    topPosts?: PostSummary[]
    timeSeries?: TimeSeriesPoint[]
    ageDistribution?: DemographicPoint[]
    genderDistribution?: DemographicPoint[]
    topGeos?: DemographicPoint[]
  }
  return {
    channels: Array.isArray(data.channels) ? data.channels : [],
    topPosts: Array.isArray(data.topPosts) ? data.topPosts : [],
    timeSeries: Array.isArray(data.timeSeries) ? data.timeSeries : [],
    ageDistribution: Array.isArray(data.ageDistribution) ? data.ageDistribution : [],
    genderDistribution: Array.isArray(data.genderDistribution) ? data.genderDistribution : [],
    topGeos: Array.isArray(data.topGeos) ? data.topGeos : [],
  }
}

const readSummaryUpdatedAtFromStorage = (): number => {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(YOUTUBE_SUMMARY_CACHE_UPDATED_AT_KEY)
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  } catch {
    return 0
  }
}

const readSummaryFromStorage = (): YouTubeSummary | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(YOUTUBE_SUMMARY_CACHE_KEY)
    if (!raw) return null
    return normalizeSummary(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeSummaryToStorage = (summary: YouTubeSummary) => {
  if (typeof window === 'undefined') return
  const updatedAt = Date.now()
  cachedSummaryUpdatedAt = updatedAt
  try {
    window.localStorage.setItem(YOUTUBE_SUMMARY_CACHE_KEY, JSON.stringify(summary))
    window.localStorage.setItem(YOUTUBE_SUMMARY_CACHE_UPDATED_AT_KEY, String(updatedAt))
  } catch {
    // Ignore storage write failures to avoid interrupting dashboard rendering.
  }
}

const clearSummaryFromStorage = () => {
  if (typeof window === 'undefined') return
  cachedSummaryUpdatedAt = 0
  try {
    window.localStorage.removeItem(YOUTUBE_SUMMARY_CACHE_KEY)
    window.localStorage.removeItem(YOUTUBE_SUMMARY_CACHE_UPDATED_AT_KEY)
  } catch {
    // Ignore storage clear failures.
  }
}

const isSummaryCacheFresh = () => {
  if (!cachedSummaryUpdatedAt) return false
  return Date.now() - cachedSummaryUpdatedAt <= YOUTUBE_SUMMARY_CACHE_TTL_MS
}

const hasMeaningfulSummaryMetrics = (summary: YouTubeSummary) => {
  const hasChannelViews = summary.channels.some((channel) => Number(channel?.views) > 0)
  const hasSeriesViews = summary.timeSeries.some((point) => Number(point?.views) > 0)
  const hasPostViews = summary.topPosts.some((post) => Number(post?.views) > 0)
  if (hasChannelViews || hasSeriesViews) return true
  return hasPostViews
}

export const getCachedYouTubeSummary = (): YouTubeSummary | null => {
  if (cachedSummary) return cachedSummary
  const stored = readSummaryFromStorage()
  if (stored) {
    cachedSummary = stored
    cachedSummaryUpdatedAt = readSummaryUpdatedAtFromStorage()
  }
  return cachedSummary
}

export const setCachedYouTubeSummary = (summary: YouTubeSummary) => {
  cachedSummary = summary
  writeSummaryToStorage(summary)
}

export const clearYouTubeSummaryCache = () => {
  cachedSummary = null
  inFlightSummaryRequest = null
  clearSummaryFromStorage()
}

const requestYouTubeSummary = async (): Promise<YouTubeSummary> => {
  const response = await fetch(`${apiBaseUrl}/api/youtube/summary`, {
    credentials: 'include',
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('Unable to load YouTube summary.')
  }
  const payload = await response.json().catch(() => null)
  return normalizeSummary(payload)
}

export const fetchYouTubeSummary = async (): Promise<YouTubeSummary> => {
  const nextSummary = await requestYouTubeSummary()
  setCachedYouTubeSummary(nextSummary)
  return nextSummary
}

export const fetchAndCacheYouTubeSummary = async (options?: { force?: boolean }): Promise<YouTubeSummary> => {
  const forceRefresh = Boolean(options?.force)
  const existing = getCachedYouTubeSummary()
  if (!forceRefresh && existing) {
    const looksInconsistent =
      existing.topPosts.some((post) => Number(post?.views) > 0)
      && existing.channels.every((channel) => Number(channel?.views) <= 0)
      && existing.timeSeries.every((point) => Number(point?.views) <= 0)
    const needsLiveRecovery = looksInconsistent || !hasMeaningfulSummaryMetrics(existing)

    if (isSummaryCacheFresh()) {
      if (!needsLiveRecovery && existing.channels.length > 0) {
        return existing
      }
    }
  }

  if (!forceRefresh && inFlightSummaryRequest) {
    return inFlightSummaryRequest
  }

  const request = requestYouTubeSummary()
    .then((summary) => {
      setCachedYouTubeSummary(summary)
      return summary
    })
    .finally(() => {
      if (inFlightSummaryRequest === request) {
        inFlightSummaryRequest = null
      }
    })

  inFlightSummaryRequest = request
  return request
}

export const fetchYouTubeConnections = async (): Promise<YouTubeConnectionsResponse> => {
  let resolved = await readYouTubeConnections()
  if (resolved.count === 0 && lastKnownConnectionCount > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, 150))
    resolved = await readYouTubeConnections().catch(() => resolved)
  }
  if (resolved.count === 0 && lastKnownConnectionCount > 0) {
    return {
      count: lastKnownConnectionCount,
      connections: lastKnownConnections,
    }
  }
  lastKnownConnectionCount = resolved.count
  lastKnownConnections = resolved.connections
  return resolved
}

export const disconnectYouTubeChannels = async (channelNames?: string[]) => {
  await fetch(`${apiBaseUrl}/api/youtube/disconnect`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelNames: channelNames ?? [] }),
  })
}

export const startYouTubeRefresh = async (): Promise<YouTubeRefreshStartResponse> => {
  const response = await fetch(`${apiBaseUrl}/api/youtube/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new Error('Unable to start YouTube refresh.')
  }
  const data = payload as Partial<YouTubeRefreshStartResponse>
  if (!data.jobId || typeof data.jobId !== 'string') {
    throw new Error('Unable to start YouTube refresh.')
  }
  return {
    ok: true,
    jobId: data.jobId,
    status: data.status === 'running' || data.status === 'succeeded' || data.status === 'failed'
      ? data.status
      : 'queued',
  }
}

export const getYouTubeRefreshStatus = async (jobId: string): Promise<YouTubeRefreshStatusResponse> => {
  const response = await fetch(`${apiBaseUrl}/api/youtube/refresh/${encodeURIComponent(jobId)}`, {
    credentials: 'include',
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new Error('Unable to load YouTube refresh status.')
  }
  const data = payload as Partial<YouTubeRefreshStatusResponse>
  return {
    id: typeof data.id === 'string' ? data.id : jobId,
    status: data.status === 'running' || data.status === 'succeeded' || data.status === 'failed'
      ? data.status
      : 'queued',
    requestedAt: typeof data.requestedAt === 'string' ? data.requestedAt : null,
    startedAt: typeof data.startedAt === 'string' ? data.startedAt : null,
    finishedAt: typeof data.finishedAt === 'string' ? data.finishedAt : null,
    channelsTotal: Number.isFinite(data.channelsTotal) ? Number(data.channelsTotal) : 0,
    channelsProcessed: Number.isFinite(data.channelsProcessed) ? Number(data.channelsProcessed) : 0,
    errorMessage: typeof data.errorMessage === 'string' ? data.errorMessage : '',
    meta: data.meta && typeof data.meta === 'object' ? data.meta : {},
  }
}

export const waitForYouTubeRefresh = async (
  jobId: string,
  options?: {
    timeoutMs?: number
    intervalMs?: number
    onProgress?: (status: YouTubeRefreshStatusResponse) => void
  },
): Promise<YouTubeRefreshStatusResponse> => {
  const timeoutMs = Number.isFinite(options?.timeoutMs) ? Number(options?.timeoutMs) : 5 * 60 * 1000
  const intervalMs = Number.isFinite(options?.intervalMs) ? Number(options?.intervalMs) : 2_000
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    const status = await getYouTubeRefreshStatus(jobId)
    if (typeof options?.onProgress === 'function') {
      options.onProgress(status)
    }
    if (status.status === 'succeeded' || status.status === 'failed') {
      return status
    }
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs))
  }

  throw new Error('Timed out waiting for YouTube refresh to complete.')
}
