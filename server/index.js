import 'dotenv/config'
import crypto from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { URLSearchParams } from 'node:url'
import cookieParser from 'cookie-parser'
import express from 'express'

const app = express()

const normalizeEnvValue = (value) => {
  if (value === undefined || value === null) return ''
  const trimmed = String(value).trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

const getEnv = (key, fallback = '') => {
  const normalized = normalizeEnvValue(process.env[key])
  if (normalized) return normalized
  return normalizeEnvValue(fallback)
}

const normalizeBaseUrl = (value) => {
  if (!value) return ''
  return value.endsWith('/') ? value.slice(0, -1) : value
}

const withFallbackUrl = (value, fallback) => {
  const normalizedValue = normalizeBaseUrl(value)
  const normalizedFallback = normalizeBaseUrl(fallback)
  try {
    return new URL(normalizedValue).toString().replace(/\/$/, '')
  } catch {
    return normalizedFallback
  }
}

const defaultBaseUrl = 'https://fixated-dashboard.netlify.app'
const serverBaseUrl = withFallbackUrl(getEnv('SERVER_BASE_URL', defaultBaseUrl), defaultBaseUrl)
const appBaseUrl = withFallbackUrl(getEnv('APP_BASE_URL', defaultBaseUrl), defaultBaseUrl)
const clientId = getEnv('GOOGLE_CLIENT_ID')
const clientSecret = getEnv('GOOGLE_CLIENT_SECRET')
const redirectUri = getEnv('SUPABASE_REDIRECT_URI', `${serverBaseUrl}/oauth/google/callback`)
const scope = getEnv('GOOGLE_SCOPE', 'openid email profile')
const youtubeClientId = getEnv('YOUTUBE_CLIENT_ID', clientId)
const youtubeClientSecret = getEnv('YOUTUBE_CLIENT_SECRET', clientSecret)
const youtubeRedirectUri = getEnv(
  'YOUTUBE_REDIRECT_URI',
  `${serverBaseUrl}/oauth/youtube/callback`,
)
const youtubeScope = getEnv(
  'YOUTUBE_SCOPE',
  'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly',
)
const youtubeReportChannelDaily = getEnv('YOUTUBE_REPORT_CHANNEL_DAILY', 'channel_basic_a2')
const youtubeReportVideoDaily = getEnv('YOUTUBE_REPORT_VIDEO_DAILY', 'video_basic_a2')
const youtubeReportDemographics = getEnv('YOUTUBE_REPORT_DEMOGRAPHICS', 'channel_demographics_a1')
const youtubeReportGeo = getEnv('YOUTUBE_REPORT_GEO', 'channel_geography_a1')
const supabaseUrl = withFallbackUrl(getEnv('SUPABASE_URL'), '')
const supabasePublishableKey = getEnv('SUPABASE_PUBLISHABLE_KEY', getEnv('SUPABASE_ANON_KEY'))
const supabaseSecretKey = getEnv('SUPABASE_SECRET_KEY', getEnv('SUPABASE_SERVICE_ROLE_KEY'))
const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey && supabaseSecretKey)

const parsedServerUrl = new URL(serverBaseUrl)
const port = Number(getEnv('PORT', parsedServerUrl.port || '5000'))
const isProd = getEnv('NODE_ENV') === 'production'
const allowCrossSiteCookies = isProd
const cookieSameSite = allowCrossSiteCookies ? 'none' : 'lax'
const cookieSecure = allowCrossSiteCookies || isProd
const YOUTUBE_CONNECTIONS_COOKIE = 'youtube_connections'
const YOUTUBE_SESSION_COOKIE = 'youtube_session_id'
const APP_REDIRECT_COOKIE = 'app_redirect_origin'
const SUPABASE_ACCESS_TOKEN_COOKIE = 'sb_access_token'
const SUPABASE_REFRESH_TOKEN_COOKIE = 'sb_refresh_token'
const YOUTUBE_AUTO_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
const YOUTUBE_AUTO_REFRESH_RETRY_COOLDOWN_MS = 10 * 60 * 1000

const buildAppRedirect = ({
  status,
  message,
  provider = 'google',
  path = '/login',
  extraParams = {},
  baseUrl = appBaseUrl,
}) => {
  const params = new URLSearchParams({ status, provider })
  if (message) params.set('message', message)
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(key, String(value))
  })
  return `${baseUrl}${path}?${params.toString()}`
}

const normalizeChannelName = (value) => String(value ?? '').trim().toLowerCase()

const resolveOriginBase = (value) => {
  if (!value || typeof value !== 'string') return ''
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    const port = parsed.port ? `:${parsed.port}` : ''
    return `${parsed.protocol}//${parsed.hostname}${port}`
  } catch {
    return ''
  }
}

const resolveAppRedirectBase = (req) => {
  const fromCookie = resolveOriginBase(req.cookies?.[APP_REDIRECT_COOKIE])
  if (fromCookie) return fromCookie
  return appBaseUrl
}

const reportingStorePath = new URL('./reporting-store.json', import.meta.url)
let reportingStore = null

const buildEmptyReportingStore = () => ({
  reportTypesCache: null,
  sessions: {},
})

const loadReportingStore = async () => {
  if (reportingStore) return reportingStore
  try {
    const raw = await readFile(reportingStorePath, 'utf8')
    const parsed = JSON.parse(raw)
    reportingStore = parsed && typeof parsed === 'object' ? parsed : buildEmptyReportingStore()
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      reportingStore = buildEmptyReportingStore()
    } else {
      reportingStore = buildEmptyReportingStore()
    }
    await writeFile(reportingStorePath, JSON.stringify(reportingStore, null, 2))
  }
  return reportingStore
}

const persistReportingStore = async () => {
  if (!reportingStore) return
  await writeFile(reportingStorePath, JSON.stringify(reportingStore, null, 2))
}

const buildEmptySession = () => ({
  connections: [],
  reporting: {
    jobs: {},
    reports: {},
  },
})

const getSessionId = (req) => {
  const existing = req.cookies?.[YOUTUBE_SESSION_COOKIE]
  return typeof existing === 'string' ? existing : ''
}

const loadSession = async (sessionId) => {
  const store = await loadReportingStore()
  const session = store.sessions?.[sessionId]
  if (session && typeof session === 'object') return session
  return buildEmptySession()
}

const saveSession = async (sessionId, session) => {
  const store = await loadReportingStore()
  store.sessions[sessionId] = session
  await persistReportingStore()
}

const upsertSessionConnection = async (sessionId, nextConnection) => {
  const session = await loadSession(sessionId)
  const filtered = session.connections.filter((connection) => connection.channelId !== nextConnection.channelId)
  session.connections = [...filtered, nextConnection]
  await saveSession(sessionId, session)
  return session
}

