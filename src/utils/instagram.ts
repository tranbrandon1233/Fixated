import type {
  ChannelSummary,
  ChannelTimeSeriesPoint,
  DemographicPoint,
  PostSummary,
  TimeSeriesPoint,
} from '../types/dashboard'
import { resolveAuthBaseUrl } from './baseUrl'
import { sanitizeDateInput, sanitizeTextInput } from './sanitize'

const apiBaseUrl = resolveAuthBaseUrl()

export interface InstagramSummary {
  firstVideoUploadDate: string
  channels: ChannelSummary[]
  topPosts: PostSummary[]
  timeSeries: TimeSeriesPoint[]
  timeSeriesByChannel: ChannelTimeSeriesPoint[]
  ageDistribution: DemographicPoint[]
  ageDistributionByChannel: Record<string, DemographicPoint[]>
  genderDistribution: DemographicPoint[]
  genderDistributionByChannel: Record<string, DemographicPoint[]>
  topGeos: DemographicPoint[]
  topGeosByChannel: Record<string, DemographicPoint[]>
}

export interface InstagramConnection {
  accountId: string
  accountName: string
}

interface InstagramConnectionsResponse {
  count: number
  connections: InstagramConnection[]
}

export interface InstagramRefreshStartResponse {
  ok: boolean
  jobId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
}

export interface InstagramRefreshStatusResponse {
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

let cachedSummary: InstagramSummary | null = null
let cachedSummaryUpdatedAt = 0
let inFlightSummaryRequest: Promise<InstagramSummary> | null = null
const INSTAGRAM_SUMMARY_CACHE_KEY = 'fixated.instagram.summary'
const INSTAGRAM_SUMMARY_CACHE_UPDATED_AT_KEY = 'fixated.instagram.summary.updatedAt'
const INSTAGRAM_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000

const toSafeNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeConnections = (payload: unknown): InstagramConnectionsResponse => {
  if (!payload || typeof payload !== 'object') {
    return { count: 0, connections: [] }
  }
  const data = payload as Partial<InstagramConnectionsResponse>
  return {
    count: Number.isFinite(data.count)
      ? Number(data.count)
      : Array.isArray(data.connections)
        ? data.connections.length
        : 0,
    connections: Array.isArray(data.connections) ? data.connections : [],
  }
}

const normalizeTimeSeriesPoint = (value: unknown): TimeSeriesPoint | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<TimeSeriesPoint>
  const date = sanitizeTextInput(row.date, { maxLength: 64 })
  if (!date) return null
  return {
    date,
    views: toSafeNumber(row.views),
    engagements: toSafeNumber(row.engagements),
    posts: toSafeNumber(row.posts),
    watchTimeHours: toSafeNumber(row.watchTimeHours),
    followersNetChange: Math.round(toSafeNumber(row.followersNetChange)),
  }
}

const normalizeChannelTimeSeriesPoint = (value: unknown): ChannelTimeSeriesPoint | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<ChannelTimeSeriesPoint>
  const channelId = sanitizeTextInput(row.channelId, { maxLength: 300 })
  if (!channelId) return null
  const point = normalizeTimeSeriesPoint(value)
  if (!point) return null
  return {
    channelId,
    ...point,
  }
}

const normalizeDemographicByChannel = (value: unknown): Record<string, DemographicPoint[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const output: Record<string, DemographicPoint[]> = {}
  Object.entries(value as Record<string, unknown>).forEach(([rawChannelId, rows]) => {
    const channelId = sanitizeTextInput(rawChannelId, { maxLength: 300 })
    if (!channelId || !Array.isArray(rows)) return
    const normalizedRows = rows
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const point = entry as Partial<DemographicPoint>
        const label = sanitizeTextInput(point.label, { maxLength: 140 })
        if (!label) return null
        return {
          label,
          value: toSafeNumber(point.value),
        }
      })
      .filter((entry): entry is DemographicPoint => Boolean(entry))
    if (!normalizedRows.length) return
    output[channelId] = normalizedRows
  })
  return output
}

