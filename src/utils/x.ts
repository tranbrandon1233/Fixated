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

export interface XSummary {
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

export interface XRefreshResponse {
  ok: boolean
  partialSuccess: boolean
  refreshedAccounts: number
  postsCollected: number
  failedAccounts: Array<{
    userId: string
    username: string
    error: string
    message?: string
    status?: number
  }>
}

interface XRefreshError extends Error {
  code?: string
  status?: number
}

let cachedSummary: XSummary | null = null
let cachedSummaryUpdatedAt = 0
let inFlightSummaryRequest: Promise<XSummary> | null = null
const X_SUMMARY_CACHE_KEY = 'fixated.x.summary'
const X_SUMMARY_CACHE_UPDATED_AT_KEY = 'fixated.x.summary.updatedAt'
const X_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000

const toSafeNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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

const normalizeSummary = (payload: unknown): XSummary => {
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
    const raw = window.localStorage.getItem(X_SUMMARY_CACHE_UPDATED_AT_KEY)
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  } catch {
    return 0
  }
}

const readSummaryFromStorage = (): XSummary | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(X_SUMMARY_CACHE_KEY)
    if (!raw) return null
    return normalizeSummary(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeSummaryToStorage = (summary: XSummary) => {
  if (typeof window === 'undefined') return
  const updatedAt = Date.now()
  cachedSummaryUpdatedAt = updatedAt
  try {
    window.localStorage.setItem(X_SUMMARY_CACHE_KEY, JSON.stringify(summary))
    window.localStorage.setItem(X_SUMMARY_CACHE_UPDATED_AT_KEY, String(updatedAt))
  } catch {
    // Ignore cache write failures.
  }
}

const clearSummaryFromStorage = () => {
  if (typeof window === 'undefined') return
  cachedSummaryUpdatedAt = 0
  try {
    window.localStorage.removeItem(X_SUMMARY_CACHE_KEY)
    window.localStorage.removeItem(X_SUMMARY_CACHE_UPDATED_AT_KEY)
  } catch {
    // Ignore cache clear failures.
  }
}

const isSummaryCacheFresh = () => {
  if (!cachedSummaryUpdatedAt) return false
  return Date.now() - cachedSummaryUpdatedAt <= X_SUMMARY_CACHE_TTL_MS
}

const hasMeaningfulSummaryMetrics = (summary: XSummary) => {
  const hasChannelViews = summary.channels.some((channel) => Number(channel?.views) > 0)
  const hasSeriesViews = summary.timeSeries.some((point) => Number(point?.views) > 0)
  const hasPostViews = summary.topPosts.some((post) => Number(post?.views) > 0)
  return hasChannelViews || hasSeriesViews || hasPostViews
}

const requestXSummary = async (): Promise<XSummary> => {
  const response = await fetch(`${apiBaseUrl}/api/x/summary`, {
    credentials: 'include',
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('Unable to load X summary.')
  }
  const payload = await response.json().catch(() => null)
  return normalizeSummary(payload)
}

export const getCachedXSummary = (): XSummary | null => {
  if (cachedSummary) return cachedSummary
  const stored = readSummaryFromStorage()
  if (stored) {
    cachedSummary = stored
    cachedSummaryUpdatedAt = readSummaryUpdatedAtFromStorage()
  }
  return cachedSummary
}

export const setCachedXSummary = (summary: XSummary) => {
  cachedSummary = summary
  writeSummaryToStorage(summary)
}

export const clearXSummaryCache = () => {
  cachedSummary = null
  inFlightSummaryRequest = null
  clearSummaryFromStorage()
}

export const fetchXSummary = async (): Promise<XSummary> => {
  const nextSummary = await requestXSummary()
  setCachedXSummary(nextSummary)
  return nextSummary
}

export const fetchAndCacheXSummary = async (options?: { force?: boolean }): Promise<XSummary> => {
  const forceRefresh = Boolean(options?.force)
  const existing = getCachedXSummary()
  if (!forceRefresh && existing && isSummaryCacheFresh() && hasMeaningfulSummaryMetrics(existing)) {
    return existing
  }
  if (!forceRefresh && inFlightSummaryRequest) {
    return inFlightSummaryRequest
  }

  const request = requestXSummary()
    .then((summary) => {
      setCachedXSummary(summary)
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

export const startXRefresh = async (): Promise<XRefreshResponse> => {
  const response = await fetch(`${apiBaseUrl}/api/x/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
  const rawPayload = await response.text().catch(() => '')
  let payload: unknown = null
  if (rawPayload) {
    try {
      payload = JSON.parse(rawPayload)
    } catch {
      payload = null
    }
  }
  const payloadRecord =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : null
  if (!response.ok) {
    const errorCode =
      payloadRecord && typeof payloadRecord.error === 'string'
        ? sanitizeTextInput(payloadRecord.error, { maxLength: 120 })
        : ''
    const payloadMessage =
      payloadRecord && typeof payloadRecord.message === 'string'
        ? sanitizeTextInput(payloadRecord.message, { maxLength: 240 })
        : ''
    const textMessage = payloadMessage
      ? ''
      : sanitizeTextInput(rawPayload.replace(/<[^>]+>/g, ' '), { maxLength: 240 })
    const message = payloadMessage || textMessage || `X refresh request failed (${response.status}).`
    const error = new Error(message) as XRefreshError
    error.code = errorCode || undefined
    error.status = response.status
    throw error
  }
  if (!payloadRecord) {
    const error = new Error('Unable to start X refresh.') as XRefreshError
    error.status = response.status
    throw error
  }
  return {
    ok: Boolean(payloadRecord.ok),
    partialSuccess: Boolean(payloadRecord.partialSuccess),
    refreshedAccounts: Number.isFinite(payloadRecord.refreshedAccounts) ? Number(payloadRecord.refreshedAccounts) : 0,
    postsCollected: Number.isFinite(payloadRecord.postsCollected) ? Number(payloadRecord.postsCollected) : 0,
    failedAccounts: Array.isArray(payloadRecord.failedAccounts)
      ? payloadRecord.failedAccounts.map((entry: unknown) => ({
        userId: sanitizeTextInput((entry as { userId?: unknown }).userId, { maxLength: 40 }),
        username: sanitizeTextInput((entry as { username?: unknown }).username, { maxLength: 64 }),
        error: sanitizeTextInput((entry as { error?: unknown }).error, { maxLength: 120 }),
        message: sanitizeTextInput((entry as { message?: unknown }).message, { maxLength: 240 }) || undefined,
        status: Number.isFinite((entry as { status?: unknown }).status)
          ? Number((entry as { status?: number }).status)
          : undefined,
      }))
      : [],
  }
}