const refreshYouTubeAccessToken = async (refreshToken) => {
  if (!refreshToken) return null
  try {
    const tokenParams = new URLSearchParams({
      client_id: youtubeClientId,
      client_secret: youtubeClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload?.access_token) return null
    const expiresIn = toNumber(payload?.expires_in)
    const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : 0
    return { accessToken: payload.access_token, expiresAt }
  } catch (_err) {
    return null
  }
}

const ensureValidAccessToken = async (sessionId, connection, options = {}) => {
  if (!connection) return { accessToken: '', connection }
  const persistConnection =
    typeof options.persistConnection === 'function'
      ? options.persistConnection
      : async (updatedConnection) => {
          if (!sessionId) return
          await upsertSessionConnection(sessionId, updatedConnection)
        }
  const expiresAt = toNumber(connection.expiresAt)
  const shouldRefresh = !connection.accessToken || (expiresAt && Date.now() >= expiresAt - 60_000)
  if (!shouldRefresh) return { accessToken: connection.accessToken, connection }

  const refreshed = await refreshYouTubeAccessToken(connection.refreshToken)
  if (!refreshed?.accessToken) return { accessToken: connection.accessToken || '', connection }

  const updatedConnection = {
    ...connection,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  }
  await persistConnection(updatedConnection)
  return { accessToken: refreshed.accessToken, connection: updatedConnection }
}


const buildSupabaseTableUrl = (tableName, query = '') => {
  const suffix = query ? `?${query}` : ''
  return `${supabaseUrl}/rest/v1/${tableName}${suffix}`
}

const requestSupabaseTable = async (tableName, { method = 'GET', query = '', body, prefer = '' } = {}) => {
  if (!isSupabaseConfigured) {
    return { ok: false, status: 500, payload: null }
  }
  const url = buildSupabaseTableUrl(tableName, query)
  const headers = {
    apikey: supabaseSecretKey,
    Authorization: `Bearer ${supabaseSecretKey}`,
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (prefer) {
    headers.Prefer = prefer
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const payload = await response.json().catch(() => null)
    return { ok: response.ok, status: response.status, payload }
  } catch (_err) {
    return { ok: false, status: 500, payload: null }
  }
}

const mapYouTubeConnectionRow = (row) => ({
  channelId: typeof row?.channel_id === 'string' ? row.channel_id : '',
  channelName: typeof row?.channel_name === 'string' ? row.channel_name : 'YouTube Channel',
  accessToken: typeof row?.access_token === 'string' ? row.access_token : '',
  refreshToken: typeof row?.refresh_token === 'string' ? row.refresh_token : '',
  expiresAt: row?.token_expires_at ? Date.parse(row.token_expires_at) : 0,
  connectedAt: typeof row?.connected_at === 'string' ? row.connected_at : '',
})

const listYouTubeConnectionRowsByUserId = async (userId) => {
  const selectFields = encodeURIComponent(
    'id,user_id,channel_id,channel_name,access_token,refresh_token,token_expires_at,connected_at,updated_at',
  )
  const userFilter = encodeURIComponent(userId)
  const query = `select=${selectFields}&user_id=eq.${userFilter}&order=connected_at.asc`
  const result = await requestSupabaseTable('youtube_connections', { query })
  return {
    ...result,
    rows: Array.isArray(result.payload) ? result.payload : [],
  }
}

const upsertYouTubeConnectionRow = async (row) => {
  const result = await requestSupabaseTable('youtube_connections', {
    method: 'POST',
    query: 'on_conflict=user_id,channel_id',
    body: [row],
    prefer: 'resolution=merge-duplicates,return=representation',
  })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const updateYouTubeConnectionTokenRow = async (userId, channelId, payload) => {
  const userFilter = encodeURIComponent(userId)
  const channelFilter = encodeURIComponent(channelId)
  const query = `user_id=eq.${userFilter}&channel_id=eq.${channelFilter}`
  const result = await requestSupabaseTable('youtube_connections', {
    method: 'PATCH',
    query,
    body: payload,
    prefer: 'return=representation',
  })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const deleteYouTubeConnectionsByUserId = async (userId) => {
  const userFilter = encodeURIComponent(userId)
  const query = `user_id=eq.${userFilter}`
  return requestSupabaseTable('youtube_connections', { method: 'DELETE', query })
}

const deleteYouTubeConnectionsByIds = async (userId, channelIds) => {
  if (!channelIds.length) return { ok: true, status: 200, payload: null }
  const userFilter = encodeURIComponent(userId)
  const idsFilter = encodeURIComponent(`in.(${channelIds.map((value) => value.replace(/,/g, '')).join(',')})`)
  const query = `user_id=eq.${userFilter}&channel_id=${idsFilter}`
  return requestSupabaseTable('youtube_connections', { method: 'DELETE', query })
}

const loadSupabaseYouTubeConnections = async (userId) => {
  const result = await listYouTubeConnectionRowsByUserId(userId)
  if (!result.ok) return { ok: false, status: result.status, error: 'youtube_connections_read_failed' }
  return {
    ok: true,
    connections: result.rows.map(mapYouTubeConnectionRow).filter((row) => row.channelId),
  }
}

const ensureValidAccessTokenForUser = async (userId, connection) =>
  ensureValidAccessToken('', connection, {
    persistConnection: async (updatedConnection) => {
      if (!userId || !updatedConnection?.channelId) return
      const tokenExpiresAtIso = updatedConnection.expiresAt
        ? new Date(updatedConnection.expiresAt).toISOString()
        : null
      await updateYouTubeConnectionTokenRow(userId, updatedConnection.channelId, {
        access_token: updatedConnection.accessToken || '',
        refresh_token: updatedConnection.refreshToken || null,
        token_expires_at: tokenExpiresAtIso,
        updated_at: new Date().toISOString(),
      })
    },
  })

const insertYouTubeRefreshJob = async (job) => {
  const result = await requestSupabaseTable('youtube_refresh_jobs', {
    method: 'POST',
    body: [job],
    prefer: 'return=representation',
  })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const updateYouTubeRefreshJob = async (userId, jobId, payload) => {
  const userFilter = encodeURIComponent(userId)
  const jobFilter = encodeURIComponent(jobId)
  const query = `user_id=eq.${userFilter}&id=eq.${jobFilter}`
  const result = await requestSupabaseTable('youtube_refresh_jobs', {
    method: 'PATCH',
    query,
    body: payload,
    prefer: 'return=representation',
  })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const getYouTubeRefreshJob = async (userId, jobId) => {
  const userFilter = encodeURIComponent(userId)
  const jobFilter = encodeURIComponent(jobId)
  const selectFields = encodeURIComponent(
    'id,user_id,status,requested_at,started_at,finished_at,error_message,channels_total,channels_processed,meta',
  )
  const query = `select=${selectFields}&user_id=eq.${userFilter}&id=eq.${jobFilter}&limit=1`
  const result = await requestSupabaseTable('youtube_refresh_jobs', { query })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const getLatestYouTubeRefreshJobByUserId = async (userId) => {
  const userFilter = encodeURIComponent(userId)
  const selectFields = encodeURIComponent(
    'id,user_id,status,requested_at,started_at,finished_at,error_message,channels_total,channels_processed,meta',
  )
  const query = `select=${selectFields}&user_id=eq.${userFilter}&order=requested_at.desc&limit=1`
  const result = await requestSupabaseTable('youtube_refresh_jobs', { query })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const upsertCachedYouTubeSummary = async ({ userId, summary, generatedAt, refreshJobId }) => {
  const result = await requestSupabaseTable('youtube_cached_summaries', {
    method: 'POST',
    query: 'on_conflict=user_id',
    body: [
      {
        user_id: userId,
        summary_json: summary,
        generated_at: generatedAt || new Date().toISOString(),
        refresh_job_id: refreshJobId || null,
      },
    ],
    prefer: 'resolution=merge-duplicates,return=representation',
  })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const getCachedYouTubeSummaryByUserId = async (userId) => {
  const userFilter = encodeURIComponent(userId)
  const selectFields = encodeURIComponent('id,user_id,summary_json,generated_at,refresh_job_id')
  const query = `select=${selectFields}&user_id=eq.${userFilter}&limit=1`
  const result = await requestSupabaseTable('youtube_cached_summaries', { query })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const deleteCachedYouTubeSummaryByUserId = async (userId) => {
  const userFilter = encodeURIComponent(userId)
  const query = `user_id=eq.${userFilter}`
  return requestSupabaseTable('youtube_cached_summaries', { method: 'DELETE', query })
}

const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const readBearerToken = (req) => {
  const authorization = typeof req.headers?.authorization === 'string'
    ? req.headers.authorization.trim()
    : ''
  if (!authorization.toLowerCase().startsWith('bearer ')) return ''
  return authorization.slice(7).trim()
}

const clearSupabaseSessionCookies = (res) => {
  const options = {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSecure,
  }
  res.clearCookie(SUPABASE_ACCESS_TOKEN_COOKIE, options)
  res.clearCookie(SUPABASE_REFRESH_TOKEN_COOKIE, options)
}

const setSupabaseSessionCookies = (res, payload) => {
  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : ''
  const refreshToken = typeof payload?.refresh_token === 'string' ? payload.refresh_token : ''
  if (!accessToken) return false

  const expiresIn = toNumber(payload?.expires_in)
  const accessTokenMaxAge = expiresIn > 0 ? expiresIn * 1000 : 60 * 60 * 1000
  res.cookie(SUPABASE_ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSecure,
    maxAge: accessTokenMaxAge,
  })

  if (refreshToken) {
    res.cookie(SUPABASE_REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: cookieSecure,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    })
  }

  return true
}

const exchangeGoogleIdTokenForSupabaseSession = async (idToken) => {
  if (!isSupabaseConfigured || !idToken) return null
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=id_token`, {
      method: 'POST',
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'google',
        id_token: idToken,
      }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.access_token) {
      console.error('Supabase id_token exchange failed:', {
        status: response.status,
        code: payload?.code,
        message: payload?.message || payload?.msg || payload?.error_description || payload?.error,
      })
      return null
    }
    return payload
  } catch (err) {
    console.error('Supabase id_token exchange failed:', err)
    return null
  }
}

const refreshSupabaseSession = async (refreshToken) => {
  if (!isSupabaseConfigured || !refreshToken) return null
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: supabasePublishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.access_token) return null
    return payload
  } catch (_err) {
    return null
  }
}

const decodeJwtPayload = (token) => {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const decoded = Buffer.from(padded, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (_err) {
    return null
  }
}

const resolveSupabaseUserId = (sessionPayload) => {
  const fromUser = sessionPayload?.user?.id
  if (typeof fromUser === 'string' && fromUser.trim()) return fromUser.trim()
  const fromUserId = sessionPayload?.user_id
  if (typeof fromUserId === 'string' && fromUserId.trim()) return fromUserId.trim()
  const fromSub = decodeJwtPayload(sessionPayload?.access_token)?.sub
  if (typeof fromSub === 'string' && fromSub.trim()) return fromSub.trim()
  return ''
}

const resolveSupabaseUserEmail = (sessionPayload) => {
  const fromUser = sessionPayload?.user?.email
  if (typeof fromUser === 'string' && fromUser.trim()) return fromUser.trim()
  const fromEmail = sessionPayload?.email
  if (typeof fromEmail === 'string' && fromEmail.trim()) return fromEmail.trim()
  const fromJwtEmail = decodeJwtPayload(sessionPayload?.access_token)?.email
  if (typeof fromJwtEmail === 'string' && fromJwtEmail.trim()) return fromJwtEmail.trim()
  return ''
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const tryInsertUsersRow = async (userId, email) => {
  const candidates = [
    `${supabaseUrl}/rest/v1/%22Users%22?on_conflict=id`,
    `${supabaseUrl}/rest/v1/Users?on_conflict=id`,
  ]
  let lastResult = {
    ok: false,
    status: 500,
    payload: null,
  }

  for (const endpoint of candidates) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([
        {
          id: userId,
          ...(email ? { email } : {}),
        },
      ]),
    })
    const payload = await response.json().catch(() => null)
    const result = {
      ok: response.ok,
      status: response.status,
      payload,
    }
    if (result.ok) return result
    lastResult = result
    if (response.status !== 404) break
  }

  return lastResult
}

const ensureSupabaseUserRow = async (sessionPayload) => {
  if (!isSupabaseConfigured) return { ok: false, reason: 'supabase_not_configured' }
  const userId = resolveSupabaseUserId(sessionPayload)
  if (!userId) return { ok: false, reason: 'missing_user_id' }
  const email = resolveSupabaseUserEmail(sessionPayload)
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await tryInsertUsersRow(userId, email)
      if (result.ok) return { ok: true, userId }

      // In rare cases auth.users replication can lag briefly after signup.
      if (result.payload?.code === '23503' && attempt < 5) {
        await wait(250 * (attempt + 1))
        continue
      }

      console.error('Failed to upsert Users row:', {
        status: result.status,
        code: result.payload?.code,
        message: result.payload?.message,
      })
      return { ok: false, reason: 'insert_failed', details: result.payload, userId }
    }
    return { ok: false, reason: 'insert_failed', userId }
  } catch (err) {
    console.error('Failed to upsert Users row:', err)
    return { ok: false, reason: 'insert_failed_exception', userId }
  }
}

const bumpRefreshCounter24h = async (accessToken) => {
  if (!isSupabaseConfigured || !accessToken) {
    return {
      ok: false,
      status: 401,
      payload: null,
    }
  }
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/bump_refresh_count_24h`, {
      method: 'POST',
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    const payload = await response.json().catch(() => null)
    return {
      ok: response.ok,
      status: response.status,
      payload,
    }
  } catch (_err) {
    return {
      ok: false,
      status: 500,
      payload: null,
    }
  }
}

const formatDateLabel = (isoDate) => {
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) return isoDate
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed)
}

const extractGoogleApiErrorMessage = (payload, status) => {
  const topLevelMessage = typeof payload?.error?.message === 'string' ? payload.error.message.trim() : ''
  const reason = typeof payload?.error?.errors?.[0]?.reason === 'string'
    ? payload.error.errors[0].reason.trim()
    : ''
  if (topLevelMessage && reason) return `${topLevelMessage} (${reason})`
  if (topLevelMessage) return topLevelMessage
  if (reason) return reason
  return `YouTube API request failed with status ${status}.`
}

const fetchYouTubeChannelInfo = async (accessToken, channelId) => {
  try {
    const params = new URLSearchParams({
      part: 'snippet,statistics',
      maxResults: '1',
    })
    if (channelId) {
      params.set('id', channelId)
    } else {
      params.set('mine', 'true')
    }
    const response = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      return {
        id: '',
        title: '',
        statistics: {},
        errorMessage: extractGoogleApiErrorMessage(payload, response.status),
      }
    }
    const channel = payload?.items?.[0]
    if (!channel) {
      return {
        id: '',
        title: '',
        statistics: {},
        errorMessage: 'No YouTube channel was found for this Google account.',
      }
    }
    return {
      id: typeof channel.id === 'string' ? channel.id : '',
      title: typeof channel?.snippet?.title === 'string' ? channel.snippet.title.trim() : '',
      statistics: channel.statistics ?? {},
      errorMessage: '',
    }
  } catch (_err) {
    return {
      id: '',
      title: '',
      statistics: {},
      errorMessage: 'Unable to reach YouTube API. Please try again.',
    }
  }
}

const fetchGoogleProfileName = async (accessToken) => {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return ''
    const payload = await response.json().catch(() => ({}))
    const profileName = payload?.name
    if (typeof profileName !== 'string') return ''
    return profileName.trim()
  } catch (_err) {
    return ''
  }
}

app.use(cookieParser())
app.use(express.json())
app.use((req, res, next) => {
  const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  const allowOrigin = !isProd && requestOrigin ? requestOrigin : appBaseUrl
  res.setHeader('Access-Control-Allow-Origin', allowOrigin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/auth/session', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    const unauthenticatedErrors = new Set(['not_authenticated', 'missing_user_id'])
    if (viewer.status === 401 || unauthenticatedErrors.has(viewer.error)) {
      res.status(401).json({ authenticated: false })
      return
    }
    res.status(viewer.status || 500).json({
      authenticated: false,
      error: viewer.error || 'session_check_failed',
      message: viewer.message || 'Unable to verify session.',
      details: viewer.details ?? null,
    })
    return
  }

  res.json({
    authenticated: true,
    userId: viewer.userId,
    email: viewer.email || '',
  })
})

app.post('/api/refresh-counter/bump', async (req, res) => {
  if (!isSupabaseConfigured) {
    res.status(500).json({
      error: 'supabase_not_configured',
      message: 'Supabase config is missing. Set SUPABASE_URL and API keys.',
    })
    return
  }

  const { accessToken, refreshToken } = readSupabaseSessionTokens(req)

  if (!accessToken) {
    res.status(401).json({
      error: 'not_authenticated',
      message: 'Missing Supabase session token.',
    })
    return
  }

  let rpcResult = await bumpRefreshCounter24h(accessToken)
  if (!rpcResult.ok && rpcResult.status === 401 && refreshToken) {
    const refreshedSession = await refreshSupabaseSession(refreshToken)
    if (refreshedSession?.access_token) {
      setSupabaseSessionCookies(res, refreshedSession)
      rpcResult = await bumpRefreshCounter24h(refreshedSession.access_token)
    }
  }

  if (!rpcResult.ok) {
    if (rpcResult.status === 401) clearSupabaseSessionCookies(res)
    res.status(rpcResult.status || 500).json({
      error: 'refresh_count_update_failed',
      details: rpcResult.payload,
    })
    return
  }

  const row = Array.isArray(rpcResult.payload) ? rpcResult.payload[0] : rpcResult.payload
  const refreshCount = toNumber(row?.refresh_count)
  const refreshWindowStartedAt =
    typeof row?.refresh_window_started_at === 'string' ? row.refresh_window_started_at : null

  res.json({
    refreshCount,
    refreshWindowStartedAt,
  })
})

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const isUuid = (value) => typeof value === 'string' && uuidRegex.test(value.trim())

const uniqueValues = (values) => [...new Set(values)]

const normalizeUuidArray = (value) => {
  if (Array.isArray(value)) {
    return uniqueValues(
      value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => isUuid(entry)),
    )
  }

  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  if (isUuid(trimmed)) return [trimmed]

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed)
      return normalizeUuidArray(parsed)
    } catch {
      return []
    }
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return uniqueValues(
      trimmed
        .slice(1, -1)
        .split(',')
        .map((entry) => entry.replace(/^"+|"+$/g, '').trim())
        .filter((entry) => isUuid(entry)),
    )
  }

  return []
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normalizeEmail = (value) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || !emailRegex.test(trimmed)) return ''
  return trimmed
}

const normalizeEmailInputArray = (value) => {
  if (!Array.isArray(value)) return { validEmails: [], invalidEmails: [] }
  const validEmails = []
  const invalidEmails = []
  const seenValid = new Set()
  const seenInvalid = new Set()

  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim().toLowerCase()
    if (!trimmed) continue
    if (emailRegex.test(trimmed)) {
      if (!seenValid.has(trimmed)) {
        seenValid.add(trimmed)
        validEmails.push(trimmed)
      }
      continue
    }
    if (!seenInvalid.has(trimmed)) {
      seenInvalid.add(trimmed)
      invalidEmails.push(trimmed)
    }
  }

  return { validEmails, invalidEmails }
}

const hasIntersection = (left, right) => {
  if (!left.length || !right.length) return false
  const rightSet = new Set(right)
  return left.some((value) => rightSet.has(value))
}

const normalizeDateOnly = (value) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return ''
  const parsed = Date.parse(`${trimmed}T00:00:00Z`)
  if (Number.isNaN(parsed)) return ''
  return trimmed
}

const normalizeJsonValue = (value) => {
  if (value === undefined || value === null) return null
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    Array.isArray(value)
  ) {
    return value
  }
  if (typeof value === 'object') return value
  return null
}

const sanitizeDistributionSources = (value) => {
  const normalizedValue = normalizeJsonValue(value)
  if (
    !normalizedValue ||
    typeof normalizedValue !== 'object' ||
    Array.isArray(normalizedValue)
  ) {
    return normalizedValue
  }

  const { brand: _ignoredBrand, ...sanitizedValue } = normalizedValue
  return sanitizedValue
}

const readSupabaseSessionTokens = (req) => {
  const accessTokenFromCookie = typeof req.cookies?.[SUPABASE_ACCESS_TOKEN_COOKIE] === 'string'
    ? req.cookies[SUPABASE_ACCESS_TOKEN_COOKIE]
    : ''
  const accessToken = accessTokenFromCookie || readBearerToken(req)
  const refreshToken = typeof req.cookies?.[SUPABASE_REFRESH_TOKEN_COOKIE] === 'string'
    ? req.cookies[SUPABASE_REFRESH_TOKEN_COOKIE]
    : ''
  return { accessToken, refreshToken }
}