const normalizeSummary = (payload: unknown): InstagramSummary => {
  if (!payload || typeof payload !== 'object') {
    return {
      firstVideoUploadDate: '',
      channels: [],
      topPosts: [],
      timeSeries: [],
      timeSeriesByChannel: [],
      ageDistribution: [],
      ageDistributionByChannel: {},
      genderDistribution: [],
      genderDistributionByChannel: {},
      topGeos: [],
      topGeosByChannel: {},
    }
  }
  const data = payload as {
    firstVideoUploadDate?: string
    channels?: ChannelSummary[]
    topPosts?: PostSummary[]
    timeSeries?: TimeSeriesPoint[]
    timeSeriesByChannel?: ChannelTimeSeriesPoint[]
    ageDistribution?: DemographicPoint[]
    ageDistributionByChannel?: Record<string, DemographicPoint[]>
    genderDistribution?: DemographicPoint[]
    genderDistributionByChannel?: Record<string, DemographicPoint[]>
    topGeos?: DemographicPoint[]
    topGeosByChannel?: Record<string, DemographicPoint[]>
  }
  return {
    firstVideoUploadDate: sanitizeDateInput(data.firstVideoUploadDate),
    channels: Array.isArray(data.channels) ? data.channels : [],
    topPosts: Array.isArray(data.topPosts) ? data.topPosts : [],
    timeSeries: Array.isArray(data.timeSeries)
      ? data.timeSeries
        .map((point) => normalizeTimeSeriesPoint(point))
        .filter((point): point is TimeSeriesPoint => Boolean(point))
      : [],
    timeSeriesByChannel: Array.isArray(data.timeSeriesByChannel)
      ? data.timeSeriesByChannel
        .map((point) => normalizeChannelTimeSeriesPoint(point))
        .filter((point): point is ChannelTimeSeriesPoint => Boolean(point))
      : [],
    ageDistribution: Array.isArray(data.ageDistribution) ? data.ageDistribution : [],
    ageDistributionByChannel: normalizeDemographicByChannel(data.ageDistributionByChannel),
    genderDistribution: Array.isArray(data.genderDistribution) ? data.genderDistribution : [],
    genderDistributionByChannel: normalizeDemographicByChannel(data.genderDistributionByChannel),
    topGeos: Array.isArray(data.topGeos) ? data.topGeos : [],
    topGeosByChannel: normalizeDemographicByChannel(data.topGeosByChannel),
  }
}

const readSummaryUpdatedAtFromStorage = (): number => {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(INSTAGRAM_SUMMARY_CACHE_UPDATED_AT_KEY)
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  } catch {
    return 0
  }
}