const fetchSupabaseAuthUser = async (accessToken) => {
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${accessToken}`,
      },
    })
    const payload = await response.json().catch(() => null)
    return {
      ok: response.ok,
      status: response.status,
      payload,
    }
  } catch (_err) {
    return {
      ok: false,
      status: 500,
      payload: null,
    }
  }
}

const fetchUsersRowById = async (userId) => {
  const selectFields = encodeURIComponent('id,organization_ids,email')
  const userFilter = encodeURIComponent(userId)
  const endpoints = [
    `${supabaseUrl}/rest/v1/%22Users%22?select=${selectFields}&id=eq.${userFilter}&limit=1`,
    `${supabaseUrl}/rest/v1/Users?select=${selectFields}&id=eq.${userFilter}&limit=1`,
  ]

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
      },
    })
    const payload = await response.json().catch(() => null)
    const row = Array.isArray(payload) ? payload[0] ?? null : null
    const result = {
      ok: response.ok,
      status: response.status,
      payload,
      row,
    }
    if (result.ok) return result
    lastResult = result
    if (response.status !== 404) break
  }

  return lastResult
}

const fetchUsersRowByEmail = async (email) => {
  const selectFields = encodeURIComponent('id,email')
  const emailFilter = encodeURIComponent(email)
  const endpoints = [
    `${supabaseUrl}/rest/v1/%22Users%22?select=${selectFields}&email=ilike.${emailFilter}&limit=1`,
    `${supabaseUrl}/rest/v1/Users?select=${selectFields}&email=ilike.${emailFilter}&limit=1`,
  ]

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
      },
    })
    const payload = await response.json().catch(() => null)
    const row = Array.isArray(payload) ? payload[0] ?? null : null
    const result = {
      ok: response.ok,
      status: response.status,
      payload,
      row,
    }
    if (result.ok) return result
    lastResult = result
    if (response.status !== 404) break
  }

  return lastResult
}

const fetchUsersRowsByIds = async (userIds) => {
  const normalizedIds = normalizeUuidArray(userIds)
  if (!normalizedIds.length) {
    return {
      ok: true,
      status: 200,
      payload: [],
      rows: [],
    }
  }

  const selectFields = encodeURIComponent('id,email')
  const idFilter = encodeURIComponent(`in.(${normalizedIds.join(',')})`)
  const endpoints = [
    `${supabaseUrl}/rest/v1/%22Users%22?select=${selectFields}&id=${idFilter}`,
    `${supabaseUrl}/rest/v1/Users?select=${selectFields}&id=${idFilter}`,
  ]

  let lastResult = { ok: false, status: 500, payload: null, rows: [] }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
      },
    })
    const payload = await response.json().catch(() => null)
    const rows = Array.isArray(payload) ? payload : []
    const result = {
      ok: response.ok,
      status: response.status,
      payload,
      rows,
    }
    if (result.ok) return result
    lastResult = result
    if (response.status !== 404) break
  }

  return lastResult
}

const buildEmptyMemberResolution = () => ({
  added: [],
  removed: [],
  failed: [],
})

const resolveMemberIdsFromEmails = async (emails) => {
  const resolution = buildEmptyMemberResolution()
  const resolvedUserIds = []
  const seenUserIds = new Set()

  for (const email of emails) {
    const lookupResult = await fetchUsersRowByEmail(email)
    if (!lookupResult.ok) {
      resolution.failed.push({
        action: 'add',
        email,
        error: 'lookup_failed',
        message: 'Unable to verify this email right now.',
      })
      continue
    }

    const userId = typeof lookupResult.row?.id === 'string' ? lookupResult.row.id.trim() : ''
    if (!isUuid(userId)) {
      resolution.failed.push({
        action: 'add',
        email,
        error: 'user_not_found',
        message: 'No matching user was found for this email.',
      })
      continue
    }

    if (!seenUserIds.has(userId)) {
      seenUserIds.add(userId)
      resolvedUserIds.push(userId)
    }

    resolution.added.push({
      action: 'add',
      email,
      userId,
      message: 'User added to campaign members.',
    })
  }

  return { resolvedUserIds, resolution }
}

const resolveAuthedUserContext = async (req, res) => {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      status: 500,
      error: 'supabase_not_configured',
      message: 'Supabase config is missing. Set SUPABASE_URL and API keys.',
    }
  }

  const { accessToken, refreshToken } = readSupabaseSessionTokens(req)
  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      error: 'not_authenticated',
      message: 'Missing Supabase session token.',
    }
  }

  let resolvedAccessToken = accessToken
  let authUserResult = await fetchSupabaseAuthUser(resolvedAccessToken)
  if (!authUserResult.ok && authUserResult.status === 401 && refreshToken) {
    const refreshedSession = await refreshSupabaseSession(refreshToken)
    if (refreshedSession?.access_token) {
      setSupabaseSessionCookies(res, refreshedSession)
      resolvedAccessToken = refreshedSession.access_token
      authUserResult = await fetchSupabaseAuthUser(resolvedAccessToken)
    }
  }

  if (!authUserResult.ok) {
    if (authUserResult.status === 401) clearSupabaseSessionCookies(res)
    return {
      ok: false,
      status: authUserResult.status || 401,
      error: 'not_authenticated',
      message: 'Unable to load authenticated Supabase user.',
      details: authUserResult.payload,
    }
  }

  const userId = resolveSupabaseUserId({
    user: authUserResult.payload,
    access_token: resolvedAccessToken,
  })
  const email = resolveSupabaseUserEmail({
    user: authUserResult.payload,
    access_token: resolvedAccessToken,
  })
  if (!userId) {
    return {
      ok: false,
      status: 401,
      error: 'missing_user_id',
      message: 'Supabase user id is missing from session.',
    }
  }

  const ensuredRow = await ensureSupabaseUserRow({
    user: { id: userId, email },
    access_token: resolvedAccessToken,
  })
  if (!ensuredRow.ok) {
    return {
      ok: false,
      status: 500,
      error: 'user_row_init_failed',
      message: `Unable to initialize user row (${ensuredRow.reason}).`,
      details: ensuredRow.details ?? null,
    }
  }

  const appUserResult = await fetchUsersRowById(userId)
  if (!appUserResult.ok) {
    return {
      ok: false,
      status: 500,
      error: 'user_row_lookup_failed',
      message: 'Unable to read user access scope from Users table.',
      details: appUserResult.payload,
    }
  }

  const organizationIds = normalizeUuidArray(appUserResult.row?.organization_ids)
  return {
    ok: true,
    userId,
    email,
    accessToken: resolvedAccessToken,
    organizationIds,
  }
}

const listCampaignRows = async () => {
  const selectFields = encodeURIComponent(
    'id,created_at,campaign_name,brand,start_date,end_date,views_delivered,guaranteed,engagement_rate,allowed_orgs,distribution_sources,allowed_members,creator',
  )
  const endpoints = [
    `${supabaseUrl}/rest/v1/%22Campaigns%22?select=${selectFields}&order=created_at.desc`,
    `${supabaseUrl}/rest/v1/Campaigns?select=${selectFields}&order=created_at.desc`,
  ]

  let lastResult = { ok: false, status: 500, payload: null, rows: [] }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
      },
    })
    const payload = await response.json().catch(() => null)
    const rows = Array.isArray(payload) ? payload : []
    const result = {
      ok: response.ok,
      status: response.status,
      payload,
      rows,
    }
    if (result.ok) return result
    lastResult = result
    if (response.status !== 404) break
  }

  return lastResult
}

const insertCampaignRow = async (row) => {
  const endpoints = [
    `${supabaseUrl}/rest/v1/%22Campaigns%22`,
    `${supabaseUrl}/rest/v1/Campaigns`,
  ]

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify([row]),
    })
    const payload = await response.json().catch(() => null)
    const returnedRow = Array.isArray(payload) ? payload[0] ?? null : null
    const result = {
      ok: response.ok,
      status: response.status,
      payload,
      row: returnedRow,
    }
    if (result.ok) return result
    lastResult = result
    if (response.status !== 404) break
  }

  return lastResult
}

const fetchCampaignRowById = async (campaignId) => {
  const selectFields = encodeURIComponent(
    'id,campaign_name,allowed_members,allowed_orgs,creator',
  )
  const campaignFilter = encodeURIComponent(campaignId)
  const endpoints = [
    `${supabaseUrl}/rest/v1/%22Campaigns%22?select=${selectFields}&id=eq.${campaignFilter}&limit=1`,
    `${supabaseUrl}/rest/v1/Campaigns?select=${selectFields}&id=eq.${campaignFilter}&limit=1`,
  ]

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
      },
    })
    const payload = await response.json().catch(() => null)
    const row = Array.isArray(payload) ? payload[0] ?? null : null
    const result = {
      ok: response.ok,
      status: response.status,
      payload,
      row,
    }
    if (result.ok) return result
    lastResult = result
    if (response.status !== 404) break
  }

  return lastResult
}

const updateCampaignAllowedMembers = async (campaignId, allowedMembers) => {
  const campaignFilter = encodeURIComponent(campaignId)
  const endpoints = [
    `${supabaseUrl}/rest/v1/%22Campaigns%22?id=eq.${campaignFilter}`,
    `${supabaseUrl}/rest/v1/Campaigns?id=eq.${campaignFilter}`,
  ]

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        allowed_members: normalizeUuidArray(allowedMembers),
      }),
    })
    const payload = await response.json().catch(() => null)
    const row = Array.isArray(payload) ? payload[0] ?? null : null
    const result = {
      ok: response.ok,
      status: response.status,
      payload,
      row,
    }
    if (result.ok) return result
    lastResult = result
    if (response.status !== 404) break
  }

  return lastResult
}

const deleteCampaignRowById = async (campaignId) => {
  const campaignFilter = encodeURIComponent(campaignId)
  const endpoints = [
    `${supabaseUrl}/rest/v1/%22Campaigns%22?id=eq.${campaignFilter}`,
    `${supabaseUrl}/rest/v1/Campaigns?id=eq.${campaignFilter}`,
  ]

  let lastResult = { ok: false, status: 500, payload: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
      },
    })
    const payload = await response.json().catch(() => null)
    const result = {
      ok: response.ok,
      status: response.status,
      payload,
    }
    if (result.ok) return result
    lastResult = result
    if (response.status !== 404) break
  }

  return lastResult
}

const canUserSeeCampaign = (row, userId, organizationIds) => {
  const creator = typeof row?.creator === 'string' ? row.creator.trim() : ''
  if (creator && creator === userId) return true
  const allowedMembers = normalizeUuidArray(row?.allowed_members)
  if (allowedMembers.includes(userId)) return true
  const allowedOrgs = normalizeUuidArray(row?.allowed_orgs)
  return hasIntersection(allowedOrgs, organizationIds)
}

const buildCampaignMemberIds = (row) => {
  const creatorId = typeof row?.creator === 'string' ? row.creator.trim() : ''
  const creatorIds = isUuid(creatorId) ? [creatorId] : []
  return uniqueValues([...normalizeUuidArray(row?.allowed_members), ...creatorIds])
}

const mapCampaignMembersForClient = (memberIds, userRows) => {
  const userEmailById = new Map(
    (Array.isArray(userRows) ? userRows : [])
      .filter((row) => row && typeof row === 'object')
      .map((row) => {
        const id = typeof row.id === 'string' ? row.id.trim() : ''
        const email = typeof row.email === 'string' ? row.email.trim() : ''
        return [id, email]
      }),
  )

  return memberIds.map((id) => ({
    id,
    email: userEmailById.get(id) || '',
  }))
}

const mapCampaignForClient = (row) => {
  const creator = typeof row?.creator === 'string' ? row.creator : ''
  const id = typeof row?.id === 'string' ? row.id : ''
  const createdAt = typeof row?.created_at === 'string' ? row.created_at : ''
  const campaignName = typeof row?.campaign_name === 'string' ? row.campaign_name.trim() : ''
  const brand = typeof row?.brand === 'string' ? row.brand.trim() : ''
  const startDate = typeof row?.start_date === 'string' ? row.start_date : ''
  const endDate = typeof row?.end_date === 'string' ? row.end_date : ''
  const viewsDelivered = toNumber(row?.views_delivered)
  const guaranteed = toNumber(row?.guaranteed)
  const engagementRate = toNumber(row?.engagement_rate)
  const distributionSources = normalizeJsonValue(row?.distribution_sources)

  return {
    id,
    createdAt,
    campaignName,
    brand,
    startDate,
    endDate,
    viewsDelivered,
    guaranteed,
    engagementRate,
    allowedOrgs: normalizeUuidArray(row?.allowed_orgs),
    distributionSources,
    allowedMembers: normalizeUuidArray(row?.allowed_members),
    creator,
  }
}

app.get('/api/campaigns', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'campaigns_fetch_failed',
      message: viewer.message || 'Unable to load campaigns.',
      details: viewer.details ?? null,
    })
    return
  }

  const campaignsResult = await listCampaignRows()
  if (!campaignsResult.ok) {
    res.status(campaignsResult.status || 500).json({
      error: 'campaigns_fetch_failed',
      message: 'Unable to load campaigns from Supabase.',
      details: campaignsResult.payload,
    })
    return
  }

  const visibleCampaigns = campaignsResult.rows
    .filter((row) => canUserSeeCampaign(row, viewer.userId, viewer.organizationIds))
    .map((row) => mapCampaignForClient(row))
  res.json({ campaigns: visibleCampaigns, viewerUserId: viewer.userId })
})

app.post('/api/campaigns', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'campaign_create_failed',
      message: viewer.message || 'Unable to create campaign.',
      details: viewer.details ?? null,
    })
    return
  }

  const payload = req.body ?? {}
  const campaignName = typeof payload.campaignName === 'string' ? payload.campaignName.trim() : ''
  const payloadBrand = typeof payload.brand === 'string' ? payload.brand.trim() : ''
  const fallbackDistributionBrand =
    payload?.distributionSources && typeof payload.distributionSources === 'object'
      ? typeof payload.distributionSources.brand === 'string'
        ? payload.distributionSources.brand.trim()
        : ''
      : ''
  const brand = payloadBrand || fallbackDistributionBrand
  const startDate = normalizeDateOnly(payload.startDate)
  const endDate = normalizeDateOnly(payload.endDate)
  const guaranteed = toNumber(payload.guaranteed)
  const viewsDelivered = Math.max(0, toNumber(payload.viewsDelivered))
  const engagementRate = Math.max(0, toNumber(payload.engagementRate))
  let allowedOrgs = normalizeUuidArray(payload.allowedOrgs)
  const requestedMembers = normalizeUuidArray(payload.allowedMembers)
  const requestedEmailInputs = normalizeEmailInputArray(payload.memberEmails)
  const requestedMemberEmails = requestedEmailInputs.validEmails
  const distributionSources = sanitizeDistributionSources(payload.distributionSources)

  if (!campaignName || !brand || !startDate || !endDate) {
    res.status(400).json({
      error: 'invalid_campaign_payload',
      message: 'campaignName, brand, startDate, and endDate are required.',
    })
    return
  }

  if (Date.parse(`${startDate}T00:00:00Z`) > Date.parse(`${endDate}T00:00:00Z`)) {
    res.status(400).json({
      error: 'invalid_campaign_payload',
      message: 'startDate must be earlier than or equal to endDate.',
    })
    return
  }

  if (guaranteed < 0 || viewsDelivered < 0 || engagementRate < 0) {
    res.status(400).json({
      error: 'invalid_campaign_payload',
      message: 'guaranteed, viewsDelivered, and engagementRate must be non-negative numbers.',
    })
    return
  }

  if (!allowedOrgs.length && viewer.organizationIds.length) {
    allowedOrgs = viewer.organizationIds
  }

  let memberResolution = buildEmptyMemberResolution()
  let resolvedEmailMemberIds = []
  for (const email of requestedEmailInputs.invalidEmails) {
    memberResolution.failed.push({
      action: 'add',
      email,
      error: 'invalid_email',
      message: 'Email format is invalid.',
    })
  }
  if (requestedMemberEmails.length) {
    const resolvedMembers = await resolveMemberIdsFromEmails(requestedMemberEmails)
    resolvedEmailMemberIds = resolvedMembers.resolvedUserIds
    memberResolution.added.push(...resolvedMembers.resolution.added)
    memberResolution.removed.push(...resolvedMembers.resolution.removed)
    memberResolution.failed.push(...resolvedMembers.resolution.failed)
  }

  const allowedMembers = uniqueValues([...requestedMembers, ...resolvedEmailMemberIds, viewer.userId])
  const rowToInsert = {
    id: crypto.randomUUID(),
    campaign_name: campaignName,
    brand,
    start_date: startDate,
    end_date: endDate,
    views_delivered: viewsDelivered,
    guaranteed,
    engagement_rate: engagementRate,
    allowed_orgs: allowedOrgs.length ? allowedOrgs : null,
    distribution_sources: distributionSources,
    allowed_members: allowedMembers.length ? allowedMembers : [viewer.userId],
    creator: viewer.userId,
  }

  const inserted = await insertCampaignRow(rowToInsert)
  if (!inserted.ok) {
    console.error('Failed to insert campaign:', {
      status: inserted.status,
      details: inserted.payload,
    })
    res.status(inserted.status || 500).json({
      error: 'campaign_create_failed',
      message: 'Unable to create campaign in Supabase.',
      details: inserted.payload,
    })
    return
  }

  const createdRow = inserted.row ?? rowToInsert
  res.status(201).json({
    campaign: mapCampaignForClient(createdRow),
    viewerUserId: viewer.userId,
    memberResolution,
  })
})

app.delete('/api/campaigns/:campaignId', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'campaign_delete_failed',
      message: viewer.message || 'Unable to delete campaign.',
      details: viewer.details ?? null,
    })
    return
  }

  const campaignId = typeof req.params?.campaignId === 'string' ? req.params.campaignId.trim() : ''
  if (!isUuid(campaignId)) {
    res.status(400).json({
      error: 'invalid_campaign_id',
      message: 'Campaign id must be a valid UUID.',
    })
    return
  }

  const campaignResult = await fetchCampaignRowById(campaignId)
  if (!campaignResult.ok) {
    res.status(campaignResult.status || 500).json({
      error: 'campaign_delete_failed',
      message: 'Unable to load campaign from Supabase.',
      details: campaignResult.payload,
    })
    return
  }

  const campaignRow = campaignResult.row
  if (!campaignRow) {
    res.status(404).json({
      error: 'campaign_not_found',
      message: 'Campaign was not found.',
    })
    return
  }

  const creatorId = typeof campaignRow.creator === 'string' ? campaignRow.creator.trim() : ''
  if (!creatorId || creatorId !== viewer.userId) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only the campaign creator can delete this campaign.',
    })
    return
  }

  const deleted = await deleteCampaignRowById(campaignId)
  if (!deleted.ok) {
    res.status(deleted.status || 500).json({
      error: 'campaign_delete_failed',
      message: 'Unable to delete campaign from Supabase.',
      details: deleted.payload,
    })
    return
  }

  res.json({ campaignId })
})

app.get('/api/campaigns/:campaignId/members', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'campaign_members_fetch_failed',
      message: viewer.message || 'Unable to load campaign members.',
      details: viewer.details ?? null,
    })
    return
  }

  const campaignId = typeof req.params?.campaignId === 'string' ? req.params.campaignId.trim() : ''
  if (!isUuid(campaignId)) {
    res.status(400).json({
      error: 'invalid_campaign_id',
      message: 'Campaign id must be a valid UUID.',
    })
    return
  }

  const campaignResult = await fetchCampaignRowById(campaignId)
  if (!campaignResult.ok) {
    res.status(campaignResult.status || 500).json({
      error: 'campaign_members_fetch_failed',
      message: 'Unable to load campaign from Supabase.',
      details: campaignResult.payload,
    })
    return
  }

  const campaignRow = campaignResult.row
  if (!campaignRow) {
    res.status(404).json({
      error: 'campaign_not_found',
      message: 'Campaign was not found.',
    })
    return
  }

  if (!canUserSeeCampaign(campaignRow, viewer.userId, viewer.organizationIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this campaign.',
    })
    return
  }

  const memberIds = buildCampaignMemberIds(campaignRow)
  const usersResult = await fetchUsersRowsByIds(memberIds)
  if (!usersResult.ok) {
    console.error('Unable to load campaign member emails:', {
      campaignId,
      status: usersResult.status,
      details: usersResult.payload,
    })
  }

  const creator = typeof campaignRow.creator === 'string' ? campaignRow.creator.trim() : ''
  const campaignName =
    typeof campaignRow.campaign_name === 'string' ? campaignRow.campaign_name.trim() : ''

  res.json({
    campaignId,
    campaignName,
    creator,
    members: mapCampaignMembersForClient(memberIds, usersResult.ok ? usersResult.rows : []),
  })
})

app.post('/api/campaigns/:campaignId/members', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'campaign_members_update_failed',
      message: viewer.message || 'Unable to update campaign members.',
      details: viewer.details ?? null,
    })
    return
  }

  const campaignId = typeof req.params?.campaignId === 'string' ? req.params.campaignId.trim() : ''
  if (!isUuid(campaignId)) {
    res.status(400).json({
      error: 'invalid_campaign_id',
      message: 'Campaign id must be a valid UUID.',
    })
    return
  }

  const payload = req.body ?? {}
  const addEmailInputs = normalizeEmailInputArray(payload.addEmails)
  const removeEmailInputs = normalizeEmailInputArray(payload.removeEmails)
  const addEmails = addEmailInputs.validEmails
  const removeEmails = removeEmailInputs.validEmails
  const removeUserIds = normalizeUuidArray(payload.removeUserIds)
  if (
    !addEmails.length &&
    !removeEmails.length &&
    !addEmailInputs.invalidEmails.length &&
    !removeEmailInputs.invalidEmails.length &&
    !removeUserIds.length
  ) {
    res.status(400).json({
      error: 'invalid_member_update_payload',
      message: 'Provide at least one valid member in addEmails, removeEmails, or removeUserIds.',
    })
    return
  }

  const campaignResult = await fetchCampaignRowById(campaignId)
  if (!campaignResult.ok) {
    res.status(campaignResult.status || 500).json({
      error: 'campaign_members_update_failed',
      message: 'Unable to load campaign from Supabase.',
      details: campaignResult.payload,
    })
    return
  }

  const campaignRow = campaignResult.row
  if (!campaignRow) {
    res.status(404).json({
      error: 'campaign_not_found',
      message: 'Campaign was not found.',
    })
    return
  }

  if (!canUserSeeCampaign(campaignRow, viewer.userId, viewer.organizationIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this campaign.',
    })
    return
  }

  const creatorId = typeof campaignRow.creator === 'string' ? campaignRow.creator.trim() : ''
  if (!creatorId || viewer.userId !== creatorId) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only the campaign creator can manage members.',
    })
    return
  }

  const updateResult = buildEmptyMemberResolution()
  const memberSet = new Set(buildCampaignMemberIds(campaignRow))

  for (const email of addEmailInputs.invalidEmails) {
    updateResult.failed.push({
      action: 'add',
      email,
      error: 'invalid_email',
      message: 'Email format is invalid.',
    })
  }

  for (const email of removeEmailInputs.invalidEmails) {
    updateResult.failed.push({
      action: 'remove',
      email,
      error: 'invalid_email',
      message: 'Email format is invalid.',
    })
  }

  for (const email of addEmails) {
    const lookupResult = await fetchUsersRowByEmail(email)
    if (!lookupResult.ok) {
      updateResult.failed.push({
        action: 'add',
        email,
        error: 'lookup_failed',
        message: 'Unable to verify this email right now.',
      })
      continue
    }

    const userId = typeof lookupResult.row?.id === 'string' ? lookupResult.row.id.trim() : ''
    if (!isUuid(userId)) {
      updateResult.failed.push({
        action: 'add',
        email,
        error: 'user_not_found',
        message: 'No matching user was found for this email.',
      })
      continue
    }

    if (memberSet.has(userId)) {
      updateResult.failed.push({
        action: 'add',
        email,
        userId,
        error: 'user_already_member',
        message: 'User is already a campaign member.',
      })
      continue
    }

    memberSet.add(userId)
    updateResult.added.push({
      action: 'add',
      email,
      userId,
      message: 'User added to campaign members.',
    })
  }

  for (const email of removeEmails) {
    const lookupResult = await fetchUsersRowByEmail(email)
    if (!lookupResult.ok) {
      updateResult.failed.push({
        action: 'remove',
        email,
        error: 'lookup_failed',
        message: 'Unable to verify this email right now.',
      })
      continue
    }

    const userId = typeof lookupResult.row?.id === 'string' ? lookupResult.row.id.trim() : ''
    if (!isUuid(userId)) {
      updateResult.failed.push({
        action: 'remove',
        email,
        error: 'user_not_found',
        message: 'No matching user was found for this email.',
      })
      continue
    }

    if (userId === creatorId) {
      updateResult.failed.push({
        action: 'remove',
        email,
        userId,
        error: 'cannot_remove_creator',
        message: 'The campaign creator cannot be removed.',
      })
      continue
    }

    if (!memberSet.has(userId)) {
      updateResult.failed.push({
        action: 'remove',
        email,
        userId,
        error: 'user_not_member',
        message: 'User is not currently a campaign member.',
      })
      continue
    }

    memberSet.delete(userId)
    updateResult.removed.push({
      action: 'remove',
      email,
      userId,
      message: 'User removed from campaign members.',
    })
  }

  const removeUsersLookup = removeUserIds.length
    ? await fetchUsersRowsByIds(removeUserIds)
    : { ok: true, rows: [] }
  const removeLabelById = new Map(
    (removeUsersLookup.ok && Array.isArray(removeUsersLookup.rows) ? removeUsersLookup.rows : []).map((row) => {
      const id = typeof row?.id === 'string' ? row.id.trim() : ''
      const email = typeof row?.email === 'string' ? row.email.trim() : ''
      return [id, email]
    }),
  )

  for (const userId of removeUserIds) {
    const label = removeLabelById.get(userId) || userId
    if (userId === creatorId) {
      updateResult.failed.push({
        action: 'remove',
        email: label,
        userId,
        error: 'cannot_remove_creator',
        message: 'The campaign creator cannot be removed.',
      })
      continue
    }

    if (!memberSet.has(userId)) {
      updateResult.failed.push({
        action: 'remove',
        email: label,
        userId,
        error: 'user_not_member',
        message: 'User is not currently a campaign member.',
      })
      continue
    }

    memberSet.delete(userId)
    updateResult.removed.push({
      action: 'remove',
      email: label,
      userId,
      message: 'User removed from campaign members.',
    })
  }

  if (isUuid(creatorId)) memberSet.add(creatorId)
  const nextAllowedMembers = [...memberSet]
  const updateCampaignResult = await updateCampaignAllowedMembers(campaignId, nextAllowedMembers)
  if (!updateCampaignResult.ok) {
    res.status(updateCampaignResult.status || 500).json({
      error: 'campaign_members_update_failed',
      message: 'Unable to update campaign members in Supabase.',
      details: updateCampaignResult.payload,
    })
    return
  }

  const updatedCampaignRow = updateCampaignResult.row ?? {
    ...campaignRow,
    allowed_members: nextAllowedMembers,
  }
  const memberIds = buildCampaignMemberIds(updatedCampaignRow)
  const usersResult = await fetchUsersRowsByIds(memberIds)
  if (!usersResult.ok) {
    console.error('Unable to load campaign member emails after update:', {
      campaignId,
      status: usersResult.status,
      details: usersResult.payload,
    })
  }

  res.json({
    campaignId,
    members: mapCampaignMembersForClient(memberIds, usersResult.ok ? usersResult.rows : []),
    updateResult,
  })
})

app.get('/oauth/google', (_req, res) => {
  if (!clientId || !clientSecret || !redirectUri) {
    res.redirect(buildAppRedirect({ status: 'error', message: 'Google OAuth not configured.' }))
    return
  }

  const state = crypto.randomBytes(16).toString('hex')
  res.cookie('google_oauth_state', state, {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSecure,
    maxAge: 10 * 60 * 1000,
  })

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    state,
    include_granted_scopes: 'true',
    access_type: 'offline',
    prompt: 'consent',
  })

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
})

app.get('/oauth/google/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query
  const expectedState = req.cookies.google_oauth_state

  if (error) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        message: typeof errorDescription === 'string' ? errorDescription : 'Google login failed.',
      }),
    )
    return
  }

  if (!state || !expectedState || state !== expectedState) {
    res.redirect(buildAppRedirect({ status: 'error', message: 'Google login state mismatch.' }))
    return
  }

  if (!code || typeof code !== 'string') {
    res.redirect(buildAppRedirect({ status: 'error', message: 'Missing authorization code.' }))
    return
  }

  try {
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    })

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    })

    const tokenPayload = await tokenResponse.json().catch(() => ({}))
    const accessToken = tokenPayload?.access_token
    const idToken = tokenPayload?.id_token

    if (!tokenResponse.ok || (!accessToken && !idToken)) {
      const message =
        tokenPayload?.error_description ||
        tokenPayload?.error ||
        'Google token exchange failed.'
      res.redirect(buildAppRedirect({ status: 'error', message }))
      return
    }

    if (isSupabaseConfigured) {
      if (typeof idToken !== 'string' || !idToken) {
        clearSupabaseSessionCookies(res)
        res.redirect(
          buildAppRedirect({
            status: 'error',
            message: 'Google did not return an ID token for Supabase sign-in.',
          }),
        )
        return
      }

      const supabaseSession = await exchangeGoogleIdTokenForSupabaseSession(idToken)
      if (!supabaseSession?.access_token) {
        clearSupabaseSessionCookies(res)
        res.redirect(
          buildAppRedirect({
            status: 'error',
            message: 'Supabase session exchange failed. Check Supabase Google provider settings.',
          }),
        )
        return
      }

      const ensuredRow = await ensureSupabaseUserRow(supabaseSession)
      if (!ensuredRow.ok) {
        clearSupabaseSessionCookies(res)
        res.redirect(
          buildAppRedirect({
            status: 'error',
            message: `Unable to initialize your account (${ensuredRow.reason}). Please try again.`,
          }),
        )
        return
      }

      if (!setSupabaseSessionCookies(res, supabaseSession)) {
        clearSupabaseSessionCookies(res)
        res.redirect(
          buildAppRedirect({
            status: 'error',
            message: 'Unable to persist Supabase session cookies.',
          }),
        )
        return
      }
    } else {
      clearSupabaseSessionCookies(res)
    }
    res.clearCookie('google_oauth_state')
    res.redirect(buildAppRedirect({ status: 'success' }))
  } catch (_err) {
    res.redirect(buildAppRedirect({ status: 'error', message: 'Google login failed.' }))
  }
})

app.get('/oauth/youtube', (req, res) => {
  if (!youtubeClientId || !youtubeClientSecret || !youtubeRedirectUri) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: 'YouTube OAuth not configured.',
        path: '/settings',
      }),
    )
    return
  }

  const requestedOrigin =
    typeof req.query?.app_origin === 'string' ? req.query.app_origin : ''
  const refererOrigin = typeof req.headers.referer === 'string' ? req.headers.referer : ''
  const appOrigin = resolveOriginBase(requestedOrigin) || resolveOriginBase(refererOrigin)
  if (appOrigin) {
    res.cookie(APP_REDIRECT_COOKIE, appOrigin, {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: cookieSecure,
      maxAge: 10 * 60 * 1000,
    })
  }

  const state = crypto.randomBytes(16).toString('hex')
  res.cookie('youtube_oauth_state', state, {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSecure,
    maxAge: 10 * 60 * 1000,
  })

  const params = new URLSearchParams({
    client_id: youtubeClientId,
    redirect_uri: youtubeRedirectUri,
    response_type: 'code',
    scope: youtubeScope,
    state,
    include_granted_scopes: 'true',
    access_type: 'offline',
    prompt: 'consent',
  })

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
})

app.get('/oauth/youtube/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query
  const expectedState = req.cookies.youtube_oauth_state
  const redirectBase = resolveAppRedirectBase(req)

  if (error) {
    res.clearCookie(APP_REDIRECT_COOKIE)
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: typeof errorDescription === 'string' ? errorDescription : 'YouTube connection failed.',
        path: '/settings',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!state || !expectedState || state !== expectedState) {
    res.clearCookie(APP_REDIRECT_COOKIE)
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: 'YouTube connection state mismatch.',
        path: '/settings',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!code || typeof code !== 'string') {
    res.clearCookie(APP_REDIRECT_COOKIE)
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: 'Missing authorization code.',
        path: '/settings',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  try {
    const tokenParams = new URLSearchParams({
      client_id: youtubeClientId,
      client_secret: youtubeClientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: youtubeRedirectUri,
    })

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    })

    const tokenPayload = await tokenResponse.json().catch(() => ({}))
    const accessToken = tokenPayload?.access_token
    const refreshToken = tokenPayload?.refresh_token
    const expiresIn = toNumber(tokenPayload?.expires_in)
    const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : 0

    if (!tokenResponse.ok || !accessToken) {
      const message =
        tokenPayload?.error_description ||
        tokenPayload?.error ||
        'YouTube token exchange failed.'
      res.redirect(
        buildAppRedirect({
          status: 'error',
          provider: 'youtube',
          message,
          path: '/settings',
          baseUrl: redirectBase,
        }),
      )
      return
    }

    const channelInfo = await fetchYouTubeChannelInfo(accessToken)
    const youtubeChannelName = channelInfo?.title ?? ''
    const fallbackProfileName = youtubeChannelName ? '' : await fetchGoogleProfileName(accessToken)
    const connectedDisplayName = youtubeChannelName || fallbackProfileName

    if (!channelInfo?.id) {
      const channelErrorMessage =
        typeof channelInfo?.errorMessage === 'string' && channelInfo.errorMessage.trim()
          ? channelInfo.errorMessage.trim()
          : 'Unable to load YouTube channel details.'
      console.error('YouTube connect failed while loading channel details:', channelErrorMessage)
      res.clearCookie('youtube_oauth_state')
      res.clearCookie(APP_REDIRECT_COOKIE)
      res.redirect(
        buildAppRedirect({
          status: 'error',
          provider: 'youtube',
          message: channelErrorMessage,
          path: '/settings',
          baseUrl: redirectBase,
        }),
      )
      return
    }

    const viewerResult = await resolveYouTubeViewer(req, res)
    if (!viewerResult.ok) {
      throw new Error('You must be signed in before connecting YouTube.')
    }
    const userId = viewerResult.viewer.userId
    const existingConnectionsResult = await listYouTubeConnectionRowsByUserId(userId)
    const existingRows = existingConnectionsResult.ok ? existingConnectionsResult.rows : []
    const existing = existingRows
      .map(mapYouTubeConnectionRow)
      .find((connection) => connection.channelId === channelInfo.id)
    const nextConnection = {
      ...existing,
      channelId: channelInfo.id,
      channelName: connectedDisplayName || youtubeChannelName || 'YouTube Channel',
      accessToken,
      refreshToken: refreshToken || existing?.refreshToken,
      expiresAt,
      connectedAt: existing?.connectedAt ?? new Date().toISOString(),
    }
    const upsertResult = await upsertYouTubeConnectionRow({
      user_id: userId,
      channel_id: nextConnection.channelId,
      channel_name: nextConnection.channelName,
      access_token: nextConnection.accessToken,
      refresh_token: nextConnection.refreshToken || null,
      token_expires_at: nextConnection.expiresAt
        ? new Date(nextConnection.expiresAt).toISOString()
        : null,
      connected_at: nextConnection.connectedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    if (!upsertResult.ok) {
      throw new Error('Unable to save YouTube connection.')
    }

    res.clearCookie('youtube_oauth_state')
    res.clearCookie(APP_REDIRECT_COOKIE)
    res.redirect(
      buildAppRedirect({
        status: 'success',
        provider: 'youtube',
        path: '/settings',
        extraParams: { youtube_channel_name: connectedDisplayName },
        baseUrl: redirectBase,
      }),
    )
  } catch (err) {
    res.clearCookie(APP_REDIRECT_COOKIE)
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: err instanceof Error && err.message ? err.message : 'YouTube connection failed.',
        path: '/settings',
        baseUrl: redirectBase,
      }),
    )
  }
})

const fetchYouTubeVideoIds = async (accessToken, channelId, order, maxResults) => {
  if (!channelId) return []
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      channelId,
      order,
      maxResults: String(maxResults),
      type: 'video',
    })
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return []
    const payload = await response.json().catch(() => ({}))
    if (!Array.isArray(payload?.items)) return []
    return payload.items
      .map((item) => item?.id?.videoId)
      .filter((id) => typeof id === 'string' && id.length > 0)
  } catch (_err) {
    return []
  }
}

const fetchYouTubeVideos = async (accessToken, videoIds) => {
  if (!videoIds.length) return []
  try {
    const params = new URLSearchParams({
      part: 'snippet,statistics',
      id: videoIds.join(','),
    })
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return []
    const payload = await response.json().catch(() => ({}))
    if (!Array.isArray(payload?.items)) return []
    return payload.items.map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      title: typeof item?.snippet?.title === 'string' ? item.snippet.title.trim() : '',
      publishedAt: typeof item?.snippet?.publishedAt === 'string' ? item.snippet.publishedAt : '',
      views: toNumber(item?.statistics?.viewCount),
      likes: toNumber(item?.statistics?.likeCount),
      comments: toNumber(item?.statistics?.commentCount),
    }))
  } catch (_err) {
    return []
  }
}

const buildEngagementRate = (videos) => {
  const totals = videos.reduce(
    (acc, video) => {
      acc.views += video.views
      acc.engagements += video.likes + video.comments
      return acc
    },
    { views: 0, engagements: 0 },
  )
  return totals.views ? (totals.engagements / totals.views) * 100 : 0
}

const buildTimeSeries = (videos) => {
  const buckets = new Map()
  videos.forEach((video) => {
    if (!video.publishedAt) return
    const isoDate = video.publishedAt.slice(0, 10)
    const current = buckets.get(isoDate) ?? { date: isoDate, views: 0, engagements: 0, posts: 0 }
    current.views += video.views
    current.engagements += video.likes + video.comments
    current.posts += 1
    buckets.set(isoDate, current)
  })
  const ordered = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))
  const trimmed = ordered.slice(-8)
  return trimmed.map((point) => ({
    date: formatDateLabel(point.date),
    views: point.views,
    engagements: point.engagements,
    posts: point.posts,
  }))
}

const buildAnalyticsDateRange = (days) => {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - Math.max(0, days - 1))
  const toIso = (value) => value.toISOString().slice(0, 10)
  return { startDate: toIso(start), endDate: toIso(end) }
}

const fetchAnalyticsReport = async (accessToken, params) => {
  const query = new URLSearchParams(params).toString()
  const response = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    console.error('YouTube Analytics request failed:', {
      status: response.status,
      params,
      reason:
        payload?.error?.message ||
        payload?.error_description ||
        payload?.error ||
        'unknown_error',
    })
    return null
  }
  return response.json().catch(() => null)
}

const parseAnalyticsRows = (payload) => {
  const headers = Array.isArray(payload?.columnHeaders) ? payload.columnHeaders : []
  const rows = Array.isArray(payload?.rows) ? payload.rows : []
  if (!headers.length || !rows.length) return []
  return rows.map((row) => {
    const entry = {}
    headers.forEach((header, index) => {
      if (header?.name) {
        entry[header.name] = row[index]
      }
    })
    return entry
  })
}

const buildAnalyticsSummary = async (sessionId, connections, options = {}) => {
  const resolveAccessToken =
    typeof options.resolveAccessToken === 'function'
      ? options.resolveAccessToken
      : (connection) => ensureValidAccessToken(sessionId, connection)
  const timeSeriesMap = new Map()
  const ageMap = new Map()
  const genderMap = new Map()
  const geoMap = new Map()
  const { startDate, endDate } = buildAnalyticsDateRange(365)
  const audienceRanges = [365, 90, 28].map((days) => buildAnalyticsDateRange(days))

  for (const connection of connections) {
    const { accessToken } = await resolveAccessToken(connection)
    if (!accessToken) continue
    let ageRowsCount = 0
    let genderRowsCount = 0
    let geoRowsCount = 0

    const baseParams = {
      startDate,
      endDate,
    }
    const fetchForConnection = async (params, rangeParams = baseParams) => {
      const preferredIds = connection.channelId ? `channel==${connection.channelId}` : 'channel==MINE'
      const withPreferredIds = await fetchAnalyticsReport(accessToken, {
        ...rangeParams,
        ...params,
        ids: preferredIds,
      })
      if (withPreferredIds) return withPreferredIds
      if (preferredIds === 'channel==MINE') return null
      return fetchAnalyticsReport(accessToken, {
        ...rangeParams,
        ...params,
        ids: 'channel==MINE',
      })
    }
    const fetchRowsForConnection = async (candidates, ranges = [baseParams]) => {
      for (const range of ranges) {
        for (const candidate of candidates) {
          const payload = await fetchForConnection(candidate, range)
          const rows = parseAnalyticsRows(payload)
          if (rows.length) {
            return rows
          }
        }
      }
      return []
    }
    const resolveAudienceMetricValue = (row) => {
      if (Object.prototype.hasOwnProperty.call(row, 'viewerPercentage')) {
        const percent = toNumber(row.viewerPercentage)
        return totalViews ? (percent / 100) * totalViews : percent
      }
      if (Object.prototype.hasOwnProperty.call(row, 'estimatedMinutesWatched')) {
        return toNumber(row.estimatedMinutesWatched)
      }
      return toNumber(row.views)
    }

    const totalPayload = await fetchForConnection({
      metrics: 'views',
    })
    const totalRows = parseAnalyticsRows(totalPayload)
    const totalViews = totalRows.length ? toNumber(totalRows[0].views) : 0

    const timePayload = await fetchForConnection({
      metrics: 'views,likes,comments',
      dimensions: 'day',
      sort: 'day',
    })
    const timeRows = parseAnalyticsRows(timePayload)
    timeRows.forEach((row) => {
      if (!row.day) return
      const current =
        timeSeriesMap.get(row.day) ?? { date: row.day, views: 0, engagements: 0, posts: 0 }
      current.views += toNumber(row.views)
      current.engagements += toNumber(row.likes) + toNumber(row.comments)
      timeSeriesMap.set(row.day, current)
    })

    const demographicRows = await fetchRowsForConnection([
      { metrics: 'viewerPercentage', dimensions: 'ageGroup,gender' },
    ], audienceRanges)
    demographicRows.forEach((row) => {
      const label = normalizeAgeLabel(row.ageGroup)
      if (!label) return
      const value = resolveAudienceMetricValue(row)
      ageMap.set(label, (ageMap.get(label) ?? 0) + value)
      ageRowsCount += 1
    })
    demographicRows.forEach((row) => {
      const label = normalizeGenderLabel(row.gender)
      if (!label) return
      const value = resolveAudienceMetricValue(row)
      genderMap.set(label, (genderMap.get(label) ?? 0) + value)
      genderRowsCount += 1
    })

    if (!demographicRows.length) {
      const ageRows = await fetchRowsForConnection([
        { metrics: 'viewerPercentage', dimensions: 'ageGroup' },
      ], audienceRanges)
      ageRows.forEach((row) => {
        const label = normalizeAgeLabel(row.ageGroup)
        if (!label) return
        const value = resolveAudienceMetricValue(row)
        ageMap.set(label, (ageMap.get(label) ?? 0) + value)
        ageRowsCount += 1
      })

      const genderRows = await fetchRowsForConnection([
        { metrics: 'viewerPercentage', dimensions: 'gender' },
      ], audienceRanges)
      genderRows.forEach((row) => {
        const label = normalizeGenderLabel(row.gender)
        if (!label) return
        const value = resolveAudienceMetricValue(row)
        genderMap.set(label, (genderMap.get(label) ?? 0) + value)
        genderRowsCount += 1
      })
    }

    const geoRows = await fetchRowsForConnection([
      { metrics: 'views', dimensions: 'country', sort: '-views' },
      { metrics: 'views', dimensions: 'country' },
      { metrics: 'estimatedMinutesWatched', dimensions: 'country', sort: '-estimatedMinutesWatched' },
      { metrics: 'estimatedMinutesWatched', dimensions: 'country' },
    ], audienceRanges)
    geoRows.forEach((row) => {
      const label = resolveCountryLabel(row.country)
      if (!label) return
      const value = resolveAudienceMetricValue(row)
      geoMap.set(label, (geoMap.get(label) ?? 0) + value)
      geoRowsCount += 1
    })

    if (ageRowsCount === 0 && genderRowsCount === 0 && geoRowsCount === 0) {
      console.info('YouTube audience rows unavailable for channel in analytics window:', {
        channelId: connection.channelId || 'unknown',
        startDate,
        endDate,
      })
    }
  }

  const buildPercentList = (map) => {
    const total = [...map.values()].reduce((sum, value) => sum + value, 0)
    if (!total) return []
    return [...map.entries()]
      .map(([label, value]) => ({
        label,
        value: Math.round((value / total) * 100),
      }))
      .sort((a, b) => b.value - a.value)
  }

  const orderedSeries = [...timeSeriesMap.values()]
    .filter((point) => point.date)
    .sort((a, b) => a.date.localeCompare(b.date))
  const nonZeroSeries = orderedSeries.filter(
    (point) =>
      toNumber(point.views) > 0 || toNumber(point.engagements) > 0 || toNumber(point.posts) > 0,
  )
  const timeSeries = (nonZeroSeries.length ? nonZeroSeries : orderedSeries)
    .slice(-8)
    .map((point) => ({
      date: formatDateLabel(point.date),
      views: point.views,
      engagements: point.engagements,
      posts: point.posts,
    }))

  return {
    timeSeries,
    ageDistribution: buildPercentList(ageMap),
    genderDistribution: buildPercentList(genderMap),
    topGeos: buildPercentList(geoMap).slice(0, 5),
  }
}

const parseCsvRows = (content) => {
  if (!content) return []
  const rows = []
  let row = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i]
    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(current)
      current = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && content[i + 1] === '\n') {
        i += 1
      }
      row.push(current)
      if (row.some((value) => value.trim().length > 0)) {
        rows.push(row)
      }
      row = []
      current = ''
      continue
    }

    current += char
  }

  if (current.length || row.length) {
    row.push(current)
    if (row.some((value) => value.trim().length > 0)) {
      rows.push(row)
    }
  }

  return rows
}

const parseReportingCsv = (content) => {
  const rows = parseCsvRows(content)
  if (!rows.length) return { headers: [], rows: [] }
  const headers = rows[0].map((value) => value.trim())
  return { headers, rows: rows.slice(1) }
}

const findHeaderIndex = (headers, candidates) => {
  const normalizeKey = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  const normalizedHeaders = headers.map((header) => normalizeKey(header))
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeKey(candidate)
    const index = normalizedHeaders.findIndex((header) => header === normalizedCandidate)
    if (index >= 0) return index
  }
  return -1
}

const normalizeAgeLabel = (value) => {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('age')) {
    const label = trimmed.replace(/^age/, '')
    return label.endsWith('-') ? `${label.slice(0, -1)}+` : label
  }
  return trimmed
}

const normalizeGenderLabel = (value) => {
  const trimmed = String(value ?? '').trim().toLowerCase()
  if (!trimmed) return ''
  if (trimmed === 'female') return 'Women'
  if (trimmed === 'male') return 'Men'
  if (trimmed.includes('unknown')) return 'Unknown'
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

const resolveCountryLabel = (value) => {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return ''
  if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
    try {
      const displayNames = new Intl.DisplayNames(['en'], { type: 'region' })
      return displayNames.of(trimmed) || trimmed
    } catch (_err) {
      return trimmed
    }
  }
  return trimmed
}

const fetchReportingJson = async (accessToken, endpoint, params) => {
  const query = params ? `?${new URLSearchParams(params).toString()}` : ''
  const response = await fetch(`https://youtubereporting.googleapis.com/v1/${endpoint}${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) return null
  return response.json().catch(() => null)
}