const readSummaryFromStorage = (): InstagramSummary | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(INSTAGRAM_SUMMARY_CACHE_KEY)
    if (!raw) return null
    return normalizeSummary(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeSummaryToStorage = (summary: InstagramSummary) => {
  if (typeof window === 'undefined') return
  const updatedAt = Date.now()
  cachedSummaryUpdatedAt = updatedAt
  try {
    window.localStorage.setItem(INSTAGRAM_SUMMARY_CACHE_KEY, JSON.stringify(summary))
    window.localStorage.setItem(INSTAGRAM_SUMMARY_CACHE_UPDATED_AT_KEY, String(updatedAt))
  } catch {
    // Ignore cache write failures.
  }
}

const clearSummaryFromStorage = () => {
  if (typeof window === 'undefined') return
  cachedSummaryUpdatedAt = 0
  try {
    window.localStorage.removeItem(INSTAGRAM_SUMMARY_CACHE_KEY)
    window.localStorage.removeItem(INSTAGRAM_SUMMARY_CACHE_UPDATED_AT_KEY)
  } catch {
    // Ignore cache clear failures.
  }
}

const isSummaryCacheFresh = () => {
  if (!cachedSummaryUpdatedAt) return false
  return Date.now() - cachedSummaryUpdatedAt <= INSTAGRAM_SUMMARY_CACHE_TTL_MS
}

const hasMeaningfulSummaryMetrics = (summary: InstagramSummary) => {
  const hasChannelViews = summary.channels.some((channel) => Number(channel?.views) > 0)
  const hasSeriesViews = summary.timeSeries.some((point) => Number(point?.views) > 0)
  const hasPostViews = summary.topPosts.some((post) => Number(post?.views) > 0)
  return hasChannelViews || hasSeriesViews || hasPostViews
}

const readInstagramConnections = async (): Promise<InstagramConnectionsResponse> => {
  const response = await fetch(`${apiBaseUrl}/api/instagram/connections`, {
    credentials: 'include',
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('Unable to load Instagram connections.')
  }
  const payload = await response.json().catch(() => null)
  return normalizeConnections(payload)
}

const requestInstagramSummary = async (): Promise<InstagramSummary> => {
  const response = await fetch(`${apiBaseUrl}/api/instagram/summary`, {
    credentials: 'include',
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('Unable to load Instagram summary.')
  }
  const payload = await response.json().catch(() => null)
  return normalizeSummary(payload)
}

export const getCachedInstagramSummary = (): InstagramSummary | null => {
  if (cachedSummary) return cachedSummary
  const stored = readSummaryFromStorage()
  if (stored) {
    cachedSummary = stored
    cachedSummaryUpdatedAt = readSummaryUpdatedAtFromStorage()
  }
  return cachedSummary
}

export const setCachedInstagramSummary = (summary: InstagramSummary) => {
  cachedSummary = summary
  writeSummaryToStorage(summary)
}

export const clearInstagramSummaryCache = () => {
  cachedSummary = null
  inFlightSummaryRequest = null
  clearSummaryFromStorage()
}

export const fetchInstagramSummary = async (): Promise<InstagramSummary> => {
  const nextSummary = await requestInstagramSummary()
  setCachedInstagramSummary(nextSummary)
  return nextSummary
}

export const fetchAndCacheInstagramSummary = async (options?: { force?: boolean }): Promise<InstagramSummary> => {
  const forceRefresh = Boolean(options?.force)
  const existing = getCachedInstagramSummary()
  if (!forceRefresh && existing && isSummaryCacheFresh() && hasMeaningfulSummaryMetrics(existing)) {
    return existing
  }
  if (!forceRefresh && inFlightSummaryRequest) {
    return inFlightSummaryRequest
  }

  const request = requestInstagramSummary()
    .then((summary) => {
      setCachedInstagramSummary(summary)
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

export const fetchInstagramConnections = async (): Promise<InstagramConnectionsResponse> => {
  const resolved = await readInstagramConnections()
  return resolved
}

export const clearInstagramConnectionsCache = () => {}

export const startInstagramRefresh = async (): Promise<InstagramRefreshStartResponse> => {
  const response = await fetch(`${apiBaseUrl}/api/instagram/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new Error('Unable to start Instagram refresh.')
  }
  const data = payload as Partial<InstagramRefreshStartResponse>
  if (!data.jobId || typeof data.jobId !== 'string') {
    throw new Error('Unable to start Instagram refresh.')
  }
  return {
    ok: true,
    jobId: data.jobId,
    status: data.status === 'running' || data.status === 'succeeded' || data.status === 'failed'
      ? data.status
      : 'queued',
  }
}

export const getInstagramRefreshStatus = async (jobId: string): Promise<InstagramRefreshStatusResponse> => {
  const response = await fetch(`${apiBaseUrl}/api/instagram/refresh/${encodeURIComponent(jobId)}`, {
    credentials: 'include',
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new Error('Unable to load Instagram refresh status.')
  }
  const data = payload as Partial<InstagramRefreshStatusResponse>
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

export const waitForInstagramRefresh = async (
  jobId: string,
  options?: {
    timeoutMs?: number
    intervalMs?: number
    onProgress?: (status: InstagramRefreshStatusResponse) => void
  },
): Promise<InstagramRefreshStatusResponse> => {
  const timeoutMs = Number.isFinite(options?.timeoutMs) ? Number(options?.timeoutMs) : 5 * 60 * 1000
  const intervalMs = Number.isFinite(options?.intervalMs) ? Number(options?.intervalMs) : 2_000
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const status = await getInstagramRefreshStatus(jobId)
    if (typeof options?.onProgress === 'function') {
      options.onProgress(status)
    }
    if (status.status === 'succeeded' || status.status === 'failed') {
      return status
    }
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs))
  }
  throw new Error('Timed out waiting for Instagram refresh to complete.')
}