const fetchReportingReportTypes = async (accessToken) => {
  const store = await loadReportingStore()
  const cached = store.reportTypesCache
  if (cached?.fetchedAt && Date.now() - cached.fetchedAt < 6 * 60 * 60 * 1000 && cached?.items) {
    return cached.items
  }
  const payload = await fetchReportingJson(accessToken, 'reportTypes')
  const items = Array.isArray(payload?.reportTypes) ? payload.reportTypes : []
  store.reportTypesCache = { fetchedAt: Date.now(), items }
  await persistReportingStore()
  return items
}

const listReportingJobs = async (accessToken) => {
  const jobs = []
  let nextPageToken = ''
  for (let page = 0; page < 20; page += 1) {
    const payload = await fetchReportingJson(
      accessToken,
      'jobs',
      nextPageToken ? { pageToken: nextPageToken } : undefined,
    )
    const batch = Array.isArray(payload?.jobs) ? payload.jobs : []
    jobs.push(...batch)
    const token = typeof payload?.nextPageToken === 'string' ? payload.nextPageToken : ''
    if (!token) break
    nextPageToken = token
  }
  return jobs
}

const createReportingJob = async (accessToken, reportTypeId, name) => {
  const response = await fetch('https://youtubereporting.googleapis.com/v1/jobs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reportTypeId, name }),
  })
  if (!response.ok) return null
  return response.json().catch(() => null)
}

const listReportingReports = async (accessToken, jobId) => {
  const reports = []
  let nextPageToken = ''
  for (let page = 0; page < 20; page += 1) {
    const payload = await fetchReportingJson(
      accessToken,
      `jobs/${jobId}/reports`,
      nextPageToken ? { pageToken: nextPageToken } : undefined,
    )
    const batch = Array.isArray(payload?.reports) ? payload.reports : []
    reports.push(...batch)
    const token = typeof payload?.nextPageToken === 'string' ? payload.nextPageToken : ''
    if (!token) break
    nextPageToken = token
  }
  return reports
}

const downloadReportingReport = async (accessToken, downloadUrl) => {
  if (!downloadUrl) return ''
  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) return ''
  return response.text().catch(() => '')
}

const selectLatestReport = (reports) => {
  if (!reports.length) return null
  return [...reports].sort((a, b) => {
    const aTime = new Date(a?.createTime || a?.startTime || 0).getTime()
    const bTime = new Date(b?.createTime || b?.startTime || 0).getTime()
    return bTime - aTime
  })[0]
}

const normalizeReportTypeKey = (value) =>
  String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')

const resolveAvailableReportTypeId = (availableReportTypes, preferredId, fallbackIds, prefix) => {
  const availableIds = availableReportTypes
    .map((item) => item?.id)
    .filter((id) => typeof id === 'string' && id.trim())
  if (!availableIds.length) return ''
  if (preferredId && availableIds.includes(preferredId)) return preferredId
  for (const fallbackId of fallbackIds) {
    if (fallbackId && availableIds.includes(fallbackId)) return fallbackId
  }
  const normalizedPrefix = normalizeReportTypeKey(prefix)
  const matched = availableIds.find((id) => normalizeReportTypeKey(id).startsWith(normalizedPrefix))
  return matched || ''
}

const ensureReportingJobs = async (sessionId, connection, accessToken) => {
  const session = await loadSession(sessionId)
  const jobsByChannel = session.reporting?.jobs?.[connection.channelId] ?? {}
  const availableReportTypes = await fetchReportingReportTypes(accessToken)
  const reportTypes = [
    {
      key: 'channelDaily',
      reportTypeId: resolveAvailableReportTypeId(
        availableReportTypes,
        youtubeReportChannelDaily,
        ['channel_basic_a3', 'channel_basic_a2'],
        'channel_basic_',
      ),
      name: `fixated-${connection.channelId}-channel-daily`,
    },
    {
      key: 'videoDaily',
      reportTypeId: resolveAvailableReportTypeId(
        availableReportTypes,
        youtubeReportVideoDaily,
        ['video_basic_a3', 'video_basic_a2'],
        'video_basic_',
      ),
      name: `fixated-${connection.channelId}-video-daily`,
    },
    {
      key: 'demographics',
      reportTypeId: resolveAvailableReportTypeId(
        availableReportTypes,
        youtubeReportDemographics,
        ['channel_demographics_a1'],
        'channel_demographics_',
      ),
      name: `fixated-${connection.channelId}-demographics`,
    },
    {
      key: 'geo',
      reportTypeId:
        resolveAvailableReportTypeId(
          availableReportTypes,
          youtubeReportGeo,
          ['channel_geography_a1'],
          'channel_geography_',
        )
        || resolveAvailableReportTypeId(
          availableReportTypes,
          '',
          ['channel_province_a3'],
          'channel_province_',
        ),
      name: `fixated-${connection.channelId}-geo`,
    },
  ]
  const jobsList = await listReportingJobs(accessToken)

  for (const reportType of reportTypes) {
    if (!reportType.reportTypeId) {
      continue
    }
    const existing = jobsByChannel[reportType.key] || jobsByChannel[reportType.reportTypeId]
    if (existing?.jobId) {
      jobsByChannel[reportType.key] = {
        jobId: existing.jobId,
        name: existing.name || reportType.name,
        reportTypeId: existing.reportTypeId || reportType.reportTypeId,
      }
      continue
    }
    let matched = jobsList.find(
      (job) => job?.reportTypeId === reportType.reportTypeId && job?.name === reportType.name,
    )
    if (!matched) {
      matched = jobsList.find((job) => job?.reportTypeId === reportType.reportTypeId)
    }
    if (matched?.id) {
      jobsByChannel[reportType.key] = {
        jobId: matched.id,
        name: matched.name,
        reportTypeId: reportType.reportTypeId,
      }
      continue
    }
    const created = await createReportingJob(accessToken, reportType.reportTypeId, reportType.name)
    if (created?.id) {
      jobsByChannel[reportType.key] = {
        jobId: created.id,
        name: created.name,
        reportTypeId: reportType.reportTypeId,
      }
    }
  }

  session.reporting = session.reporting || { jobs: {}, reports: {} }
  session.reporting.jobs = session.reporting.jobs || {}
  session.reporting.jobs[connection.channelId] = jobsByChannel
  await saveSession(sessionId, session)
  return jobsByChannel
}

const getCachedReportData = async (sessionId, jobId) => {
  const session = await loadSession(sessionId)
  const cached = session.reporting?.reports?.[jobId]
  if (cached && typeof cached === 'object') return cached
  return null
}

const cacheReportData = async (sessionId, jobId, data) => {
  const session = await loadSession(sessionId)
  session.reporting = session.reporting || { jobs: {}, reports: {} }
  session.reporting.reports = session.reporting.reports || {}
  session.reporting.reports[jobId] = data
  await saveSession(sessionId, session)
}

const parseVideoReportRows = (headers, rows) => {
  const dayIndex = findHeaderIndex(headers, ['day', 'date'])
  const videoIndex = findHeaderIndex(headers, ['video', 'videoId', 'video_id'])
  const viewsIndex = findHeaderIndex(headers, ['views'])
  if (dayIndex < 0 || videoIndex < 0 || viewsIndex < 0) return []
  const likesIndex = findHeaderIndex(headers, ['likes'])
  const commentsIndex = findHeaderIndex(headers, ['comments'])

  return rows
    .map((row) => ({
      day: row[dayIndex]?.trim(),
      videoId: row[videoIndex]?.trim(),
      views: toNumber(row[viewsIndex]),
      likes: likesIndex >= 0 ? toNumber(row[likesIndex]) : 0,
      comments: commentsIndex >= 0 ? toNumber(row[commentsIndex]) : 0,
    }))
    .filter((row) => row.day && row.videoId)
}

const parseChannelReportRows = (headers, rows) => {
  const dayIndex = findHeaderIndex(headers, ['day', 'date'])
  const viewsIndex = findHeaderIndex(headers, ['views'])
  if (dayIndex < 0 || viewsIndex < 0) return []
  const likesIndex = findHeaderIndex(headers, ['likes'])
  const commentsIndex = findHeaderIndex(headers, ['comments'])
  const subscribersGainedIndex = findHeaderIndex(headers, [
    'subscribersGained',
    'subscribers_gained',
    'subscribersGainedFromChannel',
  ])
  const subscribersLostIndex = findHeaderIndex(headers, [
    'subscribersLost',
    'subscribers_lost',
    'subscribersLostFromChannel',
  ])

  return rows
    .map((row) => ({
      day: row[dayIndex]?.trim(),
      views: toNumber(row[viewsIndex]),
      likes: likesIndex >= 0 ? toNumber(row[likesIndex]) : 0,
      comments: commentsIndex >= 0 ? toNumber(row[commentsIndex]) : 0,
      subscribersGained: subscribersGainedIndex >= 0 ? toNumber(row[subscribersGainedIndex]) : null,
      subscribersLost: subscribersLostIndex >= 0 ? toNumber(row[subscribersLostIndex]) : null,
    }))
    .filter((row) => row.day)
}

const parseDemographicsRows = (headers, rows) => {
  const ageIndex = findHeaderIndex(headers, ['ageGroup', 'age_group'])
  const genderIndex = findHeaderIndex(headers, ['gender'])
  const viewPercentIndex = findHeaderIndex(headers, ['viewerPercentage', 'viewer_percentage'])
  const viewsIndex = findHeaderIndex(headers, ['views'])
  if (ageIndex < 0 && genderIndex < 0) return []

  return rows
    .map((row) => ({
      ageGroup: ageIndex >= 0 ? row[ageIndex]?.trim() : '',
      gender: genderIndex >= 0 ? row[genderIndex]?.trim() : '',
      viewerPercentage: viewPercentIndex >= 0 ? toNumber(row[viewPercentIndex]) : 0,
      views: viewsIndex >= 0 ? toNumber(row[viewsIndex]) : 0,
    }))
    .filter((row) => row.ageGroup || row.gender)
}

const parseGeoRows = (headers, rows) => {
  const countryIndex = findHeaderIndex(headers, [
    'country',
    'countryCode',
    'country_code',
    'province',
    'provinceCode',
    'province_code',
  ])
  const viewPercentIndex = findHeaderIndex(headers, ['viewerPercentage', 'viewer_percentage'])
  const viewsIndex = findHeaderIndex(headers, ['views'])
  if (countryIndex < 0) return []

  return rows
    .map((row) => ({
      country: row[countryIndex]?.trim(),
      viewerPercentage: viewPercentIndex >= 0 ? toNumber(row[viewPercentIndex]) : 0,
      views: viewsIndex >= 0 ? toNumber(row[viewsIndex]) : 0,
    }))
    .filter((row) => row.country)
}

const getReportingDataForJob = async (sessionId, accessToken, jobId, parser) => {
  const reports = await listReportingReports(accessToken, jobId)
  const orderedReports = [...reports].sort((a, b) => {
    const aTime = new Date(a?.createTime || a?.startTime || 0).getTime()
    const bTime = new Date(b?.createTime || b?.startTime || 0).getTime()
    return bTime - aTime
  })
  if (!orderedReports.length) return null

  const cached = await getCachedReportData(sessionId, jobId)
  if (cached?.reportId && orderedReports.some((report) => report?.id === cached.reportId)) {
    return cached
  }

  let fallbackEmptyReport = null
  for (const report of orderedReports.slice(0, 12)) {
    if (!report?.downloadUrl || !report?.id) continue
    const csvContent = await downloadReportingReport(accessToken, report.downloadUrl)
    const { headers, rows } = parseReportingCsv(csvContent)
    const dataRows = parser(headers, rows)
    const parsedReport = {
      reportId: report.id,
      createdAt: report.createTime || report.startTime || '',
      data: dataRows,
    }
    if (dataRows.length) {
      await cacheReportData(sessionId, jobId, parsedReport)
      return parsedReport
    }
    if (!fallbackEmptyReport) {
      fallbackEmptyReport = parsedReport
    }
  }

  if (fallbackEmptyReport) {
    await cacheReportData(sessionId, jobId, fallbackEmptyReport)
    return fallbackEmptyReport
  }

  return null
}

const buildReportingSummary = async (sessionId, connections, options = {}) => {
  const resolveAccessToken =
    typeof options.resolveAccessToken === 'function'
      ? options.resolveAccessToken
      : (connection) => ensureValidAccessToken(sessionId, connection)
  const videoRows = []
  const channelRows = []
  const demographicRows = []
  const geoRows = []
  const videoIdsByChannel = new Map()

  for (const connection of connections) {
    const { accessToken } = await resolveAccessToken(connection)
    if (!accessToken) continue

    const jobsByType = await ensureReportingJobs(sessionId, connection, accessToken)
    const channelJob = jobsByType?.channelDaily?.jobId || jobsByType?.[youtubeReportChannelDaily]?.jobId
    const videoJob = jobsByType?.videoDaily?.jobId || jobsByType?.[youtubeReportVideoDaily]?.jobId
    const demoJob = jobsByType?.demographics?.jobId || jobsByType?.[youtubeReportDemographics]?.jobId
    const geoJob = jobsByType?.geo?.jobId || jobsByType?.[youtubeReportGeo]?.jobId

    if (channelJob) {
      const report = await getReportingDataForJob(sessionId, accessToken, channelJob, parseChannelReportRows)
      if (report?.data?.length) {
        report.data.forEach((row) => channelRows.push({ ...row, channelId: connection.channelId }))
      }
    }

    if (videoJob) {
      const report = await getReportingDataForJob(sessionId, accessToken, videoJob, parseVideoReportRows)
      if (report?.data?.length) {
        report.data.forEach((row) => {
          videoRows.push({ ...row, channelId: connection.channelId })
          if (!videoIdsByChannel.has(connection.channelId)) {
            videoIdsByChannel.set(connection.channelId, new Set())
          }
          videoIdsByChannel.get(connection.channelId).add(row.videoId)
        })
      }
    }

    if (demoJob) {
      const report = await getReportingDataForJob(sessionId, accessToken, demoJob, parseDemographicsRows)
      if (report?.data?.length) {
        report.data.forEach((row) => demographicRows.push({ ...row, channelId: connection.channelId }))
      }
    }

    if (geoJob) {
      const report = await getReportingDataForJob(sessionId, accessToken, geoJob, parseGeoRows)
      if (report?.data?.length) {
        report.data.forEach((row) => geoRows.push({ ...row, channelId: connection.channelId }))
      }
    }
  }

  const timeSeriesMap = new Map()
  if (channelRows.length) {
    channelRows.forEach((row) => {
      const current =
        timeSeriesMap.get(row.day) ?? { date: row.day, views: 0, engagements: 0, posts: 0 }
      current.views += row.views
      current.engagements += row.likes + row.comments
      timeSeriesMap.set(row.day, current)
    })
  } else {
    videoRows.forEach((row) => {
      const current =
        timeSeriesMap.get(row.day) ?? { date: row.day, views: 0, engagements: 0, posts: 0 }
      current.views += row.views
      current.engagements += row.likes + row.comments
      timeSeriesMap.set(row.day, current)
    })
  }

  videoRows.forEach((row) => {
    const current = timeSeriesMap.get(row.day) ?? { date: row.day, views: 0, engagements: 0, posts: 0 }
    current.posts += 1
    timeSeriesMap.set(row.day, current)
  })

  const orderedSeries = [...timeSeriesMap.values()]
    .filter((point) => point.date)
    .sort((a, b) => a.date.localeCompare(b.date))
  const nonZeroSeries = orderedSeries.filter(
    (point) =>
      toNumber(point.views) > 0 || toNumber(point.engagements) > 0 || toNumber(point.posts) > 0,
  )
  const timeSeries = (nonZeroSeries.length ? nonZeroSeries : orderedSeries)
    .slice(-8)
    .map((point) => ({
      date: formatDateLabel(point.date),
      views: point.views,
      engagements: point.engagements,
      posts: point.posts,
    }))

  const channelFollowerDeltas = {}
  const hasSubscriberMetrics = channelRows.some(
    (row) =>
      typeof row.subscribersGained === 'number' || typeof row.subscribersLost === 'number',
  )
  if (channelRows.length && hasSubscriberMetrics) {
    let latestTime = 0
    channelRows.forEach((row) => {
      const rowTime = Date.parse(row.day)
      if (!Number.isNaN(rowTime)) {
        latestTime = Math.max(latestTime, rowTime)
      }
    })

    if (latestTime > 0) {
      const cutoffTime = latestTime - 30 * 24 * 60 * 60 * 1000
      channelRows.forEach((row) => {
        const rowTime = Date.parse(row.day)
        if (Number.isNaN(rowTime) || rowTime < cutoffTime) return
        const gained = typeof row.subscribersGained === 'number' ? row.subscribersGained : 0
        const lost = typeof row.subscribersLost === 'number' ? row.subscribersLost : 0
        const netSubscribers = gained - lost
        if (!Number.isFinite(netSubscribers)) return
        const channelId = row.channelId
        if (!channelId) return
        channelFollowerDeltas[channelId] = (channelFollowerDeltas[channelId] ?? 0) + netSubscribers
      })
    }
  }

  const videoTotals = new Map()
  videoRows.forEach((row) => {
    const current =
      videoTotals.get(row.videoId) ?? { views: 0, engagements: 0, channelId: row.channelId }
    current.views += row.views
    current.engagements += row.likes + row.comments
    videoTotals.set(row.videoId, current)
  })

  const topVideoIds = [...videoTotals.entries()]
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, 10)
    .map(([videoId, info]) => ({ videoId, ...info }))

  const topVideoIdSet = new Set(topVideoIds.map((item) => item.videoId))
  const videoTitleMap = new Map()
  for (const [channelId, idSet] of videoIdsByChannel.entries()) {
    const ids = [...idSet].filter((id) => topVideoIdSet.has(id))
    if (!ids.length) continue
    const connection = connections.find((item) => item.channelId === channelId)
    if (!connection) continue
    const { accessToken } = await resolveAccessToken(connection)
    if (!accessToken) continue
    const details = await fetchYouTubeVideos(accessToken, ids.slice(0, 50))
    details.forEach((video) => {
      if (video.id) {
        videoTitleMap.set(video.id, video.title || 'Untitled video')
      }
    })
  }

  const topPosts = topVideoIds.map((item) => ({
    id: item.videoId,
    title: videoTitleMap.get(item.videoId) || 'Untitled video',
    platform: 'YouTube',
    views: item.views,
    engagementRate: item.views ? (item.engagements / item.views) * 100 : 0,
  }))

  const ageMap = new Map()
  const genderMap = new Map()
  demographicRows.forEach((row) => {
    const ageLabel = normalizeAgeLabel(row.ageGroup)
    const genderLabel = normalizeGenderLabel(row.gender)
    if (ageLabel) {
      const current = ageMap.get(ageLabel) ?? 0
      ageMap.set(ageLabel, current + (row.views || row.viewerPercentage))
    }
    if (genderLabel) {
      const current = genderMap.get(genderLabel) ?? 0
      genderMap.set(genderLabel, current + (row.views || row.viewerPercentage))
    }
  })

  const buildPercentList = (map) => {
    const total = [...map.values()].reduce((sum, value) => sum + value, 0)
    return [...map.entries()]
      .map(([label, value]) => ({
        label,
        value: total ? Math.round((value / total) * 100) : Math.round(value),
      }))
      .sort((a, b) => b.value - a.value)
  }

  const ageDistribution = buildPercentList(ageMap)
  const genderDistribution = buildPercentList(genderMap)

  const geoMap = new Map()
  geoRows.forEach((row) => {
    const label = resolveCountryLabel(row.country)
    if (!label) return
    const current = geoMap.get(label) ?? 0
    geoMap.set(label, current + (row.views || row.viewerPercentage))
  })

  const topGeos = buildPercentList(geoMap).slice(0, 5)

  return {
    timeSeries,
    topPosts,
    ageDistribution,
    genderDistribution,
    topGeos,
    channelFollowerDeltas,
  }
}

const buildLiveYouTubeSummary = async ({
  sessionId,
  connections,
  resolveAccessToken,
}) => {
  const resolveToken =
    typeof resolveAccessToken === 'function'
      ? resolveAccessToken
      : (connection) => ensureValidAccessToken(sessionId, connection)
  const channelSummaries = []
  const topVideos = []
  const recentVideos = []

  for (const connection of connections) {
    const { accessToken } = await resolveToken(connection)
    if (!accessToken) continue
    const channelInfo = await fetchYouTubeChannelInfo(accessToken, connection.channelId)
    if (!channelInfo?.id) continue

    const topVideoIds = await fetchYouTubeVideoIds(accessToken, channelInfo.id, 'viewCount', 6)
    const recentVideoIds = await fetchYouTubeVideoIds(accessToken, channelInfo.id, 'date', 8)

    const topVideoDetails = await fetchYouTubeVideos(accessToken, topVideoIds)
    const recentVideoDetails = await fetchYouTubeVideos(accessToken, recentVideoIds)

    topVideos.push(...topVideoDetails)
    recentVideos.push(...recentVideoDetails)

    const engagementRate = buildEngagementRate(topVideoDetails)
    const channelViews = toNumber(channelInfo?.statistics?.viewCount)
    const derivedViews = [...topVideoDetails, ...recentVideoDetails].reduce(
      (max, video) => Math.max(max, toNumber(video?.views)),
      0,
    )
    const views = channelViews > 0 ? channelViews : derivedViews
    const followers = channelInfo?.statistics?.hiddenSubscriberCount
      ? 0
      : toNumber(channelInfo?.statistics?.subscriberCount)

    channelSummaries.push({
      id: channelInfo.id,
      name: channelInfo.title || connection.channelName || 'YouTube Channel',
      platform: 'YouTube',
      views,
      engagementRate,
      followers,
      status: 'Connected',
    })
  }

  const fallbackTopPosts = topVideos
    .filter((video) => video.id)
    .sort((a, b) => b.views - a.views)
    .slice(0, 10)
    .map((video) => ({
      id: video.id,
      title: video.title || 'Untitled video',
      platform: 'YouTube',
      views: video.views,
      engagementRate: video.views ? ((video.likes + video.comments) / video.views) * 100 : 0,
    }))

  const fallbackTimeSeries = buildTimeSeries(recentVideos)
  let reportingSummary = {
    timeSeries: [],
    topPosts: [],
    ageDistribution: [],
    genderDistribution: [],
    topGeos: [],
    channelFollowerDeltas: {},
  }
  try {
    reportingSummary = await buildReportingSummary(sessionId, connections, {
      resolveAccessToken: resolveToken,
    })
  } catch (reportingError) {
    console.error('YouTube reporting summary failed:', reportingError)
  }

  let analyticsSummary = {
    timeSeries: [],
    ageDistribution: [],
    genderDistribution: [],
    topGeos: [],
  }
  try {
    analyticsSummary = await buildAnalyticsSummary(sessionId, connections, {
      resolveAccessToken: resolveToken,
    })
  } catch (analyticsError) {
    console.error('YouTube analytics summary failed:', analyticsError)
  }

  const followerDeltaByChannel = reportingSummary.channelFollowerDeltas ?? {}
  const hydratedChannels = channelSummaries.map((channel) => {
    const delta = followerDeltaByChannel[channel.id]
    return {
      ...channel,
      followersDelta30d: Number.isFinite(delta) ? delta : undefined,
    }
  })

  const hasNonZeroSeries = (series) =>
    Array.isArray(series)
      && series.some(
        (point) =>
          toNumber(point?.views) > 0 || toNumber(point?.engagements) > 0 || toNumber(point?.posts) > 0,
      )
  const resolvedTimeSeries = hasNonZeroSeries(analyticsSummary.timeSeries)
    ? analyticsSummary.timeSeries
    : hasNonZeroSeries(reportingSummary.timeSeries)
      ? reportingSummary.timeSeries
      : hasNonZeroSeries(fallbackTimeSeries)
        ? fallbackTimeSeries
        : analyticsSummary.timeSeries.length
          ? analyticsSummary.timeSeries
          : reportingSummary.timeSeries.length
            ? reportingSummary.timeSeries
            : fallbackTimeSeries

  return {
    channels: hydratedChannels,
    topPosts: reportingSummary.topPosts.length ? reportingSummary.topPosts : fallbackTopPosts,
    timeSeries: resolvedTimeSeries,
    ageDistribution: analyticsSummary.ageDistribution.length
      ? analyticsSummary.ageDistribution
      : reportingSummary.ageDistribution,
    genderDistribution: analyticsSummary.genderDistribution.length
      ? analyticsSummary.genderDistribution
      : reportingSummary.genderDistribution,
    topGeos: analyticsSummary.topGeos.length ? analyticsSummary.topGeos : reportingSummary.topGeos,
  }
}

const buildEmptyYouTubeSummary = () => ({
  channels: [],
  topPosts: [],
  timeSeries: [],
  ageDistribution: [],
  genderDistribution: [],
  topGeos: [],
})

const normalizeCachedSummaryPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return buildEmptyYouTubeSummary()
  const parsed = payload
  return {
    channels: Array.isArray(parsed.channels) ? parsed.channels : [],
    topPosts: Array.isArray(parsed.topPosts) ? parsed.topPosts : [],
    timeSeries: Array.isArray(parsed.timeSeries) ? parsed.timeSeries : [],
    ageDistribution: Array.isArray(parsed.ageDistribution) ? parsed.ageDistribution : [],
    genderDistribution: Array.isArray(parsed.genderDistribution) ? parsed.genderDistribution : [],
    topGeos: Array.isArray(parsed.topGeos) ? parsed.topGeos : [],
  }
}

const resolveYouTubeViewer = async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) return { ok: false, viewer }
  return { ok: true, viewer }
}

const parseIsoTime = (value) => {
  if (typeof value !== 'string' || !value.trim()) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const createAndStartYouTubeRefreshJob = async (
  userId,
  options = {},
) => {
  const trigger = typeof options.trigger === 'string' ? options.trigger : 'manual'
  const reuseRunning = options.reuseRunning !== false
  const minIntervalMs = Number.isFinite(options.minIntervalMs) ? Number(options.minIntervalMs) : 0

  const latestResult = await getLatestYouTubeRefreshJobByUserId(userId)
  if (latestResult.ok && latestResult.row) {
    const latest = latestResult.row
    const latestStatus = typeof latest.status === 'string' ? latest.status : ''
    if (reuseRunning && (latestStatus === 'queued' || latestStatus === 'running')) {
      return {
        ok: true,
        jobId: latest.id,
        status: latestStatus,
        deduped: true,
      }
    }

    if (minIntervalMs > 0) {
      const lastRequestedAt = parseIsoTime(latest.requested_at)
      if (lastRequestedAt > 0 && Date.now() - lastRequestedAt < minIntervalMs) {
        return {
          ok: true,
          jobId: latest.id,
          status: latestStatus || 'queued',
          deduped: true,
        }
      }
    }
  }

  const nowIso = new Date().toISOString()
  const insertResult = await insertYouTubeRefreshJob({
    user_id: userId,
    status: 'queued',
    requested_at: nowIso,
    channels_total: 0,
    channels_processed: 0,
    meta: { trigger },
  })
  if (!insertResult.ok || !insertResult.row?.id) {
    return {
      ok: false,
      status: insertResult.status || 500,
      error: 'youtube_refresh_job_create_failed',
      payload: insertResult.payload,
    }
  }

  const jobId = insertResult.row.id
  void runYouTubeRefreshJob(jobId, userId)
  return {
    ok: true,
    jobId,
    status: 'queued',
    deduped: false,
  }
}

const maybeQueueAutoYouTubeRefresh = async ({ userId, hasConnections, generatedAt }) => {
  if (!userId || !hasConnections) return { queued: false }
  const generatedAtMs = parseIsoTime(generatedAt)
  const isStale =
    generatedAtMs <= 0 || Date.now() - generatedAtMs >= YOUTUBE_AUTO_REFRESH_INTERVAL_MS
  if (!isStale) return { queued: false }

  const queued = await createAndStartYouTubeRefreshJob(userId, {
    trigger: 'auto',
    reuseRunning: true,
    minIntervalMs: YOUTUBE_AUTO_REFRESH_RETRY_COOLDOWN_MS,
  })
  if (!queued.ok) return { queued: false, error: queued.error || 'youtube_auto_refresh_enqueue_failed' }
  return {
    queued: true,
    jobId: queued.jobId,
    status: queued.status,
    deduped: queued.deduped,
  }
}

const runYouTubeRefreshJob = async (jobId, userId) => {
  if (!jobId || !userId) return

  const startedAt = new Date().toISOString()
  await updateYouTubeRefreshJob(userId, jobId, {
    status: 'running',
    started_at: startedAt,
    error_message: null,
  })

  try {
    const connectionResult = await loadSupabaseYouTubeConnections(userId)
    if (!connectionResult.ok) {
      throw new Error('Unable to load connected YouTube channels.')
    }
    const connections = connectionResult.connections
    const channelsTotal = connections.length
    await updateYouTubeRefreshJob(userId, jobId, {
      channels_total: channelsTotal,
      channels_processed: 0,
    })

    if (!channelsTotal) {
      const emptySummary = buildEmptyYouTubeSummary()
      await upsertCachedYouTubeSummary({
        userId,
        summary: emptySummary,
        generatedAt: new Date().toISOString(),
        refreshJobId: jobId,
      })
      await updateYouTubeRefreshJob(userId, jobId, {
        status: 'succeeded',
        channels_processed: 0,
        finished_at: new Date().toISOString(),
        meta: { message: 'No connected channels.' },
      })
      return
    }

    const sessionId = `sb-${userId}`
    const summary = await buildLiveYouTubeSummary({
      sessionId,
      connections,
      resolveAccessToken: (connection) => ensureValidAccessTokenForUser(userId, connection),
    })

    await upsertCachedYouTubeSummary({
      userId,
      summary,
      generatedAt: new Date().toISOString(),
      refreshJobId: jobId,
    })

    await updateYouTubeRefreshJob(userId, jobId, {
      status: 'succeeded',
      channels_processed: channelsTotal,
      finished_at: new Date().toISOString(),
      error_message: null,
      meta: {
        channels: channelsTotal,
        timeSeriesPoints: summary.timeSeries.length,
        topPosts: summary.topPosts.length,
      },
    })
  } catch (err) {
    await updateYouTubeRefreshJob(userId, jobId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_message: err instanceof Error ? err.message : 'YouTube refresh failed.',
    })
  }
}

app.post('/api/youtube/reporting/init', async (req, res) => {
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      ok: false,
      error: viewer.error || 'not_authenticated',
      message: viewer.message || 'Unable to authorize YouTube reporting initialization.',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const connectionsResult = await loadSupabaseYouTubeConnections(userId)
  if (!connectionsResult.ok) {
    res.status(500).json({ ok: false, error: 'youtube_connections_read_failed' })
    return
  }

  const connections = connectionsResult.connections
  if (!connections.length) {
    res.json({ ok: true, jobs: [] })
    return
  }

  const sessionId = `sb-${userId}`
  const jobs = []
  for (const connection of connections) {
    const { accessToken } = await ensureValidAccessTokenForUser(userId, connection)
    if (!accessToken) continue
    const jobsByType = await ensureReportingJobs(sessionId, connection, accessToken)
    jobs.push({ channelId: connection.channelId, jobs: jobsByType })
  }

  res.json({ ok: true, jobs })
})

app.get('/api/youtube/reporting/summary', async (req, res) => {
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      timeSeries: [],
      topPosts: [],
      ageDistribution: [],
      genderDistribution: [],
      topGeos: [],
      channelFollowerDeltas: {},
      error: viewer.error || 'not_authenticated',
    })
    return
  }
  const userId = viewerResult.viewer.userId
  const connectionsResult = await loadSupabaseYouTubeConnections(userId)
  if (!connectionsResult.ok) {
    res.status(500).json({
      timeSeries: [],
      topPosts: [],
      ageDistribution: [],
      genderDistribution: [],
      topGeos: [],
      channelFollowerDeltas: {},
      error: 'youtube_connections_read_failed',
    })
    return
  }

  const connections = connectionsResult.connections
  if (!connections.length) {
    res.json({
      timeSeries: [],
      topPosts: [],
      ageDistribution: [],
      genderDistribution: [],
      topGeos: [],
      channelFollowerDeltas: {},
    })
    return
  }

  try {
    const reportingSummary = await buildReportingSummary(`sb-${userId}`, connections, {
      resolveAccessToken: (connection) => ensureValidAccessTokenForUser(userId, connection),
    })
    res.json(reportingSummary)
  } catch (_err) {
    res.status(500).json({
      timeSeries: [],
      topPosts: [],
      ageDistribution: [],
      genderDistribution: [],
      topGeos: [],
      channelFollowerDeltas: {},
      error: 'youtube_reporting_failed',
    })
  }
})

app.post('/api/youtube/refresh', async (req, res) => {
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      error: viewer.error || 'not_authenticated',
      message: viewer.message || 'Unable to authorize refresh.',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const queued = await createAndStartYouTubeRefreshJob(userId, {
    trigger: 'manual',
    reuseRunning: true,
    minIntervalMs: 0,
  })
  if (!queued.ok) {
    res.status(queued.status || 500).json({
      error: queued.error || 'youtube_refresh_job_create_failed',
      details: queued.payload ?? null,
    })
    return
  }

  res.status(202).json({
    ok: true,
    jobId: queued.jobId,
    status: queued.status,
    deduped: Boolean(queued.deduped),
  })
})

app.get('/api/youtube/refresh/:jobId', async (req, res) => {
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      error: viewer.error || 'not_authenticated',
      message: viewer.message || 'Unable to authorize refresh status lookup.',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const jobId = typeof req.params?.jobId === 'string' ? req.params.jobId.trim() : ''
  if (!jobId) {
    res.status(400).json({ error: 'invalid_job_id' })
    return
  }

  const jobResult = await getYouTubeRefreshJob(userId, jobId)
  if (!jobResult.ok) {
    res.status(jobResult.status || 500).json({
      error: 'youtube_refresh_job_lookup_failed',
      details: jobResult.payload,
    })
    return
  }
  if (!jobResult.row) {
    res.status(404).json({ error: 'youtube_refresh_job_not_found' })
    return
  }

  res.json({
    id: jobResult.row.id,
    status: typeof jobResult.row.status === 'string' ? jobResult.row.status : 'queued',
    requestedAt: jobResult.row.requested_at ?? null,
    startedAt: jobResult.row.started_at ?? null,
    finishedAt: jobResult.row.finished_at ?? null,
    channelsTotal: toNumber(jobResult.row.channels_total),
    channelsProcessed: toNumber(jobResult.row.channels_processed),
    errorMessage: typeof jobResult.row.error_message === 'string' ? jobResult.row.error_message : '',
    meta: jobResult.row.meta && typeof jobResult.row.meta === 'object' ? jobResult.row.meta : {},
  })
})

app.get('/api/youtube/connections', async (req, res) => {
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      count: 0,
      connections: [],
      error: viewer.error || 'not_authenticated',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const connectionsResult = await loadSupabaseYouTubeConnections(userId)
  if (!connectionsResult.ok) {
    res.status(500).json({ count: 0, connections: [], error: 'youtube_connections_read_failed' })
    return
  }

  const connections = connectionsResult.connections
  const summarized = connections.map((connection) => ({
    channelId: connection.channelId,
    channelName: connection.channelName || 'YouTube Channel',
  }))
  res.json({ count: summarized.length, connections: summarized })
})

app.get('/api/youtube/summary', async (req, res) => {
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      ...buildEmptyYouTubeSummary(),
      error: viewer.error || 'not_authenticated',
      cacheStatus: 'error',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const cachedResult = await getCachedYouTubeSummaryByUserId(userId)
  if (!cachedResult.ok) {
    res.status(cachedResult.status || 500).json({
      ...buildEmptyYouTubeSummary(),
      error: 'youtube_cache_read_failed',
      cacheStatus: 'error',
    })
    return
  }

  const connectionsResult = await loadSupabaseYouTubeConnections(userId)
  const hasConnections = connectionsResult.ok ? connectionsResult.connections.length > 0 : false
  const generatedAtValue =
    typeof cachedResult.row?.generated_at === 'string' ? cachedResult.row.generated_at : ''
  const autoRefresh = await maybeQueueAutoYouTubeRefresh({
    userId,
    hasConnections,
    generatedAt: generatedAtValue,
  })

  if (!cachedResult.row?.summary_json) {
    res.json({
      ...buildEmptyYouTubeSummary(),
      cacheStatus: 'empty',
      generatedAt: null,
      autoRefresh: autoRefresh.queued
        ? {
            queued: true,
            jobId: autoRefresh.jobId ?? null,
            status: autoRefresh.status ?? 'queued',
          }
        : { queued: false },
    })
    return
  }

  const summary = normalizeCachedSummaryPayload(cachedResult.row.summary_json)
  res.json({
    ...summary,
    cacheStatus: 'ready',
    generatedAt: cachedResult.row.generated_at ?? null,
    autoRefresh: autoRefresh.queued
      ? {
          queued: true,
          jobId: autoRefresh.jobId ?? null,
          status: autoRefresh.status ?? 'queued',
        }
      : { queued: false },
  })
})

app.post('/api/youtube/disconnect', async (req, res) => {
  const payload = req.body ?? {}
  const channelNames = Array.isArray(payload.channelNames)
    ? payload.channelNames.filter((name) => typeof name === 'string' && name.trim())
    : []

  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      ok: false,
      error: viewer.error || 'not_authenticated',
      message: viewer.message || 'Unable to disconnect YouTube channels.',
    })
    return
  }
  const userId = viewerResult.viewer.userId
  const connectionsResult = await listYouTubeConnectionRowsByUserId(userId)
  if (!connectionsResult.ok) {
    res.status(connectionsResult.status || 500).json({
      ok: false,
      error: 'youtube_connections_read_failed',
    })
    return
  }
  const connections = connectionsResult.rows.map(mapYouTubeConnectionRow)

  if (!channelNames.length) {
    await deleteYouTubeConnectionsByUserId(userId)
    await deleteCachedYouTubeSummaryByUserId(userId)
    res.json({ ok: true, remaining: 0 })
    return
  }

  const blocked = new Set(channelNames.map((name) => normalizeChannelName(name)))
  const toDelete = connections.filter(
    (connection) => blocked.has(normalizeChannelName(connection.channelName)),
  )
  const remaining = connections.filter(
    (connection) => !blocked.has(normalizeChannelName(connection.channelName)),
  )
  if (toDelete.length) {
    await deleteYouTubeConnectionsByIds(userId, toDelete.map((connection) => connection.channelId))
  }
  await deleteCachedYouTubeSummaryByUserId(userId)
  res.json({ ok: true, remaining: remaining.length })
})

app.post('/auth/logout', async (req, res) => {
  const sessionId = getSessionId(req)
  if (sessionId) {
    const store = await loadReportingStore()
    if (store.sessions?.[sessionId]) {
      delete store.sessions[sessionId]
      await persistReportingStore()
    }
  }
  res.clearCookie('google_oauth_state')
  res.clearCookie('youtube_oauth_state')
  res.clearCookie(YOUTUBE_SESSION_COOKIE)
  res.clearCookie(YOUTUBE_CONNECTIONS_COOKIE)
  clearSupabaseSessionCookies(res)
  res.sendStatus(204)
})

const isServerlessRuntime = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME)

const runScheduledYouTubeAutoRefresh = async () => {
  if (!isSupabaseConfigured) return
  const selectFields = encodeURIComponent('user_id')
  const query = `select=${selectFields}`
  const result = await requestSupabaseTable('youtube_connections', { query })
  if (!result.ok || !Array.isArray(result.payload)) return
  const userIds = [...new Set(
    result.payload
      .map((row) => (typeof row?.user_id === 'string' ? row.user_id.trim() : ''))
      .filter((value) => value),
  )]
  for (const userId of userIds) {
    const cachedResult = await getCachedYouTubeSummaryByUserId(userId)
    const generatedAt =
      cachedResult.ok && typeof cachedResult.row?.generated_at === 'string'
        ? cachedResult.row.generated_at
        : ''
    await maybeQueueAutoYouTubeRefresh({
      userId,
      hasConnections: true,
      generatedAt,
    })
  }
}

if (!isServerlessRuntime) {
  void runScheduledYouTubeAutoRefresh()
  setInterval(() => {
    void runScheduledYouTubeAutoRefresh()
  }, 60 * 60 * 1000)
  app.listen(port, () => {
    console.log(`Auth server listening on ${serverBaseUrl}`)
  })
}

export { app }
