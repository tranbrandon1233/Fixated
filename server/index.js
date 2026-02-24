import 'dotenv/config'
import crypto from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { URLSearchParams } from 'node:url'
import path from 'node:path'
import cookieParser from 'cookie-parser'
import express from 'express'
import { collectInstagramMetricsWithPlaywright } from './instagramCollector.js'
import { INSTAGRAM_SELECTOR_VERSION } from './instagramSelectors.js'

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

const resolveDefaultBaseUrl = () => {
  const vercelUrl = normalizeEnvValue(process.env.VERCEL_URL)
  if (vercelUrl) {
    const withProtocol = /^https?:\/\//i.test(vercelUrl) ? vercelUrl : `https://${vercelUrl}`
    return normalizeBaseUrl(withProtocol)
  }
  return 'http://localhost:5000'
}

const defaultBaseUrl = resolveDefaultBaseUrl()
const serverBaseUrl = withFallbackUrl(getEnv('SERVER_BASE_URL', defaultBaseUrl), defaultBaseUrl)
const appBaseUrl = withFallbackUrl(getEnv('APP_BASE_URL', defaultBaseUrl), defaultBaseUrl)
const clientId = getEnv('GOOGLE_CLIENT_ID')
const clientSecret = getEnv('GOOGLE_CLIENT_SECRET')
const redirectUri = getEnv(
  'GOOGLE_REDIRECT_URI',
  getEnv('SUPABASE_REDIRECT_URI', `${serverBaseUrl}/oauth/google/callback`),
)
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
const instagramAppId = getEnv('INSTAGRAM_APP_ID')
const instagramClientToken = getEnv('INSTAGRAM_CLIENT_TOKEN')
const instagramAppToken = getEnv('INSTAGRAM_APP_TOKEN')
const instagramAccessToken = getEnv('INSTAGRAM_ACCESS_TOKEN')
const instagramFacebookPageId = getEnv('FB_PAGE_ID')
const instagramRedirectUri = getEnv('INSTAGRAM_REDIRECT_URI', `${serverBaseUrl}/oauth/instagram/callback`)
const instagramGraphApiVersion = getEnv('INSTAGRAM_GRAPH_API_VERSION', 'v22.0')
const defaultInstagramOauthScope =
  'pages_show_list,pages_read_engagement,instagram_business_basic'
const normalizeInstagramOauthScope = (value) => {
  const normalizedValue = String(value ?? '').trim().toLowerCase().slice(0, 500)
  const inputScopes = normalizedValue
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => Boolean(scope))
  const allowedScopes = new Set([
    'pages_show_list',
    'pages_read_engagement',
    'instagram_business_basic',
    'instagram_content_publish',
    'instagram_manage_comments',
    'instagram_manage_messages',
    'business_management',
  ])
  const normalizedScopes = []
  for (const scope of inputScopes) {
    if (!allowedScopes.has(scope)) continue
    if (!normalizedScopes.includes(scope)) {
      normalizedScopes.push(scope)
    }
  }
  if (normalizedScopes.length) return normalizedScopes.join(',')
  return defaultInstagramOauthScope
}
const instagramOauthScope = normalizeInstagramOauthScope(
  getEnv('INSTAGRAM_OAUTH_SCOPE', defaultInstagramOauthScope),
)
const instagramOauthAuthorizeUrl = getEnv(
  'INSTAGRAM_OAUTH_AUTHORIZE_URL',
  'https://www.facebook.com/v25.0/dialog/oauth',
)
const instagramOauthEnableFbLogin = getEnv('INSTAGRAM_OAUTH_ENABLE_FB_LOGIN')
const instagramOauthForceAuthentication = getEnv('INSTAGRAM_OAUTH_FORCE_AUTHENTICATION')
const instagramOauthEnableBasicDisplayProbe = getEnv('INSTAGRAM_OAUTH_ENABLE_BASIC_DISPLAY_PROBE', 'false').toLowerCase() === 'true'
const instagramAppSecret = getEnv('INSTAGRAM_APP_SECRET')
if (instagramAppToken && !instagramAppSecret) {
  console.warn('INSTAGRAM_APP_TOKEN is set but OAuth requires INSTAGRAM_APP_SECRET for client_secret.')
}
const resolveInstagramOauthAuthorizeUrl = (rawUrl, rawScope) => {
  const normalizedScope = normalizeTextInput(rawScope, { maxLength: 500 }).toLowerCase()
  const isBusinessScope = normalizedScope.includes('instagram_business')
  const fallbackUrl = isBusinessScope
    ? 'https://www.facebook.com/v25.0/dialog/oauth'
    : 'https://www.facebook.com/v25.0/dialog/oauth'
  const normalizedRaw = normalizeTextInput(rawUrl, { maxLength: 500 })
  if (!normalizedRaw) return fallbackUrl
  try {
    const parsed = new URL(normalizedRaw)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== 'https:' && protocol !== 'http:') {
      return fallbackUrl
    }
    const host = parsed.hostname.toLowerCase()
    if (host !== 'www.facebook.com') {
      return fallbackUrl
    }
    const resolvedPath = parsed.pathname.replace(/\/+$/, '').toLowerCase()
    const isDialogOauthPath =
      resolvedPath === '/dialog/oauth'
      || /^\/v\d+(?:\.\d+)?\/dialog\/oauth$/.test(resolvedPath)
    if (!isDialogOauthPath) {
      return fallbackUrl
    }
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return fallbackUrl
  }
}

const resolveFacebookGraphOauthTokenUrl = () => {
  const normalizedVersion = normalizeTextInput(instagramGraphApiVersion, { maxLength: 24 }).toLowerCase()
  const parsedVersion = normalizedVersion.replace(/^v/, '')
  const safeVersion = /^\d+(?:\.\d+)?$/.test(parsedVersion) ? `v${parsedVersion}` : 'v22.0'
  return `https://graph.facebook.com/${safeVersion}/oauth/access_token`
}
// Instagram OAuth optional flags are intentionally not forwarded by default.
// Meta may reject authorize requests for some app setups when these are present.
const instagramCollectorMode = getEnv(
  'INSTAGRAM_COLLECTOR_MODE',
  instagramAccessToken ? 'graph' : 'playwright',
).toLowerCase()
const instagramCollectionEnabled = getEnv(
  'INSTAGRAM_COLLECTION_ENABLED',
  instagramAccessToken ? 'true' : 'false',
).toLowerCase() === 'true'
const instagramUsername = getEnv('INSTAGRAM_USERNAME')
const instagramPassword = getEnv('INSTAGRAM_PWD')
const instagramSessionEncryptionKey = getEnv('INSTAGRAM_SESSION_ENCRYPTION_KEY')
const instagramCollectorMaxPosts = Math.max(1, Math.min(50, Number(getEnv('INSTAGRAM_COLLECTOR_MAX_POSTS', '12')) || 12))
const instagramCollectorTimeoutMs = Math.max(
  10_000,
  Math.min(120_000, Number(getEnv('INSTAGRAM_COLLECTOR_TIMEOUT_MS', '45000')) || 45_000),
)
const instagramRefreshMaxConcurrency = Math.max(
  1,
  Math.min(8, Number(getEnv('INSTAGRAM_REFRESH_MAX_CONCURRENCY', '2')) || 2),
)
const instagramCollectorMaxRetries = Math.max(
  0,
  Math.min(4, Number(getEnv('INSTAGRAM_COLLECTOR_MAX_RETRIES', '2')) || 2),
)
const instagramCollectorRetryBaseDelayMs = Math.max(
  200,
  Math.min(15_000, Number(getEnv('INSTAGRAM_COLLECTOR_RETRY_BASE_DELAY_MS', '1200')) || 1200),
)
const instagramCollectorRetryJitterMs = Math.max(
  50,
  Math.min(15_000, Number(getEnv('INSTAGRAM_COLLECTOR_RETRY_JITTER_MS', '500')) || 500),
)
const instagramRateLimitWindowMs = Math.max(
  10_000,
  Math.min(10 * 60 * 1000, Number(getEnv('INSTAGRAM_RATE_LIMIT_WINDOW_MS', '60000')) || 60_000),
)
const instagramRefreshRateLimitMax = Math.max(
  1,
  Math.min(60, Number(getEnv('INSTAGRAM_REFRESH_RATE_LIMIT_MAX', '8')) || 8),
)
const instagramSessionRateLimitMax = Math.max(
  1,
  Math.min(60, Number(getEnv('INSTAGRAM_SESSION_RATE_LIMIT_MAX', '12')) || 12),
)
const instagramAlertFailureStreakThreshold = Math.max(
  2,
  Math.min(20, Number(getEnv('INSTAGRAM_ALERT_FAILURE_STREAK_THRESHOLD', '3')) || 3),
)
const instagramAlertFailureRateThresholdPct = Math.max(
  5,
  Math.min(100, Number(getEnv('INSTAGRAM_ALERT_FAILURE_RATE_THRESHOLD_PCT', '50')) || 50),
)
const instagramAlertFailureRateMinRuns = Math.max(
  3,
  Math.min(200, Number(getEnv('INSTAGRAM_ALERT_FAILURE_RATE_MIN_RUNS', '5')) || 5),
)
const instagramOpsRunWindowMs = Math.max(
  60_000,
  Math.min(24 * 60 * 60 * 1000, Number(getEnv('INSTAGRAM_OPS_RUN_WINDOW_MS', '21600000')) || 6 * 60 * 60 * 1000),
)
const instagramOpsRecentRunLimit = Math.max(
  20,
  Math.min(1000, Number(getEnv('INSTAGRAM_OPS_RECENT_RUN_LIMIT', '200')) || 200),
)
const instagramOpsRecentAlertLimit = Math.max(
  10,
  Math.min(500, Number(getEnv('INSTAGRAM_OPS_RECENT_ALERT_LIMIT', '100')) || 100),
)
const instagramOpsRecentRunsPerAccount = Math.max(
  3,
  Math.min(50, Number(getEnv('INSTAGRAM_OPS_RECENT_RUNS_PER_ACCOUNT', '15')) || 15),
)
const instagramOpsRecentAlertsPerAccount = Math.max(
  3,
  Math.min(50, Number(getEnv('INSTAGRAM_OPS_RECENT_ALERTS_PER_ACCOUNT', '12')) || 12),
)
const decodeMaybeUriEncodedToken = (value) => {
  const normalized = normalizeEnvValue(value)
  if (!normalized) return ''
  try {
    const decoded = decodeURIComponent(normalized)
    return decoded || normalized
  } catch {
    return normalized
  }
}
const xApiBaseUrl = withFallbackUrl(getEnv('X_API_BASE_URL', 'https://api.x.com/2'), 'https://api.x.com/2')
const xApiFallbackBaseUrl = withFallbackUrl(
  getEnv('X_API_FALLBACK_BASE_URL', 'https://api.twitter.com/2'),
  'https://api.twitter.com/2',
)
const xOauthClientId = getEnv('X_CLIENT_ID', getEnv('X_CLIENT_SECRET_ID'))
const xOauthClientSecret = getEnv('X_CLIENT_SECRET')
const xOauthEncryptionKey = getEnv(
  'X_OAUTH_ENCRYPTION_KEY',
  getEnv('INSTAGRAM_SESSION_ENCRYPTION_KEY', getEnv('SUPABASE_SECRET_KEY', getEnv('SUPABASE_SERVICE_ROLE_KEY'))),
)
const xOauthRedirectUri = getEnv(
  'X_REDIRECT_URI',
  getEnv('X_REDIRECT_URL', `${serverBaseUrl}/oauth/x/callback`),
)
const requiredXOauthScopes = ['users.read', 'tweet.read', 'offline.access']
const defaultXOauthScope = 'users.read tweet.read offline.access'
const tokenizeXOauthScope = (value) =>
  String(value ?? '')
    .toLowerCase()
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => Boolean(scope))
const normalizeXOauthScope = (value) => {
  const normalizedValue = String(value ?? '').trim().toLowerCase().slice(0, 500)
  const inputScopes = normalizedValue
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => Boolean(scope))
  const normalizedScopes = []
  for (const scope of inputScopes) {
    if (!/^[a-z0-9._:-]{1,64}$/i.test(scope)) continue
    if (!normalizedScopes.includes(scope)) {
      normalizedScopes.push(scope)
    }
  }
  for (const requiredScope of requiredXOauthScopes) {
    if (!normalizedScopes.includes(requiredScope)) {
      normalizedScopes.push(requiredScope)
    }
  }
  if (normalizedScopes.length) return normalizedScopes.join(' ')
  return defaultXOauthScope
}
const hasRequiredXOauthScopes = (scopeValue, requiredScopes = []) => {
  const scopeSet = new Set(tokenizeXOauthScope(scopeValue))
  return requiredScopes.every((requiredScope) => scopeSet.has(String(requiredScope || '').toLowerCase()))
}
const xOauthScope = normalizeXOauthScope(getEnv('X_OAUTH_SCOPE', defaultXOauthScope))
const xOauthAuthorizeUrl = getEnv('X_OAUTH_AUTHORIZE_URL', 'https://x.com/i/oauth2/authorize')
const xOauthTokenUrl = withFallbackUrl(
  getEnv('X_OAUTH_TOKEN_URL', 'https://api.x.com/2/oauth2/token'),
  'https://api.x.com/2/oauth2/token',
)
const xOauthTokenFallbackUrl = withFallbackUrl(
  getEnv('X_OAUTH_TOKEN_FALLBACK_URL', 'https://api.twitter.com/2/oauth2/token'),
  'https://api.twitter.com/2/oauth2/token',
)
const xBearerToken = decodeMaybeUriEncodedToken(
  getEnv(
    'X_BEARER_TOKEN',
    getEnv(
      'X_API_BEARER_TOKEN',
      getEnv('TWITTER_BEARER_TOKEN'),
    ),
  ),
)
const xCollectionEnabled = getEnv(
  'X_COLLECTION_ENABLED',
  xBearerToken || xOauthClientId ? 'true' : 'false',
).toLowerCase() === 'true'
const xCollectorMaxPosts = Math.max(5, Math.min(100, Number(getEnv('X_COLLECTOR_MAX_POSTS', '50')) || 50))
const supabaseUrl = withFallbackUrl(
  getEnv(
    'SUPABASE_URL',
    getEnv('NEXT_PUBLIC_SUPABASE_URL', getEnv('VITE_SUPABASE_URL', getEnv('SUPABASE_PROJECT_URL'))),
  ),
  '',
)
const supabasePublishableKey = getEnv(
  'SUPABASE_PUBLISHABLE_KEY',
  getEnv('SUPABASE_ANON_KEY', getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', getEnv('VITE_SUPABASE_ANON_KEY'))),
)
const supabaseSecretKey = getEnv(
  'SUPABASE_SECRET_KEY',
  getEnv('SUPABASE_SERVICE_ROLE_KEY', getEnv('SUPABASE_SERVICE_ROLE')),
)
const supabaseServiceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', getEnv('SUPABASE_SERVICE_ROLE'))
const isJwtTokenLike = (value) => {
  const normalized = normalizeEnvValue(value)
  if (!normalized) return false
  return /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(normalized)
}
const resolveSupabaseServiceAuthorizationKey = () => {
  if (isJwtTokenLike(supabaseSecretKey)) return supabaseSecretKey
  if (isJwtTokenLike(supabaseServiceRoleKey)) return supabaseServiceRoleKey
  return ''
}
const supabaseServiceAuthorizationKey = resolveSupabaseServiceAuthorizationKey()
const buildSupabaseServiceAuthorizationHeader = () =>
  supabaseServiceAuthorizationKey ? { Authorization: `Bearer ${supabaseServiceAuthorizationKey}` } : {}
const hasSupabaseUrl = Boolean(supabaseUrl)
const hasSupabasePublishableKey = Boolean(supabasePublishableKey)
const hasSupabaseSecretKey = Boolean(supabaseSecretKey)
const isSupabaseConfigured = Boolean(hasSupabaseUrl && hasSupabasePublishableKey && hasSupabaseSecretKey)
const getMissingSupabaseConfigKeys = () => {
  const missing = []
  if (!hasSupabaseUrl) missing.push('SUPABASE_URL')
  if (!hasSupabasePublishableKey) missing.push('SUPABASE_PUBLISHABLE_KEY')
  if (!hasSupabaseSecretKey) missing.push('SUPABASE_SECRET_KEY')
  return missing
}
const buildSupabaseConfigDiagnostic = () => ({
  configured: isSupabaseConfigured,
  hasUrl: hasSupabaseUrl,
  hasPublishableKey: hasSupabasePublishableKey,
  hasSecretKey: hasSupabaseSecretKey,
  publishableKeyFormat: isJwtTokenLike(supabasePublishableKey) ? 'jwt' : 'opaque',
  secretKeyFormat: isJwtTokenLike(supabaseSecretKey) ? 'jwt' : 'opaque',
  hasServiceAuthorizationKey: Boolean(supabaseServiceAuthorizationKey),
  urlHost: (() => {
    try {
      return supabaseUrl ? new URL(supabaseUrl).host : ''
    } catch {
      return ''
    }
  })(),
  missingKeys: getMissingSupabaseConfigKeys(),
})
const parseSupabaseProbeError = (payload) => ({
  code: normalizeTextInput(payload?.code, { maxLength: 120 }),
  message:
    normalizeTextInput(payload?.message, { maxLength: 240 })
    || normalizeTextInput(payload?.error_description, { maxLength: 240 })
    || normalizeTextInput(payload?.error, { maxLength: 240 }),
})
const isTruthyProbeValue = (value) => {
  const normalized = normalizeTextInput(value, { maxLength: 12 }).toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}
const probeSupabaseConnectivity = async () => {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'supabase_not_configured' }
  }
  const probes = {
    authSettings: { ok: false, status: 0, code: '', message: '' },
    authTokenExchange: { ok: false, status: 0, code: '', message: '' },
    restOpenApi: { ok: false, status: 0, code: '', message: '' },
  }
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabasePublishableKey },
    })
    const payload = await response.json().catch(() => null)
    const err = parseSupabaseProbeError(payload)
    probes.authSettings = {
      ok: response.ok,
      status: response.status,
      code: err.code,
      message: err.message,
    }
  } catch (error) {
    probes.authSettings = {
      ok: false,
      status: 0,
      code: 'fetch_failed',
      message: error instanceof Error ? normalizeTextInput(error.message, { maxLength: 240 }) : 'request_failed',
    }
  }
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=id_token`, {
      method: 'POST',
      headers: {
        apikey: supabasePublishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'google',
        id_token: 'health-probe-invalid-token',
      }),
    })
    const payload = await response.json().catch(() => null)
    const err = parseSupabaseProbeError(payload)
    probes.authTokenExchange = {
      ok: response.ok || response.status === 400,
      status: response.status,
      code: err.code,
      message: err.message,
    }
  } catch (error) {
    probes.authTokenExchange = {
      ok: false,
      status: 0,
      code: 'fetch_failed',
      message: error instanceof Error ? normalizeTextInput(error.message, { maxLength: 240 }) : 'request_failed',
    }
  }
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: supabaseSecretKey,
        Accept: 'application/openapi+json',
        ...buildSupabaseServiceAuthorizationHeader(),
      },
    })
    const payload = await response.json().catch(() => null)
    const err = parseSupabaseProbeError(payload)
    probes.restOpenApi = {
      ok: response.ok,
      status: response.status,
      code: err.code,
      message: err.message,
    }
  } catch (error) {
    probes.restOpenApi = {
      ok: false,
      status: 0,
      code: 'fetch_failed',
      message: error instanceof Error ? normalizeTextInput(error.message, { maxLength: 240 }) : 'request_failed',
    }
  }
  return {
    ok: probes.authSettings.ok && probes.authTokenExchange.ok && probes.restOpenApi.ok,
    probes,
  }
}
const INTERNAL_REFRESH_RUNNER_HEADER = 'x-fixated-refresh-runner-token'
const INTERNAL_REFRESH_RUNNER_FUNCTION_PATH = getEnv(
  'INTERNAL_REFRESH_RUNNER_FUNCTION_PATH',
  '/internal/refresh-job-runner-background',
)
const buildInternalRefreshRunnerToken = () => {
  const explicit = getEnv('INTERNAL_REFRESH_RUNNER_TOKEN')
  if (explicit) return explicit
  if (!supabaseSecretKey) return ''
  return crypto
    .createHash('sha256')
    .update(`fixated:refresh-runner:${supabaseSecretKey}`)
    .digest('hex')
}
const internalRefreshRunnerToken = buildInternalRefreshRunnerToken()

const parsedServerUrl = new URL(serverBaseUrl)
const port = Number(getEnv('PORT', parsedServerUrl.port || '5000'))
const isProd = getEnv('NODE_ENV') === 'production'
const resolveCookieSiteKey = (value) => {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return `${parsed.protocol}//${parsed.hostname}`
  } catch {
    return ''
  }
}
const appCookieSiteKey = resolveCookieSiteKey(appBaseUrl)
const serverCookieSiteKey = resolveCookieSiteKey(serverBaseUrl)
const isCrossSiteCookieContext = Boolean(
  appCookieSiteKey
  && serverCookieSiteKey
  && appCookieSiteKey !== serverCookieSiteKey,
)
const supportsSecureCrossSiteCookies =
  appCookieSiteKey.startsWith('https://') && serverCookieSiteKey.startsWith('https://')
const allowCrossSiteCookies = isProd || (isCrossSiteCookieContext && supportsSecureCrossSiteCookies)
const cookieSameSite = allowCrossSiteCookies ? 'none' : 'lax'
const cookieSecure = allowCrossSiteCookies || isProd
const YOUTUBE_CONNECTIONS_COOKIE = 'youtube_connections'
const YOUTUBE_SESSION_COOKIE = 'youtube_session_id'
const APP_REDIRECT_COOKIE = 'app_redirect_origin'
const GOOGLE_OAUTH_CONTEXT_COOKIE = 'google_oauth_context'
const YOUTUBE_OAUTH_CONTEXT_COOKIE = 'youtube_oauth_context'
const INSTAGRAM_OAUTH_CONTEXT_COOKIE = 'instagram_oauth_context'
const INSTAGRAM_OAUTH_STATE_COOKIE = 'instagram_oauth_state'
const X_OAUTH_CONTEXT_COOKIE = 'x_oauth_context'
const X_OAUTH_STATE_COOKIE = 'x_oauth_state'
const INSTAGRAM_OAUTH_STATE_VERSION = 'v1'
const INSTAGRAM_OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const X_OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const SUPABASE_ACCESS_TOKEN_COOKIE = 'sb_access_token'
const SUPABASE_REFRESH_TOKEN_COOKIE = 'sb_refresh_token'
const YOUTUBE_AUTO_REFRESH_INTERVAL_MS = 60 * 60 * 1000
const YOUTUBE_AUTO_REFRESH_RETRY_COOLDOWN_MS = 10 * 60 * 1000
const INSTAGRAM_AUTO_REFRESH_INTERVAL_MS = 60 * 60 * 1000
const INSTAGRAM_AUTO_REFRESH_RETRY_COOLDOWN_MS = 10 * 60 * 1000
const REFRESH_JOB_STALE_TIMEOUT_MS = 15 * 60 * 1000
const YOUTUBE_CHANNEL_REFRESH_TIMEOUT_MS = Math.max(
  30_000,
  Math.min(10 * 60 * 1000, Number(getEnv('YOUTUBE_CHANNEL_REFRESH_TIMEOUT_MS', '180000')) || 180_000),
)
const REFRESH_LIMIT_PER_24H = 10
const REFRESH_WINDOW_DURATION_MS = 24 * 60 * 60 * 1000
const EXPORT_PREVIEW_TTL_MS = 30 * 60 * 1000
const EXPORT_PREVIEW_MAX_ENTRIES = 64
const EXPORT_PREVIEW_MAX_BASE64_SIZE = 20 * 1024 * 1024
const EXPORT_PREVIEW_STORAGE_BUCKET = 'export-previews'
const EXPORT_PREVIEW_STORAGE_PREFIX = 'previews'
const MAX_INPUT_LIST_SIZE = 500
const exportPreviewStore = new Map()
let exportPreviewStorageBucketReady = false
const ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE = 'YouTube'
const ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM = 'Instagram'
const ORGANIZATION_CONNECTION_PLATFORM_X = 'X'
const instagramEndpointRateLimitBuckets = new Map()
const instagramRefreshRunningUsers = new Set()
const instagramOpsState = {
  runs: [],
  alerts: [],
  failureStreakByUser: new Map(),
}
const instagramGraphConnectionCandidateCache = {
  token: '',
  expiresAtMs: 0,
  candidates: [],
}
const instagramGraphAccessTokenByConnectionKey = new Map()

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

const safeTimingEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  try {
    const leftBuffer = Buffer.from(left)
    const rightBuffer = Buffer.from(right)
    if (leftBuffer.length !== rightBuffer.length) return false
    return crypto.timingSafeEqual(leftBuffer, rightBuffer)
  } catch {
    return false
  }
}

const buildInstagramOauthStateToken = ({
  userId = '',
  organizationId = '',
  redirectUri = '',
  issuedAtMs = Date.now(),
} = {}) => {
  if (!instagramAppSecret) return ''
  if (!isUuid(userId) || !isUuid(organizationId)) return ''
  const normalizedRedirectUri = normalizeTextInput(redirectUri, { maxLength: 500 })
  const payload = {
    v: INSTAGRAM_OAUTH_STATE_VERSION,
    iat: Math.max(0, Math.floor(Number(issuedAtMs) || Date.now())),
    nonce: crypto.randomBytes(12).toString('hex'),
    userId,
    organizationId,
    redirectUri: normalizedRedirectUri,
  }
  const payloadJson = JSON.stringify(payload)
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url')
  const signature = crypto
    .createHmac('sha256', instagramAppSecret)
    .update(payloadB64)
    .digest('base64url')
  return `${INSTAGRAM_OAUTH_STATE_VERSION}.${payloadB64}.${signature}`
}

const verifyInstagramOauthStateToken = (rawState, { nowMs = Date.now() } = {}) => {
  const normalized = normalizeTextInput(rawState, { maxLength: 4000, trim: true })
  if (!normalized) return { ok: false, reason: 'missing' }
  const segments = normalized.split('.')
  if (segments.length !== 3) return { ok: false, reason: 'format' }
  const [version, payloadB64, signature] = segments
  if (version !== INSTAGRAM_OAUTH_STATE_VERSION || !payloadB64 || !signature) {
    return { ok: false, reason: 'version_or_segments' }
  }
  if (!instagramAppSecret) return { ok: false, reason: 'missing_secret' }
  const expectedSignature = crypto
    .createHmac('sha256', instagramAppSecret)
    .update(payloadB64)
    .digest('base64url')
  if (!safeTimingEqual(signature, expectedSignature)) {
    return { ok: false, reason: 'signature' }
  }
  let parsedPayload = null
  try {
    const decodedPayload = Buffer.from(payloadB64, 'base64url').toString('utf8')
    parsedPayload = JSON.parse(decodedPayload)
  } catch {
    return { ok: false, reason: 'payload_parse' }
  }
  if (!parsedPayload || typeof parsedPayload !== 'object') {
    return { ok: false, reason: 'payload_shape' }
  }
  const issuedAtMs = Math.max(0, Number(parsedPayload.iat) || 0)
  if (!issuedAtMs) return { ok: false, reason: 'issued_at' }
  if (issuedAtMs > nowMs + 30_000) return { ok: false, reason: 'issued_in_future' }
  if (nowMs - issuedAtMs > INSTAGRAM_OAUTH_STATE_TTL_MS) return { ok: false, reason: 'expired' }
  const userId = normalizeTextInput(parsedPayload.userId, { maxLength: 80 })
  const organizationId = normalizeTextInput(parsedPayload.organizationId, { maxLength: 80 })
  const redirectUri = normalizeTextInput(parsedPayload.redirectUri, { maxLength: 500 })
  if (!isUuid(userId) || !isUuid(organizationId)) {
    return { ok: false, reason: 'identity' }
  }
  return {
    ok: true,
    payload: {
      userId,
      organizationId,
      redirectUri,
      issuedAtMs,
    },
  }
}

const normalizeChannelName = (value) => String(value ?? '').trim().toLowerCase()
const normalizeInstagramHandle = (value) => {
  const normalizedInput = normalizeTextInput(value, { maxLength: 240 }).toLowerCase()
  if (!normalizedInput) return ''

  let candidate = normalizedInput
  const withProtocol =
    candidate.startsWith('https://') || candidate.startsWith('http://')
      ? candidate
      : `https://${candidate}`
  try {
    const parsed = new URL(withProtocol)
    const host = normalizeTextInput(parsed.hostname, { maxLength: 255 }).toLowerCase()
    if (host === 'instagram.com' || host === 'www.instagram.com') {
      const pathSegments = parsed.pathname
        .split('/')
        .map((segment) => normalizeTextInput(segment, { maxLength: 120 }).toLowerCase())
        .filter((segment) => Boolean(segment))
      if (pathSegments.length > 0) {
        candidate = pathSegments[0]
      }
    }
  } catch {
    candidate = candidate.replace(/^https?:\/\//, '')
  }

  return candidate
    .replace(/^@+/, '')
    .replace(/^www\./, '')
    .replace(/^instagram\.com\//, '')
    .split(/[/?#]/)[0]
    .replace(/[^a-z0-9._]/g, '')
}

const resolveInstagramAccountId = (account) => {
  const explicitId = normalizeTextInput(account?.channelId, { maxLength: 300 })
  if (explicitId) return explicitId.toLowerCase()
  const fromName = normalizeInstagramHandle(account?.accountName)
  return fromName
}

const normalizeXUserId = (value) => {
  let raw = ''
  if (typeof value === 'string') {
    raw = value
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    raw = value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
  } else if (typeof value === 'bigint') {
    raw = value.toString()
  } else if (value !== null && value !== undefined) {
    raw = String(value)
  }
  return raw.replace(/[^0-9]/g, '').slice(0, 30)
}

const normalizeXUsername = (value) => {
  const normalizedInput = normalizeTextInput(value, { maxLength: 240 }).toLowerCase()
  if (!normalizedInput) return ''

  let candidate = normalizedInput
  const withProtocol =
    candidate.startsWith('https://') || candidate.startsWith('http://')
      ? candidate
      : `https://${candidate}`
  try {
    const parsed = new URL(withProtocol)
    const host = normalizeTextInput(parsed.hostname, { maxLength: 255 }).toLowerCase()
    if (host === 'x.com' || host === 'www.x.com' || host === 'twitter.com' || host === 'www.twitter.com') {
      const pathSegments = parsed.pathname
        .split('/')
        .map((segment) => normalizeTextInput(segment, { maxLength: 120 }).toLowerCase())
        .filter((segment) => Boolean(segment))
      if (pathSegments.length > 0) {
        candidate = pathSegments[0]
      }
    }
  } catch {
    candidate = candidate.replace(/^https?:\/\//, '')
  }

  return candidate
    .replace(/^@+/, '')
    .replace(/^www\./, '')
    .replace(/^x\.com\//, '')
    .replace(/^twitter\.com\//, '')
    .split(/[/?#]/)[0]
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 15)
}

const isValidXUsername = (value) => /^[a-z0-9_]{1,15}$/.test(normalizeXUsername(value))
const formatXAccountName = (username) => {
  const normalizedUsername = normalizeXUsername(username)
  return normalizedUsername ? `@${normalizedUsername}` : ''
}
const resolveXUserIdFromConnection = (account) =>
  normalizeXUserId(account?.channelId) || normalizeXUserId(account?.userId)
const resolveXUsernameFromConnection = (account) => {
  const explicitUsernameRaw = normalizeTextInput(account?.username, { maxLength: 120 })
  if (/^@?[a-z0-9_]{1,15}$/i.test(explicitUsernameRaw)) {
    const explicitUsername = normalizeXUsername(explicitUsernameRaw)
    if (isValidXUsername(explicitUsername)) return explicitUsername
  }
  const accountNameRaw = normalizeTextInput(account?.accountName, { maxLength: 180 })
  if (
    /^@?[a-z0-9_]{1,15}$/i.test(accountNameRaw)
    || /^https?:\/\/(www\.)?(x|twitter)\.com\//i.test(accountNameRaw)
  ) {
    const accountNameUsername = normalizeXUsername(accountNameRaw)
    if (isValidXUsername(accountNameUsername)) return accountNameUsername
  }
  const channelIdRaw = normalizeTextInput(account?.channelId, { maxLength: 300 })
  if (
    /^@?[a-z0-9_]{1,15}$/i.test(channelIdRaw)
    || /^https?:\/\/(www\.)?(x|twitter)\.com\//i.test(channelIdRaw)
  ) {
    const channelIdUsername = normalizeXUsername(channelIdRaw)
    if (isValidXUsername(channelIdUsername)) return channelIdUsername
  }
  return ''
}
const resolveXChannelIdFromConnectedAccount = (account, fallbackUserId = '') => {
  const xUserIdFromConnection = resolveXUserIdFromConnection(account)
  if (xUserIdFromConnection) return `x:${xUserIdFromConnection}`
  const xUsernameFromConnection = resolveXUsernameFromConnection(account)
  if (isValidXUsername(xUsernameFromConnection)) return `x:${xUsernameFromConnection}`
  const normalizedFallbackUserId = normalizeXUserId(fallbackUserId)
  if (normalizedFallbackUserId) return `x:${normalizedFallbackUserId}`
  return ''
}
const resolveXUserIdFromStoredPostsPayload = (value) => {
  const sourceEntries = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && !Array.isArray(value)
      ? Object.values(value)
      : []
  for (const entry of sourceEntries.slice(0, xCollectorMaxPosts)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const candidate = normalizeXUserId(
      entry.userId
      || entry.user_id
      || entry.authorId
      || entry.author_id,
    )
    if (candidate) return candidate
  }
  return ''
}

const buildInstagramVaultKey = ({ ownerUserId = '', accountId = '' }) => {
  const normalizedOwner = normalizeTextInput(ownerUserId, { maxLength: 80 })
  const normalizedAccountId = normalizeTextInput(accountId, { maxLength: 300 }).toLowerCase()
  if (!normalizedOwner || !normalizedAccountId) return ''
  return `${normalizedOwner}:${normalizedAccountId}`
}

const normalizeOrganizationConnectionPlatform = (value) => {
  const normalized = normalizeTextInput(value, { maxLength: 24 }).toLowerCase()
  if (normalized === 'instagram') return ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM
  if (
    normalized === 'x'
    || normalized === 'twitter'
    || normalized === 'x/twitter'
    || normalized === 'xtwitter'
  ) {
    return ORGANIZATION_CONNECTION_PLATFORM_X
  }
  return ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE
}

const buildOrganizationConnectionId = (platform) => {
  const normalizedPlatform = normalizeOrganizationConnectionPlatform(platform).toLowerCase()
  return `${normalizedPlatform}:${crypto.randomUUID()}`
}

const normalizeOrganizationConnectionId = (value) =>
  normalizeTextInput(value, { maxLength: 180 })

const formatOrganizationConnectedAccountLabel = (account) => {
  const accountName = normalizeTextInput(account?.accountName, { maxLength: 180 }) || 'Unknown account'
  const platform = normalizeOrganizationConnectionPlatform(account?.platform)
  return `${accountName} [${platform}]`
}

const normalizeInstagramOpsRunEntry = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const runId = normalizeTextInput(value.runId, { maxLength: 80 })
    || normalizeTextInput(value.id, { maxLength: 80 })
  const jobId = normalizeTextInput(value.jobId, { maxLength: 80 })
  const status = normalizeTextInput(value.status, { maxLength: 32 })
  const startedAt = normalizeTextInput(value.startedAt, { maxLength: 64 })
  const finishedAt = normalizeTextInput(value.finishedAt, { maxLength: 64 })
  const partialFailureCount = Math.max(0, Number(value.partialFailureCount) || 0)
  const errorCode = normalizeTextInput(value.errorCode, { maxLength: 80 })
  const errorMessage = normalizeTextInput(value.errorMessage, { maxLength: 240 })
  if (!runId && !jobId && !startedAt && !finishedAt) return null
  return {
    runId,
    jobId: isUuid(jobId) ? jobId : '',
    status,
    startedAt,
    finishedAt,
    partialFailureCount,
    errorCode,
    errorMessage,
  }
}

const normalizeInstagramOpsAlertEntry = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = normalizeTextInput(value.id, { maxLength: 80 }) || crypto.randomUUID()
  const type = normalizeTextInput(value.type, { maxLength: 64 })
  const createdAt = normalizeTextInput(value.createdAt, { maxLength: 64 }) || new Date().toISOString()
  const payload = value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
    ? value.payload
    : {}
  return {
    id,
    type,
    createdAt,
    payload,
  }
}

const normalizeInstagramOpsSnapshot = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const updatedAt = normalizeTextInput(value.updatedAt, { maxLength: 64 }) || ''
  const lastStatus = normalizeTextInput(value.lastStatus, { maxLength: 32 }) || ''
  const lastRunAt = normalizeTextInput(value.lastRunAt, { maxLength: 64 }) || ''
  const lastErrorCode = normalizeTextInput(value.lastErrorCode, { maxLength: 80 }) || ''
  const lastErrorMessage = normalizeTextInput(value.lastErrorMessage, { maxLength: 240 }) || ''
  const failureStreak = Math.max(0, Math.min(5000, Number(value.failureStreak) || 0))
  const recentRuns = (Array.isArray(value.recentRuns) ? value.recentRuns : [])
    .map((entry) => normalizeInstagramOpsRunEntry(entry))
    .filter((entry) => Boolean(entry))
    .sort((left, right) => {
      const leftTime = Date.parse(left.finishedAt || left.startedAt || '')
      const rightTime = Date.parse(right.finishedAt || right.startedAt || '')
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
    })
    .slice(0, instagramOpsRecentRunsPerAccount)
  const recentAlerts = (Array.isArray(value.recentAlerts) ? value.recentAlerts : [])
    .map((entry) => normalizeInstagramOpsAlertEntry(entry))
    .filter((entry) => Boolean(entry))
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt || '')
      const rightTime = Date.parse(right.createdAt || '')
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
    })
    .slice(0, instagramOpsRecentAlertsPerAccount)
  return {
    updatedAt: updatedAt || new Date().toISOString(),
    lastStatus,
    lastRunAt,
    lastErrorCode,
    lastErrorMessage,
    failureStreak,
    recentRuns,
    recentAlerts,
  }
}

const normalizeOrganizationConnectedAccounts = (value) => {
  if (!Array.isArray(value)) return []
  const accountsById = new Map()
  for (const entry of value.slice(0, MAX_INPUT_LIST_SIZE)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const platform = normalizeOrganizationConnectionPlatform(entry.platform)
    const accountName = normalizeTextInput(entry.accountName, { maxLength: 180 })
    const rawChannelId = normalizeTextInput(entry.channelId, { maxLength: 300 })
    const legacyXUserId = platform === ORGANIZATION_CONNECTION_PLATFORM_X
      ? normalizeXUserId(entry.userId || entry.xUserId || entry.twitterUserId)
      : ''
    const channelId = rawChannelId || legacyXUserId
    const ownerUserId = normalizeTextInput(entry.ownerUserId, { maxLength: 80 })
    const connectedAt = normalizeTextInput(entry.connectedAt, { maxLength: 64 })
    const fallbackId = `${platform.toLowerCase()}:${channelId || accountName.toLowerCase().replace(/\s+/g, '-')}`
    const id = normalizeOrganizationConnectionId(entry.id) || fallbackId
    if (!id || !accountName) continue
    const normalizedAccount = {
      id,
      platform,
      accountName,
      channelId: channelId || undefined,
      ownerUserId: isUuid(ownerUserId) ? ownerUserId : undefined,
      connectedAt: connectedAt || undefined,
    }
    if (platform === ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM) {
      const instagramOps = normalizeInstagramOpsSnapshot(entry.instagramOps)
      if (instagramOps) {
        normalizedAccount.instagramOps = instagramOps
      }
    }
    accountsById.set(id, normalizedAccount)
  }
  return [...accountsById.values()]
}

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

const isLoopbackHostname = (hostname) => {
  const normalized = normalizeTextInput(hostname, { maxLength: 255 }).toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

const isLoopbackUrl = (value) => {
  const base = resolveOriginBase(value)
  if (!base) return false
  try {
    const parsed = new URL(base)
    return isLoopbackHostname(parsed.hostname)
  } catch {
    return false
  }
}

const resolveInstagramOauthRedirectUri = ({
  requestOriginBase = '',
  refererOriginBase = '',
} = {}) => {
  const fallback = `${serverBaseUrl}/oauth/instagram/callback`
  const configured = normalizeTextInput(instagramRedirectUri, { maxLength: 500 }) || fallback
  let resolved = configured
  try {
    const parsedConfigured = new URL(configured)
    const configuredProtocol = parsedConfigured.protocol.toLowerCase()
    if (configuredProtocol !== 'https:' && configuredProtocol !== 'http:') {
      resolved = fallback
    }
  } catch {
    resolved = fallback
  }

  const inboundBase = requestOriginBase || refererOriginBase
  if (isLoopbackUrl(resolved) && inboundBase && !isLoopbackUrl(inboundBase)) {
    return fallback
  }
  return resolved
}

const resolveXOauthRedirectUri = ({
  requestOriginBase = '',
  refererOriginBase = '',
} = {}) => {
  const fallback = `${serverBaseUrl}/oauth/x/callback`
  const configured = normalizeTextInput(xOauthRedirectUri, { maxLength: 500 }) || fallback
  let resolved = configured
  try {
    const parsedConfigured = new URL(configured)
    const configuredProtocol = parsedConfigured.protocol.toLowerCase()
    if (configuredProtocol !== 'https:' && configuredProtocol !== 'http:') {
      resolved = fallback
    }
  } catch {
    resolved = fallback
  }

  const inboundBase = requestOriginBase || refererOriginBase
  if (isLoopbackUrl(resolved) && inboundBase && !isLoopbackUrl(inboundBase)) {
    return fallback
  }
  return resolved
}

const resolveXOauthAuthorizeUrl = (rawUrl) => {
  const fallback = 'https://x.com/i/oauth2/authorize'
  const normalizedRaw = normalizeTextInput(rawUrl, { maxLength: 500 })
  if (!normalizedRaw) return fallback
  try {
    const parsed = new URL(normalizedRaw)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== 'https:' && protocol !== 'http:') return fallback
    const host = parsed.hostname.toLowerCase()
    if (host !== 'x.com' && host !== 'www.x.com' && host !== 'twitter.com' && host !== 'www.twitter.com') {
      return fallback
    }
    const resolvedPath = parsed.pathname.replace(/\/+$/, '').toLowerCase()
    if (resolvedPath !== '/i/oauth2/authorize') {
      return fallback
    }
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return fallback
  }
}

const resolveXOauthTokenUrls = () => {
  const fallbackUrls = ['https://api.x.com/2/oauth2/token', 'https://api.twitter.com/2/oauth2/token']
  const candidates = [xOauthTokenUrl, xOauthTokenFallbackUrl, ...fallbackUrls]
  const resolved = []
  for (const candidate of candidates) {
    const normalized = normalizeTextInput(candidate, { maxLength: 500 })
    if (!normalized) continue
    try {
      const parsed = new URL(normalized)
      const protocol = parsed.protocol.toLowerCase()
      if (protocol !== 'https:' && protocol !== 'http:') continue
      const host = parsed.hostname.toLowerCase()
      if (host !== 'api.x.com' && host !== 'api.twitter.com') continue
      const resolvedPath = parsed.pathname.replace(/\/+$/, '').toLowerCase()
      if (resolvedPath !== '/2/oauth2/token') continue
      parsed.search = ''
      parsed.hash = ''
      const normalizedUrl = parsed.toString().replace(/\/$/, '')
      if (!resolved.includes(normalizedUrl)) {
        resolved.push(normalizedUrl)
      }
    } catch {
      // Skip invalid OAuth token URL candidates.
    }
  }
  return resolved
}

const trustedRequestOrigins = new Set(
  [resolveOriginBase(appBaseUrl), resolveOriginBase(serverBaseUrl)].filter(Boolean),
)
const hasExplicitGoogleRedirectUri = Boolean(
  normalizeEnvValue(process.env.GOOGLE_REDIRECT_URI)
  || normalizeEnvValue(process.env.SUPABASE_REDIRECT_URI),
)
const preferDynamicGoogleRedirectInDev = getEnv(
  'GOOGLE_OAUTH_DYNAMIC_REDIRECT_IN_DEV',
  'true',
).toLowerCase() !== 'false'

const isTrustedRequestSource = (req) => {
  const originHeader = typeof req.headers?.origin === 'string' ? req.headers.origin : ''
  const refererHeader = typeof req.headers?.referer === 'string' ? req.headers.referer : ''
  const fetchSiteHeader = typeof req.headers?.['sec-fetch-site'] === 'string'
    ? req.headers['sec-fetch-site'].trim().toLowerCase()
    : ''
  const originBase = resolveOriginBase(originHeader)
  const refererBase = resolveOriginBase(refererHeader)
  if (originBase && trustedRequestOrigins.has(originBase)) return true
  if (refererBase && trustedRequestOrigins.has(refererBase)) return true
  if (fetchSiteHeader) {
    if (fetchSiteHeader === 'cross-site') return false
    if (fetchSiteHeader === 'same-origin' || fetchSiteHeader === 'same-site' || fetchSiteHeader === 'none') {
      return true
    }
  }
  if (!isProd && !originBase && !refererBase) return true
  return false
}

const resolveAppRedirectBase = (req) => {
  const fromCookie = resolveOriginBase(req.cookies?.[APP_REDIRECT_COOKIE])
  if (fromCookie) return fromCookie
  return appBaseUrl
}

const resolveGoogleOauthRedirectUri = ({
  requestOriginBase = '',
  refererOriginBase = '',
} = {}) => {
  const fallback = `${serverBaseUrl}/oauth/google/callback`
  const configured = normalizeTextInput(redirectUri, { maxLength: 500 }) || fallback
  const inboundBase = requestOriginBase || refererOriginBase

  const toInboundRedirectUri = () => {
    if (!inboundBase) return ''
    if (isProd && !trustedRequestOrigins.has(inboundBase)) return ''
    return `${inboundBase}/oauth/google/callback`
  }

  const dynamic = toInboundRedirectUri()
  if (dynamic) {
    if (!isProd && preferDynamicGoogleRedirectInDev) {
      return dynamic
    }
    if (!hasExplicitGoogleRedirectUri) {
      return dynamic
    }
  }

  try {
    const parsed = new URL(configured)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== 'https:' && protocol !== 'http:') {
      return fallback
    }
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return fallback
  }
}

const isServerlessRuntime = Boolean(
  process.env.NETLIFY
  || process.env.AWS_LAMBDA_FUNCTION_NAME
  || process.env.VERCEL,
)

const readHeaderValue = (headers, headerName) => {
  if (!headers || typeof headers !== 'object') return ''
  const directValue = headers[headerName]
  if (typeof directValue === 'string') return directValue
  const normalizedHeaderName = headerName.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== normalizedHeaderName) continue
    if (typeof value === 'string') return value
    break
  }
  return ''
}

const isValidInternalRefreshRunnerToken = (headers = {}) => {
  if (!internalRefreshRunnerToken) return false
  const providedRaw = readHeaderValue(headers, INTERNAL_REFRESH_RUNNER_HEADER)
  const provided = normalizeEnvValue(providedRaw)
  if (!provided) return false
  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided),
      Buffer.from(internalRefreshRunnerToken),
    )
  } catch {
    return false
  }
}

const resolveInternalRefreshRunnerUrl = () => {
  const explicitBaseUrl = normalizeBaseUrl(getEnv('INTERNAL_REFRESH_RUNNER_BASE_URL'))
  const vercelUrl = normalizeEnvValue(process.env.VERCEL_URL)
  const vercelBaseUrl = vercelUrl
    ? normalizeBaseUrl(/^https?:\/\//i.test(vercelUrl) ? vercelUrl : `https://${vercelUrl}`)
    : ''
  const defaultBaseUrl = normalizeBaseUrl(getEnv('URL', vercelBaseUrl || serverBaseUrl))
  const baseUrl = explicitBaseUrl || defaultBaseUrl
  if (!baseUrl) return ''
  return `${baseUrl}${INTERNAL_REFRESH_RUNNER_FUNCTION_PATH}`
}

const dispatchInternalRefreshRunner = async ({ platform, userId, jobId }) => {
  if (!isServerlessRuntime) return { ok: false, error: 'not_serverless_runtime' }
  if (!isUuid(userId) || !isUuid(jobId)) return { ok: false, error: 'invalid_dispatch_payload' }
  if (platform !== 'youtube' && platform !== 'instagram') return { ok: false, error: 'invalid_platform' }
  if (!internalRefreshRunnerToken) return { ok: false, error: 'missing_internal_refresh_runner_token' }

  const runnerUrl = resolveInternalRefreshRunnerUrl()
  if (!runnerUrl) return { ok: false, error: 'missing_internal_refresh_runner_url' }

  const abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController.abort(), 4_000)
  try {
    const response = await fetch(runnerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_REFRESH_RUNNER_HEADER]: internalRefreshRunnerToken,
      },
      body: JSON.stringify({ platform, userId, jobId }),
      signal: abortController.signal,
    })
    if (!response.ok) {
      return { ok: false, error: `refresh_runner_http_${response.status}` }
    }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'refresh_runner_dispatch_failed',
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

const resolveReportingStorePath = () => {
  if (isServerlessRuntime) return null
  try {
    if (typeof import.meta !== 'undefined' && import.meta?.url) {
      return new URL('./reporting-store.json', import.meta.url)
    }
  } catch {
    // Ignore and fall back to process.cwd path resolution.
  }
  return path.join(process.cwd(), 'server', 'reporting-store.json')
}

const reportingStorePath = resolveReportingStorePath()
let reportingStore = null

const buildEmptyReportingStore = () => ({
  reportTypesCache: null,
  sessions: {},
  instagram: {
    sessionVault: {},
    jobs: {},
    summaries: {},
  },
  x: {
    oauthVault: {},
  },
})

const ensureInstagramReportingStore = (store) => {
  if (!store || typeof store !== 'object') return buildEmptyReportingStore()
  if (!store.instagram || typeof store.instagram !== 'object' || Array.isArray(store.instagram)) {
    store.instagram = { sessionVault: {}, jobs: {}, summaries: {} }
  }
  if (!store.instagram.sessionVault || typeof store.instagram.sessionVault !== 'object' || Array.isArray(store.instagram.sessionVault)) {
    store.instagram.sessionVault = {}
  }
  if (!store.instagram.jobs || typeof store.instagram.jobs !== 'object' || Array.isArray(store.instagram.jobs)) {
    store.instagram.jobs = {}
  }
  if (!store.instagram.summaries || typeof store.instagram.summaries !== 'object' || Array.isArray(store.instagram.summaries)) {
    store.instagram.summaries = {}
  }
  return store
}

const ensureXOauthReportingStore = (store) => {
  if (!store || typeof store !== 'object') return buildEmptyReportingStore()
  if (!store.x || typeof store.x !== 'object' || Array.isArray(store.x)) {
    store.x = { oauthVault: {} }
  }
  if (!store.x.oauthVault || typeof store.x.oauthVault !== 'object' || Array.isArray(store.x.oauthVault)) {
    store.x.oauthVault = {}
  }
  return store
}

const loadReportingStore = async () => {
  if (reportingStore) return reportingStore
  if (!reportingStorePath) {
    reportingStore = buildEmptyReportingStore()
    return reportingStore
  }
  try {
    const raw = await readFile(reportingStorePath, 'utf8')
    const parsed = JSON.parse(raw)
    reportingStore = parsed && typeof parsed === 'object'
      ? ensureXOauthReportingStore(ensureInstagramReportingStore(parsed))
      : buildEmptyReportingStore()
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      reportingStore = buildEmptyReportingStore()
    } else {
      reportingStore = buildEmptyReportingStore()
    }
    await writeFile(reportingStorePath, JSON.stringify(reportingStore, null, 2))
  }
  ensureXOauthReportingStore(ensureInstagramReportingStore(reportingStore))
  return reportingStore
}

const persistReportingStore = async () => {
  if (!reportingStore || !reportingStorePath) return
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

const buildSupabaseTableEndpoints = (tableName, query = '') => {
  const normalizedTableName = typeof tableName === 'string' ? tableName.trim() : ''
  if (!normalizedTableName) return []
  const suffix = query ? `?${query}` : ''
  const encodedTableName = encodeURIComponent(normalizedTableName)
  const encodedLowercaseTableName = encodeURIComponent(normalizedTableName.toLowerCase())
  const pathParts = [`%22${encodedTableName}%22`, encodedTableName, encodedLowercaseTableName]
  return [...new Set(pathParts)].map((pathPart) => `${supabaseUrl}/rest/v1/${pathPart}${suffix}`)
}

const requestSupabaseTable = async (tableName, { method = 'GET', query = '', body, prefer = '' } = {}) => {
  if (!isSupabaseConfigured) {
    return { ok: false, status: 500, payload: null }
  }
  const url = buildSupabaseTableUrl(tableName, query)
  const headers = {
    apikey: supabaseSecretKey,
    ...buildSupabaseServiceAuthorizationHeader(),
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
  } catch (error) {
    console.error('Supabase table request failed', {
      tableName,
      method,
      message: error instanceof Error ? error.message : 'unknown_error',
    })
    return { ok: false, status: 503, payload: null }
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

const listYouTubeConnectionRowsByChannelIds = async (channelIds) => {
  const normalizedChannelIds = uniqueValues(
    (Array.isArray(channelIds) ? channelIds : [])
      .map((value) => normalizeTextInput(value, { maxLength: 300 }))
      .filter((value) => Boolean(value)),
  )
  if (!normalizedChannelIds.length) {
    return { ok: true, status: 200, payload: [], rows: [] }
  }

  const selectFields = encodeURIComponent(
    'id,user_id,channel_id,channel_name,access_token,refresh_token,token_expires_at,connected_at,updated_at',
  )
  const rows = []
  const chunkSize = 100

  for (let index = 0; index < normalizedChannelIds.length; index += chunkSize) {
    const chunk = normalizedChannelIds.slice(index, index + chunkSize)
    const channelFilter = encodeURIComponent(
      `in.(${chunk.map((value) => value.replace(/,/g, '')).join(',')})`,
    )
    const query = `select=${selectFields}&channel_id=${channelFilter}`
    const result = await requestSupabaseTable('youtube_connections', { query })
    if (!result.ok) {
      return {
        ...result,
        rows: [],
      }
    }
    rows.push(...(Array.isArray(result.payload) ? result.payload : []))
  }

  return {
    ok: true,
    status: 200,
    payload: rows,
    rows,
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

const exchangeGoogleIdTokenForSupabaseSession = async ({
  idToken,
  accessToken = '',
} = {}) => {
  if (!isSupabaseConfigured || !idToken) {
    return {
      ok: false,
      error: {
        status: 0,
        code: 'supabase_not_configured_or_missing_id_token',
        message: 'Supabase is not configured or Google id_token is missing.',
      },
    }
  }
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=id_token`, {
      method: 'POST',
      headers: {
        apikey: supabasePublishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'google',
        id_token: idToken,
        ...(typeof accessToken === 'string' && accessToken ? { access_token: accessToken } : {}),
      }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.access_token) {
      const code = payload?.code || payload?.error || 'supabase_exchange_failed'
      const message = payload?.message || payload?.msg || payload?.error_description || payload?.error
      console.error('Supabase id_token exchange failed:', {
        status: response.status,
        code,
        message,
      })
      return {
        ok: false,
        error: {
          status: response.status,
          code,
          message,
        },
      }
    }
    return {
      ok: true,
      session: payload,
    }
  } catch (err) {
    console.error('Supabase id_token exchange failed:', err)
    return {
      ok: false,
      error: {
        status: 0,
        code: 'network_or_runtime_error',
        message: err instanceof Error ? err.message : 'Unexpected error exchanging id_token.',
      },
    }
  }
}

const isValidPkceCodeVerifier = (value) =>
  /^[A-Za-z0-9._~-]{43,128}$/.test(normalizeTextInput(value, { maxLength: 200, trim: true }))

const buildPkceCodeVerifier = () => crypto.randomBytes(48).toString('base64url')

const buildPkceCodeChallenge = (verifier) => {
  const normalizedVerifier = normalizeTextInput(verifier, { maxLength: 200, trim: true })
  if (!isValidPkceCodeVerifier(normalizedVerifier)) return ''
  return crypto
    .createHash('sha256')
    .update(normalizedVerifier)
    .digest('base64url')
}

const buildSupabaseGoogleProviderErrorMessage = (exchangeError) => {
  const code = normalizeTextInput(exchangeError?.code, { maxLength: 120 }).toLowerCase()
  const message = normalizeTextInput(exchangeError?.message, { maxLength: 220 })
  const signal = `${code} ${message}`.toLowerCase()

  if (signal.includes('provider') && signal.includes('enable')) {
    return 'Supabase rejected Google sign-in because the Google provider is disabled. Enable Google under Supabase Authentication > Providers.'
  }
  if (signal.includes('audience') || signal.includes('aud')) {
    return 'Supabase rejected Google sign-in due to OAuth client mismatch. Ensure Supabase Google provider client ID matches GOOGLE_CLIENT_ID.'
  }
  if (signal.includes('nonce')) {
    return 'Supabase rejected Google sign-in due to nonce validation. Verify nonce settings in Supabase Google provider configuration.'
  }
  if (message) {
    return `Supabase session exchange failed: ${message}`
  }
  return 'Supabase session exchange failed. Check Supabase Authentication > Providers > Google settings.'
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
  const candidates = buildSupabaseTableEndpoints('Users', 'on_conflict=id')
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
        ...buildSupabaseServiceAuthorizationHeader(),
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

const updateUsersRowById = async (userId, payload) => {
  const normalizedUserId = normalizeTextInput(userId, { maxLength: 80 })
  if (!isUuid(normalizedUserId)) {
    return { ok: false, status: 400, payload: null, row: null }
  }
  const userFilter = encodeURIComponent(normalizedUserId)
  const endpoints = buildSupabaseTableEndpoints('Users', `id=eq.${userFilter}`)
  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
    })
    const responsePayload = await response.json().catch(() => null)
    const row = Array.isArray(responsePayload) ? responsePayload[0] ?? null : null
    const result = {
      ok: response.ok,
      status: response.status,
      payload: responsePayload,
      row,
    }
    if (result.ok) return result
    lastResult = result
    if (response.status !== 404) break
  }
  return lastResult
}

const normalizeRefreshCounterState = (row, nowMs = Date.now()) => {
  const nowIso = new Date(nowMs).toISOString()
  const currentCount = Math.max(0, Math.floor(toNumber(row?.refresh_count)))
  const currentWindowStartedAtRaw = normalizeTextInput(row?.refresh_window_started_at, { maxLength: 64 })
  const currentWindowStartedAtMs = parseIsoTime(currentWindowStartedAtRaw)
  const hasValidWindow =
    currentWindowStartedAtMs > 0 && nowMs - currentWindowStartedAtMs < REFRESH_WINDOW_DURATION_MS
  const refreshCount = hasValidWindow ? currentCount : 0
  const refreshWindowStartedAt = hasValidWindow ? currentWindowStartedAtRaw : nowIso
  const wasReset = !hasValidWindow || currentCount !== refreshCount
  const refreshesRemaining = Math.max(0, REFRESH_LIMIT_PER_24H - refreshCount)
  const nextWindowStartsAt = new Date(parseIsoTime(refreshWindowStartedAt) + REFRESH_WINDOW_DURATION_MS).toISOString()
  return {
    refreshCount,
    refreshWindowStartedAt,
    refreshesRemaining,
    refreshLimit: REFRESH_LIMIT_PER_24H,
    nextWindowStartsAt,
    wasReset,
    nowIso,
  }
}

const getRefreshCounterStatusForUser = async (userId) => {
  let usersRowResult = await fetchUsersRowById(userId)
  if (usersRowResult.ok && !usersRowResult.row && isUuid(userId)) {
    await tryInsertUsersRow(userId, '')
    usersRowResult = await fetchUsersRowById(userId)
  }
  if (!usersRowResult.ok || !usersRowResult.row) {
    return {
      ok: false,
      status: usersRowResult.status || 500,
      error: 'refresh_count_read_failed',
      details: usersRowResult.payload,
    }
  }

  const normalized = normalizeRefreshCounterState(usersRowResult.row)
  if (normalized.wasReset) {
    const resetResult = await updateUsersRowById(userId, {
      refresh_count: 0,
      refresh_window_started_at: normalized.refreshWindowStartedAt,
    })
    if (!resetResult.ok) {
      return {
        ok: false,
        status: resetResult.status || 500,
        error: 'refresh_count_reset_failed',
        details: resetResult.payload,
      }
    }
  }

  return {
    ok: true,
    status: 200,
    state: {
      refreshCount: normalized.refreshCount,
      refreshWindowStartedAt: normalized.refreshWindowStartedAt,
      refreshesRemaining: normalized.refreshesRemaining,
      refreshLimit: normalized.refreshLimit,
      nextWindowStartsAt: normalized.nextWindowStartsAt,
    },
  }
}

const consumeRefreshCounterForUser = async (userId) => {
  const statusResult = await getRefreshCounterStatusForUser(userId)
  if (!statusResult.ok) return statusResult
  const state = statusResult.state
  if (state.refreshesRemaining <= 0) {
    return {
      ok: false,
      status: 429,
      error: 'refresh_limit_reached',
      state,
      nextWindowStartsAt: state.nextWindowStartsAt,
    }
  }

  const nextCount = state.refreshCount + 1
  const updateResult = await updateUsersRowById(userId, {
    refresh_count: nextCount,
    refresh_window_started_at: state.refreshWindowStartedAt,
  })
  if (!updateResult.ok) {
    return {
      ok: false,
      status: updateResult.status || 500,
      error: 'refresh_count_update_failed',
      details: updateResult.payload,
    }
  }

  return {
    ok: true,
    status: 200,
    state: {
      refreshCount: nextCount,
      refreshWindowStartedAt: state.refreshWindowStartedAt,
      refreshesRemaining: Math.max(0, REFRESH_LIMIT_PER_24H - nextCount),
      refreshLimit: REFRESH_LIMIT_PER_24H,
      nextWindowStartsAt: state.nextWindowStartsAt,
    },
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
      part: 'snippet,statistics,contentDetails',
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
        uploadsPlaylistId: '',
        errorMessage: extractGoogleApiErrorMessage(payload, response.status),
      }
    }
    const channel = payload?.items?.[0]
    if (!channel) {
      return {
        id: '',
        title: '',
        statistics: {},
        uploadsPlaylistId: '',
        errorMessage: 'No YouTube channel was found for this Google account.',
      }
    }
    return {
      id: typeof channel.id === 'string' ? channel.id : '',
      title: typeof channel?.snippet?.title === 'string' ? channel.snippet.title.trim() : '',
      statistics: channel.statistics ?? {},
      uploadsPlaylistId:
        typeof channel?.contentDetails?.relatedPlaylists?.uploads === 'string'
          ? channel.contentDetails.relatedPlaylists.uploads.trim()
          : '',
      errorMessage: '',
    }
  } catch (_err) {
    return {
      id: '',
      title: '',
      statistics: {},
      uploadsPlaylistId: '',
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
app.use(express.json({ limit: '25mb' }))
app.use((req, res, next) => {
  const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
  const normalizedRequestOrigin = resolveOriginBase(requestOrigin)
  const defaultAllowedOrigin = resolveOriginBase(appBaseUrl) || appBaseUrl
  const allowOrigin = !isProd
    ? normalizedRequestOrigin || defaultAllowedOrigin
    : normalizedRequestOrigin && trustedRequestOrigins.has(normalizedRequestOrigin)
      ? normalizedRequestOrigin
      : defaultAllowedOrigin
  res.setHeader('Access-Control-Allow-Origin', allowOrigin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,ngrok-skip-browser-warning')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none';")
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next()
    return
  }
  if (isTrustedRequestSource(req)) {
    next()
    return
  }
  res.status(403).json({
    error: 'forbidden',
    message: 'Untrusted request origin.',
  })
})

app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') {
    next()
    return
  }
  if (isTrustedRequestSource(req)) {
    next()
    return
  }
  res.status(403).json({
    error: 'forbidden',
    message: 'Untrusted API request source.',
  })
})

app.get('/health', async (req, res) => {
  trimInstagramOpsState()
  const instagramFailureRatePct = Number(getInstagramFailureRatePct().toFixed(2))
  const highestFailureStreak = [...instagramOpsState.failureStreakByUser.values()]
    .reduce((max, streak) => Math.max(max, Math.max(0, toNumber(streak?.count))), 0)
  const probeSupabase = isTruthyProbeValue(req.query?.probe_supabase ?? req.query?.probe ?? '')
  const supabaseProbe = probeSupabase ? await probeSupabaseConnectivity() : null
  res.json({
    ok: true,
    supabase: {
      ...buildSupabaseConfigDiagnostic(),
      ...(supabaseProbe ? { probe: supabaseProbe } : {}),
    },
    instagram: {
      collectorMode: instagramCollectorMode,
      selectorVersion: INSTAGRAM_SELECTOR_VERSION,
      failureRatePct: instagramFailureRatePct,
      highestFailureStreak,
      runningUsers: instagramRefreshRunningUsers.size,
    },
  })
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
    role: viewer.appRole,
  })
})

const resolveRefreshCounterViewer = async (req, res) => {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      status: 500,
      error: 'supabase_not_configured',
      message: `Supabase config is missing. Set: ${getMissingSupabaseConfigKeys().join(', ')}.`,
      details: buildSupabaseConfigDiagnostic(),
    }
  }
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    return {
      ok: false,
      status: viewer.status || 500,
      error: viewer.error || 'refresh_count_update_failed',
      message: viewer.message || 'Unable to verify user role.',
      details: viewer.details ?? null,
    }
  }
  if (!canViewerRefreshConnectedAccountData(viewer)) {
    return {
      ok: false,
      status: 403,
      error: 'forbidden',
      message: 'Only organization internal/admin members can refresh connected account data.',
    }
  }
  return { ok: true, viewer }
}

app.get('/api/refresh-counter/status', async (req, res) => {
  const viewerResult = await resolveRefreshCounterViewer(req, res)
  if (!viewerResult.ok) {
    res.status(viewerResult.status || 500).json({
      error: viewerResult.error || 'refresh_count_read_failed',
      message: viewerResult.message || 'Unable to read refresh counter.',
      details: viewerResult.details ?? null,
    })
    return
  }

  const statusResult = await getRefreshCounterStatusForUser(viewerResult.viewer.userId)
  if (!statusResult.ok) {
    res.status(statusResult.status || 500).json({
      error: statusResult.error || 'refresh_count_read_failed',
      message: 'Unable to read refresh counter.',
      details: statusResult.details ?? null,
    })
    return
  }

  res.json(statusResult.state)
})

app.post('/api/refresh-counter/bump', async (req, res) => {
  const viewerResult = await resolveRefreshCounterViewer(req, res)
  if (!viewerResult.ok) {
    res.status(viewerResult.status || 500).json({
      error: viewerResult.error || 'refresh_count_update_failed',
      message: viewerResult.message || 'Unable to update refresh counter.',
      details: viewerResult.details ?? null,
    })
    return
  }

  const bumpResult = await consumeRefreshCounterForUser(viewerResult.viewer.userId)
  if (!bumpResult.ok) {
    const basePayload = {
      error: bumpResult.error || 'refresh_count_update_failed',
      details: bumpResult.details ?? null,
    }
    if (bumpResult.status === 429) {
      res.status(429).json({
        ...basePayload,
        message: 'You have reached the 2 refreshes per 24 hours limit.',
        refreshCount: bumpResult.state?.refreshCount ?? REFRESH_LIMIT_PER_24H,
        refreshWindowStartedAt: bumpResult.state?.refreshWindowStartedAt ?? null,
        refreshesRemaining: 0,
        refreshLimit: REFRESH_LIMIT_PER_24H,
        nextWindowStartsAt: bumpResult.nextWindowStartsAt ?? null,
      })
      return
    }
    res.status(bumpResult.status || 500).json(basePayload)
    return
  }

  res.json(bumpResult.state)
})

app.post('/api/exports/preview', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'export_preview_create_failed',
      message: viewer.message || 'Unable to authorize export preview.',
      details: viewer.details ?? null,
    })
    return
  }

  const payload = req.body ?? {}
  const campaignId = normalizeTextInput(payload.campaignId, { maxLength: 80 })
  const requestedCampaignIds = uniqueValues([campaignId, ...normalizeUuidArray(payload.campaignIds)])
  const type = normalizeExportPreviewType(payload.type)
  const dataBase64 = typeof payload.dataBase64 === 'string' ? payload.dataBase64.trim() : ''
  const fileName = sanitizeFileName(
    typeof payload.fileName === 'string' ? payload.fileName : '',
    type === 'pdf' ? 'report.pdf' : 'report.csv',
  )

  if (!isUuid(campaignId) || !type || !dataBase64) {
    res.status(400).json({
      error: 'invalid_export_preview_payload',
      message: 'campaignId, type, and dataBase64 are required.',
    })
    return
  }

  const campaignResult = await fetchCampaignRowById(campaignId)
  if (!campaignResult.ok) {
    res.status(campaignResult.status || 500).json({
      error: 'export_preview_create_failed',
      message: 'Unable to load campaign from Supabase.',
      details: campaignResult.payload,
    })
    return
  }
  if (!campaignResult.row) {
    res.status(404).json({
      error: 'campaign_not_found',
      message: 'Campaign was not found.',
    })
    return
  }

  const viewerOrganizationIds = normalizeUuidArray(viewer.organizationIds)
  const viewerOrganizationAdminIds = normalizeUuidArray(viewer.organizationAdminIds)
  const viewerOrganizationBrandViewerIds = normalizeUuidArray(viewer.organizationBrandViewerIds)
  for (const scopedCampaignId of requestedCampaignIds) {
    if (!isUuid(scopedCampaignId)) continue
    const scopedCampaignResult = scopedCampaignId === campaignId
      ? campaignResult
      : await fetchCampaignRowById(scopedCampaignId)
    if (!scopedCampaignResult.ok || !scopedCampaignResult.row) {
      res.status(scopedCampaignResult.status || 404).json({
        error: 'campaign_not_found',
        message: 'One or more campaigns in this report scope could not be loaded.',
      })
      return
    }
    if (!canUserSeeCampaign(
      scopedCampaignResult.row,
      viewer.userId,
      viewerOrganizationIds,
      viewerOrganizationAdminIds,
      viewerOrganizationBrandViewerIds,
    )) {
      res.status(403).json({
        error: 'forbidden',
        message: 'You do not have access to all campaigns in this report scope.',
      })
      return
    }
  }

  const campaignRole = resolveCampaignEffectiveRole(campaignResult.row, viewer.userId, {
    organizationIds: viewerOrganizationIds,
    organizationAdminIds: viewerOrganizationAdminIds,
    organizationBrandViewerIds: viewerOrganizationBrandViewerIds,
  })
  if (!campaignRole) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You must have campaign access to generate export previews.',
    })
    return
  }
  if (
    campaignRole !== CAMPAIGN_MEMBER_ROLE_ADMIN &&
    campaignRole !== CAMPAIGN_MEMBER_ROLE_INTERNAL
  ) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only campaign admins and internal members can generate export previews.',
    })
    return
  }
  if (dataBase64.length > EXPORT_PREVIEW_MAX_BASE64_SIZE) {
    res.status(413).json({
      error: 'export_preview_too_large',
      message: 'Export preview payload is too large.',
    })
    return
  }

  let decoded
  try {
    decoded = Buffer.from(dataBase64, 'base64')
  } catch {
    res.status(400).json({
      error: 'invalid_export_preview_payload',
      message: 'dataBase64 must be valid base64.',
    })
    return
  }
  if (!decoded || !decoded.length) {
    res.status(400).json({
      error: 'invalid_export_preview_payload',
      message: 'Export preview payload is empty.',
    })
    return
  }

  const id = crypto.randomUUID()
  const entry = {
    id,
    userId: viewer.userId,
    campaignId,
    campaignIds: requestedCampaignIds,
    type,
    fileName,
    contentType: type === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
    dataBase64,
    createdAtMs: Date.now(),
  }
  const persistResult = await persistExportPreviewEntry(entry)
  if (!persistResult.ok) {
    res.status(persistResult.status || 500).json({
      error: 'export_preview_create_failed',
      message: 'Unable to store export preview.',
    })
    return
  }

  res.status(201).json({
    id,
    type,
    fileName,
    expiresInMs: EXPORT_PREVIEW_TTL_MS,
  })
})

app.get('/api/exports/preview/:previewId', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 401).json({
      error: viewer.error || 'not_authenticated',
      message: viewer.message || 'Unable to authorize export preview.',
    })
    return
  }

  const previewId = normalizeTextInput(req.params?.previewId, { maxLength: 80 })
  const previewResult = await resolveExportPreviewEntry(previewId)
  if (!previewResult.ok) {
    if (previewResult.notFound) {
      res.status(404).json({
        error: 'export_preview_not_found',
        message: 'Export preview not found or expired.',
      })
      return
    }
    res.status(previewResult.status || 503).json({
      error: 'export_preview_unavailable',
      message: 'Unable to load export preview right now.',
    })
    return
  }
  const entry = previewResult.entry
  if (!entry) {
    res.status(404).json({
      error: 'export_preview_not_found',
      message: 'Export preview not found or expired.',
    })
    return
  }
  const entryCampaignIds = uniqueValues([
    ...normalizeUuidArray(entry.campaignIds),
    normalizeTextInput(entry.campaignId, { maxLength: 80 }),
  ].filter((value) => isUuid(value)))
  if (!entryCampaignIds.length) {
    res.status(404).json({
      error: 'export_preview_not_found',
      message: 'Export preview not found or expired.',
    })
    return
  }
  const viewerOrganizationIds = normalizeUuidArray(viewer.organizationIds)
  const viewerOrganizationAdminIds = normalizeUuidArray(viewer.organizationAdminIds)
  const viewerOrganizationBrandViewerIds = normalizeUuidArray(viewer.organizationBrandViewerIds)
  for (const scopedCampaignId of entryCampaignIds) {
    const scopedCampaignResult = await fetchCampaignRowById(scopedCampaignId)
    if (!scopedCampaignResult.ok || !scopedCampaignResult.row) {
      res.status(404).json({
        error: 'export_preview_not_found',
        message: 'Export preview not found or expired.',
      })
      return
    }
    if (!canUserSeeCampaign(
      scopedCampaignResult.row,
      viewer.userId,
      viewerOrganizationIds,
      viewerOrganizationAdminIds,
      viewerOrganizationBrandViewerIds,
    )) {
      res.status(404).json({
        error: 'export_preview_not_found',
        message: 'Export preview not found or expired.',
      })
      return
    }
  }

  const payloadBuffer = Buffer.from(entry.dataBase64, 'base64')
  if (!payloadBuffer.length) {
    await removeExportPreviewEntry(entry.id)
    res.status(404).json({
      error: 'export_preview_not_found',
      message: 'Export preview not found or expired.',
    })
    return
  }

  res.setHeader('Content-Type', entry.contentType || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${sanitizeFileName(entry.fileName)}"`)
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).send(payloadBuffer)
})

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const isUuid = (value) => typeof value === 'string' && uuidRegex.test(value.trim())

const uniqueValues = (values) => [...new Set(values)]

const stripControlChars = (value) => {
  if (typeof value !== 'string') return ''
  let sanitized = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    const isControl =
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    if (!isControl) {
      sanitized += char
    }
  }
  return sanitized
}

const normalizeTextInput = (
  value,
  {
    maxLength = 256,
    allowNewLines = false,
    trim = true,
  } = {},
) => {
  if (typeof value !== 'string') return ''
  let normalized = value.replace(/\r\n?/g, '\n')
  normalized = stripControlChars(normalized)
  normalized = normalized.replace(/[<>]/g, '')
  if (allowNewLines) {
    normalized = normalized.replace(/[^\S\n]+/g, ' ')
  } else {
    normalized = normalized.replace(/[\n\t]+/g, ' ')
    normalized = normalized.replace(/\s+/g, ' ')
  }
  if (trim) {
    normalized = normalized.trim()
  }
  return normalized.slice(0, Math.max(0, maxLength))
}

const normalizeUuidArray = (value) => {
  if (Array.isArray(value)) {
    return uniqueValues(
      value
        .slice(0, MAX_INPUT_LIST_SIZE)
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

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) return []
  return uniqueValues(
    value
      .slice(0, MAX_INPUT_LIST_SIZE)
      .map((entry) => normalizeTextInput(entry, { maxLength: 300 }))
      .filter((entry) => entry.length > 0),
  )
}

const APP_ROLE_ADMIN = 'admin'
const APP_ROLE_INTERNAL = 'internal'
const APP_ROLE_BRAND = 'brand'

const normalizeAppRole = (value) => {
  if (typeof value !== 'string') return APP_ROLE_ADMIN
  const normalized = value.trim().toLowerCase()
  if (!normalized) return APP_ROLE_ADMIN
  if (normalized.includes('admin')) return APP_ROLE_ADMIN
  if (normalized.includes('brand')) return APP_ROLE_BRAND
  if (normalized.includes('internal')) return APP_ROLE_INTERNAL
  return APP_ROLE_ADMIN
}

const canRoleConnectAccounts = (role) => normalizeAppRole(role) === APP_ROLE_ADMIN
const canRoleCreateCampaigns = (role) => normalizeAppRole(role) === APP_ROLE_ADMIN
const canRoleCreateOrganizations = (role) => normalizeAppRole(role) === APP_ROLE_ADMIN
const canRoleManageCampaignDetails = (role) => normalizeAppRole(role) === APP_ROLE_ADMIN
const canRoleManageCampaignMembers = (role) => normalizeAppRole(role) === APP_ROLE_ADMIN
const canRoleTagCampaignContent = (role) => {
  const normalized = normalizeAppRole(role)
  return normalized === APP_ROLE_ADMIN || normalized === APP_ROLE_INTERNAL
}
const canRoleGenerateReports = canRoleTagCampaignContent
const canViewerManageConnectedAccounts = (viewer) =>
  normalizeUuidArray(viewer?.organizationIds).length > 0
const canViewerRefreshConnectedAccountData = (viewer) => canViewerManageConnectedAccounts(viewer)

const CAMPAIGN_MEMBER_ROLE_ADMIN = 'admin'
const CAMPAIGN_MEMBER_ROLE_INTERNAL = 'internal'
const CAMPAIGN_MEMBER_ROLE_BRAND_VIEWER = 'brand viewer'
const CAMPAIGN_SELECTED_POST_IDS_KEY = 'selected_post_ids'
const CAMPAIGN_SELECTED_CHANNEL_ID_KEY = 'selected_channel_id'
const ORGANIZATION_MEMBER_ROLE_ADMIN = 'admin'
const ORGANIZATION_MEMBER_ROLE_INTERNAL = 'internal'
const ORGANIZATION_MEMBER_ROLE_BRAND_VIEWER = 'brand viewer'

const normalizeCampaignMemberRole = (value) => {
  if (typeof value !== 'string') return CAMPAIGN_MEMBER_ROLE_INTERNAL
  const normalized = value.trim().toLowerCase()
  if (!normalized) return CAMPAIGN_MEMBER_ROLE_INTERNAL
  if (normalized === CAMPAIGN_MEMBER_ROLE_ADMIN || normalized.includes('admin')) {
    return CAMPAIGN_MEMBER_ROLE_ADMIN
  }
  if (
    normalized === CAMPAIGN_MEMBER_ROLE_BRAND_VIEWER ||
    normalized === 'brand-viewer' ||
    normalized === 'brand_viewer' ||
    normalized === 'brand' ||
    normalized.includes('brand')
  ) {
    return CAMPAIGN_MEMBER_ROLE_BRAND_VIEWER
  }
  if (normalized === CAMPAIGN_MEMBER_ROLE_INTERNAL || normalized.includes('internal')) {
    return CAMPAIGN_MEMBER_ROLE_INTERNAL
  }
  // Backward compatibility with legacy campaign role values.
  if (normalized === 'member') return CAMPAIGN_MEMBER_ROLE_INTERNAL
  return CAMPAIGN_MEMBER_ROLE_INTERNAL
}

const normalizeCampaignMemberRoles = (value, creatorId = '') => {
  const roleByUserId = {}

  if (Array.isArray(value)) {
    for (const userId of normalizeUuidArray(value)) {
      roleByUserId[userId] = CAMPAIGN_MEMBER_ROLE_INTERNAL
    }
  } else if (value && typeof value === 'object') {
    for (const [rawUserId, rawRole] of Object.entries(value)) {
      const userId = typeof rawUserId === 'string' ? rawUserId.trim() : ''
      if (!isUuid(userId)) continue
      roleByUserId[userId] = normalizeCampaignMemberRole(rawRole)
    }
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (isUuid(trimmed)) {
      roleByUserId[trimmed] = CAMPAIGN_MEMBER_ROLE_INTERNAL
    } else if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        const parsed = JSON.parse(trimmed)
        const parsedRoles = normalizeCampaignMemberRoles(parsed)
        Object.assign(roleByUserId, parsedRoles)
      } catch {
        for (const userId of normalizeUuidArray(trimmed)) {
          roleByUserId[userId] = CAMPAIGN_MEMBER_ROLE_INTERNAL
        }
      }
    }
  }

  if (isUuid(creatorId)) {
    roleByUserId[creatorId] = CAMPAIGN_MEMBER_ROLE_ADMIN
  }

  return roleByUserId
}

const normalizeOrganizationMemberRole = (value) => {
  if (typeof value !== 'string') return ORGANIZATION_MEMBER_ROLE_INTERNAL
  const normalized = value.trim().toLowerCase()
  if (!normalized) return ORGANIZATION_MEMBER_ROLE_INTERNAL
  if (normalized === ORGANIZATION_MEMBER_ROLE_ADMIN || normalized.includes('admin')) {
    return ORGANIZATION_MEMBER_ROLE_ADMIN
  }
  if (
    normalized === ORGANIZATION_MEMBER_ROLE_BRAND_VIEWER ||
    normalized === 'brand-viewer' ||
    normalized === 'brand_viewer' ||
    normalized === 'brand' ||
    normalized.includes('brand')
  ) {
    return ORGANIZATION_MEMBER_ROLE_BRAND_VIEWER
  }
  return ORGANIZATION_MEMBER_ROLE_INTERNAL
}

const normalizeOrganizationMemberRoles = (value, creatorId = '') => {
  const roleByUserId = {}

  if (Array.isArray(value)) {
    for (const userId of normalizeUuidArray(value)) {
      roleByUserId[userId] = ORGANIZATION_MEMBER_ROLE_INTERNAL
    }
  } else if (value && typeof value === 'object') {
    for (const [rawUserId, rawRole] of Object.entries(value)) {
      const userId = typeof rawUserId === 'string' ? rawUserId.trim() : ''
      if (!isUuid(userId)) continue
      roleByUserId[userId] = normalizeOrganizationMemberRole(rawRole)
    }
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (isUuid(trimmed)) {
      roleByUserId[trimmed] = ORGANIZATION_MEMBER_ROLE_INTERNAL
    } else if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        const parsed = JSON.parse(trimmed)
        const parsedRoles = normalizeOrganizationMemberRoles(parsed)
        Object.assign(roleByUserId, parsedRoles)
      } catch {
        for (const userId of normalizeUuidArray(trimmed)) {
          roleByUserId[userId] = ORGANIZATION_MEMBER_ROLE_INTERNAL
        }
      }
    }
  }

  if (isUuid(creatorId)) {
    roleByUserId[creatorId] = ORGANIZATION_MEMBER_ROLE_ADMIN
  }

  return roleByUserId
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normalizeEmail = (value) => {
  const trimmed = normalizeTextInput(value, { maxLength: 320 }).replace(/\s+/g, '').toLowerCase()
  if (!trimmed || !emailRegex.test(trimmed)) return ''
  return trimmed
}

const sanitizeFileName = (value, fallback = 'export') => {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180)
  return sanitized || fallback
}

const normalizeExportPreviewType = (value) => {
  if (value === 'pdf') return 'pdf'
  if (value === 'csv') return 'csv'
  return ''
}

const normalizeExportPreviewEntry = (value) => {
  if (!value || typeof value !== 'object') return null
  const id = normalizeTextInput(value.id, { maxLength: 80 })
  const userId = normalizeTextInput(value.userId, { maxLength: 80 })
  const campaignId = normalizeTextInput(value.campaignId, { maxLength: 80 })
  const type = normalizeExportPreviewType(value.type)
  const fallbackFileName = type === 'pdf' ? 'report.pdf' : 'report.csv'
  const fileName = sanitizeFileName(value.fileName, fallbackFileName)
  const dataBase64 = typeof value.dataBase64 === 'string' ? value.dataBase64.trim() : ''
  const createdAtMsCandidate =
    Number.isFinite(Number(value.createdAtMs))
      ? Number(value.createdAtMs)
      : Number.parseInt(String(Date.parse(String(value.createdAt || ''))), 10)
  const createdAtMs = Number.isFinite(createdAtMsCandidate) ? Math.max(0, createdAtMsCandidate) : 0
  const campaignIds = uniqueValues([campaignId, ...normalizeUuidArray(value.campaignIds)])
  if (!isUuid(id) || !isUuid(userId) || !isUuid(campaignId) || !type || !dataBase64 || !createdAtMs) {
    return null
  }
  if (dataBase64.length > EXPORT_PREVIEW_MAX_BASE64_SIZE) return null
  return {
    id,
    userId,
    campaignId,
    campaignIds,
    type,
    fileName,
    contentType: type === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
    dataBase64,
    createdAtMs,
  }
}

const isExportPreviewExpired = (entry, nowMs = Date.now()) =>
  nowMs - Number(entry?.createdAtMs || entry?.createdAt || 0) > EXPORT_PREVIEW_TTL_MS

const buildExportPreviewStorageObjectPath = (previewId) => {
  const normalizedPreviewId = normalizeTextInput(previewId, { maxLength: 80 })
  if (!isUuid(normalizedPreviewId)) return ''
  return `${EXPORT_PREVIEW_STORAGE_PREFIX}/${normalizedPreviewId}.json`
}

const buildSupabaseStorageObjectUrl = (bucketName, objectPath) => {
  const encodedBucket = encodeURIComponent(bucketName)
  const encodedObjectPath = String(objectPath || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${supabaseUrl}/storage/v1/object/${encodedBucket}/${encodedObjectPath}`
}

const createSupabaseServiceHeaders = (extraHeaders = {}) => ({
  apikey: supabaseSecretKey,
  ...buildSupabaseServiceAuthorizationHeader(),
  ...extraHeaders,
})

const isMissingExportPreviewBucketError = (status, payload) => {
  const message = normalizeTextInput(payload?.message, { maxLength: 240 }).toLowerCase()
  const error = normalizeTextInput(payload?.error, { maxLength: 240 }).toLowerCase()
  return status === 404 || (
    (message.includes('bucket') && message.includes('not found'))
    || (error.includes('bucket') && error.includes('not found'))
  )
}

const isDuplicateBucketError = (payload) => {
  const message = normalizeTextInput(payload?.message, { maxLength: 240 }).toLowerCase()
  const error = normalizeTextInput(payload?.error, { maxLength: 240 }).toLowerCase()
  const code = normalizeTextInput(payload?.code, { maxLength: 80 }).toLowerCase()
  return code === '23505' || message.includes('already exists') || error.includes('duplicate')
}

const ensureExportPreviewStorageBucket = async () => {
  if (!isSupabaseConfigured) {
    return { ok: false, status: 500, payload: null }
  }
  if (exportPreviewStorageBucketReady) {
    return { ok: true, status: 200, payload: null }
  }
  try {
    const response = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: createSupabaseServiceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        id: EXPORT_PREVIEW_STORAGE_BUCKET,
        name: EXPORT_PREVIEW_STORAGE_BUCKET,
        public: false,
      }),
    })
    const payload = await response.json().catch(() => null)
    if (response.ok || isDuplicateBucketError(payload)) {
      exportPreviewStorageBucketReady = true
      return { ok: true, status: response.status, payload }
    }
    return { ok: false, status: response.status, payload }
  } catch (_err) {
    return { ok: false, status: 500, payload: null }
  }
}

const writeExportPreviewToSupabaseStorage = async (entry) => {
  if (!isSupabaseConfigured) {
    return { ok: false, status: 500, payload: null }
  }
  const normalizedEntry = normalizeExportPreviewEntry(entry)
  if (!normalizedEntry) {
    return { ok: false, status: 400, payload: null }
  }
  const objectPath = buildExportPreviewStorageObjectPath(normalizedEntry.id)
  if (!objectPath) {
    return { ok: false, status: 400, payload: null }
  }
  const body = JSON.stringify(normalizedEntry)
  const upload = async () => {
    const response = await fetch(buildSupabaseStorageObjectUrl(EXPORT_PREVIEW_STORAGE_BUCKET, objectPath), {
      method: 'POST',
      headers: createSupabaseServiceHeaders({
        'Content-Type': 'application/json',
        'x-upsert': 'true',
      }),
      body,
    })
    const payload = await response.json().catch(() => null)
    return { ok: response.ok, status: response.status, payload }
  }

  const firstAttempt = await upload()
  if (firstAttempt.ok) return firstAttempt
  if (!isMissingExportPreviewBucketError(firstAttempt.status, firstAttempt.payload)) {
    return firstAttempt
  }
  const ensureResult = await ensureExportPreviewStorageBucket()
  if (!ensureResult.ok) return ensureResult
  exportPreviewStorageBucketReady = true
  return upload()
}

const deleteExportPreviewFromSupabaseStorage = async (previewId) => {
  if (!isSupabaseConfigured) return
  const objectPath = buildExportPreviewStorageObjectPath(previewId)
  if (!objectPath) return
  try {
    await fetch(buildSupabaseStorageObjectUrl(EXPORT_PREVIEW_STORAGE_BUCKET, objectPath), {
      method: 'DELETE',
      headers: createSupabaseServiceHeaders(),
    })
  } catch (_err) {
    // Ignore cleanup failures for expired previews.
  }
}

const readExportPreviewFromSupabaseStorage = async (previewId) => {
  if (!isSupabaseConfigured) {
    return { ok: false, status: 500, payload: null, notFound: true, entry: null }
  }
  const objectPath = buildExportPreviewStorageObjectPath(previewId)
  if (!objectPath) {
    return { ok: false, status: 404, payload: null, notFound: true, entry: null }
  }
  try {
    const response = await fetch(buildSupabaseStorageObjectUrl(EXPORT_PREVIEW_STORAGE_BUCKET, objectPath), {
      method: 'GET',
      headers: createSupabaseServiceHeaders(),
    })
    if (response.status === 404) {
      return { ok: false, status: 404, payload: null, notFound: true, entry: null }
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      return { ok: false, status: response.status, payload, notFound: false, entry: null }
    }
    const payload = await response.json().catch(() => null)
    const entry = normalizeExportPreviewEntry(payload)
    if (!entry || isExportPreviewExpired(entry)) {
      await deleteExportPreviewFromSupabaseStorage(previewId)
      return { ok: false, status: 404, payload: null, notFound: true, entry: null }
    }
    return { ok: true, status: 200, payload: null, notFound: false, entry }
  } catch (_err) {
    return { ok: false, status: 500, payload: null, notFound: false, entry: null }
  }
}

const writeExportPreviewToInMemoryStore = (entry) => {
  const normalizedEntry = normalizeExportPreviewEntry(entry)
  if (!normalizedEntry) {
    return { ok: false, status: 400 }
  }
  pruneExpiredExportPreviews()
  exportPreviewStore.set(normalizedEntry.id, {
    ...normalizedEntry,
    createdAt: normalizedEntry.createdAtMs,
  })
  pruneExpiredExportPreviews()
  return { ok: true, status: 200 }
}

const readExportPreviewFromInMemoryStore = (previewId) => {
  const normalizedPreviewId = normalizeTextInput(previewId, { maxLength: 80 })
  if (!isUuid(normalizedPreviewId)) return null
  pruneExpiredExportPreviews()
  const rawEntry = exportPreviewStore.get(normalizedPreviewId)
  if (!rawEntry) return null
  const normalizedEntry = normalizeExportPreviewEntry({
    ...rawEntry,
    createdAtMs: rawEntry.createdAtMs ?? rawEntry.createdAt,
  })
  if (!normalizedEntry || isExportPreviewExpired(normalizedEntry)) {
    exportPreviewStore.delete(normalizedPreviewId)
    return null
  }
  return normalizedEntry
}

const persistExportPreviewEntry = async (entry) => {
  if (isSupabaseConfigured) {
    const result = await writeExportPreviewToSupabaseStorage(entry)
    if (!result.ok) {
      console.error('Failed to persist export preview in Supabase Storage:', {
        status: result.status,
        payload: result.payload,
      })
      return { ok: false, status: result.status || 500 }
    }
    return { ok: true, status: 201 }
  }
  return writeExportPreviewToInMemoryStore(entry)
}

const resolveExportPreviewEntry = async (previewId) => {
  const normalizedPreviewId = normalizeTextInput(previewId, { maxLength: 80 })
  if (!isUuid(normalizedPreviewId)) {
    return { ok: false, status: 404, notFound: true, entry: null }
  }

  let supabaseFailureStatus = 0
  if (isSupabaseConfigured) {
    const supabaseResult = await readExportPreviewFromSupabaseStorage(normalizedPreviewId)
    if (supabaseResult.ok && supabaseResult.entry) {
      return { ok: true, status: 200, notFound: false, entry: supabaseResult.entry }
    }
    if (!supabaseResult.notFound) {
      supabaseFailureStatus = supabaseResult.status || 503
    }
  }

  const inMemoryEntry = readExportPreviewFromInMemoryStore(normalizedPreviewId)
  if (inMemoryEntry) {
    return { ok: true, status: 200, notFound: false, entry: inMemoryEntry }
  }

  if (supabaseFailureStatus) {
    return { ok: false, status: supabaseFailureStatus, notFound: false, entry: null }
  }
  return { ok: false, status: 404, notFound: true, entry: null }
}

const removeExportPreviewEntry = async (previewId) => {
  const normalizedPreviewId = normalizeTextInput(previewId, { maxLength: 80 })
  if (!isUuid(normalizedPreviewId)) return
  exportPreviewStore.delete(normalizedPreviewId)
  if (isSupabaseConfigured) {
    await deleteExportPreviewFromSupabaseStorage(normalizedPreviewId)
  }
}

const pruneExpiredExportPreviews = () => {
  const now = Date.now()
  for (const [id, entry] of exportPreviewStore.entries()) {
    const createdAtMs = Number(entry?.createdAtMs || entry?.createdAt || 0)
    if (!entry || !createdAtMs || now - createdAtMs > EXPORT_PREVIEW_TTL_MS) {
      exportPreviewStore.delete(id)
    }
  }

  if (exportPreviewStore.size <= EXPORT_PREVIEW_MAX_ENTRIES) return
  const ordered = [...exportPreviewStore.values()].sort(
    (left, right) =>
      Number(left?.createdAtMs || left?.createdAt || 0)
      - Number(right?.createdAtMs || right?.createdAt || 0),
  )
  const overflow = exportPreviewStore.size - EXPORT_PREVIEW_MAX_ENTRIES
  for (let index = 0; index < overflow; index += 1) {
    const entry = ordered[index]
    if (!entry) continue
    exportPreviewStore.delete(entry.id)
  }
}

const normalizeEmailInputArray = (value) => {
  if (!Array.isArray(value)) return { validEmails: [], invalidEmails: [] }
  const validEmails = []
  const invalidEmails = []
  const seenValid = new Set()
  const seenInvalid = new Set()

  for (const entry of value.slice(0, MAX_INPUT_LIST_SIZE)) {
    if (typeof entry !== 'string') continue
    const trimmed = normalizeTextInput(entry, { maxLength: 320 }).replace(/\s+/g, '').toLowerCase()
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

const normalizeMemberInviteInputArray = (value) => {
  if (!Array.isArray(value)) return { validMembers: [], invalidEmails: [] }
  const roleByEmail = new Map()
  const invalidEmails = []
  const seenInvalid = new Set()

  for (const entry of value.slice(0, MAX_INPUT_LIST_SIZE)) {
    const rawEmail =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && typeof entry.email === 'string'
          ? entry.email
          : ''
    const rawRole =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? normalizeCampaignMemberRole(entry.role)
        : CAMPAIGN_MEMBER_ROLE_INTERNAL
    const normalizedEmail = normalizeEmail(rawEmail)
    if (!normalizedEmail) {
      const trimmedRawEmail = normalizeTextInput(rawEmail, { maxLength: 320 })
        .replace(/\s+/g, '')
        .toLowerCase()
      if (trimmedRawEmail && !seenInvalid.has(trimmedRawEmail)) {
        seenInvalid.add(trimmedRawEmail)
        invalidEmails.push(trimmedRawEmail)
      }
      continue
    }

    const existingRole = roleByEmail.get(normalizedEmail)
    if (!existingRole || campaignMemberRolePriority(rawRole) > campaignMemberRolePriority(existingRole)) {
      roleByEmail.set(normalizedEmail, rawRole)
    }
  }

  const validMembers = [...roleByEmail.entries()].map(([email, role]) => ({ email, role }))
  return { validMembers, invalidEmails }
}

const campaignMemberRolePriority = (role) => {
  const normalized = normalizeCampaignMemberRole(role)
  if (normalized === CAMPAIGN_MEMBER_ROLE_ADMIN) return 3
  if (normalized === CAMPAIGN_MEMBER_ROLE_INTERNAL) return 2
  return 1
}

const organizationMemberRolePriority = (role) => {
  const normalized = normalizeOrganizationMemberRole(role)
  if (normalized === ORGANIZATION_MEMBER_ROLE_ADMIN) return 3
  if (normalized === ORGANIZATION_MEMBER_ROLE_INTERNAL) return 2
  return 1
}

const normalizeOrganizationMemberInviteInputArray = (value) => {
  if (!Array.isArray(value)) return { validMembers: [], invalidEmails: [] }
  const roleByEmail = new Map()
  const invalidEmails = []
  const seenInvalid = new Set()

  for (const entry of value.slice(0, MAX_INPUT_LIST_SIZE)) {
    const rawEmail =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && typeof entry.email === 'string'
          ? entry.email
          : ''
    const rawRole =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? normalizeOrganizationMemberRole(entry.role)
        : ORGANIZATION_MEMBER_ROLE_INTERNAL
    const normalizedEmail = normalizeEmail(rawEmail)
    if (!normalizedEmail) {
      const trimmedRawEmail = normalizeTextInput(rawEmail, { maxLength: 320 })
        .replace(/\s+/g, '')
        .toLowerCase()
      if (trimmedRawEmail && !seenInvalid.has(trimmedRawEmail)) {
        seenInvalid.add(trimmedRawEmail)
        invalidEmails.push(trimmedRawEmail)
      }
      continue
    }

    const existingRole = roleByEmail.get(normalizedEmail)
    if (!existingRole || organizationMemberRolePriority(rawRole) > organizationMemberRolePriority(existingRole)) {
      roleByEmail.set(normalizedEmail, rawRole)
    }
  }

  const validMembers = [...roleByEmail.entries()].map(([email, role]) => ({ email, role }))
  return { validMembers, invalidEmails }
}

const normalizeMemberRoleUpdateInputArray = (value) => {
  if (!Array.isArray(value)) return { validUpdates: [], invalidUserIds: [] }
  const roleByUserId = new Map()
  const invalidUserIds = []
  const seenInvalid = new Set()

  for (const entry of value.slice(0, MAX_INPUT_LIST_SIZE)) {
    const rawUserId =
      entry && typeof entry === 'object' && typeof entry.userId === 'string' ? entry.userId : ''
    const userId = normalizeTextInput(rawUserId, { maxLength: 80 })
    if (!isUuid(userId)) {
      if (userId && !seenInvalid.has(userId)) {
        seenInvalid.add(userId)
        invalidUserIds.push(userId)
      }
      continue
    }

    const role =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? normalizeCampaignMemberRole(entry.role)
        : CAMPAIGN_MEMBER_ROLE_INTERNAL
    roleByUserId.set(userId, role)
  }

  const validUpdates = [...roleByUserId.entries()].map(([userId, role]) => ({ userId, role }))
  return { validUpdates, invalidUserIds }
}

const normalizeOrganizationMemberRoleUpdateInputArray = (value) => {
  if (!Array.isArray(value)) return { validUpdates: [], invalidUserIds: [] }
  const roleByUserId = new Map()
  const invalidUserIds = []
  const seenInvalid = new Set()

  for (const entry of value.slice(0, MAX_INPUT_LIST_SIZE)) {
    const rawUserId =
      entry && typeof entry === 'object' && typeof entry.userId === 'string' ? entry.userId : ''
    const userId = normalizeTextInput(rawUserId, { maxLength: 80 })
    if (!isUuid(userId)) {
      if (userId && !seenInvalid.has(userId)) {
        seenInvalid.add(userId)
        invalidUserIds.push(userId)
      }
      continue
    }

    const role =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? normalizeOrganizationMemberRole(entry.role)
        : ORGANIZATION_MEMBER_ROLE_INTERNAL
    roleByUserId.set(userId, role)
  }

  const validUpdates = [...roleByUserId.entries()].map(([userId, role]) => ({ userId, role }))
  return { validUpdates, invalidUserIds }
}

const normalizeOrganizationCampaignAccessUpdateInputArray = (value) => {
  if (!Array.isArray(value)) return { validUpdates: [], invalidEntries: [] }
  const updatesByKey = new Map()
  const invalidEntries = []
  const seenInvalid = new Set()

  for (const entry of value.slice(0, MAX_INPUT_LIST_SIZE)) {
    const campaignId =
      entry && typeof entry === 'object' && typeof entry.campaignId === 'string'
        ? normalizeTextInput(entry.campaignId, { maxLength: 80 })
        : ''
    const userId =
      entry && typeof entry === 'object' && typeof entry.userId === 'string'
        ? normalizeTextInput(entry.userId, { maxLength: 80 })
        : ''
    const hasAccessRaw =
      entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'hasAccess')
        ? entry.hasAccess
        : null
    const hasAccess =
      typeof hasAccessRaw === 'boolean'
        ? hasAccessRaw
        : typeof hasAccessRaw === 'string'
          ? hasAccessRaw.trim().toLowerCase() === 'true'
          : null

    if (!isUuid(campaignId) || !isUuid(userId) || hasAccess === null) {
      const invalidKey = `${campaignId || 'invalid_campaign'}:${userId || 'invalid_user'}`
      if (!seenInvalid.has(invalidKey)) {
        seenInvalid.add(invalidKey)
        invalidEntries.push({ campaignId, userId })
      }
      continue
    }

    updatesByKey.set(`${campaignId}:${userId}`, {
      campaignId,
      userId,
      hasAccess,
    })
  }

  return {
    validUpdates: [...updatesByKey.values()],
    invalidEntries,
  }
}

const resolveCampaignUserRole = (row, userId) => {
  if (!isUuid(userId)) return ''
  const creator = normalizeTextInput(row?.creator, { maxLength: 80 })
  if (creator && creator === userId) return CAMPAIGN_MEMBER_ROLE_ADMIN
  const allowedMemberRoles = normalizeCampaignMemberRoles(row?.allowed_members, creator)
  return allowedMemberRoles[userId] || ''
}

const resolveCampaignOrgScopedRole = (
  row,
  { organizationIds = [], organizationAdminIds = [], organizationBrandViewerIds = [] } = {},
) => {
  const allowedOrgs = normalizeUuidArray(row?.allowed_orgs)
  if (!allowedOrgs.length) return ''
  const adminOrgIdSet = new Set(normalizeUuidArray(organizationAdminIds))
  if (allowedOrgs.some((organizationId) => adminOrgIdSet.has(organizationId))) {
    return CAMPAIGN_MEMBER_ROLE_ADMIN
  }
  const internalOrgIdSet = new Set(normalizeUuidArray(organizationIds))
  if (allowedOrgs.some((organizationId) => internalOrgIdSet.has(organizationId))) {
    return CAMPAIGN_MEMBER_ROLE_INTERNAL
  }
  const brandViewerOrgIdSet = new Set(normalizeUuidArray(organizationBrandViewerIds))
  if (allowedOrgs.some((organizationId) => brandViewerOrgIdSet.has(organizationId))) {
    return CAMPAIGN_MEMBER_ROLE_BRAND_VIEWER
  }
  return ''
}

const resolveCampaignEffectiveRole = (
  row,
  userId,
  { organizationIds = [], organizationAdminIds = [], organizationBrandViewerIds = [] } = {},
) => {
  const explicitRole = resolveCampaignUserRole(row, userId)
  const orgScopedRole = resolveCampaignOrgScopedRole(row, {
    organizationIds,
    organizationAdminIds,
    organizationBrandViewerIds,
  })
  if (!explicitRole) return orgScopedRole
  if (!orgScopedRole) return explicitRole
  return campaignMemberRolePriority(orgScopedRole) > campaignMemberRolePriority(explicitRole)
    ? orgScopedRole
    : explicitRole
}

const canUserManageCampaignDetails = (row, userId, organizationAdminIds = []) => {
  return resolveCampaignEffectiveRole(row, userId, { organizationAdminIds }) === CAMPAIGN_MEMBER_ROLE_ADMIN
}

const canUserManageCampaignPosts = (row, userId, organizationIds = [], organizationAdminIds = []) => {
  const role = resolveCampaignEffectiveRole(row, userId, { organizationIds, organizationAdminIds })
  return role === CAMPAIGN_MEMBER_ROLE_ADMIN || role === CAMPAIGN_MEMBER_ROLE_INTERNAL
}

const canUserDeleteCampaign = (row, userId, organizationAdminIds = []) =>
  resolveCampaignEffectiveRole(row, userId, { organizationAdminIds }) === CAMPAIGN_MEMBER_ROLE_ADMIN

const canUserManageCampaignMembers = (row, userId, organizationAdminIds = []) => {
  return resolveCampaignEffectiveRole(row, userId, { organizationAdminIds }) === CAMPAIGN_MEMBER_ROLE_ADMIN
}

const canUserViewCampaignMembers = (row, userId, organizationIds = [], organizationAdminIds = []) =>
  Boolean(resolveCampaignEffectiveRole(row, userId, { organizationIds, organizationAdminIds }))

const canUserChangeCampaignMemberRoles = (row, userId, organizationAdminIds = []) =>
  resolveCampaignEffectiveRole(row, userId, { organizationAdminIds }) === CAMPAIGN_MEMBER_ROLE_ADMIN

const hasIntersection = (left, right) => {
  if (!left.length || !right.length) return false
  const rightSet = new Set(right)
  return left.some((value) => rightSet.has(value))
}

const normalizeDateOnly = (value) => {
  const trimmed = normalizeTextInput(value, { maxLength: 32 })
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

const readCampaignDistributionObject = (value) => {
  const normalizedValue = normalizeJsonValue(value)
  if (normalizedValue && typeof normalizedValue === 'object' && !Array.isArray(normalizedValue)) {
    return { ...normalizedValue }
  }

  if (typeof normalizedValue === 'string') {
    const trimmed = normalizedValue.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { ...parsed }
        }
      } catch {
        return {}
      }
    }
  }

  return {}
}

const readCampaignSelectedPostIds = (distributionSources) =>
  normalizeStringArray(distributionSources?.[CAMPAIGN_SELECTED_POST_IDS_KEY])

const readCampaignSelectedChannelId = (distributionSources) => {
  const rawValue = distributionSources?.[CAMPAIGN_SELECTED_CHANNEL_ID_KEY]
  return normalizeTextInput(rawValue, { maxLength: 300 })
}

const normalizeCampaignManagedPostObject = (value, fallbackId = '') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value
  const id = normalizeTextInput(source.id, { maxLength: 300 }) || normalizeTextInput(fallbackId, { maxLength: 300 })
  if (!id) return null
  const title = normalizeTextInput(source.title, { maxLength: 300 }) || 'Untitled post'
  const platform = normalizeTextInput(source.platform, { maxLength: 64 }) || 'YouTube'
  const channelId = normalizeTextInput(source.channelId, { maxLength: 300 })
  const channelName = normalizeTextInput(source.channelName, { maxLength: 180 })
  const views = Math.max(0, toNumber(source.views))
  const engagementRate = Math.max(0, toNumber(source.engagementRate))
  return {
    id,
    title,
    platform,
    channelId,
    channelName,
    views,
    engagementRate,
  }
}

const readCampaignPostsByChannel = (value) => {
  const parseArray = (input) => {
    if (Array.isArray(input)) return input
    if (typeof input === 'string') {
      const trimmed = input.trim()
      if (!trimmed) return []
      try {
        const parsed = JSON.parse(trimmed)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    return []
  }

  const groups = parseArray(value)
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const channelId = normalizeTextInput(entry.channelId, { maxLength: 300 })
      const channelName = normalizeTextInput(entry.channelName, { maxLength: 180 })
      const platform = normalizeTextInput(entry.platform, { maxLength: 64 }) || 'YouTube'
      const postsSource = entry.posts
      if (!postsSource || typeof postsSource !== 'object' || Array.isArray(postsSource)) return null
      const posts = {}
      Object.entries(postsSource).forEach(([postId, postValue]) => {
        const normalizedPost = normalizeCampaignManagedPostObject(postValue, postId)
        if (!normalizedPost) return
        posts[normalizedPost.id] = normalizedPost
      })
      if (!Object.keys(posts).length) return null
      return {
        channelId,
        channelName,
        platform,
        posts,
      }
    })
    .filter(Boolean)

  return groups
}

const flattenCampaignManagedPosts = (groups) => {
  if (!Array.isArray(groups)) return []
  const byId = new Map()
  groups.forEach((group) => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return
    const channelId = normalizeTextInput(group.channelId, { maxLength: 300 })
    const channelName = normalizeTextInput(group.channelName, { maxLength: 180 })
    const platform = normalizeTextInput(group.platform, { maxLength: 64 }) || 'YouTube'
    const postsSource = group.posts
    if (!postsSource || typeof postsSource !== 'object' || Array.isArray(postsSource)) return
    Object.entries(postsSource).forEach(([postId, postValue]) => {
      const normalizedPost = normalizeCampaignManagedPostObject(
        {
          ...(postValue && typeof postValue === 'object' && !Array.isArray(postValue) ? postValue : {}),
          channelId,
          channelName,
          platform,
        },
        postId,
      )
      if (!normalizedPost) return
      byId.set(normalizedPost.id, normalizedPost)
    })
  })
  return [...byId.values()]
}

const normalizeCampaignManagedPostsInput = (value) => {
  if (!Array.isArray(value)) return []
  const byId = new Map()
  value.slice(0, MAX_INPUT_LIST_SIZE).forEach((entry) => {
    const normalizedPost = normalizeCampaignManagedPostObject(entry)
    if (!normalizedPost) return
    byId.set(normalizedPost.id, normalizedPost)
  })
  return [...byId.values()]
}

const buildCampaignPostsByChannel = (posts) => {
  if (!Array.isArray(posts) || !posts.length) return []
  const channelKeyToGroup = new Map()
  posts.forEach((post) => {
    const normalizedPost = normalizeCampaignManagedPostObject(post)
    if (!normalizedPost) return
    const channelId = normalizedPost.channelId || ''
    const channelName = normalizedPost.channelName || ''
    const platform = normalizedPost.platform || 'YouTube'
    const groupKey = `${channelId}::${channelName}::${platform}`
    if (!channelKeyToGroup.has(groupKey)) {
      channelKeyToGroup.set(groupKey, {
        channelId,
        channelName,
        platform,
        posts: {},
      })
    }
    const group = channelKeyToGroup.get(groupKey)
    group.posts[normalizedPost.id] = normalizedPost
  })
  return [...channelKeyToGroup.values()].filter((group) => Object.keys(group.posts).length)
}

const formatCampaignDistributionValueForWrite = (distributionObject, currentRawValue) => {
  const sanitizedDistribution = sanitizeDistributionSources(distributionObject)
  if (typeof currentRawValue === 'string') {
    try {
      return JSON.stringify(sanitizedDistribution ?? {})
    } catch {
      return currentRawValue
    }
  }
  return sanitizedDistribution
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
  const selectFields = encodeURIComponent('*')
  const userFilter = encodeURIComponent(userId)
  const endpoints = buildSupabaseTableEndpoints('Users', `select=${selectFields}&id=eq.${userFilter}&limit=1`)

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
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
  const endpoints = buildSupabaseTableEndpoints(
    'Users',
    `select=${selectFields}&email=ilike.${emailFilter}&limit=1`,
  )

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
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
  const endpoints = buildSupabaseTableEndpoints('Users', `select=${selectFields}&id=${idFilter}`)

  let lastResult = { ok: false, status: 500, payload: null, rows: [] }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
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

const resolveMemberIdsFromEmails = async (members) => {
  const resolution = buildEmptyMemberResolution()
  const resolvedMembersByUserId = new Map()

  for (const member of members) {
    const email = normalizeEmail(member?.email)
    const role = normalizeCampaignMemberRole(member?.role)
    if (!email) continue
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

    const userId = normalizeTextInput(lookupResult.row?.id, { maxLength: 80 })
    if (!isUuid(userId)) {
      resolution.failed.push({
        action: 'add',
        email,
        error: 'user_not_found',
        message: 'No matching user was found for this email.',
      })
      continue
    }

    const existingMember = resolvedMembersByUserId.get(userId)
    if (
      !existingMember ||
      campaignMemberRolePriority(role) > campaignMemberRolePriority(existingMember.role)
    ) {
      resolvedMembersByUserId.set(userId, {
        userId,
        role,
      })
    }

    resolution.added.push({
      action: 'add',
      email,
      userId,
      message: `User added to campaign members as ${role}.`,
    })
  }

  return {
    resolvedMembers: [...resolvedMembersByUserId.values()],
    resolution,
  }
}

const resolveOrganizationMemberIdsFromEmails = async (members) => {
  const resolution = buildEmptyMemberResolution()
  const resolvedMembersByUserId = new Map()

  for (const member of members) {
    const email = normalizeEmail(member?.email)
    const role = normalizeOrganizationMemberRole(member?.role)
    if (!email) continue
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

    const userId = normalizeTextInput(lookupResult.row?.id, { maxLength: 80 })
    if (!isUuid(userId)) {
      resolution.failed.push({
        action: 'add',
        email,
        error: 'user_not_found',
        message: 'No matching user was found for this email.',
      })
      continue
    }

    const existingMember = resolvedMembersByUserId.get(userId)
    if (
      !existingMember ||
      organizationMemberRolePriority(role) > organizationMemberRolePriority(existingMember.role)
    ) {
      resolvedMembersByUserId.set(userId, {
        userId,
        email,
        role,
      })
    }
  }

  for (const member of resolvedMembersByUserId.values()) {
    const email = normalizeEmail(member?.email) || normalizeTextInput(member?.userId, { maxLength: 80 })
    const role = normalizeOrganizationMemberRole(member?.role)
    const userId = normalizeTextInput(member?.userId, { maxLength: 80 })
    resolution.added.push({
      action: 'add',
      email,
      userId,
      message: `User added to organization members as ${role}.`,
    })
  }

  return {
    resolvedMembers: [...resolvedMembersByUserId.values()],
    resolution,
  }
}

const resolveAuthedUserContext = async (req, res) => {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      status: 500,
      error: 'supabase_not_configured',
      message: `Supabase config is missing. Set: ${getMissingSupabaseConfigKeys().join(', ')}.`,
      details: buildSupabaseConfigDiagnostic(),
    }
  }

  const { accessToken, refreshToken } = readSupabaseSessionTokens(req)
  let resolvedAccessToken = accessToken
  if (!resolvedAccessToken && refreshToken) {
    const refreshedSession = await refreshSupabaseSession(refreshToken)
    if (refreshedSession?.access_token) {
      setSupabaseSessionCookies(res, refreshedSession)
      resolvedAccessToken = refreshedSession.access_token
    } else {
      clearSupabaseSessionCookies(res)
    }
  }
  if (!resolvedAccessToken) {
    return {
      ok: false,
      status: 401,
      error: 'not_authenticated',
      message: 'Missing Supabase session token.',
    }
  }

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

  const organizationIdsFromUserRow = normalizeUuidArray(appUserResult.row?.organization_ids)
  let organizationIds = [...organizationIdsFromUserRow]
  let organizationAdminIds = []
  let organizationBrandViewerIds = []
  let appRole = normalizeAppRole(appUserResult.row?.role)
  const organizationsResult = await listOrganizationRows()
  if (organizationsResult.ok) {
    const internalOrAdminOrganizationIds = []
    const adminOrganizationIds = []
    const brandViewerOrganizationIds = []
    let hasBrandOrganizationMembership = false
    for (const row of organizationsResult.rows) {
      const organizationId = normalizeTextInput(row?.id, { maxLength: 80 })
      if (!isUuid(organizationId)) continue
      const organizationRole = resolveOrganizationUserRole(row, userId)
      if (organizationRole === ORGANIZATION_MEMBER_ROLE_ADMIN) {
        internalOrAdminOrganizationIds.push(organizationId)
        adminOrganizationIds.push(organizationId)
      } else if (organizationRole === ORGANIZATION_MEMBER_ROLE_INTERNAL) {
        internalOrAdminOrganizationIds.push(organizationId)
      } else if (organizationRole === ORGANIZATION_MEMBER_ROLE_BRAND_VIEWER) {
        hasBrandOrganizationMembership = true
        brandViewerOrganizationIds.push(organizationId)
      }
    }
    organizationIds = uniqueValues(internalOrAdminOrganizationIds)
    organizationAdminIds = uniqueValues(adminOrganizationIds)
    organizationBrandViewerIds = uniqueValues(brandViewerOrganizationIds)
    if (organizationAdminIds.length) {
      appRole = APP_ROLE_ADMIN
    } else if (organizationIds.length) {
      appRole = APP_ROLE_INTERNAL
    } else if (hasBrandOrganizationMembership) {
      appRole = APP_ROLE_BRAND
    }
  } else if (organizationIdsFromUserRow.length) {
    // Fall back to Users.organization_ids when Organizations read fails.
    organizationIds = organizationIdsFromUserRow
    organizationAdminIds = []
    organizationBrandViewerIds = []
  }
  return {
    ok: true,
    userId,
    email,
    accessToken: resolvedAccessToken,
    organizationIds,
    organizationAdminIds,
    organizationBrandViewerIds,
    appRole,
  }
}

const listCampaignRows = async () => {
  const selectFields = encodeURIComponent(
    'id,created_at,campaign_name,brand,start_date,end_date,views_delivered,guaranteed,engagement_rate,allowed_orgs,distribution_sources,posts,allowed_members,creator',
  )
  const endpoints = buildSupabaseTableEndpoints('Campaigns', `select=${selectFields}&order=created_at.desc`)

  let lastResult = { ok: false, status: 500, payload: null, rows: [] }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
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

const buildCampaignNameById = (rows) => {
  const campaignNameById = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = normalizeTextInput(row?.id, { maxLength: 80 })
    if (!isUuid(id)) continue
    const name = normalizeTextInput(row?.campaign_name ?? row?.campaignName, { maxLength: 140 })
    if (!name) continue
    campaignNameById.set(id, name)
  }
  return campaignNameById
}

const summarizeInvalidCampaignNames = (invalidCampaignIds, campaignRows) => {
  const campaignNameById = buildCampaignNameById(campaignRows)
  const invalidCampaignNames = uniqueValues(
    invalidCampaignIds
      .map((campaignId) => campaignNameById.get(campaignId) || '')
      .filter((name) => Boolean(name)),
  )
  return invalidCampaignNames.slice(0, 5)
}

const listCampaignNameRowsByIds = async (campaignIds) => {
  const normalizedCampaignIds = uniqueValues(normalizeUuidArray(campaignIds))
  if (!normalizedCampaignIds.length) {
    return { ok: true, status: 200, payload: [], rows: [] }
  }

  const selectFields = encodeURIComponent('id,campaign_name')
  const rows = []
  const chunkSize = 100

  for (let index = 0; index < normalizedCampaignIds.length; index += chunkSize) {
    const chunk = normalizedCampaignIds.slice(index, index + chunkSize)
    const campaignFilter = encodeURIComponent(
      `in.(${chunk.map((value) => value.replace(/,/g, '')).join(',')})`,
    )
    const endpoints = buildSupabaseTableEndpoints(
      'Campaigns',
      `select=${selectFields}&id=${campaignFilter}`,
    )

    let lastResult = { ok: false, status: 500, payload: null }
    for (const endpoint of endpoints) {
      const response = await fetch(endpoint, {
        headers: {
          apikey: supabaseSecretKey,
          ...buildSupabaseServiceAuthorizationHeader(),
        },
      })
      const payload = await response.json().catch(() => null)
      const result = {
        ok: response.ok,
        status: response.status,
        payload,
      }
      if (result.ok) {
        rows.push(...(Array.isArray(payload) ? payload : []))
        lastResult = result
        break
      }
      lastResult = result
      if (response.status !== 404) break
    }

    if (!lastResult.ok) {
      return { ...lastResult, rows: [] }
    }
  }

  return {
    ok: true,
    status: 200,
    payload: rows,
    rows,
  }
}

const resolveCampaignNameByIdForOrganizations = async (organizationRows) => {
  const campaignIds = uniqueValues(
    (Array.isArray(organizationRows) ? organizationRows : [])
      .flatMap((row) => normalizeUuidArray(row?.campaigns)),
  )
  if (!campaignIds.length) return new Map()

  const campaignNameResult = await listCampaignNameRowsByIds(campaignIds)
  if (!campaignNameResult.ok) {
    console.error('Unable to resolve campaign names for organizations:', {
      status: campaignNameResult.status,
      details: campaignNameResult.payload,
    })
    return new Map()
  }

  return buildCampaignNameById(campaignNameResult.rows)
}

const insertCampaignRow = async (row) => {
  const endpoints = buildSupabaseTableEndpoints('Campaigns')

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
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
    'id,created_at,campaign_name,brand,start_date,end_date,views_delivered,guaranteed,engagement_rate,allowed_members,allowed_orgs,distribution_sources,posts,creator',
  )
  const campaignFilter = encodeURIComponent(campaignId)
  const endpoints = buildSupabaseTableEndpoints(
    'Campaigns',
    `select=${selectFields}&id=eq.${campaignFilter}&limit=1`,
  )

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
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

const updateCampaignAllowedMembers = async (campaignId, allowedMemberRoles, creatorId = '') => {
  const normalizedAllowedMembers = normalizeCampaignMemberRoles(allowedMemberRoles, creatorId)
  const campaignFilter = encodeURIComponent(campaignId)
  const endpoints = buildSupabaseTableEndpoints('Campaigns', `id=eq.${campaignFilter}`)

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        allowed_members: normalizedAllowedMembers,
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

const updateCampaignPostsAndMetrics = async (campaignId, input) => {
  const campaignFilter = encodeURIComponent(campaignId)
  const endpoints = buildSupabaseTableEndpoints('Campaigns', `id=eq.${campaignFilter}`)

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        views_delivered: Math.max(0, toNumber(input.viewsDelivered)),
        engagement_rate: Math.max(0, toNumber(input.engagementRate)),
        distribution_sources: input.distributionSources,
        posts: Array.isArray(input.posts) ? input.posts : [],
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

const updateCampaignDetails = async (campaignId, input) => {
  const campaignFilter = encodeURIComponent(campaignId)
  const endpoints = buildSupabaseTableEndpoints('Campaigns', `id=eq.${campaignFilter}`)

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        campaign_name: input.campaignName,
        brand: input.brand,
        start_date: input.startDate,
        end_date: input.endDate,
        guaranteed: Math.max(0, toNumber(input.guaranteed)),
        engagement_rate: Math.max(0, toNumber(input.engagementRate)),
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

const updateCampaignAllowedOrgs = async (campaignId, allowedOrgs) => {
  const campaignFilter = encodeURIComponent(campaignId)
  const normalizedAllowedOrgs = normalizeUuidArray(allowedOrgs)
  const endpoints = buildSupabaseTableEndpoints('Campaigns', `id=eq.${campaignFilter}`)

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        allowed_orgs: normalizedAllowedOrgs.length ? normalizedAllowedOrgs : null,
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
  const endpoints = buildSupabaseTableEndpoints('Campaigns', `id=eq.${campaignFilter}`)

  let lastResult = { ok: false, status: 500, payload: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
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

const canUserSeeCampaign = (
  row,
  userId,
  organizationIds = [],
  organizationAdminIds = [],
  organizationBrandViewerIds = [],
) => {
  const viewerRole = resolveCampaignEffectiveRole(row, userId, {
    organizationIds,
    organizationAdminIds,
    organizationBrandViewerIds,
  })
  return Boolean(viewerRole)
}

const buildCampaignMemberIds = (row) => {
  const creatorId = normalizeTextInput(row?.creator, { maxLength: 80 })
  const allowedMemberRoles = normalizeCampaignMemberRoles(row?.allowed_members, creatorId)
  return Object.keys(allowedMemberRoles)
}

const mapCampaignMembersForClient = (memberIds, userRows, memberRoles = {}) => {
  const userEmailById = new Map(
    (Array.isArray(userRows) ? userRows : [])
      .filter((row) => row && typeof row === 'object')
      .map((row) => {
        const id = normalizeTextInput(row.id, { maxLength: 80 })
        const email = normalizeEmail(row.email)
        return [id, email]
      }),
  )

  return memberIds.map((id) => ({
    id,
    email: userEmailById.get(id) || '',
    role: normalizeCampaignMemberRole(memberRoles[id]),
  }))
}

const mapCampaignForClient = (row, options = {}) => {
  const creator = normalizeTextInput(row?.creator, { maxLength: 80 })
  const id = normalizeTextInput(row?.id, { maxLength: 80 })
  const createdAt = normalizeTextInput(row?.created_at, { maxLength: 64 })
  const campaignName = normalizeTextInput(row?.campaign_name, { maxLength: 140 })
  const brand = normalizeTextInput(row?.brand, { maxLength: 140 })
  const startDate = normalizeDateOnly(row?.start_date)
  const endDate = normalizeDateOnly(row?.end_date)
  const viewsDelivered = toNumber(row?.views_delivered)
  const guaranteed = toNumber(row?.guaranteed)
  const engagementRate = toNumber(row?.engagement_rate)
  const distributionSources = readCampaignDistributionObject(row?.distribution_sources)
  const visibleChannelIds = options?.visibleChannelIds instanceof Set ? options.visibleChannelIds : null
  const posts = readCampaignPostsByChannel(row?.posts)
  const scopedPosts = visibleChannelIds
    ? posts.filter((group) => {
      const channelId = normalizeTextInput(group?.channelId, { maxLength: 300 })
      return Boolean(channelId && visibleChannelIds.has(channelId))
    })
    : posts
  const selectedPostIdsFromPosts = flattenCampaignManagedPosts(posts).map((post) => post.id)
  const selectedPostIdsFromDistribution = readCampaignSelectedPostIds(distributionSources)
  const normalizedSelectedPostIds = uniqueValues(
    [...selectedPostIdsFromPosts, ...selectedPostIdsFromDistribution]
      .map((value) => normalizeTextInput(value, { maxLength: 300 }))
      .filter((value) => value.length > 0),
  )
  const selectedPostIds = (() => {
    if (!visibleChannelIds) return normalizedSelectedPostIds
    const visiblePostIds = new Set(flattenCampaignManagedPosts(scopedPosts).map((post) => post.id))
    return normalizedSelectedPostIds.filter((postId) => visiblePostIds.has(postId))
  })()
  const selectedChannelIdRaw = readCampaignSelectedChannelId(distributionSources)
  const selectedChannelId = (() => {
    const fallbackChannelId = selectedChannelIdRaw || scopedPosts[0]?.channelId || ''
    if (!visibleChannelIds) return fallbackChannelId
    return fallbackChannelId && visibleChannelIds.has(fallbackChannelId) ? fallbackChannelId : ''
  })()
  const distributionSourcesForClient = { ...distributionSources }
  if (visibleChannelIds) {
    distributionSourcesForClient[CAMPAIGN_SELECTED_POST_IDS_KEY] = selectedPostIds
    if (selectedChannelId) {
      distributionSourcesForClient[CAMPAIGN_SELECTED_CHANNEL_ID_KEY] = selectedChannelId
    } else {
      delete distributionSourcesForClient[CAMPAIGN_SELECTED_CHANNEL_ID_KEY]
    }
  }
  const allowedMemberRoles = normalizeCampaignMemberRoles(row?.allowed_members, creator)
  const viewerUserId = normalizeTextInput(options?.viewerUserId, { maxLength: 80 })
  if (isUuid(viewerUserId)) {
    const effectiveViewerRole = resolveCampaignEffectiveRole(row, viewerUserId, {
      organizationIds: normalizeUuidArray(options?.viewerOrganizationIds),
      organizationAdminIds: normalizeUuidArray(options?.viewerOrganizationAdminIds),
      organizationBrandViewerIds: normalizeUuidArray(options?.viewerOrganizationBrandViewerIds),
    })
    if (effectiveViewerRole) {
      const existingViewerRole = allowedMemberRoles[viewerUserId]
      if (
        !existingViewerRole
        || campaignMemberRolePriority(effectiveViewerRole) > campaignMemberRolePriority(existingViewerRole)
      ) {
        allowedMemberRoles[viewerUserId] = effectiveViewerRole
      }
    }
  }

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
    distributionSources: distributionSourcesForClient,
    selectedPostIds,
    selectedChannelId,
    posts: scopedPosts,
    allowedMembers: Object.keys(allowedMemberRoles),
    allowedMemberRoles,
    creator,
  }
}

const listOrganizationRows = async () => {
  const selectFields = encodeURIComponent('id,created_at,name,campaigns,members,creator,connected_accounts')
  const endpoints = buildSupabaseTableEndpoints(
    'Organizations',
    `select=${selectFields}&order=created_at.desc`,
  )

  let lastResult = { ok: false, status: 500, payload: null, rows: [] }
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          apikey: supabaseSecretKey,
          ...buildSupabaseServiceAuthorizationHeader(),
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
    } catch (_err) {
      lastResult = { ok: false, status: 500, payload: null, rows: [] }
    }
  }

  return lastResult
}

const insertOrganizationRow = async (row) => {
  const endpoints = buildSupabaseTableEndpoints('Organizations')

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
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

const fetchOrganizationRowById = async (organizationId) => {
  const selectFields = encodeURIComponent('id,created_at,name,campaigns,members,creator,connected_accounts')
  const organizationFilter = encodeURIComponent(organizationId)
  const endpoints = buildSupabaseTableEndpoints(
    'Organizations',
    `select=${selectFields}&id=eq.${organizationFilter}&limit=1`,
  )

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
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

const updateOrganizationMembers = async (organizationId, memberRoles, creatorId = '') => {
  const normalizedMemberRoles = normalizeOrganizationMemberRoles(memberRoles, creatorId)
  const organizationFilter = encodeURIComponent(organizationId)
  const endpoints = buildSupabaseTableEndpoints('Organizations', `id=eq.${organizationFilter}`)

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        members: normalizedMemberRoles,
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

const updateOrganizationDetails = async (organizationId, input) => {
  const organizationFilter = encodeURIComponent(organizationId)
  const endpoints = buildSupabaseTableEndpoints('Organizations', `id=eq.${organizationFilter}`)

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        name: input.name,
        campaigns: input.campaigns,
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

const updateOrganizationConnectedAccounts = async (organizationId, connectedAccounts) => {
  const organizationFilter = encodeURIComponent(organizationId)
  const endpoints = buildSupabaseTableEndpoints('Organizations', `id=eq.${organizationFilter}`)
  const normalizedAccounts = normalizeOrganizationConnectedAccounts(connectedAccounts)

  let lastResult = { ok: false, status: 500, payload: null, row: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        connected_accounts: normalizedAccounts,
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

const deleteOrganizationRowById = async (organizationId) => {
  const organizationFilter = encodeURIComponent(organizationId)
  const endpoints = buildSupabaseTableEndpoints('Organizations', `id=eq.${organizationFilter}`)

  let lastResult = { ok: false, status: 500, payload: null }
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        apikey: supabaseSecretKey,
        ...buildSupabaseServiceAuthorizationHeader(),
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

const mapOrganizationMembersForClient = (memberRoles, userRows = []) => {
  const emailByUserId = new Map(
    (Array.isArray(userRows) ? userRows : [])
      .filter((row) => row && typeof row === 'object')
      .map((row) => {
        const id = normalizeTextInput(row.id, { maxLength: 80 })
        const email = normalizeEmail(row.email)
        return [id, email]
      }),
  )

  return Object.entries(memberRoles).map(([userId, role]) => ({
    id: userId,
    email: emailByUserId.get(userId) || '',
    role: normalizeOrganizationMemberRole(role),
  }))
}

const resolveOrganizationUserRole = (row, userId) => {
  if (!isUuid(userId)) return ''
  const creator = normalizeTextInput(row?.creator, { maxLength: 80 })
  if (creator && creator === userId) return ORGANIZATION_MEMBER_ROLE_ADMIN
  const memberRoles = normalizeOrganizationMemberRoles(row?.members, creator)
  const role = memberRoles[userId]
  return role ? normalizeOrganizationMemberRole(role) : ''
}

const canUserManageOrganizationDetails = (row, userId) =>
  [ORGANIZATION_MEMBER_ROLE_ADMIN, ORGANIZATION_MEMBER_ROLE_INTERNAL].includes(
    resolveOrganizationUserRole(row, userId),
  )

const canUserDeleteOrganization = (row, userId) =>
  resolveOrganizationUserRole(row, userId) === ORGANIZATION_MEMBER_ROLE_ADMIN

const canUserManageOrganizationMembers = (row, userId) => {
  return resolveOrganizationUserRole(row, userId) === ORGANIZATION_MEMBER_ROLE_ADMIN
}

const canUserManageOrganizationConnections = (row, userId) => {
  return resolveOrganizationUserRole(row, userId) === ORGANIZATION_MEMBER_ROLE_ADMIN
}

const canUserChangeOrganizationMemberRoles = (row, userId) =>
  resolveOrganizationUserRole(row, userId) === ORGANIZATION_MEMBER_ROLE_ADMIN

const canUserSeeOrganization = (row, userId) => {
  if (!isUuid(userId)) return false
  const creator = normalizeTextInput(row?.creator, { maxLength: 80 })
  if (creator && creator === userId) return true
  const memberRoles = normalizeOrganizationMemberRoles(row?.members, creator)
  return Boolean(memberRoles[userId])
}

const canUserAccessOrganizationChannels = (row, userId) => {
  const role = resolveOrganizationUserRole(row, userId)
  return role === ORGANIZATION_MEMBER_ROLE_ADMIN || role === ORGANIZATION_MEMBER_ROLE_INTERNAL
}

const mapOrganizationForClient = (row, userRows = [], campaignNameById = new Map()) => {
  const id = normalizeTextInput(row?.id, { maxLength: 80 })
  const createdAt = normalizeTextInput(row?.created_at, { maxLength: 64 })
  const name = normalizeTextInput(row?.name, { maxLength: 140 })
  const creator = normalizeTextInput(row?.creator, { maxLength: 80 })
  const members = normalizeOrganizationMemberRoles(row?.members, creator)
  const campaigns = normalizeUuidArray(row?.campaigns)
  const campaignDirectory = campaigns
    .map((campaignId) => {
      const campaignName = campaignNameById.get(campaignId) || ''
      if (!campaignName) return null
      return { id: campaignId, name: campaignName }
    })
    .filter((entry) => Boolean(entry))
  const connectedAccounts = normalizeOrganizationConnectedAccounts(row?.connected_accounts)
  const userEmailById = new Map(
    (Array.isArray(userRows) ? userRows : [])
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => {
        const userId = normalizeTextInput(entry.id, { maxLength: 80 })
        const email = normalizeEmail(entry.email)
        return [userId, email]
      }),
  )
  const creatorEmail = userEmailById.get(creator) || ''
  return {
    id,
    createdAt,
    name,
    campaigns,
    campaignDirectory,
    members,
    memberDirectory: mapOrganizationMembersForClient(members, userRows),
    connectedAccounts,
    creator,
    creatorEmail,
  }
}

const mapOrganizationForClientWithResolvedUsers = async (organizationRow, campaignNameById = null) => {
  const creatorId = normalizeTextInput(organizationRow?.creator, { maxLength: 80 })
  const memberRoles = normalizeOrganizationMemberRoles(organizationRow?.members, creatorId)
  const memberIds = Object.keys(memberRoles)
  const usersResult = await fetchUsersRowsByIds(memberIds)
  const resolvedCampaignNameById = campaignNameById instanceof Map
    ? campaignNameById
    : await resolveCampaignNameByIdForOrganizations([organizationRow])
  return mapOrganizationForClient(
    organizationRow,
    usersResult.ok ? usersResult.rows : [],
    resolvedCampaignNameById,
  )
}

const fetchOrganizationsByIds = async (organizationIds) => {
  const rows = []
  for (const organizationId of organizationIds) {
    const organizationResult = await fetchOrganizationRowById(organizationId)
    if (!organizationResult.ok || !organizationResult.row) continue
    rows.push(organizationResult.row)
  }
  return rows
}

const buildAllowedOrgsByCampaignMap = (organizationRows, campaignIdFilter = null) => {
  const allowedOrgsByCampaignId = new Map()
  const limitedCampaignIds = campaignIdFilter instanceof Set ? campaignIdFilter : null
  for (const row of Array.isArray(organizationRows) ? organizationRows : []) {
    const organizationId = normalizeTextInput(row?.id, { maxLength: 80 })
    if (!isUuid(organizationId)) continue
    const campaignIds = normalizeUuidArray(row?.campaigns)
    for (const campaignId of campaignIds) {
      if (limitedCampaignIds && !limitedCampaignIds.has(campaignId)) continue
      const existing = allowedOrgsByCampaignId.get(campaignId) ?? new Set()
      existing.add(organizationId)
      allowedOrgsByCampaignId.set(campaignId, existing)
    }
  }
  return allowedOrgsByCampaignId
}

const syncCampaignAllowedOrgsForCampaignIds = async (campaignIds) => {
  const normalizedCampaignIds = uniqueValues(normalizeUuidArray(campaignIds))
  if (!normalizedCampaignIds.length) {
    return { ok: true, syncedCampaignIds: [], failedCampaigns: [] }
  }

  const organizationsResult = await listOrganizationRows()
  if (!organizationsResult.ok) {
    return {
      ok: false,
      error: 'organization_lookup_failed',
      status: organizationsResult.status || 500,
      details: organizationsResult.payload,
      syncedCampaignIds: [],
      failedCampaigns: normalizedCampaignIds,
    }
  }

  const allowedOrgsByCampaignId = buildAllowedOrgsByCampaignMap(
    organizationsResult.rows,
    new Set(normalizedCampaignIds),
  )
  const failedCampaigns = []
  const syncedCampaignIds = []
  for (const campaignId of normalizedCampaignIds) {
    const allowedOrgs = [...(allowedOrgsByCampaignId.get(campaignId) ?? new Set())]
    const updateResult = await updateCampaignAllowedOrgs(campaignId, allowedOrgs)
    if (!updateResult.ok) {
      failedCampaigns.push(campaignId)
      continue
    }
    syncedCampaignIds.push(campaignId)
  }

  return {
    ok: failedCampaigns.length === 0,
    syncedCampaignIds,
    failedCampaigns,
  }
}

const resolveCampaignAllowedOrganizationIds = async (campaignRow) => {
  const allowedOrgsFromCampaign = normalizeUuidArray(campaignRow?.allowed_orgs)
  if (allowedOrgsFromCampaign.length) {
    return allowedOrgsFromCampaign
  }

  const campaignId = normalizeTextInput(campaignRow?.id, { maxLength: 80 })
  if (!isUuid(campaignId)) return []
  const organizationsResult = await listOrganizationRows()
  if (!organizationsResult.ok) return []

  const allowedOrgsByCampaignId = buildAllowedOrgsByCampaignMap(
    organizationsResult.rows,
    new Set([campaignId]),
  )
  const derivedAllowedOrgs = [...(allowedOrgsByCampaignId.get(campaignId) ?? new Set())]
  if (!derivedAllowedOrgs.length) return []

  // Backfill campaign-level org linkage so future lookups use Campaigns.allowed_orgs directly.
  await updateCampaignAllowedOrgs(campaignId, derivedAllowedOrgs)
  return derivedAllowedOrgs
}

const resolveCampaignAllowedOrganizationIdsFromRows = (
  campaignRow,
  organizationRows,
  allowedOrgsByCampaignId = null,
) => {
  const allowedOrgsFromCampaign = normalizeUuidArray(campaignRow?.allowed_orgs)
  if (allowedOrgsFromCampaign.length) return allowedOrgsFromCampaign

  const campaignId = normalizeTextInput(campaignRow?.id, { maxLength: 80 })
  if (!isUuid(campaignId)) return []

  if (allowedOrgsByCampaignId instanceof Map) {
    return [...(allowedOrgsByCampaignId.get(campaignId) ?? new Set())]
  }

  const derivedByCampaignId = buildAllowedOrgsByCampaignMap(
    Array.isArray(organizationRows) ? organizationRows : [],
    new Set([campaignId]),
  )
  return [...(derivedByCampaignId.get(campaignId) ?? new Set())]
}

const collectConnectedChannelIdsForOrganization = (row) => {
  const connectedChannelIds = new Set()
  const accounts = normalizeOrganizationConnectedAccounts(row?.connected_accounts)
  for (const account of accounts) {
    const platform = normalizeOrganizationConnectionPlatform(account?.platform)
    if (platform === ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE) {
      const channelId = normalizeTextInput(account?.channelId, { maxLength: 300 })
      if (channelId) {
        connectedChannelIds.add(channelId)
      }
      continue
    }
    if (platform === ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM) {
      const accountId = resolveInstagramAccountId(account)
      if (accountId) {
        connectedChannelIds.add(`instagram:${accountId}`)
      }
      continue
    }
    if (platform === ORGANIZATION_CONNECTION_PLATFORM_X) {
      const xUserId = resolveXUserIdFromConnection(account)
      if (xUserId) {
        connectedChannelIds.add(`x:${xUserId}`)
        continue
      }
      const xUsername = resolveXUsernameFromConnection(account)
      if (isValidXUsername(xUsername)) {
        connectedChannelIds.add(`x:${xUsername}`)
      }
    }
  }
  return connectedChannelIds
}

const resolveVisibleCampaignChannelIdsForViewerFromRows = ({
  campaignRow,
  viewerUserId,
  organizationRows,
  allowedOrgsByCampaignId = null,
}) => {
  const normalizedViewerUserId = normalizeTextInput(viewerUserId, { maxLength: 80 })
  if (!isUuid(normalizedViewerUserId)) return new Set()

  const allowedOrganizationIds = resolveCampaignAllowedOrganizationIdsFromRows(
    campaignRow,
    organizationRows,
    allowedOrgsByCampaignId,
  )
  if (!allowedOrganizationIds.length) return new Set()

  const allowedOrganizationIdSet = new Set(allowedOrganizationIds)
  const visibleChannelIds = new Set()
  for (const row of Array.isArray(organizationRows) ? organizationRows : []) {
    const organizationId = normalizeTextInput(row?.id, { maxLength: 80 })
    if (!isUuid(organizationId) || !allowedOrganizationIdSet.has(organizationId)) continue
    if (!canUserAccessOrganizationChannels(row, normalizedViewerUserId)) continue
    const connectedChannelIds = collectConnectedChannelIdsForOrganization(row)
    for (const channelId of connectedChannelIds) {
      visibleChannelIds.add(channelId)
    }
  }
  return visibleChannelIds
}

const resolveVisibleCampaignChannelIdsForViewer = async (campaignRow, viewerUserId) => {
  const organizationsResult = await listOrganizationRows()
  if (!organizationsResult.ok) return new Set()

  const allowedOrgsByCampaignId = buildAllowedOrgsByCampaignMap(organizationsResult.rows)
  return resolveVisibleCampaignChannelIdsForViewerFromRows({
    campaignRow,
    viewerUserId,
    organizationRows: organizationsResult.rows,
    allowedOrgsByCampaignId,
  })
}

const serializeDemographicValueMap = (valueByLabel) =>
  [...valueByLabel.entries()]
    .map(([label, value]) => ({
      label,
      value: Math.max(0, toNumber(value)),
    }))
    .sort((left, right) => toNumber(right.value) - toNumber(left.value))

const aggregateScopedDemographicsByChannel = (sourceByChannel, allowedChannelIds) => {
  const overallByLabel = new Map()
  const byChannel = {}
  if (!sourceByChannel || typeof sourceByChannel !== 'object' || Array.isArray(sourceByChannel)) {
    return { overall: [], byChannel: {} }
  }

  for (const [rawChannelId, rawRows] of Object.entries(sourceByChannel)) {
    const channelId = normalizeTextInput(rawChannelId, { maxLength: 300 })
    if (!channelId || !allowedChannelIds.has(channelId) || !Array.isArray(rawRows)) continue
    const channelValueByLabel = new Map()
    for (const row of rawRows) {
      const label = normalizeTextInput(row?.label, { maxLength: 140 })
      if (!label) continue
      const value = Math.max(0, toNumber(row?.value))
      channelValueByLabel.set(label, (channelValueByLabel.get(label) ?? 0) + value)
      overallByLabel.set(label, (overallByLabel.get(label) ?? 0) + value)
    }
    if (channelValueByLabel.size > 0) {
      byChannel[channelId] = serializeDemographicValueMap(channelValueByLabel)
    }
  }

  return {
    overall: serializeDemographicValueMap(overallByLabel),
    byChannel,
  }
}

const summarizeTimeSeriesFromChannelRows = (rows) => {
  const byDate = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = normalizeIsoDateOnly(row?.date)
    if (!date) continue
    const current = byDate.get(date) ?? {
      date,
      views: 0,
      engagements: 0,
      posts: 0,
      watchTimeHours: 0,
      followersNetChange: 0,
    }
    byDate.set(date, {
      date,
      views: current.views + Math.max(0, toNumber(row?.views)),
      engagements: current.engagements + Math.max(0, toNumber(row?.engagements)),
      posts: current.posts + Math.max(0, toNumber(row?.posts)),
      watchTimeHours: current.watchTimeHours + Math.max(0, toNumber(row?.watchTimeHours)),
      followersNetChange: current.followersNetChange + toNumber(row?.followersNetChange),
    })
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

const resolveFirstVideoUploadDateFromPosts = (posts) => {
  const firstDates = (Array.isArray(posts) ? posts : [])
    .map((post) => normalizeIsoDateOnly(post?.publishedAt))
    .filter((value) => value)
    .sort((left, right) => left.localeCompare(right))
  return firstDates[0] || ''
}

const resolveFirstVideoUploadDateFromChannels = (channels) => {
  const firstDates = (Array.isArray(channels) ? channels : [])
    .map((channel) => normalizeIsoDateOnly(channel?.firstVideoUploadDate))
    .filter((value) => value)
    .sort((left, right) => left.localeCompare(right))
  return firstDates[0] || ''
}

const scopeCachedSummaryToConnectedChannelIds = (summaryPayload, connectedChannelIds) => {
  const allowedChannelIds = connectedChannelIds instanceof Set ? connectedChannelIds : new Set()
  if (!allowedChannelIds.size) return buildEmptyYouTubeSummary()

  const channels = (Array.isArray(summaryPayload?.channels) ? summaryPayload.channels : []).filter((channel) => {
    const channelId = normalizeTextInput(channel?.id, { maxLength: 300 })
    return Boolean(channelId && allowedChannelIds.has(channelId))
  })
  const topPosts = (Array.isArray(summaryPayload?.topPosts) ? summaryPayload.topPosts : [])
    .filter((post) => {
      const channelId = normalizeTextInput(post?.channelId, { maxLength: 300 })
      return Boolean(channelId && allowedChannelIds.has(channelId))
    })
    .sort((left, right) => toNumber(right?.views) - toNumber(left?.views))
  const timeSeriesByChannel = (Array.isArray(summaryPayload?.timeSeriesByChannel)
    ? summaryPayload.timeSeriesByChannel
    : [])
    .filter((row) => {
      const channelId = normalizeTextInput(row?.channelId, { maxLength: 300 })
      return Boolean(channelId && allowedChannelIds.has(channelId))
    })
    .sort((left, right) => {
      const leftChannel = normalizeTextInput(left?.channelId, { maxLength: 300 })
      const rightChannel = normalizeTextInput(right?.channelId, { maxLength: 300 })
      const channelOrder = leftChannel.localeCompare(rightChannel)
      if (channelOrder !== 0) return channelOrder
      const leftDate = normalizeIsoDateOnly(left?.date)
      const rightDate = normalizeIsoDateOnly(right?.date)
      return leftDate.localeCompare(rightDate)
    })
  const timeSeries = summarizeTimeSeriesFromChannelRows(timeSeriesByChannel)
  const ageScoped = aggregateScopedDemographicsByChannel(summaryPayload?.ageDistributionByChannel, allowedChannelIds)
  const genderScoped = aggregateScopedDemographicsByChannel(summaryPayload?.genderDistributionByChannel, allowedChannelIds)
  const geoScoped = aggregateScopedDemographicsByChannel(summaryPayload?.topGeosByChannel, allowedChannelIds)
  const firstVideoUploadDate =
    resolveFirstVideoUploadDateFromChannels(channels)
    || resolveFirstVideoUploadDateFromPosts(topPosts)
    || normalizeIsoDateOnly(summaryPayload?.firstVideoUploadDate)

  return {
    firstVideoUploadDate,
    channels,
    topPosts,
    timeSeries,
    timeSeriesByChannel,
    ageDistribution: ageScoped.overall,
    ageDistributionByChannel: ageScoped.byChannel,
    genderDistribution: genderScoped.overall,
    genderDistributionByChannel: genderScoped.byChannel,
    topGeos: geoScoped.overall.slice(0, 5),
    topGeosByChannel: Object.fromEntries(
      Object.entries(geoScoped.byChannel).map(([channelId, rows]) => [
        channelId,
        Array.isArray(rows) ? rows.slice(0, 5) : [],
      ]),
    ),
  }
}

const includeConnectedYouTubeChannelsInSummary = (summaryPayload, connections) => {
  const baseSummary =
    summaryPayload && typeof summaryPayload === 'object'
      ? summaryPayload
      : buildEmptyYouTubeSummary()
  const channelById = new Map()
  const existingChannels = Array.isArray(baseSummary.channels) ? baseSummary.channels : []

  for (const channel of existingChannels) {
    const channelId = normalizeTextInput(channel?.id, { maxLength: 300 })
    if (!channelId) continue
    channelById.set(channelId, {
      ...channel,
      id: channelId,
      name: normalizeTextInput(channel?.name, { maxLength: 180 }) || 'YouTube Channel',
      platform: ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE,
      views: Math.max(0, toNumber(channel?.views)),
      engagementRate: Math.max(0, toNumber(channel?.engagementRate)),
      followers: Math.max(0, toNumber(channel?.followers)),
      status: normalizeTextInput(channel?.status, { maxLength: 120 }) || 'Connected',
    })
  }

  for (const connection of Array.isArray(connections) ? connections : []) {
    const channelId = normalizeTextInput(connection?.channelId, { maxLength: 300 })
    if (!channelId) continue
    const existing = channelById.get(channelId)
    const channelName = normalizeTextInput(connection?.channelName, { maxLength: 180 })
    if (existing) {
      if (channelName && existing.name !== channelName) {
        channelById.set(channelId, { ...existing, name: channelName })
      }
      continue
    }
    channelById.set(channelId, {
      id: channelId,
      name: channelName || 'YouTube Channel',
      platform: ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE,
      views: 0,
      engagementRate: 0,
      followers: 0,
      status: 'Connected',
    })
  }

  return {
    ...baseSummary,
    channels: [...channelById.values()],
  }
}

const upsertCachedYouTubeSummaryWithConnections = async ({
  userId,
  connections,
  generatedAt,
  refreshJobId,
}) => {
  const cachedResult = await getCachedYouTubeSummaryByUserId(userId)
  const baseSummary =
    cachedResult.ok && cachedResult.row?.summary_json
      ? normalizeCachedSummaryPayload(cachedResult.row.summary_json)
      : buildEmptyYouTubeSummary()
  const summaryWithConnections = includeConnectedYouTubeChannelsInSummary(baseSummary, connections)
  return upsertCachedYouTubeSummary({
    userId,
    summary: summaryWithConnections,
    generatedAt,
    refreshJobId,
  })
}

const listAccessibleYouTubeConnectionsByUserId = async (userId, options = {}) => {
  const accessScope = options?.accessScope === 'view' ? 'view' : 'manage'
  const normalizedUserId = normalizeTextInput(userId, { maxLength: 80 })
  if (!isUuid(normalizedUserId)) return { ok: false, status: 400, connections: [] }
  const organizationsResult = await listOrganizationRows()
  if (!organizationsResult.ok) {
    return {
      ok: false,
      status: organizationsResult.status || 500,
      error: 'organizations_read_failed',
      connections: [],
    }
  }

  const connectionByKey = new Map()
  for (const row of organizationsResult.rows) {
    const canAccessChannels = accessScope === 'view'
      ? canUserSeeOrganization(row, normalizedUserId)
      : canUserAccessOrganizationChannels(row, normalizedUserId)
    if (!canAccessChannels) continue
    const organizationId = normalizeTextInput(row?.id, { maxLength: 80 })
    const fallbackOwnerUserId = normalizeTextInput(row?.creator, { maxLength: 80 })
    const accounts = normalizeOrganizationConnectedAccounts(row?.connected_accounts)
    for (const account of accounts) {
      if (normalizeOrganizationConnectionPlatform(account.platform) !== ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE) continue
      const channelId = normalizeTextInput(account.channelId, { maxLength: 300 })
      if (!channelId) continue
      const ownerUserIdRaw = normalizeTextInput(account.ownerUserId, { maxLength: 80 })
      const ownerUserId =
        isUuid(ownerUserIdRaw) ? ownerUserIdRaw : isUuid(fallbackOwnerUserId) ? fallbackOwnerUserId : ''
      if (!isUuid(ownerUserId)) continue
      const key = `${ownerUserId}:${channelId}`
      if (connectionByKey.has(key)) continue
      connectionByKey.set(key, {
        channelId,
        channelName: normalizeTextInput(account.accountName, { maxLength: 180 }) || 'YouTube Channel',
        ownerUserId,
        organizationId: isUuid(organizationId) ? organizationId : undefined,
      })
    }
  }

  const directConnectionsResult = await listYouTubeConnectionRowsByUserId(normalizedUserId)
  if (directConnectionsResult.ok) {
    for (const row of directConnectionsResult.rows) {
      const connection = mapYouTubeConnectionRow(row)
      const channelId = normalizeTextInput(connection.channelId, { maxLength: 300 })
      if (!channelId) continue
      const key = `${normalizedUserId}:${channelId}`
      if (connectionByKey.has(key)) continue
      connectionByKey.set(key, {
        channelId,
        channelName: normalizeTextInput(connection.channelName, { maxLength: 180 }) || 'YouTube Channel',
        ownerUserId: normalizedUserId,
      })
    }
  }

  const connections = [...connectionByKey.values()]
  const channelIds = uniqueValues(
    connections
      .map((entry) => normalizeTextInput(entry.channelId, { maxLength: 300 }))
      .filter((value) => value),
  )
  if (channelIds.length) {
    const tokenRowsResult = await listYouTubeConnectionRowsByChannelIds(channelIds)
    if (tokenRowsResult.ok) {
      const tokenByOwnerChannel = new Map()
      for (const row of tokenRowsResult.rows) {
        const ownerUserId = normalizeTextInput(row?.user_id, { maxLength: 80 })
        const channelId = normalizeTextInput(row?.channel_id, { maxLength: 300 })
        if (!isUuid(ownerUserId) || !channelId) continue
        const key = `${ownerUserId}:${channelId}`
        tokenByOwnerChannel.set(key, mapYouTubeConnectionRow(row))
      }
      for (const connection of connections) {
        const ownerUserId = normalizeTextInput(connection.ownerUserId, { maxLength: 80 })
        const channelId = normalizeTextInput(connection.channelId, { maxLength: 300 })
        if (!isUuid(ownerUserId) || !channelId) continue
        const key = `${ownerUserId}:${channelId}`
        const tokenRow = tokenByOwnerChannel.get(key)
        if (!tokenRow) continue
        connection.accessToken = tokenRow.accessToken
        connection.refreshToken = tokenRow.refreshToken
        connection.expiresAt = tokenRow.expiresAt
        connection.connectedAt = tokenRow.connectedAt
      }
    }
  }

  return { ok: true, status: 200, connections }
}

const collectYouTubeAccountsByChannelId = (organizationRows) => {
  const accountByChannelId = new Map()
  for (const row of organizationRows) {
    const accounts = normalizeOrganizationConnectedAccounts(row?.connected_accounts)
    for (const account of accounts) {
      if (account.platform !== ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE) continue
      const channelId = normalizeTextInput(account.channelId, { maxLength: 300 })
      if (!channelId) continue
      if (!accountByChannelId.has(channelId)) {
        accountByChannelId.set(channelId, account)
      }
    }
  }
  return accountByChannelId
}

const buildCampaignAvailableContent = async (campaignRow, options = {}) => {
  const allowedOrganizationIds = await resolveCampaignAllowedOrganizationIds(campaignRow)
  if (!allowedOrganizationIds.length) {
    return { accountLabels: [], channels: [], posts: [] }
  }

  const viewerUserId = normalizeTextInput(options?.viewerUserId, { maxLength: 80 })
  const hasViewerScope = Boolean(viewerUserId)
  if (hasViewerScope && !isUuid(viewerUserId)) {
    return { accountLabels: [], channels: [], posts: [] }
  }

  const organizationRows = await fetchOrganizationsByIds(allowedOrganizationIds)
  const scopedOrganizationRows = hasViewerScope
    ? organizationRows.filter((row) => canUserAccessOrganizationChannels(row, viewerUserId))
    : organizationRows
  const connectedAccounts = scopedOrganizationRows.flatMap((row) => {
    const fallbackOwnerUserId = normalizeTextInput(row?.creator, { maxLength: 80 })
    return normalizeOrganizationConnectedAccounts(row?.connected_accounts).map((account) => {
      const ownerUserId = normalizeTextInput(account?.ownerUserId, { maxLength: 80 })
      return {
        ...account,
        ownerUserId: isUuid(ownerUserId)
          ? ownerUserId
          : isUuid(fallbackOwnerUserId)
            ? fallbackOwnerUserId
            : undefined,
      }
    })
  })
  const accountLabels = uniqueValues(
    connectedAccounts.map((account) => formatOrganizationConnectedAccountLabel(account)),
  )
  const youtubeAccounts = connectedAccounts.filter(
    (account) =>
      normalizeOrganizationConnectionPlatform(account.platform) === ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE,
  )
  const instagramAccounts = connectedAccounts.filter(
    (account) =>
      normalizeOrganizationConnectionPlatform(account.platform) === ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM,
  )
  const xAccounts = connectedAccounts.filter(
    (account) =>
      normalizeOrganizationConnectionPlatform(account.platform) === ORGANIZATION_CONNECTION_PLATFORM_X,
  )
  const youtubeAccountByChannelId = new Map()
  const configuredOwnerByChannelId = new Map()
  const channelIdsByOwnerUserId = new Map()
  const youtubeConnectionByOwnerChannelKey = new Map()
  for (const account of youtubeAccounts) {
    const channelId = normalizeTextInput(account.channelId, { maxLength: 300 })
    if (!channelId) continue
    if (!youtubeAccountByChannelId.has(channelId)) {
      youtubeAccountByChannelId.set(channelId, account)
    }
    const ownerUserId = normalizeTextInput(account.ownerUserId, { maxLength: 80 })
    if (isUuid(ownerUserId)) {
      configuredOwnerByChannelId.set(channelId, ownerUserId)
    }
  }
  const youtubeChannelIds = [...youtubeAccountByChannelId.keys()]
  if (youtubeChannelIds.length) {
    const channelConnectionsResult = await listYouTubeConnectionRowsByChannelIds(youtubeChannelIds)
    const ownersByChannelId = new Map()
    const latestOwnerByChannelId = new Map()

    if (channelConnectionsResult.ok) {
      for (const row of channelConnectionsResult.rows) {
        const channelId = normalizeTextInput(row?.channel_id, { maxLength: 300 })
        const ownerUserId = normalizeTextInput(row?.user_id, { maxLength: 80 })
        if (!channelId || !isUuid(ownerUserId)) continue
        const ownerSet = ownersByChannelId.get(channelId) ?? new Set()
        ownerSet.add(ownerUserId)
        ownersByChannelId.set(channelId, ownerSet)

        const updatedAtRaw =
          normalizeTextInput(row?.updated_at, { maxLength: 64 })
          || normalizeTextInput(row?.connected_at, { maxLength: 64 })
        const updatedAt = Number.isFinite(Date.parse(updatedAtRaw)) ? Date.parse(updatedAtRaw) : 0
        const connectionKey = `${ownerUserId}:${channelId}`
        const existingConnectionEntry = youtubeConnectionByOwnerChannelKey.get(connectionKey)
        if (!existingConnectionEntry || updatedAt >= existingConnectionEntry.updatedAt) {
          youtubeConnectionByOwnerChannelKey.set(connectionKey, {
            updatedAt,
            connection: mapYouTubeConnectionRow(row),
          })
        }
        const existingLatest = latestOwnerByChannelId.get(channelId)
        if (!existingLatest || updatedAt >= existingLatest.updatedAt) {
          latestOwnerByChannelId.set(channelId, { ownerUserId, updatedAt })
        }
      }
    }

    // Prefer the account owner linked in the organization record, but auto-fallback by channel id.
    for (const channelId of youtubeChannelIds) {
      const configuredOwnerUserId = configuredOwnerByChannelId.get(channelId) ?? ''
      const knownOwners = ownersByChannelId.get(channelId) ?? new Set()
      let resolvedOwnerUserId = ''
      if (configuredOwnerUserId && knownOwners.has(configuredOwnerUserId)) {
        resolvedOwnerUserId = configuredOwnerUserId
      } else {
        resolvedOwnerUserId =
          latestOwnerByChannelId.get(channelId)?.ownerUserId || configuredOwnerUserId
      }
      if (!isUuid(resolvedOwnerUserId)) continue
      const existing = channelIdsByOwnerUserId.get(resolvedOwnerUserId) ?? new Set()
      existing.add(channelId)
      channelIdsByOwnerUserId.set(resolvedOwnerUserId, existing)
    }
  }
  const instagramAccountById = new Map()
  const instagramAccountIdsByOwnerUserId = new Map()
  for (const account of instagramAccounts) {
    const accountId = resolveInstagramAccountId(account)
    if (!accountId) continue
    if (!instagramAccountById.has(accountId)) {
      instagramAccountById.set(accountId, account)
    }
    const ownerUserId = normalizeTextInput(account.ownerUserId, { maxLength: 80 })
    if (!isUuid(ownerUserId)) continue
    const existing = instagramAccountIdsByOwnerUserId.get(ownerUserId) ?? new Set()
    existing.add(accountId)
    instagramAccountIdsByOwnerUserId.set(ownerUserId, existing)
  }
  const xAccountByUserId = new Map()
  const xAccountByUsername = new Map()
  const unresolvedXAccountsByUsername = new Map()
  for (const account of xAccounts) {
    const connectionUsername = resolveXUsernameFromConnection(account)
    if (isValidXUsername(connectionUsername) && !xAccountByUsername.has(connectionUsername)) {
      xAccountByUsername.set(connectionUsername, account)
    }
    const xUserId = resolveXUserIdFromConnection(account)
    if (!xUserId) {
      const username = resolveXUsernameFromConnection(account)
      if (isValidXUsername(username) && !unresolvedXAccountsByUsername.has(username)) {
        unresolvedXAccountsByUsername.set(username, account)
      }
      continue
    }
    if (!xAccountByUserId.has(xUserId)) {
      xAccountByUserId.set(xUserId, account)
    }
  }
  if (unresolvedXAccountsByUsername.size > 0) {
    const xRowsByUsernameResult = await listXRowsByUsernames([...unresolvedXAccountsByUsername.keys()])
    if (xRowsByUsernameResult.ok) {
      for (const row of xRowsByUsernameResult.rows) {
        const xUserId = resolveXUserIdFromStoredPostsPayload(row?.posts) || normalizeXUserId(row?.user_id)
        const username = normalizeXUsername(row?.username)
        if (!xUserId || !username || xAccountByUserId.has(xUserId)) continue
        const fallbackAccount = unresolvedXAccountsByUsername.get(username)
        if (!fallbackAccount) continue
        xAccountByUserId.set(xUserId, fallbackAccount)
        if (!xAccountByUsername.has(username)) {
          xAccountByUsername.set(username, fallbackAccount)
        }
        unresolvedXAccountsByUsername.delete(username)
      }
    }
    for (const [username, fallbackAccount] of unresolvedXAccountsByUsername.entries()) {
      const lookupResult = await fetchXUserByUsername(username)
      if (!lookupResult.ok || !lookupResult.user) continue
      const xUserId = normalizeXUserId(lookupResult.user.userId)
      if (!xUserId || xAccountByUserId.has(xUserId)) continue
      xAccountByUserId.set(xUserId, fallbackAccount)
      if (!xAccountByUsername.has(username)) {
        xAccountByUsername.set(username, fallbackAccount)
      }
      unresolvedXAccountsByUsername.delete(username)
    }
  }

  const channelOptionById = new Map()
  for (const [channelId, account] of youtubeAccountByChannelId.entries()) {
    if (!channelOptionById.has(channelId)) {
      channelOptionById.set(channelId, {
        id: channelId,
        label: formatOrganizationConnectedAccountLabel(account),
      })
    }
  }
  for (const [accountId, account] of instagramAccountById.entries()) {
    const channelId = `instagram:${accountId}`
    if (!channelOptionById.has(channelId)) {
      channelOptionById.set(channelId, {
        id: channelId,
        label: formatOrganizationConnectedAccountLabel(account),
      })
    }
  }
  for (const [xUserId, account] of xAccountByUserId.entries()) {
    const channelId = resolveXChannelIdFromConnectedAccount(account, xUserId)
    if (!channelId || channelOptionById.has(channelId)) continue
    channelOptionById.set(channelId, {
      id: channelId,
      label: formatOrganizationConnectedAccountLabel(account),
    })
  }
  for (const [username, account] of unresolvedXAccountsByUsername.entries()) {
    const channelId = resolveXChannelIdFromConnectedAccount(account, username)
    if (!channelId || channelOptionById.has(channelId)) continue
    channelOptionById.set(channelId, {
      id: channelId,
      label: formatOrganizationConnectedAccountLabel(account),
    })
  }
  const channelOptions = [...channelOptionById.values()]
    .sort((left, right) => left.label.localeCompare(right.label))

  const postsById = new Map()
  for (const [ownerUserId, channelIdSet] of channelIdsByOwnerUserId.entries()) {
    const scopedChannelIds = new Set([...channelIdSet.values()])
    let summary = null
    const cachedResult = await getCachedYouTubeSummaryByUserId(ownerUserId)
    if (cachedResult.ok && cachedResult.row?.summary_json) {
      summary = normalizeCachedSummaryPayload(cachedResult.row.summary_json)
    }
    if (!summary) continue
    const summaryTopPosts = Array.isArray(summary.topPosts) ? summary.topPosts : []
    for (const post of summaryTopPosts) {
      if (!post || typeof post !== 'object') continue
      const postId = normalizeTextInput(post.id, { maxLength: 300 })
      const channelId = normalizeTextInput(post.channelId, { maxLength: 300 })
      if (!postId || !channelId) continue
      if (!scopedChannelIds.has(channelId)) continue
      const account = youtubeAccountByChannelId.get(channelId)
      if (!account) continue
      if (postsById.has(postId)) continue
      postsById.set(postId, {
        id: postId,
        title: normalizeTextInput(post.title, { maxLength: 300 }) || 'Untitled video',
        platform: ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE,
        channelId,
        channelName: formatOrganizationConnectedAccountLabel(account),
        views: Math.max(0, toNumber(post.views)),
        engagementRate: Math.max(0, toNumber(post.engagementRate)),
      })
    }
  }

  for (const [ownerUserId, channelIdSet] of channelIdsByOwnerUserId.entries()) {
    for (const channelId of channelIdSet.values()) {
      const connectionKey = `${ownerUserId}:${channelId}`
      const connectionEntry = youtubeConnectionByOwnerChannelKey.get(connectionKey)
      const account = youtubeAccountByChannelId.get(channelId)
      if (!connectionEntry?.connection || !account) continue
      try {
        const { accessToken } = await ensureValidAccessTokenForUser(ownerUserId, connectionEntry.connection)
        if (!accessToken) continue
        const channelVideos = await fetchAllYouTubeVideosForChannel(accessToken, channelId)
        for (const video of channelVideos) {
          const postId = normalizeTextInput(video?.id, { maxLength: 300 })
          if (!postId) continue
          const views = Math.max(0, toNumber(video?.views))
          const likes = Math.max(0, toNumber(video?.likes))
          const comments = Math.max(0, toNumber(video?.comments))
          postsById.set(postId, {
            id: postId,
            title: normalizeTextInput(video?.title, { maxLength: 300 }) || 'Untitled video',
            platform: ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE,
            channelId,
            channelName: formatOrganizationConnectedAccountLabel(account),
            views,
            engagementRate: views > 0 ? ((likes + comments) / views) * 100 : 0,
          })
        }
      } catch (error) {
        console.error('Unable to fetch full channel videos for campaign post management:', {
          ownerUserId,
          channelId,
          message: error instanceof Error ? error.message : 'unknown_error',
        })
      }
    }
  }

  for (const [ownerUserId, accountIdSet] of instagramAccountIdsByOwnerUserId.entries()) {
    const scopedAccountIds = new Set([...accountIdSet.values()])
    const cachedResult = await getCachedInstagramSummaryByUserId(ownerUserId)
    if (!cachedResult.ok || !cachedResult.row?.summary_json) continue
    const summary = normalizeCachedInstagramSummaryPayload(cachedResult.row.summary_json)
    const summaryTopPosts = Array.isArray(summary.topPosts) ? summary.topPosts : []
    for (const post of summaryTopPosts) {
      if (!post || typeof post !== 'object') continue
      const postId = normalizeTextInput(post.id, { maxLength: 300 })
      const rawChannelId = normalizeTextInput(post.channelId, { maxLength: 300 })
      const accountId = rawChannelId.replace(/^instagram:/i, '').toLowerCase()
      if (!postId || !accountId || !scopedAccountIds.has(accountId)) continue
      const account = instagramAccountById.get(accountId)
      if (!account) continue
      const postKey = `instagram:${postId}`
      if (postsById.has(postKey)) continue
      postsById.set(postKey, {
        id: postKey,
        title: normalizeTextInput(post.title, { maxLength: 300 }) || 'Untitled Instagram post',
        platform: ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM,
        channelId: `instagram:${accountId}`,
        channelName: formatOrganizationConnectedAccountLabel(account),
        views: Math.max(0, toNumber(post.views)),
        engagementRate: Math.max(0, toNumber(post.engagementRate)),
      })
    }
  }

  const xRowsResult = await listXRowsByUserIds([...xAccountByUserId.keys()])
  if (xRowsResult.ok) {
    for (const row of xRowsResult.rows) {
      const xUserId = resolveXUserIdFromStoredPostsPayload(row?.posts) || normalizeXUserId(row?.user_id)
      const xUsername = normalizeXUsername(row?.username)
      const account = (xUserId ? xAccountByUserId.get(xUserId) : null) || (xUsername ? xAccountByUsername.get(xUsername) : null)
      if (!account) continue
      const resolvedChannelUserId = resolveXUserIdFromConnection(account) || xUserId
      const resolvedChannelId = resolveXChannelIdFromConnectedAccount(account, resolvedChannelUserId)
      if (!resolvedChannelId) continue
      const posts = normalizeXStoredPosts(row?.posts, {
        userId: resolvedChannelUserId || xUserId,
        username: xUsername || resolveXUsernameFromConnection(account),
      })
      for (const post of posts) {
        const postKey = `x:${post.id}`
        if (postsById.has(postKey)) continue
        postsById.set(postKey, {
          id: postKey,
          title: post.title,
          platform: ORGANIZATION_CONNECTION_PLATFORM_X,
          channelId: resolvedChannelId,
          channelName: formatOrganizationConnectedAccountLabel(account),
          views: Math.max(0, toNumber(post.views)),
          engagementRate: Math.max(0, toNumber(post.engagementRate)),
        })
      }
    }
  }

  const posts = [...postsById.values()].sort((left, right) => right.views - left.views)
  return {
    accountLabels,
    channels: channelOptions,
    posts,
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

  const organizationsResult = await listOrganizationRows()
  if (!organizationsResult.ok) {
    console.error('Unable to resolve campaign channel visibility scope:', {
      viewerUserId: viewer.userId,
      status: organizationsResult.status,
      details: organizationsResult.payload,
    })
  }
  const organizationRows = organizationsResult.ok ? organizationsResult.rows : []
  const allowedOrgsByCampaignId = organizationsResult.ok
    ? buildAllowedOrgsByCampaignMap(organizationRows)
    : new Map()

  const visibleCampaigns = campaignsResult.rows
    .map((row) => {
      const resolvedAllowedOrgs = resolveCampaignAllowedOrganizationIdsFromRows(
        row,
        organizationRows,
        allowedOrgsByCampaignId,
      )
      if (!resolvedAllowedOrgs.length) return row
      return {
        ...row,
        allowed_orgs: resolvedAllowedOrgs,
      }
    })
    .filter((row) =>
      canUserSeeCampaign(
        row,
        viewer.userId,
        viewer.organizationIds,
        viewer.organizationAdminIds,
        viewer.organizationBrandViewerIds,
      ))
    .map((row) => {
      const visibleChannelIds = resolveVisibleCampaignChannelIdsForViewerFromRows({
        campaignRow: row,
        viewerUserId: viewer.userId,
        organizationRows,
        allowedOrgsByCampaignId,
      })
      return mapCampaignForClient(row, {
        visibleChannelIds,
        viewerUserId: viewer.userId,
        viewerOrganizationIds: viewer.organizationIds,
        viewerOrganizationAdminIds: viewer.organizationAdminIds,
        viewerOrganizationBrandViewerIds: viewer.organizationBrandViewerIds,
      })
    })
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
  if (!viewer.organizationAdminIds.length) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization admin members can create campaigns.',
    })
    return
  }

  const payload = req.body ?? {}
  const campaignName = normalizeTextInput(payload.campaignName, { maxLength: 140 })
  const payloadBrand = normalizeTextInput(payload.brand, { maxLength: 140 })
  const fallbackDistributionBrand =
    payload?.distributionSources && typeof payload.distributionSources === 'object'
      ? normalizeTextInput(payload.distributionSources.brand, { maxLength: 140 })
      : ''
  const brand = payloadBrand || fallbackDistributionBrand
  const startDate = normalizeDateOnly(payload.startDate)
  const endDate = normalizeDateOnly(payload.endDate)
  const guaranteed = toNumber(payload.guaranteed)
  const viewsDelivered = Math.max(0, toNumber(payload.viewsDelivered))
  const engagementRate = Math.max(0, toNumber(payload.engagementRate))
  const requestedAllowedOrgs = normalizeUuidArray(payload.allowedOrgs)
  const adminOrganizationIdSet = new Set(viewer.organizationAdminIds)
  let allowedOrgs = uniqueValues(
    requestedAllowedOrgs.filter((organizationId) => adminOrganizationIdSet.has(organizationId)),
  )
  if (requestedAllowedOrgs.length && allowedOrgs.length !== requestedAllowedOrgs.length) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Campaigns can only be created for organizations where you are an admin member.',
    })
    return
  }
  const requestedMembers = normalizeUuidArray(payload.allowedMembers).filter(
    (userId) => userId !== viewer.userId,
  )
  const requestedMemberRoles = normalizeCampaignMemberRoles(payload.allowedMemberRoles)
  const requestedRoleEmailInputs = normalizeMemberInviteInputArray(payload.memberAccess)
  const requestedEmailInputs = normalizeEmailInputArray(payload.memberEmails)
  const requestedMemberInviteByEmail = new Map()
  for (const member of requestedRoleEmailInputs.validMembers) {
    requestedMemberInviteByEmail.set(member.email, member.role)
  }
  for (const email of requestedEmailInputs.validEmails) {
    if (!requestedMemberInviteByEmail.has(email)) {
      requestedMemberInviteByEmail.set(email, CAMPAIGN_MEMBER_ROLE_INTERNAL)
    }
  }
  const creatorEmail = normalizeEmail(viewer.email)
  const creatorEmailWasRequested = Boolean(
    creatorEmail && requestedMemberInviteByEmail.has(creatorEmail),
  )
  if (creatorEmailWasRequested) {
    requestedMemberInviteByEmail.delete(creatorEmail)
  }
  const requestedMemberInvites = [...requestedMemberInviteByEmail.entries()].map(([email, role]) => ({
    email,
    role,
  }))
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

  if (!allowedOrgs.length) {
    allowedOrgs = uniqueValues(viewer.organizationAdminIds)
  }
  if (!allowedOrgs.length) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You must be an admin member of at least one organization to create campaigns.',
    })
    return
  }

  let memberResolution = buildEmptyMemberResolution()
  let resolvedEmailMembers = []
  const requestedRoleByUserId = normalizeCampaignMemberRoles(requestedMemberRoles)
  if (creatorEmailWasRequested) {
    memberResolution.failed.push({
      action: 'add',
      email: creatorEmail,
      error: 'cannot_add_creator',
      message: 'Campaign creator is added automatically and cannot be invited as a member.',
    })
  }
  for (const userId of requestedMembers) {
    if (!requestedRoleByUserId[userId]) {
      requestedRoleByUserId[userId] = CAMPAIGN_MEMBER_ROLE_INTERNAL
    }
  }
  for (const email of requestedRoleEmailInputs.invalidEmails) {
    memberResolution.failed.push({
      action: 'add',
      email,
      error: 'invalid_email',
      message: 'Email format is invalid.',
    })
  }
  for (const email of requestedEmailInputs.invalidEmails) {
    memberResolution.failed.push({
      action: 'add',
      email,
      error: 'invalid_email',
      message: 'Email format is invalid.',
    })
  }
  if (requestedMemberInvites.length) {
    const resolvedMembers = await resolveMemberIdsFromEmails(requestedMemberInvites)
    resolvedEmailMembers = resolvedMembers.resolvedMembers
    memberResolution.added.push(...resolvedMembers.resolution.added)
    memberResolution.removed.push(...resolvedMembers.resolution.removed)
    memberResolution.failed.push(...resolvedMembers.resolution.failed)
  }
  for (const member of resolvedEmailMembers) {
    const existingRole = requestedRoleByUserId[member.userId]
    if (
      !existingRole ||
      campaignMemberRolePriority(member.role) > campaignMemberRolePriority(existingRole)
    ) {
      requestedRoleByUserId[member.userId] = member.role
    }
  }

  const allowedMemberRoles = normalizeCampaignMemberRoles(requestedRoleByUserId, viewer.userId)
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
    posts: [],
    allowed_members: allowedMemberRoles,
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
  const visibleChannelIds = await resolveVisibleCampaignChannelIdsForViewer(createdRow, viewer.userId)
  res.status(201).json({
    campaign: mapCampaignForClient(createdRow, {
      visibleChannelIds,
      viewerUserId: viewer.userId,
      viewerOrganizationIds: viewer.organizationIds,
      viewerOrganizationAdminIds: viewer.organizationAdminIds,
    }),
    viewerUserId: viewer.userId,
    memberResolution,
  })
})

app.post('/api/campaigns/:campaignId/details', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'campaign_update_failed',
      message: viewer.message || 'Unable to update campaign.',
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
  const campaignName = normalizeTextInput(payload.campaignName, { maxLength: 140 })
  const brand = normalizeTextInput(payload.brand, { maxLength: 140 })
  const startDate = normalizeDateOnly(payload.startDate)
  const endDate = normalizeDateOnly(payload.endDate)
  const guaranteed = toNumber(payload.guaranteed)
  const guaranteedEngagements = toNumber(payload.guaranteedEngagements)

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

  if (
    !Number.isFinite(guaranteed) ||
    !Number.isFinite(guaranteedEngagements) ||
    guaranteed < 0 ||
    guaranteedEngagements < 0
  ) {
    res.status(400).json({
      error: 'invalid_campaign_payload',
      message: 'guaranteed and guaranteedEngagements must be non-negative numbers.',
    })
    return
  }

  const campaignResult = await fetchCampaignRowById(campaignId)
  if (!campaignResult.ok) {
    res.status(campaignResult.status || 500).json({
      error: 'campaign_update_failed',
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

  if (!canUserSeeCampaign(campaignRow, viewer.userId, viewer.organizationIds, viewer.organizationAdminIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this campaign.',
    })
    return
  }

  if (!canUserManageCampaignDetails(campaignRow, viewer.userId, viewer.organizationAdminIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only campaign admins can edit campaign details.',
    })
    return
  }

  const engagementRate = guaranteed > 0 ? (guaranteedEngagements / guaranteed) * 100 : 0
  const updated = await updateCampaignDetails(campaignId, {
    campaignName,
    brand,
    startDate,
    endDate,
    guaranteed,
    engagementRate,
  })
  if (!updated.ok) {
    res.status(updated.status || 500).json({
      error: 'campaign_update_failed',
      message: 'Unable to update campaign in Supabase.',
      details: updated.payload,
    })
    return
  }

  const updatedRow = updated.row ?? {
    ...campaignRow,
    campaign_name: campaignName,
    brand,
    start_date: startDate,
    end_date: endDate,
    guaranteed,
    engagement_rate: engagementRate,
  }
  const visibleChannelIds = await resolveVisibleCampaignChannelIdsForViewer(updatedRow, viewer.userId)
  res.json({
    campaign: mapCampaignForClient(updatedRow, {
      visibleChannelIds,
      viewerUserId: viewer.userId,
      viewerOrganizationIds: viewer.organizationIds,
      viewerOrganizationAdminIds: viewer.organizationAdminIds,
    }),
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

  const campaignId = normalizeTextInput(req.params?.campaignId, { maxLength: 80 })
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

  if (!canUserSeeCampaign(campaignRow, viewer.userId, viewer.organizationIds, viewer.organizationAdminIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this campaign.',
    })
    return
  }

  if (!canUserDeleteCampaign(campaignRow, viewer.userId, viewer.organizationAdminIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only campaign admins can delete campaigns.',
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

  if (!canUserSeeCampaign(campaignRow, viewer.userId, viewer.organizationIds, viewer.organizationAdminIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this campaign.',
    })
    return
  }
  if (!canUserViewCampaignMembers(campaignRow, viewer.userId, viewer.organizationIds, viewer.organizationAdminIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only invited campaign members can view campaign members.',
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

  const creator = normalizeTextInput(campaignRow.creator, { maxLength: 80 })
  const allowedMemberRoles = normalizeCampaignMemberRoles(campaignRow?.allowed_members, creator)
  const campaignName = normalizeTextInput(campaignRow.campaign_name, { maxLength: 140 })

  res.json({
    campaignId,
    campaignName,
    creator,
    members: mapCampaignMembersForClient(
      memberIds,
      usersResult.ok ? usersResult.rows : [],
      allowedMemberRoles,
    ),
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
  const addMemberInputs = normalizeMemberInviteInputArray(payload.addMembers)
  const addEmailInputs = normalizeEmailInputArray(payload.addEmails)
  const removeEmailInputs = normalizeEmailInputArray(payload.removeEmails)
  const roleUpdateInputs = normalizeMemberRoleUpdateInputArray(payload.roleUpdates)
  const addMemberByEmail = new Map()
  for (const member of addMemberInputs.validMembers) {
    addMemberByEmail.set(member.email, member.role)
  }
  for (const email of addEmailInputs.validEmails) {
    if (!addMemberByEmail.has(email)) {
      addMemberByEmail.set(email, CAMPAIGN_MEMBER_ROLE_INTERNAL)
    }
  }
  const addMembers = [...addMemberByEmail.entries()].map(([email, role]) => ({ email, role }))
  const roleUpdates = roleUpdateInputs.validUpdates
  const removeEmails = removeEmailInputs.validEmails
  const removeUserIds = normalizeUuidArray(payload.removeUserIds)
  if (
    !addMembers.length &&
    !roleUpdates.length &&
    !removeEmails.length &&
    !addMemberInputs.invalidEmails.length &&
    !addEmailInputs.invalidEmails.length &&
    !removeEmailInputs.invalidEmails.length &&
    !roleUpdateInputs.invalidUserIds.length &&
    !removeUserIds.length
  ) {
    res.status(400).json({
      error: 'invalid_member_update_payload',
      message:
        'Provide at least one valid member in addMembers, roleUpdates, addEmails, removeEmails, or removeUserIds.',
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

  if (!canUserSeeCampaign(campaignRow, viewer.userId, viewer.organizationIds, viewer.organizationAdminIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this campaign.',
    })
    return
  }

  if (!canUserManageCampaignMembers(campaignRow, viewer.userId, viewer.organizationAdminIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only campaign admins can manage members.',
    })
    return
  }
  const creatorId = normalizeTextInput(campaignRow.creator, { maxLength: 80 })
  const canChangeRoles = canUserChangeCampaignMemberRoles(campaignRow, viewer.userId, viewer.organizationAdminIds)
  const hasRoleMutations = Boolean(roleUpdates.length || roleUpdateInputs.invalidUserIds.length)
  if (!canChangeRoles && hasRoleMutations) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only campaign admins can change member roles.',
    })
    return
  }

  const updateResult = buildEmptyMemberResolution()
  const memberRoleByUserId = normalizeCampaignMemberRoles(campaignRow?.allowed_members, creatorId)

  for (const email of addMemberInputs.invalidEmails) {
    updateResult.failed.push({
      action: 'add',
      email,
      error: 'invalid_email',
      message: 'Email format is invalid.',
    })
  }

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

  for (const userId of roleUpdateInputs.invalidUserIds) {
    updateResult.failed.push({
      email: userId,
      userId,
      error: 'invalid_user_id',
      message: 'User id must be a valid UUID.',
    })
  }

  for (const member of addMembers) {
    const email = member.email
    const role = canChangeRoles
      ? normalizeCampaignMemberRole(member.role)
      : CAMPAIGN_MEMBER_ROLE_INTERNAL
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

    const userId = normalizeTextInput(lookupResult.row?.id, { maxLength: 80 })
    if (!isUuid(userId)) {
      updateResult.failed.push({
        action: 'add',
        email,
        error: 'user_not_found',
        message: 'No matching user was found for this email.',
      })
      continue
    }

    if (memberRoleByUserId[userId]) {
      const currentRole = normalizeCampaignMemberRole(memberRoleByUserId[userId])
      if (
        canChangeRoles &&
        campaignMemberRolePriority(role) > campaignMemberRolePriority(currentRole)
      ) {
        memberRoleByUserId[userId] = role
        updateResult.added.push({
          action: 'add',
          email,
          userId,
          message: `User role updated to ${role}.`,
        })
        continue
      }
      updateResult.failed.push({
        action: 'add',
        email,
        userId,
        error: 'user_already_member',
        message: 'User is already a campaign member.',
      })
      continue
    }

    memberRoleByUserId[userId] = role
    updateResult.added.push({
      action: 'add',
      email,
      userId,
      message: `User added to campaign members as ${role}.`,
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

    const userId = normalizeTextInput(lookupResult.row?.id, { maxLength: 80 })
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
    if (userId === viewer.userId) {
      updateResult.failed.push({
        action: 'remove',
        email,
        userId,
        error: 'cannot_remove_self',
        message: 'You cannot remove yourself from campaign members.',
      })
      continue
    }

    if (!memberRoleByUserId[userId]) {
      updateResult.failed.push({
        action: 'remove',
        email,
        userId,
        error: 'user_not_member',
        message: 'User is not currently a campaign member.',
      })
      continue
    }

    delete memberRoleByUserId[userId]
    updateResult.removed.push({
      action: 'remove',
      email,
      userId,
      message: 'User removed from campaign members.',
    })
  }

  const lookupUserIds = uniqueValues([...removeUserIds, ...roleUpdates.map((entry) => entry.userId)])
  const usersLookup = lookupUserIds.length
    ? await fetchUsersRowsByIds(lookupUserIds)
    : { ok: true, rows: [] }
  const userLabelById = new Map(
    (usersLookup.ok && Array.isArray(usersLookup.rows) ? usersLookup.rows : []).map((row) => {
      const id = normalizeTextInput(row?.id, { maxLength: 80 })
      const email = normalizeEmail(row?.email)
      return [id, email]
    }),
  )

  for (const userId of removeUserIds) {
    const label = userLabelById.get(userId) || userId
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
    if (userId === viewer.userId) {
      updateResult.failed.push({
        action: 'remove',
        email: label,
        userId,
        error: 'cannot_remove_self',
        message: 'You cannot remove yourself from campaign members.',
      })
      continue
    }

    if (!memberRoleByUserId[userId]) {
      updateResult.failed.push({
        action: 'remove',
        email: label,
        userId,
        error: 'user_not_member',
        message: 'User is not currently a campaign member.',
      })
      continue
    }

    delete memberRoleByUserId[userId]
    updateResult.removed.push({
      action: 'remove',
      email: label,
      userId,
      message: 'User removed from campaign members.',
    })
  }

  for (const update of roleUpdates) {
    const userId = update.userId
    const role = normalizeCampaignMemberRole(update.role)
    const label = userLabelById.get(userId) || userId
    if (userId === viewer.userId) {
      updateResult.failed.push({
        email: label,
        userId,
        error: 'cannot_change_own_role',
        message: 'You cannot change your own campaign role.',
      })
      continue
    }
    if (userId === creatorId) {
      updateResult.failed.push({
        email: label,
        userId,
        error: 'cannot_change_creator_role',
        message: 'The campaign creator role cannot be changed.',
      })
      continue
    }

    if (!memberRoleByUserId[userId]) {
      updateResult.failed.push({
        email: label,
        userId,
        error: 'user_not_member',
        message: 'User is not currently a campaign member.',
      })
      continue
    }

    const currentRole = normalizeCampaignMemberRole(memberRoleByUserId[userId])
    if (currentRole === role) {
      continue
    }

    memberRoleByUserId[userId] = role
    updateResult.added.push({
      action: 'add',
      email: label,
      userId,
      message: `User role updated to ${role}.`,
    })
  }

  const nextAllowedMemberRoles = normalizeCampaignMemberRoles(memberRoleByUserId, creatorId)
  const updateCampaignResult = await updateCampaignAllowedMembers(
    campaignId,
    nextAllowedMemberRoles,
    creatorId,
  )
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
    allowed_members: nextAllowedMemberRoles,
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
    members: mapCampaignMembersForClient(
      memberIds,
      usersResult.ok ? usersResult.rows : [],
      nextAllowedMemberRoles,
    ),
    updateResult,
  })
})

app.get('/api/campaigns/:campaignId/available-posts', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'campaign_posts_fetch_failed',
      message: viewer.message || 'Unable to load campaign posts.',
      details: viewer.details ?? null,
      accountLabels: [],
      channels: [],
      posts: [],
    })
    return
  }

  const campaignId = typeof req.params?.campaignId === 'string' ? req.params.campaignId.trim() : ''
  if (!isUuid(campaignId)) {
    res.status(400).json({
      error: 'invalid_campaign_id',
      message: 'Campaign id must be a valid UUID.',
      accountLabels: [],
      channels: [],
      posts: [],
    })
    return
  }

  const campaignResult = await fetchCampaignRowById(campaignId)
  if (!campaignResult.ok) {
    res.status(campaignResult.status || 500).json({
      error: 'campaign_posts_fetch_failed',
      message: 'Unable to load campaign from Supabase.',
      details: campaignResult.payload,
      accountLabels: [],
      channels: [],
      posts: [],
    })
    return
  }

  const campaignRow = campaignResult.row
  if (!campaignRow) {
    res.status(404).json({
      error: 'campaign_not_found',
      message: 'Campaign was not found.',
      accountLabels: [],
      channels: [],
      posts: [],
    })
    return
  }

  if (!canUserSeeCampaign(campaignRow, viewer.userId, viewer.organizationIds, viewer.organizationAdminIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this campaign.',
      accountLabels: [],
      channels: [],
      posts: [],
    })
    return
  }

  if (!canUserManageCampaignPosts(campaignRow, viewer.userId, viewer.organizationIds, viewer.organizationAdminIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only campaign admins and internal members can tag campaign content.',
      accountLabels: [],
      channels: [],
      posts: [],
    })
    return
  }

  const content = await buildCampaignAvailableContent(campaignRow, { viewerUserId: viewer.userId })
  res.json(content)
})

app.post('/api/campaigns/:campaignId/posts', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'campaign_posts_update_failed',
      message: viewer.message || 'Unable to update campaign posts.',
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
  const selectedPostIds = normalizeStringArray(payload.selectedPostIds)
  const selectedPostsInput = normalizeCampaignManagedPostsInput(payload.selectedPosts)
  const selectedChannelId = normalizeTextInput(payload.selectedChannelId, { maxLength: 300 })
  const viewsDelivered = toNumber(payload.viewsDelivered)
  const engagementRate = toNumber(payload.engagementRate)

  if (!Number.isFinite(viewsDelivered) || viewsDelivered < 0 || !Number.isFinite(engagementRate) || engagementRate < 0) {
    res.status(400).json({
      error: 'invalid_campaign_posts_payload',
      message: 'viewsDelivered and engagementRate must be non-negative numbers.',
    })
    return
  }

  const campaignResult = await fetchCampaignRowById(campaignId)
  if (!campaignResult.ok) {
    res.status(campaignResult.status || 500).json({
      error: 'campaign_posts_update_failed',
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

  if (!canUserSeeCampaign(campaignRow, viewer.userId, viewer.organizationIds, viewer.organizationAdminIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this campaign.',
    })
    return
  }
  if (!canUserManageCampaignPosts(campaignRow, viewer.userId, viewer.organizationIds, viewer.organizationAdminIds)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only campaign admins and internal members can tag campaign content.',
    })
    return
  }

  const allowedChannelIds = await resolveVisibleCampaignChannelIdsForViewer(campaignRow, viewer.userId)
  if (selectedPostIds.length && !allowedChannelIds.size) {
    res.status(400).json({
      error: 'invalid_campaign_posts_payload',
      message: 'No connected accounts are available for this campaign.',
    })
    return
  }
  if (selectedChannelId && !allowedChannelIds.has(selectedChannelId)) {
    res.status(400).json({
      error: 'invalid_campaign_posts_payload',
      message: 'Selected channel is not connected to this campaign organization.',
    })
    return
  }

  const rawDistributionSources = campaignRow?.distribution_sources
  const existingPostsByChannel = readCampaignPostsByChannel(campaignRow?.posts)
  const existingPosts = flattenCampaignManagedPosts(existingPostsByChannel)
  const existingPostById = new Map(existingPosts.map((post) => [post.id, post]))
  const incomingPostById = new Map(selectedPostsInput.map((post) => [post.id, post]))
  const nextSelectedPosts = selectedPostIds
    .map((postId) => incomingPostById.get(postId) || existingPostById.get(postId))
    .filter(Boolean)
    .map((post) => ({
      ...post,
      channelId: post.channelId || selectedChannelId || '',
    }))
  const hasInvalidChannelPost = nextSelectedPosts.some((post) => {
    const postChannelId = normalizeTextInput(post?.channelId, { maxLength: 300 })
    return !postChannelId || !allowedChannelIds.has(postChannelId)
  })
  if (hasInvalidChannelPost) {
    res.status(400).json({
      error: 'invalid_campaign_posts_payload',
      message: 'Posts must belong to accounts connected to the campaign organization.',
    })
    return
  }
  const postsByChannelForWrite = buildCampaignPostsByChannel(nextSelectedPosts)
  const nextDistributionSources = readCampaignDistributionObject(rawDistributionSources)
  nextDistributionSources[CAMPAIGN_SELECTED_POST_IDS_KEY] = selectedPostIds
  if (selectedChannelId) {
    nextDistributionSources[CAMPAIGN_SELECTED_CHANNEL_ID_KEY] = selectedChannelId
  } else {
    delete nextDistributionSources[CAMPAIGN_SELECTED_CHANNEL_ID_KEY]
  }
  const distributionSourcesForWrite = formatCampaignDistributionValueForWrite(
    nextDistributionSources,
    rawDistributionSources,
  )

  const updateResult = await updateCampaignPostsAndMetrics(campaignId, {
    viewsDelivered,
    engagementRate,
    distributionSources: distributionSourcesForWrite,
    posts: postsByChannelForWrite,
  })
  if (!updateResult.ok) {
    console.error('Campaign post update failed:', {
      campaignId,
      viewerUserId: viewer.userId,
      status: updateResult.status,
      details: updateResult.payload,
    })
    res.status(updateResult.status || 500).json({
      error: 'campaign_posts_update_failed',
      message: 'Unable to update campaign posts in Supabase.',
      details: updateResult.payload,
    })
    return
  }

  const updatedCampaignRow = updateResult.row ?? {
    ...campaignRow,
    views_delivered: viewsDelivered,
    engagement_rate: engagementRate,
    distribution_sources: distributionSourcesForWrite,
    posts: postsByChannelForWrite,
  }
  const visibleChannelIds = await resolveVisibleCampaignChannelIdsForViewer(
    updatedCampaignRow,
    viewer.userId,
  )

  res.json({
    campaign: mapCampaignForClient(updatedCampaignRow, {
      visibleChannelIds,
      viewerUserId: viewer.userId,
      viewerOrganizationIds: viewer.organizationIds,
      viewerOrganizationAdminIds: viewer.organizationAdminIds,
    }),
  })
})

app.get('/api/organizations', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'organizations_fetch_failed',
      message: viewer.message || 'Unable to load organizations.',
      details: viewer.details ?? null,
    })
    return
  }

  const organizationsResult = await listOrganizationRows()
  if (!organizationsResult.ok) {
    res.status(organizationsResult.status || 500).json({
      error: 'organizations_fetch_failed',
      message: 'Unable to load organizations from Supabase.',
      details: organizationsResult.payload,
    })
    return
  }

  const visibleOrganizations = organizationsResult.rows
    .filter((row) => canUserSeeOrganization(row, viewer.userId, viewer.appRole))
  const memberIds = uniqueValues(
    visibleOrganizations.flatMap((row) => {
      const creator = normalizeTextInput(row?.creator, { maxLength: 80 })
      return Object.keys(normalizeOrganizationMemberRoles(row?.members, creator))
    }),
  )
  const usersResult = await fetchUsersRowsByIds(memberIds)
  if (!usersResult.ok) {
    console.error('Unable to resolve organization member emails:', {
      status: usersResult.status,
      details: usersResult.payload,
    })
  }

  const campaignNameById = await resolveCampaignNameByIdForOrganizations(visibleOrganizations)

  res.json({
    organizations: visibleOrganizations.map((row) =>
      mapOrganizationForClient(row, usersResult.ok ? usersResult.rows : [], campaignNameById),
    ),
    viewerUserId: viewer.userId,
  })
})

app.post('/api/organizations', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'organization_create_failed',
      message: viewer.message || 'Unable to create organization.',
      details: viewer.details ?? null,
    })
    return
  }
  if (!canRoleCreateOrganizations(viewer.appRole)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only admins can create organizations.',
    })
    return
  }

  const payload = req.body ?? {}
  const name = normalizeTextInput(payload.name, { maxLength: 140 })
  const campaigns = normalizeUuidArray(payload.campaigns)
  const requestedRoleByUserId = normalizeOrganizationMemberRoles(payload.members)
  const requestedRoleEmailInputs = normalizeOrganizationMemberInviteInputArray(payload.memberAccess)
  const requestedEmailInputs = normalizeEmailInputArray(payload.memberEmails)
  const requestedMemberInviteByEmail = new Map()
  for (const member of requestedRoleEmailInputs.validMembers) {
    requestedMemberInviteByEmail.set(member.email, member.role)
  }
  for (const email of requestedEmailInputs.validEmails) {
    if (!requestedMemberInviteByEmail.has(email)) {
      requestedMemberInviteByEmail.set(email, ORGANIZATION_MEMBER_ROLE_INTERNAL)
    }
  }
  let memberResolution = buildEmptyMemberResolution()
  const creatorEmail = normalizeEmail(viewer.email)
  const creatorEmailWasRequested = Boolean(
    creatorEmail && requestedMemberInviteByEmail.has(creatorEmail),
  )
  if (creatorEmailWasRequested) {
    requestedMemberInviteByEmail.delete(creatorEmail)
    memberResolution.failed.push({
      action: 'add',
      email: creatorEmail,
      error: 'cannot_add_creator',
      message: 'Organization creator is added automatically and cannot be invited as a member.',
    })
  }
  for (const email of requestedRoleEmailInputs.invalidEmails) {
    memberResolution.failed.push({
      action: 'add',
      email,
      error: 'invalid_email',
      message: 'Email format is invalid.',
    })
  }
  for (const email of requestedEmailInputs.invalidEmails) {
    memberResolution.failed.push({
      action: 'add',
      email,
      error: 'invalid_email',
      message: 'Email format is invalid.',
    })
  }

  if (!name) {
    res.status(400).json({
      error: 'invalid_organization_payload',
      message: 'name is required.',
    })
    return
  }

  const campaignsResult = await listCampaignRows()
  if (!campaignsResult.ok) {
    res.status(campaignsResult.status || 500).json({
      error: 'organization_create_failed',
      message: 'Unable to verify campaign access.',
      details: campaignsResult.payload,
    })
    return
  }

  const visibleCampaignIds = new Set(
    campaignsResult.rows
      .filter((row) => canUserSeeCampaign(row, viewer.userId, viewer.organizationIds, viewer.organizationAdminIds))
      .map((row) => normalizeTextInput(row?.id, { maxLength: 80 }))
      .filter((id) => isUuid(id)),
  )
  const invalidCampaignIds = campaigns.filter((campaignId) => !visibleCampaignIds.has(campaignId))
  if (invalidCampaignIds.length) {
    const invalidCampaignNames = summarizeInvalidCampaignNames(invalidCampaignIds, campaignsResult.rows)
    const invalidCampaignMessage = invalidCampaignNames.length
      ? `One or more selected campaigns are invalid or inaccessible: ${invalidCampaignNames.join(', ')}.`
      : 'One or more selected campaigns are invalid or inaccessible.'
    res.status(400).json({
      error: 'invalid_organization_payload',
      message: invalidCampaignMessage,
      invalidCampaignNames,
    })
    return
  }

  const requestedMemberInvites = [...requestedMemberInviteByEmail.entries()].map(([email, role]) => ({
    email,
    role,
  }))
  if (requestedMemberInvites.length) {
    const resolvedMembers = await resolveOrganizationMemberIdsFromEmails(requestedMemberInvites)
    memberResolution.added.push(...resolvedMembers.resolution.added)
    memberResolution.removed.push(...resolvedMembers.resolution.removed)
    memberResolution.failed.push(...resolvedMembers.resolution.failed)
    for (const member of resolvedMembers.resolvedMembers) {
      const existingRole = requestedRoleByUserId[member.userId]
      if (
        !existingRole ||
        organizationMemberRolePriority(member.role) > organizationMemberRolePriority(existingRole)
      ) {
        requestedRoleByUserId[member.userId] = member.role
      }
    }
  }

  const requestedMembers = normalizeOrganizationMemberRoles(requestedRoleByUserId, viewer.userId)
  const memberIds = Object.keys(requestedMembers)
  const usersResult = await fetchUsersRowsByIds(memberIds)
  if (!usersResult.ok) {
    res.status(usersResult.status || 500).json({
      error: 'organization_create_failed',
      message: 'Unable to validate organization members.',
      details: usersResult.payload,
    })
    return
  }

  const foundUserIds = new Set(
    usersResult.rows
      .map((row) => normalizeTextInput(row?.id, { maxLength: 80 }))
      .filter((id) => isUuid(id)),
  )
  const invalidMemberIds = memberIds.filter((memberId) => !foundUserIds.has(memberId))
  if (invalidMemberIds.length) {
    res.status(400).json({
      error: 'invalid_organization_payload',
      message: 'One or more member UUIDs do not exist in Users.',
      invalidMemberIds,
    })
    return
  }

  const rowToInsert = {
    id: crypto.randomUUID(),
    name,
    campaigns: campaigns.length ? campaigns : null,
    members: requestedMembers,
    creator: viewer.userId,
    connected_accounts: [],
  }

  const inserted = await insertOrganizationRow(rowToInsert)
  if (!inserted.ok) {
    console.error('Failed to insert organization:', {
      status: inserted.status,
      details: inserted.payload,
    })
    res.status(inserted.status || 500).json({
      error: 'organization_create_failed',
      message: 'Unable to create organization in Supabase.',
      details: inserted.payload,
    })
    return
  }

  const createdRow = inserted.row ?? rowToInsert
  if (campaigns.length) {
    const campaignSync = await syncCampaignAllowedOrgsForCampaignIds(campaigns)
    if (!campaignSync.ok) {
      console.error('Failed to sync campaign allowed_orgs after organization create:', {
        organizationId: normalizeTextInput(createdRow?.id, { maxLength: 80 }),
        campaignIds: campaigns,
        failedCampaignIds: campaignSync.failedCampaigns,
      })
    }
  }
  const campaignNameById = buildCampaignNameById(campaignsResult.rows)

  res.status(201).json({
    organization: mapOrganizationForClient(createdRow, usersResult.rows, campaignNameById),
    viewerUserId: viewer.userId,
    memberResolution,
  })
})

app.post('/api/organizations/:organizationId/details', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'organization_update_failed',
      message: viewer.message || 'Unable to update organization.',
      details: viewer.details ?? null,
    })
    return
  }

  const organizationId =
    typeof req.params?.organizationId === 'string' ? req.params.organizationId.trim() : ''
  if (!isUuid(organizationId)) {
    res.status(400).json({
      error: 'invalid_organization_id',
      message: 'Organization id must be a valid UUID.',
    })
    return
  }

  const organizationResult = await fetchOrganizationRowById(organizationId)
  if (!organizationResult.ok) {
    res.status(organizationResult.status || 500).json({
      error: 'organization_update_failed',
      message: 'Unable to load organization from Supabase.',
      details: organizationResult.payload,
    })
    return
  }
  const organizationRow = organizationResult.row
  if (!organizationRow) {
    res.status(404).json({
      error: 'organization_not_found',
      message: 'Organization was not found.',
    })
    return
  }
  if (!canUserSeeOrganization(organizationRow, viewer.userId, viewer.appRole)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this organization.',
    })
    return
  }
  if (!canUserManageOrganizationDetails(organizationRow, viewer.userId)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization admin and internal members can edit organizations.',
    })
    return
  }

  const payload = req.body ?? {}
  const hasName = Object.prototype.hasOwnProperty.call(payload, 'name')
  const hasCampaigns = Object.prototype.hasOwnProperty.call(payload, 'campaigns')
  if (!hasName && !hasCampaigns) {
    res.status(400).json({
      error: 'invalid_organization_payload',
      message: 'Provide at least one field to update: name or campaigns.',
    })
    return
  }

  const nextName = hasName
    ? normalizeTextInput(payload.name, { maxLength: 140 })
    : normalizeTextInput(organizationRow?.name, { maxLength: 140 })
  const currentName = normalizeTextInput(organizationRow?.name, { maxLength: 140 })
  const viewerOrganizationRole = resolveOrganizationUserRole(organizationRow, viewer.userId)
  if (
    viewerOrganizationRole === ORGANIZATION_MEMBER_ROLE_INTERNAL &&
    hasName &&
    nextName !== currentName
  ) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Internal organization members can update campaign access but cannot edit organization name.',
    })
    return
  }
  if (!nextName) {
    res.status(400).json({
      error: 'invalid_organization_payload',
      message: 'Organization name is required.',
    })
    return
  }

  const previousCampaigns = normalizeUuidArray(organizationRow?.campaigns)
  const nextCampaigns = hasCampaigns
    ? normalizeUuidArray(payload.campaigns)
    : normalizeUuidArray(organizationRow?.campaigns)

  const campaignsResult = await listCampaignRows()
  if (!campaignsResult.ok) {
    res.status(campaignsResult.status || 500).json({
      error: 'organization_update_failed',
      message: 'Unable to verify campaign access.',
      details: campaignsResult.payload,
    })
    return
  }

  const visibleCampaignIds = new Set(
    campaignsResult.rows
      .filter((row) => canUserSeeCampaign(row, viewer.userId, viewer.organizationIds, viewer.organizationAdminIds))
      .map((row) => normalizeTextInput(row?.id, { maxLength: 80 }))
      .filter((id) => isUuid(id)),
  )
  const invalidCampaignIds = nextCampaigns.filter((campaignId) => !visibleCampaignIds.has(campaignId))
  if (invalidCampaignIds.length) {
    const invalidCampaignNames = summarizeInvalidCampaignNames(invalidCampaignIds, campaignsResult.rows)
    const invalidCampaignMessage = invalidCampaignNames.length
      ? `One or more selected campaigns are invalid or inaccessible: ${invalidCampaignNames.join(', ')}.`
      : 'One or more selected campaigns are invalid or inaccessible.'
    res.status(400).json({
      error: 'invalid_organization_payload',
      message: invalidCampaignMessage,
      invalidCampaignNames,
    })
    return
  }

  const updateResult = await updateOrganizationDetails(organizationId, {
    name: nextName,
    campaigns: nextCampaigns.length ? nextCampaigns : null,
  })
  if (!updateResult.ok) {
    console.error('Failed to update organization details:', {
      organizationId,
      viewerUserId: viewer.userId,
      status: updateResult.status,
      details: updateResult.payload,
    })
    res.status(updateResult.status || 500).json({
      error: 'organization_update_failed',
      message: 'Unable to update organization details in Supabase.',
      details: updateResult.payload,
    })
    return
  }

  const updatedOrganizationRow = updateResult.row ?? {
    ...organizationRow,
    name: nextName,
    campaigns: nextCampaigns.length ? nextCampaigns : null,
  }
  const campaignIdsToSync = uniqueValues([...previousCampaigns, ...nextCampaigns])
  if (campaignIdsToSync.length) {
    const campaignSync = await syncCampaignAllowedOrgsForCampaignIds(campaignIdsToSync)
    if (!campaignSync.ok) {
      console.error('Failed to sync campaign allowed_orgs after organization update:', {
        organizationId,
        campaignIds: campaignIdsToSync,
        failedCampaignIds: campaignSync.failedCampaigns,
      })
    }
  }
  const creatorId = normalizeTextInput(updatedOrganizationRow?.creator, { maxLength: 80 })
  const memberIds = Object.keys(normalizeOrganizationMemberRoles(updatedOrganizationRow?.members, creatorId))
  const usersResult = await fetchUsersRowsByIds(memberIds)
  if (!usersResult.ok) {
    console.error('Unable to load organization member emails after details update:', {
      organizationId,
      status: usersResult.status,
      details: usersResult.payload,
    })
  }

  const campaignNameById = buildCampaignNameById(campaignsResult.rows)

  res.json({
    organization: mapOrganizationForClient(
      updatedOrganizationRow,
      usersResult.ok ? usersResult.rows : [],
      campaignNameById,
    ),
  })
})

app.delete('/api/organizations/:organizationId', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'organization_delete_failed',
      message: viewer.message || 'Unable to delete organization.',
      details: viewer.details ?? null,
    })
    return
  }

  const organizationId =
    typeof req.params?.organizationId === 'string' ? req.params.organizationId.trim() : ''
  if (!isUuid(organizationId)) {
    res.status(400).json({
      error: 'invalid_organization_id',
      message: 'Organization id must be a valid UUID.',
    })
    return
  }

  const organizationResult = await fetchOrganizationRowById(organizationId)
  if (!organizationResult.ok) {
    res.status(organizationResult.status || 500).json({
      error: 'organization_delete_failed',
      message: 'Unable to load organization from Supabase.',
      details: organizationResult.payload,
    })
    return
  }
  const organizationRow = organizationResult.row
  if (!organizationRow) {
    res.status(404).json({
      error: 'organization_not_found',
      message: 'Organization was not found.',
    })
    return
  }
  if (!canUserSeeOrganization(organizationRow, viewer.userId, viewer.appRole)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this organization.',
    })
    return
  }
  if (!canUserDeleteOrganization(organizationRow, viewer.userId)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization admin members can delete organizations.',
    })
    return
  }

  const campaignIdsToSync = normalizeUuidArray(organizationRow?.campaigns)
  const deleted = await deleteOrganizationRowById(organizationId)
  if (!deleted.ok) {
    console.error('Failed to delete organization:', {
      organizationId,
      viewerUserId: viewer.userId,
      status: deleted.status,
      details: deleted.payload,
    })
    res.status(deleted.status || 500).json({
      error: 'organization_delete_failed',
      message: 'Unable to delete organization in Supabase.',
      details: deleted.payload,
    })
    return
  }

  if (campaignIdsToSync.length) {
    const campaignSync = await syncCampaignAllowedOrgsForCampaignIds(campaignIdsToSync)
    if (!campaignSync.ok) {
      console.error('Failed to sync campaign allowed_orgs after organization delete:', {
        organizationId,
        campaignIds: campaignIdsToSync,
        failedCampaignIds: campaignSync.failedCampaigns,
      })
    }
  }
  res.json({ organizationId })
})

app.post('/api/organizations/:organizationId/members', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'organization_members_update_failed',
      message: viewer.message || 'Unable to update organization members.',
      details: viewer.details ?? null,
    })
    return
  }

  const organizationId =
    typeof req.params?.organizationId === 'string' ? req.params.organizationId.trim() : ''
  if (!isUuid(organizationId)) {
    res.status(400).json({
      error: 'invalid_organization_id',
      message: 'Organization id must be a valid UUID.',
    })
    return
  }

  const payload = req.body ?? {}
  const addMemberInputs = normalizeOrganizationMemberInviteInputArray(payload.addMembers)
  const addEmailInputs = normalizeEmailInputArray(payload.addEmails)
  const removeEmailInputs = normalizeEmailInputArray(payload.removeEmails)
  const removeUserIds = normalizeUuidArray(payload.removeUserIds)
  const roleUpdateInputs = normalizeOrganizationMemberRoleUpdateInputArray(payload.roleUpdates)
  const campaignAccessUpdateInputs =
    normalizeOrganizationCampaignAccessUpdateInputArray(payload.campaignAccessUpdates)
  const hasInput =
    addMemberInputs.validMembers.length ||
    addMemberInputs.invalidEmails.length ||
    addEmailInputs.validEmails.length ||
    addEmailInputs.invalidEmails.length ||
    removeEmailInputs.validEmails.length ||
    removeEmailInputs.invalidEmails.length ||
    removeUserIds.length ||
    roleUpdateInputs.validUpdates.length ||
    roleUpdateInputs.invalidUserIds.length ||
    campaignAccessUpdateInputs.validUpdates.length ||
    campaignAccessUpdateInputs.invalidEntries.length
  if (!hasInput) {
    res.status(400).json({
      error: 'invalid_organization_member_payload',
      message:
        'Provide at least one valid member in addMembers, roleUpdates, campaignAccessUpdates, addEmails, removeEmails, or removeUserIds.',
    })
    return
  }

  const organizationResult = await fetchOrganizationRowById(organizationId)
  if (!organizationResult.ok) {
    res.status(organizationResult.status || 500).json({
      error: 'organization_members_update_failed',
      message: 'Unable to load organization from Supabase.',
      details: organizationResult.payload,
    })
    return
  }
  const organizationRow = organizationResult.row
  if (!organizationRow) {
    res.status(404).json({
      error: 'organization_not_found',
      message: 'Organization was not found.',
    })
    return
  }
  if (!canUserSeeOrganization(organizationRow, viewer.userId, viewer.appRole)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this organization.',
    })
    return
  }
  if (!canUserManageOrganizationMembers(organizationRow, viewer.userId)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization admin members can manage organization members.',
    })
    return
  }

  const canChangeRoles = canUserChangeOrganizationMemberRoles(organizationRow, viewer.userId)
  const canChangeCampaignAccess = canChangeRoles
  const addMembersContainRoleMutations = addMemberInputs.validMembers.some(
    (member) => normalizeOrganizationMemberRole(member.role) !== ORGANIZATION_MEMBER_ROLE_INTERNAL,
  )
  const hasRoleMutations = Boolean(
    roleUpdateInputs.validUpdates.length ||
    roleUpdateInputs.invalidUserIds.length ||
    addMembersContainRoleMutations,
  )
  if (!canChangeRoles && hasRoleMutations) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization admin members can change member roles.',
    })
    return
  }
  const hasCampaignAccessMutations = Boolean(
    campaignAccessUpdateInputs.validUpdates.length || campaignAccessUpdateInputs.invalidEntries.length,
  )
  if (!canChangeCampaignAccess && hasCampaignAccessMutations) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization admin members can update campaign access.',
    })
    return
  }

  const creatorId = normalizeTextInput(organizationRow?.creator, { maxLength: 80 })
  const memberRoleByUserId = normalizeOrganizationMemberRoles(organizationRow?.members, creatorId)
  const roleUpdates = canChangeRoles ? roleUpdateInputs.validUpdates : []
  const memberUpdateResult = buildEmptyMemberResolution()
  const addMemberByEmail = new Map()

  for (const member of addMemberInputs.validMembers) {
    addMemberByEmail.set(member.email, member.role)
  }
  for (const email of addEmailInputs.validEmails) {
    if (!addMemberByEmail.has(email)) {
      addMemberByEmail.set(email, ORGANIZATION_MEMBER_ROLE_INTERNAL)
    }
  }
  const creatorEmail = normalizeEmail(viewer.email)
  if (creatorEmail && addMemberByEmail.has(creatorEmail)) {
    addMemberByEmail.delete(creatorEmail)
    memberUpdateResult.failed.push({
      action: 'add',
      email: creatorEmail,
      error: 'cannot_add_creator',
      message: 'Organization creator is added automatically and cannot be invited as a member.',
    })
  }
  for (const email of addMemberInputs.invalidEmails) {
    memberUpdateResult.failed.push({
      action: 'add',
      email,
      error: 'invalid_email',
      message: 'Email format is invalid.',
    })
  }
  for (const email of addEmailInputs.invalidEmails) {
    memberUpdateResult.failed.push({
      action: 'add',
      email,
      error: 'invalid_email',
      message: 'Email format is invalid.',
    })
  }
  for (const email of removeEmailInputs.invalidEmails) {
    memberUpdateResult.failed.push({
      action: 'remove',
      email,
      error: 'invalid_email',
      message: 'Email format is invalid.',
    })
  }
  for (const userId of roleUpdateInputs.invalidUserIds) {
    memberUpdateResult.failed.push({
      email: userId,
      userId,
      error: 'invalid_user_id',
      message: 'User id must be a valid UUID.',
    })
  }
  for (const invalidEntry of campaignAccessUpdateInputs.invalidEntries) {
    const campaignId = normalizeTextInput(invalidEntry?.campaignId, { maxLength: 80 }) || 'invalid_campaign_id'
    const userId = normalizeTextInput(invalidEntry?.userId, { maxLength: 80 }) || 'invalid_user_id'
    memberUpdateResult.failed.push({
      email: userId,
      userId,
      error: 'invalid_campaign_access_update',
      message: `Campaign access update is invalid for campaign ${campaignId}.`,
    })
  }

  const addMembers = [...addMemberByEmail.entries()].map(([email, role]) => ({ email, role }))
  if (addMembers.length) {
    const resolvedMembers = await resolveOrganizationMemberIdsFromEmails(addMembers)
    memberUpdateResult.failed.push(...resolvedMembers.resolution.failed)
    for (const member of resolvedMembers.resolvedMembers) {
      const userId = normalizeTextInput(member?.userId, { maxLength: 80 })
      const email =
        normalizeEmail(member?.email) || (isUuid(userId) ? userId : 'unknown')
      const role = canChangeRoles
        ? normalizeOrganizationMemberRole(member?.role)
        : ORGANIZATION_MEMBER_ROLE_INTERNAL
      if (!isUuid(userId)) {
        memberUpdateResult.failed.push({
          action: 'add',
          email,
          error: 'invalid_user_id',
          message: 'User id must be a valid UUID.',
        })
        continue
      }
      if (userId === creatorId) {
        memberUpdateResult.failed.push({
          action: 'add',
          email,
          userId,
          error: 'cannot_add_creator',
          message: 'Organization creator is added automatically and cannot be invited as a member.',
        })
        continue
      }
      const existingRole = memberRoleByUserId[userId]
      if (existingRole) {
        const currentRole = normalizeOrganizationMemberRole(existingRole)
        if (organizationMemberRolePriority(role) > organizationMemberRolePriority(currentRole)) {
          memberRoleByUserId[userId] = role
          memberUpdateResult.added.push({
            action: 'add',
            email,
            userId,
            message: `User role updated to ${role}.`,
          })
        } else {
          memberUpdateResult.failed.push({
            action: 'add',
            email,
            userId,
            error: 'user_already_member',
            message: 'User is already a member of this organization.',
          })
        }
        continue
      }
      memberRoleByUserId[userId] = role
      memberUpdateResult.added.push({
        action: 'add',
        email,
        userId,
        message: `User added to organization members as ${role}.`,
      })
    }
  }

  for (const email of removeEmailInputs.validEmails) {
    const lookupResult = await fetchUsersRowByEmail(email)
    if (!lookupResult.ok) {
      memberUpdateResult.failed.push({
        action: 'remove',
        email,
        error: 'lookup_failed',
        message: 'Unable to verify this email right now.',
      })
      continue
    }
    const userId = normalizeTextInput(lookupResult.row?.id, { maxLength: 80 })
    if (!isUuid(userId)) {
      memberUpdateResult.failed.push({
        action: 'remove',
        email,
        error: 'user_not_found',
        message: 'No matching user was found for this email.',
      })
      continue
    }
    if (userId === creatorId) {
      memberUpdateResult.failed.push({
        action: 'remove',
        email,
        error: 'cannot_remove_creator',
        message: 'Organization creator cannot be removed.',
      })
      continue
    }
    if (userId === viewer.userId) {
      memberUpdateResult.failed.push({
        action: 'remove',
        email,
        userId,
        error: 'cannot_remove_self',
        message: 'You cannot remove yourself from organization members.',
      })
      continue
    }
    if (!memberRoleByUserId[userId]) {
      memberUpdateResult.failed.push({
        action: 'remove',
        email,
        error: 'not_member',
        message: 'User is not currently a member of this organization.',
      })
      continue
    }
    delete memberRoleByUserId[userId]
    memberUpdateResult.removed.push({
      action: 'remove',
      email,
      userId,
      message: 'User removed from organization members.',
    })
  }

  const lookupUserIds = uniqueValues([
    ...removeUserIds,
    ...roleUpdates.map((entry) => entry.userId),
    ...campaignAccessUpdateInputs.validUpdates.map((entry) => entry.userId),
  ])
  const usersLookup = lookupUserIds.length
    ? await fetchUsersRowsByIds(lookupUserIds)
    : { ok: true, rows: [] }
  const userLabelById = new Map(
    (usersLookup.ok && Array.isArray(usersLookup.rows) ? usersLookup.rows : []).map((row) => {
      const id = normalizeTextInput(row?.id, { maxLength: 80 })
      const email = normalizeEmail(row?.email)
      return [id, email]
    }),
  )

  for (const userId of removeUserIds) {
    const displayEmail = userLabelById.get(userId) || userId
    if (userId === creatorId) {
      memberUpdateResult.failed.push({
        action: 'remove',
        email: displayEmail,
        userId,
        error: 'cannot_remove_creator',
        message: 'Organization creator cannot be removed.',
      })
      continue
    }
    if (userId === viewer.userId) {
      memberUpdateResult.failed.push({
        action: 'remove',
        email: displayEmail,
        userId,
        error: 'cannot_remove_self',
        message: 'You cannot remove yourself from organization members.',
      })
      continue
    }
    if (!memberRoleByUserId[userId]) {
      memberUpdateResult.failed.push({
        action: 'remove',
        email: displayEmail,
        userId,
        error: 'not_member',
        message: 'User is not currently a member of this organization.',
      })
      continue
    }
    delete memberRoleByUserId[userId]
    memberUpdateResult.removed.push({
      action: 'remove',
      email: displayEmail,
      userId,
      message: 'User removed from organization members.',
    })
  }

  for (const update of roleUpdates) {
    const userId = update.userId
    const role = normalizeOrganizationMemberRole(update.role)
    const label = userLabelById.get(userId) || userId
    if (userId === viewer.userId) {
      memberUpdateResult.failed.push({
        email: label,
        userId,
        error: 'cannot_change_own_role',
        message: 'You cannot change your own organization role.',
      })
      continue
    }
    if (userId === creatorId) {
      memberUpdateResult.failed.push({
        email: label,
        userId,
        error: 'cannot_change_creator_role',
        message: 'The organization creator role cannot be changed.',
      })
      continue
    }

    if (!memberRoleByUserId[userId]) {
      memberUpdateResult.failed.push({
        email: label,
        userId,
        error: 'not_member',
        message: 'User is not currently a member of this organization.',
      })
      continue
    }

    const currentRole = normalizeOrganizationMemberRole(memberRoleByUserId[userId])
    if (currentRole === role) {
      continue
    }

    memberRoleByUserId[userId] = role
    memberUpdateResult.added.push({
      action: 'add',
      email: label,
      userId,
      message: `User role updated to ${role}.`,
    })
  }

  const nextMemberRoles = normalizeOrganizationMemberRoles(memberRoleByUserId, creatorId)
  const updateMembersResult = await updateOrganizationMembers(organizationId, nextMemberRoles, creatorId)
  if (!updateMembersResult.ok) {
    console.error('Failed to update organization members:', {
      organizationId,
      viewerUserId: viewer.userId,
      status: updateMembersResult.status,
      details: updateMembersResult.payload,
    })
    res.status(updateMembersResult.status || 500).json({
      error: 'organization_members_update_failed',
      message: 'Unable to update organization members in Supabase.',
      details: updateMembersResult.payload,
    })
    return
  }

  const updatedOrganizationRow = updateMembersResult.row ?? {
    ...organizationRow,
    members: nextMemberRoles,
  }
  const memberIds = Object.keys(nextMemberRoles)
  const usersResult = await fetchUsersRowsByIds(memberIds)
  if (!usersResult.ok) {
    console.error('Unable to load organization member emails after update:', {
      organizationId,
      status: usersResult.status,
      details: usersResult.payload,
    })
  }

  const organizationCampaignIdSet = new Set(normalizeUuidArray(updatedOrganizationRow?.campaigns))
  const campaignAccessUpdatesByCampaignId = new Map()
  for (const update of campaignAccessUpdateInputs.validUpdates) {
    const campaignId = normalizeTextInput(update?.campaignId, { maxLength: 80 })
    const userId = normalizeTextInput(update?.userId, { maxLength: 80 })
    if (!isUuid(campaignId) || !isUuid(userId)) continue
    if (!organizationCampaignIdSet.has(campaignId)) {
      const label = userLabelById.get(userId) || userId
      memberUpdateResult.failed.push({
        email: label,
        userId,
        error: 'campaign_not_in_organization',
        message: `Campaign ${campaignId} is not assigned to this organization.`,
      })
      continue
    }
    const existing = campaignAccessUpdatesByCampaignId.get(campaignId) ?? []
    existing.push({ userId, hasAccess: Boolean(update?.hasAccess) })
    campaignAccessUpdatesByCampaignId.set(campaignId, existing)
  }

  for (const [campaignId, updates] of campaignAccessUpdatesByCampaignId.entries()) {
    const campaignResult = await fetchCampaignRowById(campaignId)
    if (!campaignResult.ok || !campaignResult.row) {
      const failedStatus = campaignResult.status || 500
      for (const update of updates) {
        const label = userLabelById.get(update.userId) || update.userId
        memberUpdateResult.failed.push({
          email: label,
          userId: update.userId,
          error: 'campaign_lookup_failed',
          message: `Unable to load campaign ${campaignId} (status ${failedStatus}).`,
        })
      }
      continue
    }

    const campaignRow = campaignResult.row
    if (!canUserManageCampaignMembers(campaignRow, viewer.userId, viewer.organizationAdminIds)) {
      for (const update of updates) {
        const label = userLabelById.get(update.userId) || update.userId
        memberUpdateResult.failed.push({
          email: label,
          userId: update.userId,
          error: 'campaign_access_forbidden',
          message: 'Only campaign admins can update campaign access.',
        })
      }
      continue
    }

    const campaignCreatorId = normalizeTextInput(campaignRow?.creator, { maxLength: 80 })
    const campaignName =
      normalizeTextInput(campaignRow?.campaign_name, { maxLength: 140 }) || campaignId
    const nextCampaignMemberRoles = normalizeCampaignMemberRoles(
      campaignRow?.allowed_members,
      campaignCreatorId,
    )

    let hasCampaignAccessChange = false
    for (const update of updates) {
      const userId = update.userId
      const label = userLabelById.get(userId) || userId
      if (!isUuid(userId)) {
        memberUpdateResult.failed.push({
          email: label,
          userId,
          error: 'invalid_user_id',
          message: 'User id must be a valid UUID.',
        })
        continue
      }
      if (!update.hasAccess && userId === viewer.userId) {
        memberUpdateResult.failed.push({
          email: label,
          userId,
          error: 'cannot_remove_self',
          message: `You cannot remove your own campaign access for ${campaignName}.`,
        })
        continue
      }

      if (userId === campaignCreatorId && !update.hasAccess) {
        memberUpdateResult.failed.push({
          email: label,
          userId,
          error: 'cannot_remove_creator',
          message: `Campaign creator access cannot be removed for ${campaignName}.`,
        })
        continue
      }

      if (update.hasAccess) {
        const organizationRole = normalizeOrganizationMemberRole(nextMemberRoles[userId])
        if (!organizationRole && userId !== campaignCreatorId) {
          memberUpdateResult.failed.push({
            email: label,
            userId,
            error: 'not_member',
            message: 'User is not currently a member of this organization.',
          })
          continue
        }
        if (!nextCampaignMemberRoles[userId]) {
          const campaignRole = organizationRole === ORGANIZATION_MEMBER_ROLE_BRAND_VIEWER
            ? CAMPAIGN_MEMBER_ROLE_BRAND_VIEWER
            : CAMPAIGN_MEMBER_ROLE_INTERNAL
          nextCampaignMemberRoles[userId] = campaignRole
          hasCampaignAccessChange = true
          memberUpdateResult.added.push({
            action: 'add',
            email: label,
            userId,
            message: `Campaign access granted for ${campaignName}.`,
          })
        }
        continue
      }

      if (nextCampaignMemberRoles[userId]) {
        delete nextCampaignMemberRoles[userId]
        hasCampaignAccessChange = true
        memberUpdateResult.removed.push({
          action: 'remove',
          email: label,
          userId,
          message: `Campaign access removed for ${campaignName}.`,
        })
      }
    }

    if (!hasCampaignAccessChange) continue

    const campaignAccessUpdateResult = await updateCampaignAllowedMembers(
      campaignId,
      nextCampaignMemberRoles,
      campaignCreatorId,
    )
    if (!campaignAccessUpdateResult.ok) {
      for (const update of updates) {
        const label = userLabelById.get(update.userId) || update.userId
        memberUpdateResult.failed.push({
          email: label,
          userId: update.userId,
          error: 'campaign_access_update_failed',
          message: `Unable to save campaign access for ${campaignName}.`,
        })
      }
    }
  }

  const campaignNameById = await resolveCampaignNameByIdForOrganizations([updatedOrganizationRow])

  res.json({
    organization: mapOrganizationForClient(
      updatedOrganizationRow,
      usersResult.ok ? usersResult.rows : [],
      campaignNameById,
    ),
    updateResult: memberUpdateResult,
  })
})

app.post('/api/organizations/:organizationId/connections', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'organization_connections_update_failed',
      message: viewer.message || 'Unable to update organization connections.',
      details: viewer.details ?? null,
    })
    return
  }

  const organizationId =
    typeof req.params?.organizationId === 'string' ? req.params.organizationId.trim() : ''
  if (!isUuid(organizationId)) {
    res.status(400).json({
      error: 'invalid_organization_id',
      message: 'Organization id must be a valid UUID.',
    })
    return
  }

  const organizationResult = await fetchOrganizationRowById(organizationId)
  if (!organizationResult.ok) {
    res.status(organizationResult.status || 500).json({
      error: 'organization_connections_update_failed',
      message: 'Unable to load organization from Supabase.',
      details: organizationResult.payload,
    })
    return
  }
  const organizationRow = organizationResult.row
  if (!organizationRow) {
    res.status(404).json({
      error: 'organization_not_found',
      message: 'Organization was not found.',
    })
    return
  }
  if (!canUserSeeOrganization(organizationRow, viewer.userId, viewer.appRole)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this organization.',
    })
    return
  }
  if (!canUserManageOrganizationConnections(organizationRow, viewer.userId)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization admin members can manage organization connections.',
    })
    return
  }

  const payload = req.body ?? {}
  const platform = normalizeOrganizationConnectionPlatform(payload.platform)
  const accountName = normalizeTextInput(payload.accountName, { maxLength: 180 })
  const requestedUsername = normalizeXUsername(payload.username || payload.accountName)

  if (platform === ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE) {
    res.status(400).json({
      error: 'youtube_oauth_required',
      message: 'Connect YouTube accounts using the Connect YouTube button.',
    })
    return
  }
  if (platform === ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM) {
    res.status(400).json({
      error: 'instagram_oauth_required',
      message: 'Connect Instagram accounts using OAuth from the Manage Connections dialog.',
    })
    return
  }
  if (platform !== ORGANIZATION_CONNECTION_PLATFORM_X) {
    res.status(400).json({
      error: 'invalid_organization_connection_payload',
      message: 'Unsupported organization connection platform.',
    })
    return
  }
  if (!xCollectionEnabled || !xBearerToken) {
    res.status(503).json({
      error: 'x_not_configured',
      message: 'X integration is not configured on the server.',
    })
    return
  }
  if (!isValidXUsername(requestedUsername)) {
    res.status(400).json({
      error: 'invalid_x_username',
      message: 'Enter a valid X username (letters, numbers, underscores; max 15 chars).',
    })
    return
  }

  const xUserLookup = await fetchXUserByUsername(requestedUsername)
  if (!xUserLookup.ok || !xUserLookup.user) {
    res.status(xUserLookup.status || 502).json({
      error: xUserLookup.error || 'x_user_lookup_failed',
      message: 'Unable to resolve X username to user ID.',
      details: xUserLookup.payload ?? null,
    })
    return
  }
  const resolvedXUserId = xUserLookup.user.userId
  const resolvedXUsername = xUserLookup.user.username
  const resolvedAccountName = formatXAccountName(resolvedXUsername) || accountName || requestedUsername

  const currentAccounts = normalizeOrganizationConnectedAccounts(organizationRow?.connected_accounts)
  const existing = currentAccounts.find(
    (account) => {
      if (normalizeOrganizationConnectionPlatform(account.platform) !== platform) return false
      const existingXUserId = resolveXUserIdFromConnection(account)
      if (existingXUserId && resolvedXUserId) {
        return existingXUserId === resolvedXUserId
      }
      return normalizeXUsername(account.accountName) === resolvedXUsername
    },
  )
  const connectedAt = new Date().toISOString()
  const nextConnection = existing
    ? {
        ...existing,
        accountName: resolvedAccountName,
        channelId: resolvedXUserId,
        ownerUserId: viewer.userId,
        connectedAt,
      }
    : {
        id: buildOrganizationConnectionId(platform),
        platform,
        accountName: resolvedAccountName,
        channelId: resolvedXUserId,
        ownerUserId: viewer.userId,
        connectedAt,
      }
  const nextAccounts = existing
    ? currentAccounts.map((account) => (account.id === existing.id ? nextConnection : account))
    : [...currentAccounts, nextConnection]

  const updateResult = await updateOrganizationConnectedAccounts(organizationId, nextAccounts)
  if (!updateResult.ok || !updateResult.row) {
    res.status(updateResult.status || 500).json({
      error: 'organization_connections_update_failed',
      message: 'Unable to update organization connections in Supabase.',
      details: updateResult.payload,
    })
    return
  }

  const organization = await mapOrganizationForClientWithResolvedUsers(updateResult.row)
  const xSyncResult = await refreshAndPersistXAccount({
    userId: resolvedXUserId,
    username: resolvedXUsername,
    fallbackFollowerCount: xUserLookup.user.followerCount,
    ownerUserId: viewer.userId,
  })
  const connectionWarning = !xSyncResult.ok
    ? 'Connected account. Initial post sync failed; run Refresh to pull X posts and metrics.'
    : ''
  res.json({ organization, warning: connectionWarning })
})

app.delete('/api/organizations/:organizationId/connections/:connectionId', async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.status(viewer.status || 500).json({
      error: viewer.error || 'organization_connections_update_failed',
      message: viewer.message || 'Unable to update organization connections.',
      details: viewer.details ?? null,
    })
    return
  }

  const organizationId =
    typeof req.params?.organizationId === 'string' ? req.params.organizationId.trim() : ''
  if (!isUuid(organizationId)) {
    res.status(400).json({
      error: 'invalid_organization_id',
      message: 'Organization id must be a valid UUID.',
    })
    return
  }

  const connectionId = normalizeOrganizationConnectionId(req.params?.connectionId)
  if (!connectionId) {
    res.status(400).json({
      error: 'invalid_connection_id',
      message: 'Connection id is required.',
    })
    return
  }

  const organizationResult = await fetchOrganizationRowById(organizationId)
  if (!organizationResult.ok) {
    res.status(organizationResult.status || 500).json({
      error: 'organization_connections_update_failed',
      message: 'Unable to load organization from Supabase.',
      details: organizationResult.payload,
    })
    return
  }
  const organizationRow = organizationResult.row
  if (!organizationRow) {
    res.status(404).json({
      error: 'organization_not_found',
      message: 'Organization was not found.',
    })
    return
  }
  if (!canUserSeeOrganization(organizationRow, viewer.userId, viewer.appRole)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You do not have access to this organization.',
    })
    return
  }
  if (!canUserManageOrganizationConnections(organizationRow, viewer.userId)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization admin members can manage organization connections.',
    })
    return
  }

  const currentAccounts = normalizeOrganizationConnectedAccounts(organizationRow?.connected_accounts)
  const targetAccount = currentAccounts.find((account) => account.id === connectionId)
  if (!targetAccount) {
    res.status(404).json({
      error: 'organization_connection_not_found',
      message: 'Connection was not found.',
    })
    return
  }

  if (
    normalizeOrganizationConnectionPlatform(targetAccount.platform) === ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE
    && targetAccount.channelId
  ) {
    const ownerUserId = normalizeTextInput(targetAccount.ownerUserId, { maxLength: 80 })
      || normalizeTextInput(organizationRow?.creator, { maxLength: 80 })
    if (isUuid(ownerUserId)) {
      const deleteResult = await deleteYouTubeConnectionsByIds(ownerUserId, [targetAccount.channelId])
      if (!deleteResult.ok) {
        res.status(deleteResult.status || 500).json({
          error: 'organization_connections_update_failed',
          message: 'Unable to disconnect YouTube account from Supabase.',
          details: deleteResult.payload,
        })
        return
      }
      await deleteCachedYouTubeSummaryByUserId(ownerUserId)
    }
  }
  const nextAccounts = currentAccounts.filter((account) => account.id !== connectionId)
  const updateResult = await updateOrganizationConnectedAccounts(organizationId, nextAccounts)
  if (!updateResult.ok || !updateResult.row) {
    res.status(updateResult.status || 500).json({
      error: 'organization_connections_update_failed',
      message: 'Unable to update organization connections in Supabase.',
      details: updateResult.payload,
    })
    return
  }

  const organization = await mapOrganizationForClientWithResolvedUsers(updateResult.row)
  res.json({ organization })
})

app.get('/oauth/google', (req, res) => {
  const requestedOrigin =
    typeof req.query?.app_origin === 'string' ? req.query.app_origin : ''
  const refererOrigin = typeof req.headers.referer === 'string' ? req.headers.referer : ''
  const requestedOriginBase = resolveOriginBase(requestedOrigin)
  const refererOriginBase = resolveOriginBase(refererOrigin)
  const appOriginCandidate = requestedOriginBase || refererOriginBase
  const appOrigin =
    appOriginCandidate && (!isProd || trustedRequestOrigins.has(appOriginCandidate))
      ? appOriginCandidate
      : ''
  if (appOrigin) {
    res.cookie(APP_REDIRECT_COOKIE, appOrigin, {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: cookieSecure,
      maxAge: 10 * 60 * 1000,
    })
  }
  const redirectBase = appOrigin || resolveAppRedirectBase(req)
  const oauthRedirectUri = resolveGoogleOauthRedirectUri({
    requestOriginBase: requestedOriginBase,
    refererOriginBase,
  })

  if (!clientId || !clientSecret || !oauthRedirectUri) {
    res.redirect(buildAppRedirect({
      status: 'error',
      message: 'Google OAuth not configured.',
      baseUrl: redirectBase,
    }))
    return
  }

  const state = crypto.randomBytes(16).toString('hex')
  res.cookie('google_oauth_state', state, {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSecure,
    maxAge: 10 * 60 * 1000,
  })
  res.cookie(GOOGLE_OAUTH_CONTEXT_COOKIE, JSON.stringify({ redirectUri: oauthRedirectUri }), {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSecure,
    maxAge: 10 * 60 * 1000,
  })

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: oauthRedirectUri,
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
  const redirectBase = resolveAppRedirectBase(req)
  const expectedState = req.cookies.google_oauth_state
  const rawContext = req.cookies?.[GOOGLE_OAUTH_CONTEXT_COOKIE]
  let oauthContext = { redirectUri: '' }
  if (typeof rawContext === 'string' && rawContext.trim()) {
    try {
      const parsed = JSON.parse(rawContext)
      if (parsed && typeof parsed === 'object') {
        oauthContext = {
          redirectUri: normalizeTextInput(parsed.redirectUri, { maxLength: 500 }),
        }
      }
    } catch {
      oauthContext = { redirectUri: '' }
    }
  }
  const oauthRedirectUri = resolveGoogleOauthRedirectUri({
    requestOriginBase: redirectBase,
  })
  const redirectUriForExchange =
    normalizeTextInput(oauthContext.redirectUri, { maxLength: 500 }) || oauthRedirectUri

  const clearGoogleOauthCookies = () => {
    res.clearCookie('google_oauth_state')
    res.clearCookie(GOOGLE_OAUTH_CONTEXT_COOKIE)
    res.clearCookie(APP_REDIRECT_COOKIE)
  }

  if (error) {
    clearGoogleOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        message: typeof errorDescription === 'string' ? errorDescription : 'Google login failed.',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!state || !expectedState || state !== expectedState) {
    clearGoogleOauthCookies()
    res.redirect(buildAppRedirect({
      status: 'error',
      message: 'Google login state mismatch.',
      baseUrl: redirectBase,
    }))
    return
  }

  if (!code || typeof code !== 'string') {
    clearGoogleOauthCookies()
    res.redirect(buildAppRedirect({
      status: 'error',
      message: 'Missing authorization code.',
      baseUrl: redirectBase,
    }))
    return
  }

  try {
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUriForExchange,
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
      clearGoogleOauthCookies()
      res.redirect(buildAppRedirect({ status: 'error', message, baseUrl: redirectBase }))
      return
    }

    if (isSupabaseConfigured) {
      if (typeof idToken !== 'string' || !idToken) {
        clearSupabaseSessionCookies(res)
        clearGoogleOauthCookies()
        res.redirect(
          buildAppRedirect({
            status: 'error',
            message: 'Google did not return an ID token for Supabase sign-in.',
            baseUrl: redirectBase,
          }),
        )
        return
      }

      const supabaseExchange = await exchangeGoogleIdTokenForSupabaseSession({
        idToken,
        accessToken: typeof accessToken === 'string' ? accessToken : '',
      })
      const supabaseSession = supabaseExchange.ok ? supabaseExchange.session : null
      if (!supabaseSession?.access_token) {
        clearSupabaseSessionCookies(res)
        clearGoogleOauthCookies()
        res.redirect(
          buildAppRedirect({
            status: 'error',
            message: buildSupabaseGoogleProviderErrorMessage(supabaseExchange.error),
            baseUrl: redirectBase,
          }),
        )
        return
      }

      const ensuredRow = await ensureSupabaseUserRow(supabaseSession)
      if (!ensuredRow.ok) {
        clearSupabaseSessionCookies(res)
        clearGoogleOauthCookies()
        res.redirect(
          buildAppRedirect({
            status: 'error',
            message: `Unable to initialize your account (${ensuredRow.reason}). Please try again.`,
            baseUrl: redirectBase,
          }),
        )
        return
      }

      if (!setSupabaseSessionCookies(res, supabaseSession)) {
        clearSupabaseSessionCookies(res)
        clearGoogleOauthCookies()
        res.redirect(
          buildAppRedirect({
            status: 'error',
            message: 'Unable to persist Supabase session cookies.',
            baseUrl: redirectBase,
          }),
        )
        return
      }
    } else {
      clearSupabaseSessionCookies(res)
    }
    clearGoogleOauthCookies()
    res.redirect(buildAppRedirect({ status: 'success', baseUrl: redirectBase }))
  } catch (_err) {
    clearGoogleOauthCookies()
    res.redirect(buildAppRedirect({
      status: 'error',
      message: 'Google login failed.',
      baseUrl: redirectBase,
    }))
  }
})

const buildInstagramAppSecretProof = (accessToken) => {
  const normalizedAccessToken = normalizeTextInput(accessToken, { maxLength: 2000, trim: true })
  if (!normalizedAccessToken || !instagramAppSecret) return ''
  return crypto
    .createHmac('sha256', instagramAppSecret)
    .update(normalizedAccessToken)
    .digest('hex')
}

const readInstagramGraphErrorMessage = (payload, fallback) => {
  const errorMessage = normalizeTextInput(payload?.error?.message, { maxLength: 240 })
  if (errorMessage) return errorMessage
  return normalizeTextInput(payload?.message, { maxLength: 240 }) || fallback
}

const requestInstagramGraph = async ({
  base = 'facebook',
  path = '/',
  query = {},
  accessToken = instagramAccessToken,
  timeoutMs = 15_000,
} = {}) => {
  const normalizedAccessToken = normalizeTextInput(accessToken, { maxLength: 4000 })
  if (!normalizedAccessToken) {
    return {
      ok: false,
      status: 500,
      error: 'missing_instagram_access_token',
      message: 'INSTAGRAM_ACCESS_TOKEN is not configured.',
      payload: null,
    }
  }

  const normalizedVersion = normalizeTextInput(instagramGraphApiVersion, { maxLength: 24 }).toLowerCase()
  const parsedVersion = normalizedVersion.replace(/^v/, '')
  const safeVersion = /^\d+(?:\.\d+)?$/.test(parsedVersion) ? `v${parsedVersion}` : 'v22.0'
  const normalizedPath = normalizeTextInput(path, { maxLength: 240 }) || '/'
  const pathWithSlash = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
  const baseUrl = base === 'instagram'
    ? 'https://graph.instagram.com'
    : `https://graph.facebook.com/${safeVersion}`

  const abortController = new AbortController()
  const safeTimeoutMs = Math.max(3000, Math.min(60_000, toNumber(timeoutMs) || 15_000))
  const timeoutId = setTimeout(() => abortController.abort(), safeTimeoutMs)
  const performRequest = async ({ includeAppSecretProof = true } = {}) => {
    const params = new URLSearchParams()
    Object.entries(query).forEach(([key, value]) => {
      const normalizedKey = normalizeTextInput(key, { maxLength: 120 })
      if (!normalizedKey) return
      const normalizedValue = normalizeTextInput(String(value ?? ''), { maxLength: 4000 })
      if (!normalizedValue) return
      params.set(normalizedKey, normalizedValue)
    })
    params.set('access_token', normalizedAccessToken)
    if (base === 'facebook') {
      if (includeAppSecretProof) {
        const appsecretProof = buildInstagramAppSecretProof(normalizedAccessToken)
        if (appsecretProof) {
          params.set('appsecret_proof', appsecretProof)
        }
      }
      if (instagramClientToken) {
        params.set('client_token', instagramClientToken)
      }
    }
    const response = await fetch(`${baseUrl}${pathWithSlash}?${params.toString()}`, {
      signal: abortController.signal,
    })
    const payload = await response.json().catch(() => null)
    return { response, payload }
  }
  try {
    let { response, payload } = await performRequest({ includeAppSecretProof: true })
    if (!response.ok && base === 'facebook') {
      const initialMessage = readInstagramGraphErrorMessage(payload, '').toLowerCase()
      const shouldRetryWithoutProof =
        initialMessage.includes('appsecret_proof')
        || initialMessage.includes('invalid appsecret')
      if (shouldRetryWithoutProof) {
        ;({ response, payload } = await performRequest({ includeAppSecretProof: false }))
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: 'instagram_graph_request_failed',
        message: readInstagramGraphErrorMessage(payload, 'Instagram Graph request failed.'),
        payload,
      }
    }
    return {
      ok: true,
      status: response.status,
      payload,
    }
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError'
    return {
      ok: false,
      status: 502,
      error: isAbort ? 'instagram_graph_timeout' : 'instagram_graph_request_failed',
      message: isAbort ? 'Instagram Graph request timed out.' : 'Unable to reach Instagram Graph.',
      payload: null,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

const normalizeInstagramGraphConnectionCandidate = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const graphUserId = normalizeTextInput(value.graphUserId || value.id, { maxLength: 120 })
  const username = normalizeInstagramHandle(value.username)
  const fallbackId = graphUserId ? graphUserId.toLowerCase() : ''
  const accountId = username || fallbackId
  if (!accountId) return null
  const accountName =
    normalizeTextInput(value.accountName || value.name, { maxLength: 180 })
    || username
    || accountId
  return {
    accountId,
    accountName,
    graphUserId,
    username,
    followers: Math.max(0, toNumber(value.followers)),
    postsCount: Math.max(0, toNumber(value.postsCount)),
    source: normalizeTextInput(value.source, { maxLength: 40 }) || 'graph',
  }
}

const listInstagramGraphConnectionCandidates = async (options = {}) => {
  const forceRefresh = options.force === true
  const enableBasicDisplayProbe = options.enableBasicDisplayProbe !== false
  const requestedPageId = normalizeTextInput(options.pageId, { maxLength: 120 }) || instagramFacebookPageId
  const requestedToken = normalizeTextInput(options.accessToken, { maxLength: 4000 }) || instagramAccessToken
  if (!requestedToken) {
    return {
      ok: false,
      status: 500,
      error: 'missing_instagram_access_token',
      message: 'INSTAGRAM_ACCESS_TOKEN is not configured.',
      candidates: [],
    }
  }
  const nowMs = Date.now()
  const normalizedToken = requestedToken
  if (
    !forceRefresh
    && instagramGraphConnectionCandidateCache.token === normalizedToken
    && instagramGraphConnectionCandidateCache.expiresAtMs > nowMs
    && Array.isArray(instagramGraphConnectionCandidateCache.candidates)
    && instagramGraphConnectionCandidateCache.candidates.length
  ) {
    return {
      ok: true,
      status: 200,
      candidates: instagramGraphConnectionCandidateCache.candidates,
    }
  }

  const candidatesById = new Map()
  let lastErrorMessage = ''
  const addCandidatesFromPage = (page, source = 'facebook_pages') => {
    if (!page || typeof page !== 'object') return
    const pageInstagramAccounts = [
      page?.instagram_business_account,
      page?.connected_instagram_account,
    ]
    pageInstagramAccounts.forEach((igAccount) => {
      if (!igAccount || typeof igAccount !== 'object') return
      const candidate = normalizeInstagramGraphConnectionCandidate({
        id: igAccount.id,
        graphUserId: igAccount.id,
        username: igAccount.username,
        accountName: igAccount.name || igAccount.username || page?.name,
        followers: igAccount.followers_count,
        postsCount: igAccount.media_count,
        source,
      })
      if (!candidate) return
      candidatesById.set(candidate.accountId, candidate)
    })
  }

  if (requestedPageId) {
    const pageResult = await requestInstagramGraph({
      base: 'facebook',
      path: `/${encodeURIComponent(requestedPageId)}`,
      query: {
        fields: 'id,name,instagram_business_account{id,username,name,followers_count,media_count},connected_instagram_account{id,username,name,followers_count,media_count}',
      },
      accessToken: normalizedToken,
    })
    if (pageResult.ok) {
      addCandidatesFromPage(pageResult.payload, 'facebook_page_id')
    } else {
      lastErrorMessage = pageResult.message || lastErrorMessage
    }
  }

  const businessResult = await requestInstagramGraph({
    base: 'facebook',
    path: '/me/accounts',
    query: {
      fields: 'id,name,instagram_business_account{id,username,name,followers_count,media_count},connected_instagram_account{id,username,name,followers_count,media_count}',
      limit: '50',
    },
    accessToken: normalizedToken,
  })
  if (businessResult.ok) {
    const pages = Array.isArray(businessResult.payload?.data) ? businessResult.payload.data : []
    pages.forEach((page) => {
      addCandidatesFromPage(page, 'facebook_pages')
    })
  } else {
    lastErrorMessage = businessResult.message || lastErrorMessage
  }

  if (enableBasicDisplayProbe) {
    const basicProfileResult = await requestInstagramGraph({
      base: 'instagram',
      path: '/me',
      query: {
        fields: 'id,username,account_type,media_count',
      },
      accessToken: normalizedToken,
    })
    if (basicProfileResult.ok) {
      const candidate = normalizeInstagramGraphConnectionCandidate({
        id: basicProfileResult.payload?.id,
        graphUserId: basicProfileResult.payload?.id,
        username: basicProfileResult.payload?.username,
        accountName: basicProfileResult.payload?.username,
        postsCount: basicProfileResult.payload?.media_count,
        source: 'basic_display',
      })
      if (candidate) {
        candidatesById.set(candidate.accountId, candidate)
      }
    } else if (!lastErrorMessage) {
      const normalizedProbeError = normalizeTextInput(basicProfileResult.message, { maxLength: 240 }).toLowerCase()
      const isNonBlockingTokenError =
        normalizedProbeError.includes('invalid oauth access token')
        || normalizedProbeError.includes('cannot parse access token')
      if (!isNonBlockingTokenError) {
        lastErrorMessage = basicProfileResult.message || ''
      }
    }
  }

  const candidates = [...candidatesById.values()]
  if (!candidates.length) {
    const noAccountsMessage = enableBasicDisplayProbe
      ? 'Unable to find Instagram accounts for the configured token.'
      : 'No linked Instagram professional account was found. Link the Instagram account to a Facebook Page.'
    return {
      ok: false,
      status: 502,
      error: 'instagram_accounts_not_found',
      message: lastErrorMessage || noAccountsMessage,
      candidates: [],
    }
  }

  instagramGraphConnectionCandidateCache.token = normalizedToken
  instagramGraphConnectionCandidateCache.expiresAtMs = nowMs + 60_000
  instagramGraphConnectionCandidateCache.candidates = candidates

  return {
    ok: true,
    status: 200,
    candidates,
  }
}

const resolveInstagramGraphCandidateForConnection = (connection, candidates = []) => {
  const normalizedCandidates = Array.isArray(candidates) ? candidates : []
  if (!normalizedCandidates.length) return null
  const requestedAccountId = resolveInstagramAccountId(connection)
  const requestedAccountName = normalizeInstagramHandle(connection?.accountName)

  const byExactId = normalizedCandidates.find((candidate) => candidate.accountId === requestedAccountId)
  if (byExactId) return byExactId
  const byGraphId = normalizedCandidates.find((candidate) => {
    const graphUserId = normalizeTextInput(candidate.graphUserId, { maxLength: 120 }).toLowerCase()
    return graphUserId && graphUserId === requestedAccountId
  })
  if (byGraphId) return byGraphId
  const byName = normalizedCandidates.find((candidate) => candidate.username === requestedAccountName)
  if (byName) return byName
  return null
}

app.get('/oauth/instagram', async (req, res) => {
  const requestedOrigin =
    typeof req.query?.app_origin === 'string' ? req.query.app_origin : ''
  const requestedPath = normalizeTextInput(req.query?.path, { maxLength: 64 })
  const requestedOrganizationId = normalizeTextInput(req.query?.organization_id, { maxLength: 80 })
  const refererOrigin = typeof req.headers.referer === 'string' ? req.headers.referer : ''
  const requestedOriginBase = resolveOriginBase(requestedOrigin)
  const refererOriginBase = resolveOriginBase(refererOrigin)
  const appOriginCandidate = requestedOriginBase || refererOriginBase
  const appOrigin =
    appOriginCandidate && trustedRequestOrigins.has(appOriginCandidate)
      ? appOriginCandidate
      : ''
  if (appOrigin) {
    res.cookie(APP_REDIRECT_COOKIE, appOrigin, {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: cookieSecure,
      maxAge: 10 * 60 * 1000,
    })
  }
  const redirectBase = appOrigin || resolveAppRedirectBase(req)
  const redirectPath = requestedPath === '/organizations' ? '/organizations' : '/settings'
  const oauthRedirectUri = resolveInstagramOauthRedirectUri({
    requestOriginBase: requestedOriginBase,
    refererOriginBase,
  })

  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'instagram',
        message: 'You must be signed in to connect Instagram.',
        path: redirectPath,
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!requestedOrganizationId) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'instagram',
        message: 'Select an organization before connecting Instagram.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }
  if (!isUuid(requestedOrganizationId)) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'instagram',
        message: 'Organization id must be a valid UUID.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  const organizationResult = await fetchOrganizationRowById(requestedOrganizationId)
  if (!organizationResult.ok || !organizationResult.row) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'instagram',
        message: 'Unable to load organization for Instagram connection.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }
  if (!canUserSeeOrganization(organizationResult.row, viewer.userId, viewer.appRole)) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'instagram',
        message: 'You do not have access to this organization.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }
  if (!canUserManageOrganizationConnections(organizationResult.row, viewer.userId)) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'instagram',
        message: 'Brand viewers may view connected accounts but cannot edit them.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!instagramAppId || !instagramAppSecret || !oauthRedirectUri) {
    const missing = []
    if (!instagramAppId) missing.push('INSTAGRAM_APP_ID')
    if (!oauthRedirectUri) missing.push('INSTAGRAM_REDIRECT_URI')
    if (!instagramAppSecret) missing.push('INSTAGRAM_APP_SECRET')
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'instagram',
        message: `Instagram OAuth is not configured. Missing: ${missing.join(', ')}.`,
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  const state = buildInstagramOauthStateToken({
    userId: viewer.userId,
    organizationId: requestedOrganizationId,
    redirectUri: oauthRedirectUri,
  }) || crypto.randomBytes(16).toString('hex')
  res.cookie(INSTAGRAM_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSecure,
    maxAge: INSTAGRAM_OAUTH_STATE_TTL_MS,
  })
  res.cookie(INSTAGRAM_OAUTH_CONTEXT_COOKIE, JSON.stringify({
    organizationId: requestedOrganizationId,
    path: '/organizations',
    redirectUri: oauthRedirectUri,
  }), {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSecure,
    maxAge: INSTAGRAM_OAUTH_STATE_TTL_MS,
  })

  const params = new URLSearchParams({
    client_id: instagramAppId,
    redirect_uri: oauthRedirectUri,
    response_type: 'code',
    scope: instagramOauthScope,
    state,
  })
  void instagramOauthEnableFbLogin
  void instagramOauthForceAuthentication
  const authorizeUrl = resolveInstagramOauthAuthorizeUrl(instagramOauthAuthorizeUrl, instagramOauthScope)
  res.redirect(`${authorizeUrl}?${params.toString()}`)
})

app.get('/oauth/instagram/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query
  const receivedState = normalizeTextInput(state, { maxLength: 4000, trim: true })
  const expectedState = normalizeTextInput(req.cookies?.[INSTAGRAM_OAUTH_STATE_COOKIE], {
    maxLength: 4000,
    trim: true,
  })
  const redirectBase = resolveAppRedirectBase(req)
  const rawContext = req.cookies?.[INSTAGRAM_OAUTH_CONTEXT_COOKIE]
  let oauthContext = { organizationId: '', path: '/organizations', redirectUri: '' }
  if (typeof rawContext === 'string' && rawContext.trim()) {
    try {
      const parsed = JSON.parse(rawContext)
      if (parsed && typeof parsed === 'object') {
        const parsedOrganizationId = normalizeTextInput(parsed.organizationId, { maxLength: 80 })
        const parsedRedirectUri = normalizeTextInput(parsed.redirectUri, { maxLength: 500 })
        oauthContext = {
          organizationId: isUuid(parsedOrganizationId) ? parsedOrganizationId : '',
          path: '/organizations',
          redirectUri: parsedRedirectUri,
        }
      }
    } catch {
      oauthContext = { organizationId: '', path: '/organizations', redirectUri: '' }
    }
  }
  const oauthRedirectUri = resolveInstagramOauthRedirectUri({
    requestOriginBase: redirectBase,
  })
  const stateTokenVerification = verifyInstagramOauthStateToken(receivedState)
  const stateTokenPayload = stateTokenVerification.ok ? stateTokenVerification.payload : null
  if (!oauthContext.organizationId && stateTokenPayload?.organizationId) {
    oauthContext.organizationId = stateTokenPayload.organizationId
  }
  if (!oauthContext.redirectUri && stateTokenPayload?.redirectUri) {
    oauthContext.redirectUri = stateTokenPayload.redirectUri
  }
  const redirectUriForExchange = normalizeTextInput(oauthContext.redirectUri, { maxLength: 500 }) || oauthRedirectUri

  const clearInstagramOauthCookies = () => {
    res.clearCookie(INSTAGRAM_OAUTH_STATE_COOKIE)
    res.clearCookie(INSTAGRAM_OAUTH_CONTEXT_COOKIE)
    res.clearCookie(APP_REDIRECT_COOKIE)
  }

  if (error) {
    clearInstagramOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'instagram',
        message: normalizeTextInput(errorDescription, { maxLength: 240 }) || 'Instagram authorization failed.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  const stateMatchesCookie = Boolean(
    receivedState
    && expectedState
    && safeTimingEqual(receivedState, expectedState),
  )
  if (!stateMatchesCookie && !stateTokenVerification.ok) {
    clearInstagramOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'instagram',
        message: 'Instagram connection state mismatch.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  const normalizedCodeRaw = normalizeTextInput(code, { maxLength: 2000, trim: true })
  const normalizedCode = normalizedCodeRaw.replace(/#_$/, '')
  if (!normalizedCode) {
    clearInstagramOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'instagram',
        message: 'Missing authorization code.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!oauthContext.organizationId) {
    clearInstagramOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'instagram',
        message: 'Missing organization context for Instagram connection.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  try {
    const viewer = await resolveAuthedUserContext(req, res)
    if (!viewer.ok) {
      throw new Error('You must be signed in before connecting Instagram.')
    }
    if (stateTokenPayload?.userId && stateTokenPayload.userId !== viewer.userId) {
      throw new Error('Instagram OAuth state does not match the signed-in user.')
    }

    const organizationResult = await fetchOrganizationRowById(oauthContext.organizationId)
    if (!organizationResult.ok || !organizationResult.row) {
      throw new Error('Unable to load organization for Instagram connection.')
    }
    if (!canUserSeeOrganization(organizationResult.row, viewer.userId, viewer.appRole)) {
      throw new Error('You do not have access to this organization.')
    }
    if (!canUserManageOrganizationConnections(organizationResult.row, viewer.userId)) {
      throw new Error('Brand viewers may view connected accounts but cannot edit them.')
    }
    if (!instagramAppId || !redirectUriForExchange || !instagramAppSecret) {
      const missing = []
      if (!instagramAppId) missing.push('INSTAGRAM_APP_ID')
      if (!redirectUriForExchange) missing.push('INSTAGRAM_REDIRECT_URI')
      if (!instagramAppSecret) missing.push('INSTAGRAM_APP_SECRET')
      throw new Error(`Instagram OAuth is not configured on the server. Missing: ${missing.join(', ')}`)
    }

    const tokenParams = new URLSearchParams({
      client_id: instagramAppId,
      client_secret: instagramAppSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUriForExchange,
      code: normalizedCode,
    })
    const tokenResponse = await fetch(resolveFacebookGraphOauthTokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    })
    const tokenPayload = await tokenResponse.json().catch(() => ({}))
    const shortLivedAccessToken = normalizeTextInput(tokenPayload?.access_token, { maxLength: 4000 })
    if (!tokenResponse.ok || !shortLivedAccessToken) {
      const tokenErrorMessage =
        normalizeTextInput(tokenPayload?.error_message, { maxLength: 240 })
        || normalizeTextInput(tokenPayload?.error?.message, { maxLength: 240 })
        || normalizeTextInput(tokenPayload?.error_description, { maxLength: 240 })
        || 'Instagram token exchange failed.'
      if (tokenErrorMessage.toLowerCase().includes('error validating client secret')) {
        throw new Error(
          'Error validating client secret. This server uses INSTAGRAM_APP_SECRET for OAuth. Verify INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET belong to the same Meta app and restart the server.',
        )
      }
      throw new Error(tokenErrorMessage)
    }

    const candidatesResult = await listInstagramGraphConnectionCandidates({
      accessToken: shortLivedAccessToken,
      force: true,
      enableBasicDisplayProbe: instagramOauthEnableBasicDisplayProbe,
    })
    if (!candidatesResult.ok || !Array.isArray(candidatesResult.candidates) || !candidatesResult.candidates.length) {
      throw new Error(candidatesResult.message || 'Unable to find a linked Instagram business account.')
    }
    const selectedCandidate = selectPreferredInstagramConnectionCandidate(candidatesResult.candidates)
      || candidatesResult.candidates[0]
    const accountId = normalizeInstagramHandle(selectedCandidate?.accountId)
      || normalizeTextInput(selectedCandidate?.graphUserId, { maxLength: 120 }).toLowerCase()
    if (!accountId) {
      throw new Error('Instagram account resolution did not return a valid account id.')
    }
    const accountName =
      normalizeTextInput(selectedCandidate?.accountName, { maxLength: 180 })
      || normalizeTextInput(selectedCandidate?.username, { maxLength: 180 })
      || accountId

    const currentAccounts = normalizeOrganizationConnectedAccounts(organizationResult.row.connected_accounts)
    const connectedAt = new Date().toISOString()
    const nextAccount = {
      id: `instagram:${accountId}`,
      platform: ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM,
      accountName,
      channelId: accountId,
      ownerUserId: viewer.userId,
      connectedAt,
    }
    const existing = currentAccounts.find((account) =>
      normalizeOrganizationConnectionPlatform(account.platform) === ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM
      && (
        account.id === nextAccount.id
        || resolveInstagramAccountId(account) === accountId
      ))
    const nextAccounts = existing
      ? currentAccounts.map((account) => (account.id === existing.id ? {
        ...(account.instagramOps ? { instagramOps: account.instagramOps } : {}),
        ...nextAccount,
      } : account))
      : [...currentAccounts, nextAccount]

    const updateResult = await updateOrganizationConnectedAccounts(oauthContext.organizationId, nextAccounts)
    if (!updateResult.ok) {
      throw new Error('Unable to save organization connected accounts.')
    }

    const connectionKey = buildInstagramVaultKey({
      ownerUserId: viewer.userId,
      accountId,
    })
    if (connectionKey && shortLivedAccessToken) {
      instagramGraphAccessTokenByConnectionKey.set(connectionKey, {
        accessToken: shortLivedAccessToken,
        updatedAt: Date.now(),
      })
    }

    await deleteCachedInstagramSummaryByUserId(viewer.userId)
    if (instagramCollectionEnabled) {
      await createAndStartInstagramRefreshJob(viewer.userId, {
        trigger: 'oauth_connect',
        reuseRunning: true,
        minIntervalMs: 0,
      })
    }

    clearInstagramOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'success',
        provider: 'instagram',
        path: '/organizations',
        baseUrl: redirectBase,
        extraParams: {
          organizationId: oauthContext.organizationId,
          instagram_account_name: accountName,
        },
      }),
    )
  } catch (err) {
    clearInstagramOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'instagram',
        message: err instanceof Error && err.message ? err.message : 'Instagram connection failed.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
  }
})

app.get('/oauth/x', async (req, res) => {
  const requestedOrigin =
    typeof req.query?.app_origin === 'string' ? req.query.app_origin : ''
  const requestedOrganizationId = normalizeTextInput(req.query?.organization_id, { maxLength: 80 })
  const refererOrigin = typeof req.headers.referer === 'string' ? req.headers.referer : ''
  const requestedOriginBase = resolveOriginBase(requestedOrigin)
  const refererOriginBase = resolveOriginBase(refererOrigin)
  const appOriginCandidate = requestedOriginBase || refererOriginBase
  const appOrigin =
    appOriginCandidate && trustedRequestOrigins.has(appOriginCandidate)
      ? appOriginCandidate
      : ''
  if (appOrigin) {
    res.cookie(APP_REDIRECT_COOKIE, appOrigin, {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: cookieSecure,
      maxAge: 10 * 60 * 1000,
    })
  }
  const redirectBase = appOrigin || resolveAppRedirectBase(req)
  const oauthRedirectUri = resolveXOauthRedirectUri({
    requestOriginBase: requestedOriginBase,
    refererOriginBase,
  })
  const authorizeUrl = resolveXOauthAuthorizeUrl(xOauthAuthorizeUrl)

  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: 'You must be signed in to connect X.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!requestedOrganizationId) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: 'Select an organization before connecting X.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }
  if (!isUuid(requestedOrganizationId)) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: 'Organization id must be a valid UUID.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  const organizationResult = await fetchOrganizationRowById(requestedOrganizationId)
  if (!organizationResult.ok || !organizationResult.row) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: 'Unable to load organization for X connection.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }
  if (!canUserSeeOrganization(organizationResult.row, viewer.userId, viewer.appRole)) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: 'You do not have access to this organization.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }
  if (!canUserManageOrganizationConnections(organizationResult.row, viewer.userId)) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: 'Brand viewers may view connected accounts but cannot edit them.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!xOauthClientId || !oauthRedirectUri) {
    const missing = []
    if (!xOauthClientId) missing.push('X_CLIENT_ID')
    if (!oauthRedirectUri) missing.push('X_REDIRECT_URI')
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: `X OAuth is not configured. Missing: ${missing.join(', ')}.`,
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  const state = crypto.randomBytes(16).toString('hex')
  const codeVerifier = buildPkceCodeVerifier()
  const codeChallenge = buildPkceCodeChallenge(codeVerifier)
  if (!isValidPkceCodeVerifier(codeVerifier) || !codeChallenge) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: 'Unable to initialize X OAuth security state.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }
  res.cookie(X_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSecure,
    maxAge: X_OAUTH_STATE_TTL_MS,
  })
  res.cookie(X_OAUTH_CONTEXT_COOKIE, JSON.stringify({
    organizationId: requestedOrganizationId,
    path: '/organizations',
    redirectUri: oauthRedirectUri,
    codeVerifier,
  }), {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSecure,
    maxAge: X_OAUTH_STATE_TTL_MS,
  })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: xOauthClientId,
    redirect_uri: oauthRedirectUri,
    scope: xOauthScope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  res.redirect(`${authorizeUrl}?${params.toString()}`)
})

app.get('/oauth/x/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query
  const expectedState = normalizeTextInput(req.cookies?.[X_OAUTH_STATE_COOKIE], { maxLength: 4000, trim: true })
  const receivedState = normalizeTextInput(state, { maxLength: 4000, trim: true })
  const redirectBase = resolveAppRedirectBase(req)
  const rawContext = req.cookies?.[X_OAUTH_CONTEXT_COOKIE]
  let oauthContext = { organizationId: '', path: '/organizations', redirectUri: '', codeVerifier: '' }
  if (typeof rawContext === 'string' && rawContext.trim()) {
    try {
      const parsed = JSON.parse(rawContext)
      if (parsed && typeof parsed === 'object') {
        const parsedOrganizationId = normalizeTextInput(parsed.organizationId, { maxLength: 80 })
        const parsedRedirectUri = normalizeTextInput(parsed.redirectUri, { maxLength: 500 })
        const parsedCodeVerifier = normalizeTextInput(parsed.codeVerifier, { maxLength: 200, trim: true })
        oauthContext = {
          organizationId: isUuid(parsedOrganizationId) ? parsedOrganizationId : '',
          path: '/organizations',
          redirectUri: parsedRedirectUri,
          codeVerifier: isValidPkceCodeVerifier(parsedCodeVerifier) ? parsedCodeVerifier : '',
        }
      }
    } catch {
      oauthContext = { organizationId: '', path: '/organizations', redirectUri: '', codeVerifier: '' }
    }
  }
  const oauthRedirectUri = resolveXOauthRedirectUri({
    requestOriginBase: redirectBase,
  })
  const redirectUriForExchange = normalizeTextInput(oauthContext.redirectUri, { maxLength: 500 }) || oauthRedirectUri

  const clearXOauthCookies = () => {
    res.clearCookie(X_OAUTH_STATE_COOKIE)
    res.clearCookie(X_OAUTH_CONTEXT_COOKIE)
    res.clearCookie(APP_REDIRECT_COOKIE)
  }

  if (error) {
    clearXOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: normalizeTextInput(errorDescription, { maxLength: 240 }) || 'X authorization failed.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!receivedState || !expectedState || !safeTimingEqual(receivedState, expectedState)) {
    clearXOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: 'X connection state mismatch.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  const normalizedCode = normalizeTextInput(code, { maxLength: 2000, trim: true }).replace(/#_$/, '')
  if (!normalizedCode) {
    clearXOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: 'Missing authorization code.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!oauthContext.organizationId) {
    clearXOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: 'Missing organization context for X connection.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!oauthContext.codeVerifier || !isValidPkceCodeVerifier(oauthContext.codeVerifier)) {
    clearXOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: 'Missing OAuth PKCE verifier for X connection.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
    return
  }

  try {
    const viewer = await resolveAuthedUserContext(req, res)
    if (!viewer.ok) {
      throw new Error('You must be signed in before connecting X.')
    }

    const organizationResult = await fetchOrganizationRowById(oauthContext.organizationId)
    if (!organizationResult.ok || !organizationResult.row) {
      throw new Error('Unable to load organization for X connection.')
    }
    if (!canUserSeeOrganization(organizationResult.row, viewer.userId, viewer.appRole)) {
      throw new Error('You do not have access to this organization.')
    }
    if (!canUserManageOrganizationConnections(organizationResult.row, viewer.userId)) {
      throw new Error('Brand viewers may view connected accounts but cannot edit them.')
    }
    if (!xOauthClientId || !redirectUriForExchange) {
      const missing = []
      if (!xOauthClientId) missing.push('X_CLIENT_ID')
      if (!redirectUriForExchange) missing.push('X_REDIRECT_URI')
      throw new Error(`X OAuth is not configured on the server. Missing: ${missing.join(', ')}`)
    }

    const tokenRequestUrls = resolveXOauthTokenUrls()
    if (!tokenRequestUrls.length) {
      throw new Error('X OAuth token endpoint is not configured correctly.')
    }

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: normalizedCode,
      redirect_uri: redirectUriForExchange,
      code_verifier: oauthContext.codeVerifier,
      client_id: xOauthClientId,
    })
    const tokenHeaders = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    if (xOauthClientSecret) {
      tokenHeaders.Authorization = `Basic ${Buffer.from(`${xOauthClientId}:${xOauthClientSecret}`).toString('base64')}`
    }
    let accessToken = ''
    let refreshToken = ''
    let tokenExpiresAt = 0
    let tokenScope = ''
    let tokenType = ''
    let tokenErrorMessage = ''
    for (const tokenUrl of tokenRequestUrls) {
      try {
        const tokenResponse = await fetch(tokenUrl, {
          method: 'POST',
          headers: tokenHeaders,
          body: tokenParams.toString(),
        })
        const tokenPayload = await tokenResponse.json().catch(() => ({}))
        const candidateAccessToken = normalizeTextInput(tokenPayload?.access_token, { maxLength: 6000, trim: false })
        if (tokenResponse.ok && candidateAccessToken) {
          accessToken = candidateAccessToken
          refreshToken = normalizeTextInput(tokenPayload?.refresh_token, { maxLength: 6000, trim: false })
          const expiresInSeconds = Math.max(0, toNumber(tokenPayload?.expires_in))
          tokenExpiresAt = expiresInSeconds > 0 ? Date.now() + expiresInSeconds * 1000 : 0
          tokenScope = normalizeTextInput(tokenPayload?.scope, { maxLength: 500 })
          tokenType = normalizeTextInput(tokenPayload?.token_type, { maxLength: 120 }).toLowerCase()
          break
        }
        const candidateError =
          normalizeTextInput(tokenPayload?.error_description, { maxLength: 240 })
          || normalizeTextInput(tokenPayload?.error, { maxLength: 240 })
          || normalizeTextInput(tokenPayload?.detail, { maxLength: 240 })
        if (candidateError) tokenErrorMessage = candidateError
      } catch (tokenRequestError) {
        const normalizedErrorMessage = tokenRequestError instanceof Error
          ? normalizeTextInput(tokenRequestError.message, { maxLength: 240 })
          : ''
        if (normalizedErrorMessage) {
          tokenErrorMessage = normalizedErrorMessage
        }
      }
    }
    if (!accessToken) {
      throw new Error(tokenErrorMessage || 'X token exchange failed.')
    }
    if (tokenScope && !hasRequiredXOauthScopes(tokenScope, ['users.read', 'tweet.read'])) {
      throw new Error('X OAuth token is missing required scopes (users.read and tweet.read). Reconnect and grant access.')
    }

    const xProfileResult = await fetchXAuthenticatedUser(accessToken)
    if (!xProfileResult.ok || !xProfileResult.user) {
      throw new Error('Unable to load profile details for the connected X account.')
    }
    const resolvedXUserId = xProfileResult.user.userId
    const resolvedXUsername = xProfileResult.user.username
    const resolvedAccountName = formatXAccountName(resolvedXUsername) || `X Account ${resolvedXUserId}`
    const connectedAt = new Date().toISOString()

    const xOauthUpsertResult = await upsertXOauthTokenVaultEntry({
      ownerUserId: viewer.userId,
      userId: resolvedXUserId,
      username: resolvedXUsername,
      accessToken,
      refreshToken,
      expiresAt: tokenExpiresAt,
      scope: tokenScope || xOauthScope,
      tokenType: tokenType || 'bearer',
      connectedAt,
      followerCount: xProfileResult.user.followerCount,
    })
    if (!xOauthUpsertResult.ok) {
      throw new Error('Unable to securely store X OAuth token for this connected account.')
    }

    const currentAccounts = normalizeOrganizationConnectedAccounts(organizationResult.row.connected_accounts)
    const existing = currentAccounts.find((account) => {
      if (normalizeOrganizationConnectionPlatform(account.platform) !== ORGANIZATION_CONNECTION_PLATFORM_X) {
        return false
      }
      const existingXUserId = resolveXUserIdFromConnection(account)
      if (existingXUserId && resolvedXUserId) {
        return existingXUserId === resolvedXUserId
      }
      return normalizeXUsername(account.accountName) === resolvedXUsername
    })
    const nextConnection = existing
      ? {
          ...existing,
          accountName: resolvedAccountName,
          channelId: resolvedXUserId,
          ownerUserId: viewer.userId,
          connectedAt,
        }
      : {
          id: buildOrganizationConnectionId(ORGANIZATION_CONNECTION_PLATFORM_X),
          platform: ORGANIZATION_CONNECTION_PLATFORM_X,
          accountName: resolvedAccountName,
          channelId: resolvedXUserId,
          ownerUserId: viewer.userId,
          connectedAt,
        }
    const nextAccounts = existing
      ? currentAccounts.map((account) => (account.id === existing.id ? nextConnection : account))
      : [...currentAccounts, nextConnection]

    const updateResult = await updateOrganizationConnectedAccounts(oauthContext.organizationId, nextAccounts)
    if (!updateResult.ok) {
      throw new Error('Unable to save organization connected accounts.')
    }

    let successMessage = ''
    if (xCollectionEnabled) {
      const syncResult = await refreshAndPersistXAccount({
        userId: resolvedXUserId,
        username: resolvedXUsername,
        fallbackFollowerCount: xProfileResult.user.followerCount,
        ownerUserId: viewer.userId,
        accessToken,
      })
      if (!syncResult.ok) {
        successMessage = normalizeTextInput(syncResult.message, { maxLength: 240 })
          || 'Connected account. Initial post sync failed; run Refresh to pull X posts and metrics.'
      }
    }

    clearXOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'success',
        provider: 'x',
        message: successMessage,
        path: '/organizations',
        baseUrl: redirectBase,
        extraParams: {
          organizationId: oauthContext.organizationId,
          x_account_name: resolvedAccountName,
        },
      }),
    )
  } catch (err) {
    clearXOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'x',
        message: err instanceof Error && err.message ? err.message : 'X connection failed.',
        path: '/organizations',
        baseUrl: redirectBase,
      }),
    )
  }
})

app.get('/oauth/youtube', async (req, res) => {
  const requestedOrigin =
    typeof req.query?.app_origin === 'string' ? req.query.app_origin : ''
  const requestedPath = normalizeTextInput(req.query?.path, { maxLength: 64 })
  const requestedOrganizationId = normalizeTextInput(req.query?.organization_id, { maxLength: 80 })
  const refererOrigin = typeof req.headers.referer === 'string' ? req.headers.referer : ''
  const requestedOriginBase = resolveOriginBase(requestedOrigin)
  const refererOriginBase = resolveOriginBase(refererOrigin)
  const appOriginCandidate = requestedOriginBase || refererOriginBase
  const appOrigin =
    appOriginCandidate && trustedRequestOrigins.has(appOriginCandidate)
      ? appOriginCandidate
      : ''
  if (appOrigin) {
    res.cookie(APP_REDIRECT_COOKIE, appOrigin, {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: cookieSecure,
      maxAge: 10 * 60 * 1000,
    })
  }
  const redirectBase = appOrigin || resolveAppRedirectBase(req)
  const redirectPath = requestedPath === '/organizations' ? '/organizations' : '/settings'

  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: 'You must be signed in to connect YouTube.',
        path: redirectPath,
        baseUrl: redirectBase,
      }),
    )
    return
  }

  const oauthContext = {
    path: redirectPath,
    organizationId: '',
  }

  if (requestedOrganizationId) {
    if (!isUuid(requestedOrganizationId)) {
      res.redirect(
        buildAppRedirect({
          status: 'error',
          provider: 'youtube',
          message: 'Organization id must be a valid UUID.',
          path: '/organizations',
          baseUrl: redirectBase,
        }),
      )
      return
    }
    const organizationResult = await fetchOrganizationRowById(requestedOrganizationId)
    if (!organizationResult.ok || !organizationResult.row) {
      res.redirect(
        buildAppRedirect({
          status: 'error',
          provider: 'youtube',
          message: 'Unable to load organization for connection.',
          path: '/organizations',
          baseUrl: redirectBase,
        }),
      )
      return
    }
    if (!canUserSeeOrganization(organizationResult.row, viewer.userId, viewer.appRole)) {
      res.redirect(
        buildAppRedirect({
          status: 'error',
          provider: 'youtube',
          message: 'You do not have access to this organization.',
          path: '/organizations',
          baseUrl: redirectBase,
        }),
      )
      return
    }
    if (!canUserManageOrganizationConnections(organizationResult.row, viewer.userId)) {
      res.redirect(
        buildAppRedirect({
          status: 'error',
          provider: 'youtube',
          message: 'Brand viewers may view connected accounts but cannot edit them.',
          path: '/organizations',
          baseUrl: redirectBase,
        }),
      )
      return
    }
    oauthContext.organizationId = requestedOrganizationId
    oauthContext.path = '/organizations'
  } else if (!canRoleConnectAccounts(viewer.appRole)) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: 'Only admins can connect YouTube accounts.',
        path: redirectPath,
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!youtubeClientId || !youtubeClientSecret || !youtubeRedirectUri) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: 'YouTube OAuth not configured.',
        path: oauthContext.path,
        baseUrl: redirectBase,
      }),
    )
    return
  }

  const state = crypto.randomBytes(16).toString('hex')
  res.cookie('youtube_oauth_state', state, {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSecure,
    maxAge: 10 * 60 * 1000,
  })
  res.cookie(YOUTUBE_OAUTH_CONTEXT_COOKIE, JSON.stringify(oauthContext), {
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
  const rawOAuthContext = req.cookies?.[YOUTUBE_OAUTH_CONTEXT_COOKIE]
  let oauthContext = { path: '/settings', organizationId: '' }
  if (typeof rawOAuthContext === 'string' && rawOAuthContext.trim()) {
    try {
      const parsed = JSON.parse(rawOAuthContext)
      if (parsed && typeof parsed === 'object') {
        const parsedPath = normalizeTextInput(parsed.path, { maxLength: 64 })
        const parsedOrganizationId = normalizeTextInput(parsed.organizationId, { maxLength: 80 })
        oauthContext = {
          path: parsedPath === '/organizations' ? '/organizations' : '/settings',
          organizationId: isUuid(parsedOrganizationId) ? parsedOrganizationId : '',
        }
      }
    } catch {
      oauthContext = { path: '/settings', organizationId: '' }
    }
  }
  const redirectPath = oauthContext.path

  const clearYouTubeOauthCookies = () => {
    res.clearCookie('youtube_oauth_state')
    res.clearCookie(APP_REDIRECT_COOKIE)
    res.clearCookie(YOUTUBE_OAUTH_CONTEXT_COOKIE)
  }

  if (error) {
    clearYouTubeOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: typeof errorDescription === 'string' ? errorDescription : 'YouTube connection failed.',
        path: redirectPath,
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!state || !expectedState || state !== expectedState) {
    clearYouTubeOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: 'YouTube connection state mismatch.',
        path: redirectPath,
        baseUrl: redirectBase,
      }),
    )
    return
  }

  if (!code || typeof code !== 'string') {
    clearYouTubeOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: 'Missing authorization code.',
        path: redirectPath,
        baseUrl: redirectBase,
      }),
    )
    return
  }

  try {
    const viewer = await resolveAuthedUserContext(req, res)
    if (!viewer.ok) {
      throw new Error('You must be signed in before connecting YouTube.')
    }
    const connectionOwnerUserId = viewer.userId
    let connectedOrganizationId = ''
    let connectedOrganizationRow = null

    if (oauthContext.organizationId) {
      const organizationResult = await fetchOrganizationRowById(oauthContext.organizationId)
      if (!organizationResult.ok || !organizationResult.row) {
        throw new Error('Unable to load organization for YouTube connection.')
      }
      if (!canUserSeeOrganization(organizationResult.row, viewer.userId, viewer.appRole)) {
        throw new Error('You do not have access to this organization.')
      }
      if (!canUserManageOrganizationConnections(organizationResult.row, viewer.userId)) {
        throw new Error('Brand viewers may view connected accounts but cannot edit them.')
      }
      connectedOrganizationId = oauthContext.organizationId
      connectedOrganizationRow = organizationResult.row
    } else if (!canRoleConnectAccounts(viewer.appRole)) {
      throw new Error('Only admins can connect YouTube accounts.')
    }

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
      clearYouTubeOauthCookies()
      res.redirect(
        buildAppRedirect({
          status: 'error',
          provider: 'youtube',
          message,
          path: redirectPath,
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
      clearYouTubeOauthCookies()
      res.redirect(
        buildAppRedirect({
          status: 'error',
          provider: 'youtube',
          message: channelErrorMessage,
          path: redirectPath,
          baseUrl: redirectBase,
        }),
      )
      return
    }

    const existingConnectionsResult = await listYouTubeConnectionRowsByUserId(connectionOwnerUserId)
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
      user_id: connectionOwnerUserId,
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

    if (connectedOrganizationId && connectedOrganizationRow) {
      const currentAccounts = normalizeOrganizationConnectedAccounts(connectedOrganizationRow.connected_accounts)
      const connectedAt = nextConnection.connectedAt || new Date().toISOString()
      const nextAccount = {
        id: `youtube:${nextConnection.channelId}`,
        platform: ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE,
        accountName: nextConnection.channelName,
        channelId: nextConnection.channelId,
        ownerUserId: connectionOwnerUserId,
        connectedAt,
      }
      const existingByIdOrChannel = currentAccounts.find(
        (account) =>
          account.id === nextAccount.id
          || (
            normalizeOrganizationConnectionPlatform(account.platform) === ORGANIZATION_CONNECTION_PLATFORM_YOUTUBE
            && normalizeTextInput(account.channelId, { maxLength: 300 }) === nextConnection.channelId
          ),
      )
      const nextAccounts = existingByIdOrChannel
        ? currentAccounts.map((account) =>
            account.id === existingByIdOrChannel.id ? nextAccount : account)
        : [...currentAccounts, nextAccount]
      const updateOrganizationResult = await updateOrganizationConnectedAccounts(
        connectedOrganizationId,
        nextAccounts,
      )
      if (!updateOrganizationResult.ok) {
        throw new Error('Unable to save organization connected accounts.')
      }
    }

    const cachedConnectionsResult = await listYouTubeConnectionRowsByUserId(connectionOwnerUserId)
    const cachedConnections = cachedConnectionsResult.ok
      ? cachedConnectionsResult.rows.map(mapYouTubeConnectionRow)
      : [nextConnection]
    await upsertCachedYouTubeSummaryWithConnections({
      userId: connectionOwnerUserId,
      connections: cachedConnections,
      generatedAt: new Date().toISOString(),
    })
    createAndStartYouTubeRefreshJob(connectionOwnerUserId, {
      trigger: 'connect',
      reuseRunning: true,
      minIntervalMs: 0,
    }).catch((err) => {
      console.error('Unable to queue YouTube refresh after connect:', err)
    })

    clearYouTubeOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'success',
        provider: 'youtube',
        path: redirectPath,
        extraParams: {
          youtube_channel_name: connectedDisplayName,
          organizationId: connectedOrganizationId || undefined,
        },
        baseUrl: redirectBase,
      }),
    )
  } catch (err) {
    clearYouTubeOauthCookies()
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: err instanceof Error && err.message ? err.message : 'YouTube connection failed.',
        path: redirectPath,
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
      channelId: typeof item?.snippet?.channelId === 'string' ? item.snippet.channelId.trim() : '',
      channelName: typeof item?.snippet?.channelTitle === 'string' ? item.snippet.channelTitle.trim() : '',
      publishedAt: typeof item?.snippet?.publishedAt === 'string' ? item.snippet.publishedAt : '',
      views: toNumber(item?.statistics?.viewCount),
      likes: toNumber(item?.statistics?.likeCount),
      comments: toNumber(item?.statistics?.commentCount),
    }))
  } catch (_err) {
    return []
  }
}

const isUsableYouTubePlaylistVideoItem = (item) => {
  const privacyStatus =
    typeof item?.status?.privacyStatus === 'string'
      ? item.status.privacyStatus.trim().toLowerCase()
      : ''
  if (privacyStatus !== 'public') return false
  const title =
    typeof item?.snippet?.title === 'string'
      ? item.snippet.title.trim().toLowerCase()
      : ''
  if (title === 'private video' || title === 'deleted video') return false
  return true
}

const fetchYouTubeUploadVideoIds = async (accessToken, uploadsPlaylistId) => {
  if (!uploadsPlaylistId) return []
  const videoIds = []
  const seenVideoIds = new Set()
  let nextPageToken = ''
  let pageCount = 0

  while (pageCount < 200) {
    const params = new URLSearchParams({
      part: 'contentDetails,snippet,status',
      playlistId: uploadsPlaylistId,
      maxResults: '50',
    })
    if (nextPageToken) {
      params.set('pageToken', nextPageToken)
    }

    try {
      const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) break

      const payload = await response.json().catch(() => ({}))
      const items = Array.isArray(payload?.items) ? payload.items : []
      items.forEach((item) => {
        if (!isUsableYouTubePlaylistVideoItem(item)) return
        const videoId = normalizeTextInput(
          typeof item?.contentDetails?.videoId === 'string'
            ? item.contentDetails.videoId
            : item?.snippet?.resourceId?.videoId,
          { maxLength: 300 },
        )
        if (!videoId || seenVideoIds.has(videoId)) return
        seenVideoIds.add(videoId)
        videoIds.push(videoId)
      })

      const token =
        typeof payload?.nextPageToken === 'string' ? payload.nextPageToken.trim() : ''
      if (!token) break
      nextPageToken = token
      pageCount += 1
    } catch {
      break
    }
  }

  return videoIds
}

const fetchAllYouTubeVideosForChannel = async (accessToken, channelId) => {
  const normalizedChannelId = normalizeTextInput(channelId, { maxLength: 300 })
  if (!normalizedChannelId) return []
  const channelInfo = await fetchYouTubeChannelInfo(accessToken, normalizedChannelId)
  const uploadsPlaylistId = normalizeTextInput(channelInfo?.uploadsPlaylistId, { maxLength: 300 })
  if (!uploadsPlaylistId) return []
  const allVideoIds = await fetchYouTubeUploadVideoIds(accessToken, uploadsPlaylistId)
  if (!allVideoIds.length) return []

  const videos = []
  const chunkSize = 50
  for (let index = 0; index < allVideoIds.length; index += chunkSize) {
    const chunk = allVideoIds.slice(index, index + chunkSize)
    const chunkVideos = await fetchYouTubeVideos(accessToken, chunk)
    videos.push(...chunkVideos)
  }
  return videos
}

const normalizeIsoDateOnly = (value) => {
  if (typeof value !== 'string' || !value.trim()) return ''
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return ''
  return new Date(parsed).toISOString().slice(0, 10)
}

const fetchOldestUploadedVideoDate = async (accessToken, uploadsPlaylistId) => {
  if (!uploadsPlaylistId) return ''
  let oldestUploadDate = ''
  const todayIso = new Date().toISOString().slice(0, 10)
  let nextPageToken = ''
  let pageCount = 0

  while (pageCount < 200) {
    const params = new URLSearchParams({
      part: 'contentDetails,snippet,status',
      playlistId: uploadsPlaylistId,
      maxResults: '50',
    })
    if (nextPageToken) {
      params.set('pageToken', nextPageToken)
    }

    try {
      const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) break

      const payload = await response.json().catch(() => ({}))
      const items = Array.isArray(payload?.items) ? payload.items : []
      items.forEach((item) => {
        if (!isUsableYouTubePlaylistVideoItem(item)) return
        const uploadDate = normalizeIsoDateOnly(
          typeof item?.contentDetails?.videoPublishedAt === 'string'
            ? item.contentDetails.videoPublishedAt
            : typeof item?.snippet?.publishedAt === 'string'
              ? item.snippet.publishedAt
              : '',
        )
        if (!uploadDate || uploadDate > todayIso) return
        if (!oldestUploadDate || uploadDate < oldestUploadDate) {
          oldestUploadDate = uploadDate
        }
      })

      const token =
        typeof payload?.nextPageToken === 'string' ? payload.nextPageToken.trim() : ''
      if (!token) break
      nextPageToken = token
      pageCount += 1
    } catch {
      break
    }
  }

  return oldestUploadDate
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

const createTimeSeriesAccumulator = (date = '') => ({
  date,
  views: 0,
  engagements: 0,
  posts: 0,
  watchTimeHours: 0,
  followersNetChange: 0,
})

const createTimeSeriesByChannelAccumulator = (channelId = '', date = '') => ({
  channelId,
  date,
  views: 0,
  engagements: 0,
  posts: 0,
  watchTimeHours: 0,
  followersNetChange: 0,
})

const buildTimeSeries = (videos) => {
  const buckets = new Map()
  videos.forEach((video) => {
    if (!video.publishedAt) return
    const isoDate = video.publishedAt.slice(0, 10)
    const current = buckets.get(isoDate) ?? createTimeSeriesAccumulator(isoDate)
    current.views += video.views
    current.engagements += video.likes + video.comments
    current.posts += 1
    buckets.set(isoDate, current)
  })
  const ordered = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))
  return ordered.map((point) => ({
    date: point.date,
    views: point.views,
    engagements: point.engagements,
    posts: point.posts,
    watchTimeHours: point.watchTimeHours,
    followersNetChange: point.followersNetChange,
  }))
}

const buildTimeSeriesByChannel = (videos) => {
  const buckets = new Map()
  videos.forEach((video) => {
    const channelId = normalizeTextInput(video?.channelId, { maxLength: 300 })
    if (!channelId || !video?.publishedAt) return
    const isoDate = normalizeIsoDateOnly(video.publishedAt)
    if (!isoDate) return
    const key = `${channelId}:${isoDate}`
    const current = buckets.get(key) ?? createTimeSeriesByChannelAccumulator(channelId, isoDate)
    current.views += toNumber(video?.views)
    current.engagements += toNumber(video?.likes) + toNumber(video?.comments)
    current.posts += 1
    buckets.set(key, current)
  })
  return [...buckets.values()]
    .sort((left, right) => {
      const channelOrder = left.channelId.localeCompare(right.channelId)
      if (channelOrder !== 0) return channelOrder
      return left.date.localeCompare(right.date)
    })
    .map((point) => ({
      channelId: point.channelId,
      date: point.date,
      views: point.views,
      engagements: point.engagements,
      posts: point.posts,
      watchTimeHours: point.watchTimeHours,
      followersNetChange: point.followersNetChange,
    }))
}

const hydratePostCountsByDate = (series, ...postSources) => {
  if (!Array.isArray(series) || !series.length) return Array.isArray(series) ? series : []
  const postsByDate = new Map()
  for (const source of postSources) {
    if (!Array.isArray(source)) continue
    for (const row of source) {
      const date = normalizeIsoDateOnly(row?.date)
      if (!date || postsByDate.has(date)) continue
      const posts = Math.max(0, toNumber(row?.posts))
      if (posts <= 0) continue
      postsByDate.set(date, posts)
    }
  }
  return series.map((row) => {
    const date = normalizeIsoDateOnly(row?.date)
    if (!date || Math.max(0, toNumber(row?.posts)) > 0) return row
    const posts = postsByDate.get(date)
    if (!posts) return row
    return { ...row, posts }
  })
}

const hydratePostCountsByChannelDate = (series, ...postSources) => {
  if (!Array.isArray(series) || !series.length) return Array.isArray(series) ? series : []
  const postsByKey = new Map()
  for (const source of postSources) {
    if (!Array.isArray(source)) continue
    for (const row of source) {
      const channelId = normalizeTextInput(row?.channelId, { maxLength: 300 })
      const date = normalizeIsoDateOnly(row?.date)
      if (!channelId || !date) continue
      const key = `${channelId}:${date}`
      if (postsByKey.has(key)) continue
      const posts = Math.max(0, toNumber(row?.posts))
      if (posts <= 0) continue
      postsByKey.set(key, posts)
    }
  }
  return series.map((row) => {
    const channelId = normalizeTextInput(row?.channelId, { maxLength: 300 })
    const date = normalizeIsoDateOnly(row?.date)
    if (!channelId || !date || Math.max(0, toNumber(row?.posts)) > 0) return row
    const posts = postsByKey.get(`${channelId}:${date}`)
    if (!posts) return row
    return { ...row, posts }
  })
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
  const timeSeriesByChannelMap = new Map()
  const ageMap = new Map()
  const ageMapByChannel = new Map()
  const genderMap = new Map()
  const genderMapByChannel = new Map()
  const geoMap = new Map()
  const geoMapByChannel = new Map()
  const { startDate, endDate } = buildAnalyticsDateRange(365)
  const audienceRanges = [365, 90, 28].map((days) => buildAnalyticsDateRange(days))

  for (const connection of connections) {
    const { accessToken } = await resolveAccessToken(connection)
    if (!accessToken) continue
    const normalizedChannelId = normalizeTextInput(connection.channelId, { maxLength: 300 })
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
      const current = timeSeriesMap.get(row.day) ?? createTimeSeriesAccumulator(row.day)
      current.views += toNumber(row.views)
      current.engagements += toNumber(row.likes) + toNumber(row.comments)
      timeSeriesMap.set(row.day, current)
      if (normalizedChannelId) {
        const key = `${normalizedChannelId}::${row.day}`
        const currentByChannel =
          timeSeriesByChannelMap.get(key)
          ?? createTimeSeriesByChannelAccumulator(normalizedChannelId, row.day)
        currentByChannel.views += toNumber(row.views)
        currentByChannel.engagements += toNumber(row.likes) + toNumber(row.comments)
        timeSeriesByChannelMap.set(key, currentByChannel)
      }
    })

    const watchTimePayload = await fetchForConnection({
      metrics: 'estimatedMinutesWatched',
      dimensions: 'day',
      sort: 'day',
    })
    const watchTimeRows = parseAnalyticsRows(watchTimePayload)
    watchTimeRows.forEach((row) => {
      if (!row.day) return
      const current = timeSeriesMap.get(row.day) ?? createTimeSeriesAccumulator(row.day)
      const watchedMinutes = toNumber(row.estimatedMinutesWatched)
      current.watchTimeHours += watchedMinutes / 60
      timeSeriesMap.set(row.day, current)
      if (normalizedChannelId) {
        const key = `${normalizedChannelId}::${row.day}`
        const currentByChannel =
          timeSeriesByChannelMap.get(key)
          ?? createTimeSeriesByChannelAccumulator(normalizedChannelId, row.day)
        currentByChannel.watchTimeHours += watchedMinutes / 60
        timeSeriesByChannelMap.set(key, currentByChannel)
      }
    })

    const followerDeltaPayload = await fetchForConnection({
      metrics: 'subscribersGained,subscribersLost',
      dimensions: 'day',
      sort: 'day',
    })
    const followerDeltaRows = parseAnalyticsRows(followerDeltaPayload)
    followerDeltaRows.forEach((row) => {
      if (!row.day) return
      const current = timeSeriesMap.get(row.day) ?? createTimeSeriesAccumulator(row.day)
      const gained = toNumber(row.subscribersGained)
      const lost = toNumber(row.subscribersLost)
      current.followersNetChange += gained - lost
      timeSeriesMap.set(row.day, current)
      if (normalizedChannelId) {
        const key = `${normalizedChannelId}::${row.day}`
        const currentByChannel =
          timeSeriesByChannelMap.get(key)
          ?? createTimeSeriesByChannelAccumulator(normalizedChannelId, row.day)
        currentByChannel.followersNetChange += gained - lost
        timeSeriesByChannelMap.set(key, currentByChannel)
      }
    })

    const demographicRows = await fetchRowsForConnection([
      { metrics: 'viewerPercentage', dimensions: 'ageGroup,gender' },
    ], audienceRanges)
    demographicRows.forEach((row) => {
      const label = normalizeAgeLabel(row.ageGroup)
      if (!label) return
      const value = resolveAudienceMetricValue(row)
      ageMap.set(label, (ageMap.get(label) ?? 0) + value)
      if (normalizedChannelId) {
        if (!ageMapByChannel.has(normalizedChannelId)) {
          ageMapByChannel.set(normalizedChannelId, new Map())
        }
        const currentByChannel = ageMapByChannel.get(normalizedChannelId)
        currentByChannel.set(label, (currentByChannel.get(label) ?? 0) + value)
      }
      ageRowsCount += 1
    })
    demographicRows.forEach((row) => {
      const label = normalizeGenderLabel(row.gender)
      if (!label) return
      const value = resolveAudienceMetricValue(row)
      genderMap.set(label, (genderMap.get(label) ?? 0) + value)
      if (normalizedChannelId) {
        if (!genderMapByChannel.has(normalizedChannelId)) {
          genderMapByChannel.set(normalizedChannelId, new Map())
        }
        const currentByChannel = genderMapByChannel.get(normalizedChannelId)
        currentByChannel.set(label, (currentByChannel.get(label) ?? 0) + value)
      }
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
        if (normalizedChannelId) {
          if (!ageMapByChannel.has(normalizedChannelId)) {
            ageMapByChannel.set(normalizedChannelId, new Map())
          }
          const currentByChannel = ageMapByChannel.get(normalizedChannelId)
          currentByChannel.set(label, (currentByChannel.get(label) ?? 0) + value)
        }
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
        if (normalizedChannelId) {
          if (!genderMapByChannel.has(normalizedChannelId)) {
            genderMapByChannel.set(normalizedChannelId, new Map())
          }
          const currentByChannel = genderMapByChannel.get(normalizedChannelId)
          currentByChannel.set(label, (currentByChannel.get(label) ?? 0) + value)
        }
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
      if (normalizedChannelId) {
        if (!geoMapByChannel.has(normalizedChannelId)) {
          geoMapByChannel.set(normalizedChannelId, new Map())
        }
        const currentByChannel = geoMapByChannel.get(normalizedChannelId)
        currentByChannel.set(label, (currentByChannel.get(label) ?? 0) + value)
      }
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
  const buildPercentListByChannel = (mapByChannel) => {
    const output = {}
    for (const [channelId, valueMap] of mapByChannel.entries()) {
      const channelKey = normalizeTextInput(channelId, { maxLength: 300 })
      if (!channelKey) continue
      const list = buildPercentList(valueMap)
      if (!list.length) continue
      output[channelKey] = list
    }
    return output
  }

  const orderedSeries = [...timeSeriesMap.values()]
    .filter((point) => point.date)
    .sort((a, b) => a.date.localeCompare(b.date))
  const nonZeroSeries = orderedSeries.filter(
    (point) =>
      toNumber(point.views) > 0 || toNumber(point.engagements) > 0 || toNumber(point.posts) > 0,
  )
  const timeSeries = (nonZeroSeries.length ? nonZeroSeries : orderedSeries).map((point) => ({
    date: point.date,
    views: point.views,
    engagements: point.engagements,
    posts: point.posts,
    watchTimeHours: Number(point.watchTimeHours.toFixed(2)),
    followersNetChange: Math.round(point.followersNetChange),
  }))
  const orderedSeriesByChannel = [...timeSeriesByChannelMap.values()]
    .filter((point) => point.channelId && point.date)
    .sort((a, b) => {
      if (a.channelId === b.channelId) return a.date.localeCompare(b.date)
      return a.channelId.localeCompare(b.channelId)
    })
  const nonZeroSeriesByChannel = orderedSeriesByChannel.filter(
    (point) =>
      toNumber(point.views) > 0
      || toNumber(point.engagements) > 0
      || toNumber(point.posts) > 0
      || toNumber(point.watchTimeHours) > 0
      || Math.abs(toNumber(point.followersNetChange)) > 0,
  )
  const timeSeriesByChannel = (nonZeroSeriesByChannel.length ? nonZeroSeriesByChannel : orderedSeriesByChannel)
    .map((point) => ({
      channelId: point.channelId,
      date: point.date,
      views: point.views,
      engagements: point.engagements,
      posts: point.posts,
      watchTimeHours: Number(point.watchTimeHours.toFixed(2)),
      followersNetChange: Math.round(point.followersNetChange),
    }))

  return {
    timeSeries,
    timeSeriesByChannel,
    ageDistribution: buildPercentList(ageMap),
    ageDistributionByChannel: buildPercentListByChannel(ageMapByChannel),
    genderDistribution: buildPercentList(genderMap),
    genderDistributionByChannel: buildPercentListByChannel(genderMapByChannel),
    topGeos: buildPercentList(geoMap).slice(0, 5),
    topGeosByChannel: Object.fromEntries(
      Object.entries(buildPercentListByChannel(geoMapByChannel))
        .map(([channelId, values]) => [channelId, values.slice(0, 5)]),
    ),
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
  const estimatedMinutesWatchedIndex = findHeaderIndex(headers, [
    'estimatedMinutesWatched',
    'estimated_minutes_watched',
  ])

  return rows
    .map((row) => ({
      day: row[dayIndex]?.trim(),
      views: toNumber(row[viewsIndex]),
      likes: likesIndex >= 0 ? toNumber(row[likesIndex]) : 0,
      comments: commentsIndex >= 0 ? toNumber(row[commentsIndex]) : 0,
      subscribersGained: subscribersGainedIndex >= 0 ? toNumber(row[subscribersGainedIndex]) : null,
      subscribersLost: subscribersLostIndex >= 0 ? toNumber(row[subscribersLostIndex]) : null,
      estimatedMinutesWatched:
        estimatedMinutesWatchedIndex >= 0 ? toNumber(row[estimatedMinutesWatchedIndex]) : 0,
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
  const timeSeriesByChannelMap = new Map()
  const ageMapByChannel = new Map()
  const genderMapByChannel = new Map()
  const geoMapByChannel = new Map()

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
      const current = timeSeriesMap.get(row.day) ?? createTimeSeriesAccumulator(row.day)
      current.views += row.views
      current.engagements += row.likes + row.comments
      current.watchTimeHours += toNumber(row.estimatedMinutesWatched) / 60
      const gained = typeof row.subscribersGained === 'number' ? row.subscribersGained : 0
      const lost = typeof row.subscribersLost === 'number' ? row.subscribersLost : 0
      current.followersNetChange += gained - lost
      timeSeriesMap.set(row.day, current)
      if (row.channelId) {
        const key = `${row.channelId}::${row.day}`
        const currentByChannel =
          timeSeriesByChannelMap.get(key)
          ?? createTimeSeriesByChannelAccumulator(row.channelId, row.day)
        currentByChannel.views += row.views
        currentByChannel.engagements += row.likes + row.comments
        currentByChannel.watchTimeHours += toNumber(row.estimatedMinutesWatched) / 60
        currentByChannel.followersNetChange += gained - lost
        timeSeriesByChannelMap.set(key, currentByChannel)
      }
    })
  } else {
    videoRows.forEach((row) => {
      const current = timeSeriesMap.get(row.day) ?? createTimeSeriesAccumulator(row.day)
      current.views += row.views
      current.engagements += row.likes + row.comments
      timeSeriesMap.set(row.day, current)
      if (row.channelId) {
        const key = `${row.channelId}::${row.day}`
        const currentByChannel =
          timeSeriesByChannelMap.get(key)
          ?? createTimeSeriesByChannelAccumulator(row.channelId, row.day)
        currentByChannel.views += row.views
        currentByChannel.engagements += row.likes + row.comments
        timeSeriesByChannelMap.set(key, currentByChannel)
      }
    })
  }

  const incrementPostCount = (day, channelId, count = 1) => {
    if (!day || count <= 0) return
    const current = timeSeriesMap.get(day) ?? createTimeSeriesAccumulator(day)
    current.posts += count
    timeSeriesMap.set(day, current)
    if (!channelId) return
    const key = `${channelId}::${day}`
    const currentByChannel =
      timeSeriesByChannelMap.get(key)
      ?? createTimeSeriesByChannelAccumulator(channelId, day)
    currentByChannel.posts += count
    timeSeriesByChannelMap.set(key, currentByChannel)
  }

  const firstSeenDayByVideo = new Map()
  const postRowsMissingVideoIdByDay = new Map()
  videoRows.forEach((row) => {
    const day = normalizeIsoDateOnly(row?.day)
    if (!day) return
    const channelId = normalizeTextInput(row?.channelId, { maxLength: 300 })
    const videoId = normalizeTextInput(row?.videoId, { maxLength: 300 })
    if (!videoId) {
      const key = `${channelId}::${day}`
      postRowsMissingVideoIdByDay.set(key, (postRowsMissingVideoIdByDay.get(key) ?? 0) + 1)
      return
    }
    const key = `${channelId}::${videoId}`
    const existing = firstSeenDayByVideo.get(key)
    if (!existing || day < existing.day) {
      firstSeenDayByVideo.set(key, { channelId, day })
    }
  })
  firstSeenDayByVideo.forEach(({ channelId, day }) => {
    incrementPostCount(day, channelId, 1)
  })
  postRowsMissingVideoIdByDay.forEach((count, key) => {
    const [channelId = '', day = ''] = key.split('::')
    incrementPostCount(day, channelId, count)
  })

  const orderedSeries = [...timeSeriesMap.values()]
    .filter((point) => point.date)
    .sort((a, b) => a.date.localeCompare(b.date))
  const nonZeroSeries = orderedSeries.filter(
    (point) =>
      toNumber(point.views) > 0 || toNumber(point.engagements) > 0 || toNumber(point.posts) > 0,
  )
  const timeSeries = (nonZeroSeries.length ? nonZeroSeries : orderedSeries).map((point) => ({
    date: point.date,
    views: point.views,
    engagements: point.engagements,
    posts: point.posts,
    watchTimeHours: Number(point.watchTimeHours.toFixed(2)),
    followersNetChange: Math.round(point.followersNetChange),
  }))
  const orderedSeriesByChannel = [...timeSeriesByChannelMap.values()]
    .filter((point) => point.channelId && point.date)
    .sort((a, b) => {
      if (a.channelId === b.channelId) return a.date.localeCompare(b.date)
      return a.channelId.localeCompare(b.channelId)
    })
  const nonZeroSeriesByChannel = orderedSeriesByChannel.filter(
    (point) =>
      toNumber(point.views) > 0
      || toNumber(point.engagements) > 0
      || toNumber(point.posts) > 0
      || toNumber(point.watchTimeHours) > 0
      || Math.abs(toNumber(point.followersNetChange)) > 0,
  )
  const timeSeriesByChannel = (nonZeroSeriesByChannel.length ? nonZeroSeriesByChannel : orderedSeriesByChannel)
    .map((point) => ({
      channelId: point.channelId,
      date: point.date,
      views: point.views,
      engagements: point.engagements,
      posts: point.posts,
      watchTimeHours: Number(point.watchTimeHours.toFixed(2)),
      followersNetChange: Math.round(point.followersNetChange),
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

  const channelNameById = new Map(
    connections.map((connection) => [connection.channelId, connection.channelName || 'YouTube Channel']),
  )

  const topPosts = topVideoIds.map((item) => ({
    id: item.videoId,
    title: videoTitleMap.get(item.videoId) || 'Untitled video',
    platform: 'YouTube',
    channelId: item.channelId || '',
    channelName: channelNameById.get(item.channelId) || 'YouTube Channel',
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
      if (row.channelId) {
        if (!ageMapByChannel.has(row.channelId)) {
          ageMapByChannel.set(row.channelId, new Map())
        }
        const byChannel = ageMapByChannel.get(row.channelId)
        byChannel.set(ageLabel, (byChannel.get(ageLabel) ?? 0) + (row.views || row.viewerPercentage))
      }
    }
    if (genderLabel) {
      const current = genderMap.get(genderLabel) ?? 0
      genderMap.set(genderLabel, current + (row.views || row.viewerPercentage))
      if (row.channelId) {
        if (!genderMapByChannel.has(row.channelId)) {
          genderMapByChannel.set(row.channelId, new Map())
        }
        const byChannel = genderMapByChannel.get(row.channelId)
        byChannel.set(genderLabel, (byChannel.get(genderLabel) ?? 0) + (row.views || row.viewerPercentage))
      }
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
  const buildPercentListByChannel = (mapByChannel) => {
    const output = {}
    for (const [channelId, valueMap] of mapByChannel.entries()) {
      const channelKey = normalizeTextInput(channelId, { maxLength: 300 })
      if (!channelKey) continue
      const list = buildPercentList(valueMap)
      if (!list.length) continue
      output[channelKey] = list
    }
    return output
  }

  const ageDistribution = buildPercentList(ageMap)
  const genderDistribution = buildPercentList(genderMap)

  const geoMap = new Map()
  geoRows.forEach((row) => {
    const label = resolveCountryLabel(row.country)
    if (!label) return
    const current = geoMap.get(label) ?? 0
    geoMap.set(label, current + (row.views || row.viewerPercentage))
    if (row.channelId) {
      if (!geoMapByChannel.has(row.channelId)) {
        geoMapByChannel.set(row.channelId, new Map())
      }
      const byChannel = geoMapByChannel.get(row.channelId)
      byChannel.set(label, (byChannel.get(label) ?? 0) + (row.views || row.viewerPercentage))
    }
  })

  const topGeos = buildPercentList(geoMap).slice(0, 5)

  return {
    timeSeries,
    timeSeriesByChannel,
    topPosts,
    ageDistribution,
    ageDistributionByChannel: buildPercentListByChannel(ageMapByChannel),
    genderDistribution,
    genderDistributionByChannel: buildPercentListByChannel(genderMapByChannel),
    topGeos,
    topGeosByChannel: Object.fromEntries(
      Object.entries(buildPercentListByChannel(geoMapByChannel))
        .map(([channelId, values]) => [channelId, values.slice(0, 5)]),
    ),
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
  let firstVideoUploadDate = ''

  for (const connection of connections) {
    const { accessToken } = await resolveToken(connection)
    if (!accessToken) continue
    const channelInfo = await fetchYouTubeChannelInfo(accessToken, connection.channelId)
    if (!channelInfo?.id) continue
    const channelFirstUploadDate = await fetchOldestUploadedVideoDate(
      accessToken,
      channelInfo.uploadsPlaylistId,
    )
    if (
      channelFirstUploadDate &&
      (!firstVideoUploadDate || channelFirstUploadDate < firstVideoUploadDate)
    ) {
      firstVideoUploadDate = channelFirstUploadDate
    }

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
      videoCount: Math.max(0, toNumber(channelInfo?.statistics?.videoCount)),
      firstVideoUploadDate: channelFirstUploadDate || '',
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
      channelId: video.channelId || '',
      channelName: video.channelName || 'YouTube Channel',
      views: video.views,
      engagementRate: video.views ? ((video.likes + video.comments) / video.views) * 100 : 0,
    }))

  const fallbackTimeSeries = buildTimeSeries(recentVideos)
  const fallbackTimeSeriesByChannel = buildTimeSeriesByChannel(recentVideos)
  let reportingSummary = {
    timeSeries: [],
    timeSeriesByChannel: [],
    topPosts: [],
    ageDistribution: [],
    ageDistributionByChannel: {},
    genderDistribution: [],
    genderDistributionByChannel: {},
    topGeos: [],
    topGeosByChannel: {},
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
    timeSeriesByChannel: [],
    ageDistribution: [],
    ageDistributionByChannel: {},
    genderDistribution: [],
    genderDistributionByChannel: {},
    topGeos: [],
    topGeosByChannel: {},
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
          toNumber(point?.views) > 0
          || toNumber(point?.engagements) > 0
          || toNumber(point?.posts) > 0
          || toNumber(point?.watchTimeHours) > 0
          || Math.abs(toNumber(point?.followersNetChange)) > 0,
      )
  const hasNonZeroSeriesByChannel = (series) =>
    Array.isArray(series)
      && series.some(
        (point) =>
          normalizeTextInput(point?.channelId, { maxLength: 300 }).length > 0
          && (
            toNumber(point?.views) > 0
            || toNumber(point?.engagements) > 0
            || toNumber(point?.posts) > 0
            || toNumber(point?.watchTimeHours) > 0
            || Math.abs(toNumber(point?.followersNetChange)) > 0
          ),
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
  const resolvedTimeSeriesByChannel = hasNonZeroSeriesByChannel(analyticsSummary.timeSeriesByChannel)
    ? analyticsSummary.timeSeriesByChannel
    : hasNonZeroSeriesByChannel(reportingSummary.timeSeriesByChannel)
      ? reportingSummary.timeSeriesByChannel
      : hasNonZeroSeriesByChannel(fallbackTimeSeriesByChannel)
        ? fallbackTimeSeriesByChannel
        : analyticsSummary.timeSeriesByChannel.length
          ? analyticsSummary.timeSeriesByChannel
          : reportingSummary.timeSeriesByChannel.length
            ? reportingSummary.timeSeriesByChannel
            : fallbackTimeSeriesByChannel
  const resolvedTimeSeriesWithHydratedPosts = hydratePostCountsByDate(
    resolvedTimeSeries,
    reportingSummary.timeSeries,
    fallbackTimeSeries,
  )
  const resolvedTimeSeriesByChannelWithHydratedPosts = hydratePostCountsByChannelDate(
    resolvedTimeSeriesByChannel,
    reportingSummary.timeSeriesByChannel,
    fallbackTimeSeriesByChannel,
  )
  const ageDistributionByChannel =
    analyticsSummary.ageDistributionByChannel
    && Object.keys(analyticsSummary.ageDistributionByChannel).length
      ? analyticsSummary.ageDistributionByChannel
      : reportingSummary.ageDistributionByChannel
  const genderDistributionByChannel =
    analyticsSummary.genderDistributionByChannel
    && Object.keys(analyticsSummary.genderDistributionByChannel).length
      ? analyticsSummary.genderDistributionByChannel
      : reportingSummary.genderDistributionByChannel
  const topGeosByChannel =
    analyticsSummary.topGeosByChannel && Object.keys(analyticsSummary.topGeosByChannel).length
      ? analyticsSummary.topGeosByChannel
      : reportingSummary.topGeosByChannel

  return {
    firstVideoUploadDate,
    channels: hydratedChannels,
    topPosts: reportingSummary.topPosts.length ? reportingSummary.topPosts : fallbackTopPosts,
    timeSeries: resolvedTimeSeriesWithHydratedPosts,
    timeSeriesByChannel: resolvedTimeSeriesByChannelWithHydratedPosts,
    ageDistribution: analyticsSummary.ageDistribution.length
      ? analyticsSummary.ageDistribution
      : reportingSummary.ageDistribution,
    ageDistributionByChannel,
    genderDistribution: analyticsSummary.genderDistribution.length
      ? analyticsSummary.genderDistribution
      : reportingSummary.genderDistribution,
    genderDistributionByChannel,
    topGeos: analyticsSummary.topGeos.length ? analyticsSummary.topGeos : reportingSummary.topGeos,
    topGeosByChannel,
  }
}

const buildEmptyYouTubeSummary = () => ({
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
})

const mergeYouTubeDemographicRows = (targetMap, rows) => {
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    const label = normalizeTextInput(row?.label, { maxLength: 140 })
    if (!label) continue
    targetMap.set(label, (targetMap.get(label) ?? 0) + Math.max(0, toNumber(row?.value)))
  }
}

const mergeYouTubeDemographicByChannel = (targetMap, byChannel) => {
  if (!byChannel || typeof byChannel !== 'object' || Array.isArray(byChannel)) return
  for (const [rawChannelId, rows] of Object.entries(byChannel)) {
    const channelId = normalizeTextInput(rawChannelId, { maxLength: 300 })
    if (!channelId) continue
    const channelMap = targetMap.get(channelId) ?? new Map()
    mergeYouTubeDemographicRows(channelMap, rows)
    targetMap.set(channelId, channelMap)
  }
}

const serializeYouTubeDemographicMap = (sourceMap) =>
  [...sourceMap.entries()]
    .map(([label, value]) => ({ label, value: Math.max(0, toNumber(value)) }))
    .sort((left, right) => toNumber(right.value) - toNumber(left.value))

const serializeYouTubeDemographicByChannelMap = (sourceMap) => {
  const output = {}
  for (const [channelId, rowsMap] of sourceMap.entries()) {
    const normalizedChannelId = normalizeTextInput(channelId, { maxLength: 300 })
    if (!normalizedChannelId) continue
    output[normalizedChannelId] = serializeYouTubeDemographicMap(rowsMap)
  }
  return output
}

const mergeYouTubeSummaryParts = (parts) => {
  const normalizedParts = (Array.isArray(parts) ? parts : []).filter(
    (part) => part && typeof part === 'object',
  )
  if (!normalizedParts.length) return buildEmptyYouTubeSummary()

  const firstDates = []
  const channelByKey = new Map()
  const postByKey = new Map()
  const timeSeriesByDate = new Map()
  const timeSeriesByChannelDate = new Map()
  const ageDistributionMap = new Map()
  const genderDistributionMap = new Map()
  const topGeosMap = new Map()
  const ageDistributionByChannelMap = new Map()
  const genderDistributionByChannelMap = new Map()
  const topGeosByChannelMap = new Map()

  for (const part of normalizedParts) {
    const firstDate = normalizeIsoDateOnly(part.firstVideoUploadDate)
    if (firstDate) firstDates.push(firstDate)

    const channels = Array.isArray(part.channels) ? part.channels : []
    for (const channel of channels) {
      const channelId = normalizeTextInput(channel?.id, { maxLength: 300 })
      const platform = normalizeTextInput(channel?.platform, { maxLength: 40 }) || 'YouTube'
      if (!channelId) continue
      const channelFirstDate = normalizeIsoDateOnly(channel?.firstVideoUploadDate)
      if (channelFirstDate) firstDates.push(channelFirstDate)
      channelByKey.set(`${platform}:${channelId}`, channel)
    }

    const topPosts = Array.isArray(part.topPosts) ? part.topPosts : []
    for (const post of topPosts) {
      const postId = normalizeTextInput(post?.id, { maxLength: 300 })
      const platform = normalizeTextInput(post?.platform, { maxLength: 40 }) || 'YouTube'
      if (!postId) continue
      const key = `${platform}:${postId}`
      const existing = postByKey.get(key)
      if (!existing || toNumber(post?.views) >= toNumber(existing?.views)) {
        postByKey.set(key, post)
      }
    }

    const timeSeriesRows = Array.isArray(part.timeSeries) ? part.timeSeries : []
    for (const row of timeSeriesRows) {
      const date = normalizeIsoDateOnly(row?.date)
      if (!date) continue
      const current = timeSeriesByDate.get(date) ?? {
        date,
        views: 0,
        engagements: 0,
        posts: 0,
        watchTimeHours: 0,
        followersNetChange: 0,
      }
      timeSeriesByDate.set(date, {
        date,
        views: current.views + Math.max(0, toNumber(row?.views)),
        engagements: current.engagements + Math.max(0, toNumber(row?.engagements)),
        posts: current.posts + Math.max(0, toNumber(row?.posts)),
        watchTimeHours: current.watchTimeHours + Math.max(0, toNumber(row?.watchTimeHours)),
        followersNetChange: current.followersNetChange + toNumber(row?.followersNetChange),
      })
    }

    const seriesByChannelRows = Array.isArray(part.timeSeriesByChannel) ? part.timeSeriesByChannel : []
    for (const row of seriesByChannelRows) {
      const channelId = normalizeTextInput(row?.channelId, { maxLength: 300 })
      const date = normalizeIsoDateOnly(row?.date)
      if (!channelId || !date) continue
      const key = `${channelId}:${date}`
      const current = timeSeriesByChannelDate.get(key) ?? {
        channelId,
        date,
        views: 0,
        engagements: 0,
        posts: 0,
        watchTimeHours: 0,
        followersNetChange: 0,
      }
      timeSeriesByChannelDate.set(key, {
        channelId,
        date,
        views: current.views + Math.max(0, toNumber(row?.views)),
        engagements: current.engagements + Math.max(0, toNumber(row?.engagements)),
        posts: current.posts + Math.max(0, toNumber(row?.posts)),
        watchTimeHours: current.watchTimeHours + Math.max(0, toNumber(row?.watchTimeHours)),
        followersNetChange: current.followersNetChange + toNumber(row?.followersNetChange),
      })
    }

    mergeYouTubeDemographicRows(ageDistributionMap, part.ageDistribution)
    mergeYouTubeDemographicRows(genderDistributionMap, part.genderDistribution)
    mergeYouTubeDemographicRows(topGeosMap, part.topGeos)
    mergeYouTubeDemographicByChannel(ageDistributionByChannelMap, part.ageDistributionByChannel)
    mergeYouTubeDemographicByChannel(genderDistributionByChannelMap, part.genderDistributionByChannel)
    mergeYouTubeDemographicByChannel(topGeosByChannelMap, part.topGeosByChannel)
  }

  firstDates.sort((left, right) => left.localeCompare(right))

  return {
    firstVideoUploadDate: firstDates[0] || '',
    channels: [...channelByKey.values()],
    topPosts: [...postByKey.values()].sort((left, right) => toNumber(right?.views) - toNumber(left?.views)),
    timeSeries: [...timeSeriesByDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
    timeSeriesByChannel: [...timeSeriesByChannelDate.values()].sort((left, right) => {
      const channelOrder = left.channelId.localeCompare(right.channelId)
      if (channelOrder !== 0) return channelOrder
      return left.date.localeCompare(right.date)
    }),
    ageDistribution: serializeYouTubeDemographicMap(ageDistributionMap),
    ageDistributionByChannel: serializeYouTubeDemographicByChannelMap(ageDistributionByChannelMap),
    genderDistribution: serializeYouTubeDemographicMap(genderDistributionMap),
    genderDistributionByChannel: serializeYouTubeDemographicByChannelMap(genderDistributionByChannelMap),
    topGeos: serializeYouTubeDemographicMap(topGeosMap).slice(0, 5),
    topGeosByChannel: Object.fromEntries(
      Object.entries(serializeYouTubeDemographicByChannelMap(topGeosByChannelMap)).map(([channelId, rows]) => [
        channelId,
        Array.isArray(rows) ? rows.slice(0, 5) : [],
      ]),
    ),
  }
}

const normalizeCachedSummaryPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return buildEmptyYouTubeSummary()
  const parsed = payload
  return {
    firstVideoUploadDate: normalizeIsoDateOnly(parsed.firstVideoUploadDate),
    channels: Array.isArray(parsed.channels) ? parsed.channels : [],
    topPosts: Array.isArray(parsed.topPosts) ? parsed.topPosts : [],
    timeSeries: Array.isArray(parsed.timeSeries) ? parsed.timeSeries : [],
    timeSeriesByChannel: Array.isArray(parsed.timeSeriesByChannel) ? parsed.timeSeriesByChannel : [],
    ageDistribution: Array.isArray(parsed.ageDistribution) ? parsed.ageDistribution : [],
    ageDistributionByChannel:
      parsed.ageDistributionByChannel && typeof parsed.ageDistributionByChannel === 'object'
        ? parsed.ageDistributionByChannel
        : {},
    genderDistribution: Array.isArray(parsed.genderDistribution) ? parsed.genderDistribution : [],
    genderDistributionByChannel:
      parsed.genderDistributionByChannel && typeof parsed.genderDistributionByChannel === 'object'
        ? parsed.genderDistributionByChannel
        : {},
    topGeos: Array.isArray(parsed.topGeos) ? parsed.topGeos : [],
    topGeosByChannel:
      parsed.topGeosByChannel && typeof parsed.topGeosByChannel === 'object'
        ? parsed.topGeosByChannel
        : {},
  }
}

const resolveYouTubeViewer = async (req, res) => {
  const viewer = await resolveAuthedUserContext(req, res)
  if (!viewer.ok) return { ok: false, viewer }
  if (!canRoleTagCampaignContent(viewer.appRole)) {
    return {
      ok: false,
      viewer: {
        status: 403,
        error: 'forbidden',
        message: 'Brand viewers can only access shared report links.',
      },
    }
  }
  return { ok: true, viewer }
}

const parseIsoTime = (value) => {
  if (typeof value !== 'string' || !value.trim()) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const waitForDelay = (delayMs) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, toNumber(delayMs))))

const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
  const safeTimeoutMs = Math.max(1_000, toNumber(timeoutMs) || 60_000)
  let timeoutId = null
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(timeoutMessage || 'Operation timed out.'))
      }, safeTimeoutMs)
    })
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

const getInstagramRequestIp = (req) => {
  const forwardedFor = normalizeTextInput(req.headers?.['x-forwarded-for'], { maxLength: 300 })
  const forwarded = normalizeTextInput(req.headers?.forwarded, { maxLength: 300 })
  const ipFromForwarded = forwardedFor.split(',')[0]?.trim() || ''
  const ip = ipFromForwarded || normalizeTextInput(req.ip, { maxLength: 120 }) || normalizeTextInput(req.socket?.remoteAddress, { maxLength: 120 })
  return ip || 'unknown'
}

const pruneInstagramRateLimitBuckets = (nowMs) => {
  for (const [bucketKey, bucket] of instagramEndpointRateLimitBuckets.entries()) {
    if (!bucket || typeof bucket !== 'object') {
      instagramEndpointRateLimitBuckets.delete(bucketKey)
      continue
    }
    if (nowMs - toNumber(bucket.lastSeenAt) > instagramRateLimitWindowMs * 3) {
      instagramEndpointRateLimitBuckets.delete(bucketKey)
    }
  }
}

const enforceInstagramEndpointRateLimit = (req, res, options = {}) => {
  const maxRequests = Math.max(1, toNumber(options.maxRequests || instagramRefreshRateLimitMax))
  const windowMs = Math.max(1000, toNumber(options.windowMs || instagramRateLimitWindowMs))
  const scope = normalizeTextInput(options.scope, { maxLength: 64 }) || 'instagram'
  const userId = normalizeTextInput(options.userId, { maxLength: 80 }) || 'anonymous'
  const clientIp = getInstagramRequestIp(req)
  const bucketKey = `${scope}:${userId}:${clientIp}`
  const nowMs = Date.now()
  pruneInstagramRateLimitBuckets(nowMs)
  const bucket = instagramEndpointRateLimitBuckets.get(bucketKey) ?? { count: 0, resetAt: nowMs + windowMs, lastSeenAt: nowMs }
  if (nowMs > toNumber(bucket.resetAt)) {
    bucket.count = 0
    bucket.resetAt = nowMs + windowMs
  }
  bucket.count += 1
  bucket.lastSeenAt = nowMs
  instagramEndpointRateLimitBuckets.set(bucketKey, bucket)
  const remaining = Math.max(0, maxRequests - bucket.count)
  res.setHeader('X-RateLimit-Limit', String(maxRequests))
  res.setHeader('X-RateLimit-Remaining', String(remaining))
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(toNumber(bucket.resetAt) / 1000)))
  if (bucket.count <= maxRequests) return true
  const retryAfterSeconds = Math.max(1, Math.ceil((toNumber(bucket.resetAt) - nowMs) / 1000))
  res.setHeader('Retry-After', String(retryAfterSeconds))
  res.status(429).json({
    error: 'rate_limited',
    message: 'Too many Instagram requests. Try again shortly.',
    retryAfterSeconds,
  })
  return false
}

const trimInstagramOpsState = () => {
  const nowMs = Date.now()
  instagramOpsState.runs = instagramOpsState.runs
    .filter((entry) => nowMs - toNumber(entry.finishedAtMs || entry.startedAtMs) <= instagramOpsRunWindowMs * 2)
    .slice(-instagramOpsRecentRunLimit)
  instagramOpsState.alerts = instagramOpsState.alerts
    .filter((entry) => nowMs - toNumber(entry.createdAtMs) <= instagramOpsRunWindowMs * 2)
    .slice(-instagramOpsRecentAlertLimit)
  for (const [userId, streak] of instagramOpsState.failureStreakByUser.entries()) {
    if (!streak || typeof streak !== 'object') {
      instagramOpsState.failureStreakByUser.delete(userId)
      continue
    }
    if (nowMs - toNumber(streak.updatedAtMs) > instagramOpsRunWindowMs * 2) {
      instagramOpsState.failureStreakByUser.delete(userId)
    }
  }
}

const redactInstagramErrorMessage = (value) => {
  const normalized = normalizeTextInput(value, { maxLength: 240 })
  if (!normalized) return ''
  return normalized
    .replace(/[A-Za-z0-9+/_-]{24,}/g, '[redacted]')
    .replace(/(sessionid|csrftoken|ds_user_id)\s*=\s*[^;\s]+/gi, '$1=[redacted]')
}

const getInstagramFailureRatePct = () => {
  trimInstagramOpsState()
  const nowMs = Date.now()
  const recentRuns = instagramOpsState.runs.filter(
    (entry) => nowMs - toNumber(entry.finishedAtMs || entry.startedAtMs) <= instagramOpsRunWindowMs,
  )
  if (!recentRuns.length) return 0
  const failedRuns = recentRuns.filter((entry) => entry.status !== 'succeeded').length
  return (failedRuns / recentRuns.length) * 100
}

const recordInstagramAlert = (type, payload = {}) => {
  const nowIso = new Date().toISOString()
  const alert = {
    id: crypto.randomUUID(),
    type: normalizeTextInput(type, { maxLength: 64 }) || 'instagram_alert',
    createdAt: nowIso,
    createdAtMs: Date.now(),
    payload: payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {},
  }
  instagramOpsState.alerts.push(alert)
  trimInstagramOpsState()
  const log = alert.type === 'instagram_failure_rate_threshold' ? console.warn : console.error
  log('Instagram guardrail alert:', {
    type: alert.type,
    createdAt: alert.createdAt,
    payload: alert.payload,
  })
  const alertUserId = normalizeTextInput(alert.payload?.userId, { maxLength: 80 })
  if (isUuid(alertUserId)) {
    void persistInstagramAlertForUser(alertUserId, {
      id: alert.id,
      type: alert.type,
      createdAt: alert.createdAt,
      payload: alert.payload,
    })
  }
}

const updateInstagramFailureStreak = (userId, status, details = {}) => {
  const normalizedUserId = normalizeTextInput(userId, { maxLength: 80 })
  if (!isUuid(normalizedUserId)) return
  const nowMs = Date.now()
  const existing = instagramOpsState.failureStreakByUser.get(normalizedUserId) ?? {
    count: 0,
    updatedAtMs: nowMs,
    lastStatus: 'idle',
  }
  if (status === 'succeeded') {
    instagramOpsState.failureStreakByUser.set(normalizedUserId, {
      count: 0,
      updatedAtMs: nowMs,
      lastStatus: 'succeeded',
    })
    return
  }
  const next = {
    count: toNumber(existing.count) + 1,
    updatedAtMs: nowMs,
    lastStatus: normalizeTextInput(status, { maxLength: 32 }) || 'failed',
  }
  instagramOpsState.failureStreakByUser.set(normalizedUserId, next)
  if (next.count >= instagramAlertFailureStreakThreshold) {
    recordInstagramAlert('instagram_failure_streak_threshold', {
      userId: normalizedUserId,
      streakCount: next.count,
      details,
    })
  }
}

const maybeAlertInstagramFailureRate = () => {
  trimInstagramOpsState()
  const nowMs = Date.now()
  const recentRuns = instagramOpsState.runs.filter(
    (entry) => nowMs - toNumber(entry.finishedAtMs || entry.startedAtMs) <= instagramOpsRunWindowMs,
  )
  if (recentRuns.length < instagramAlertFailureRateMinRuns) return
  const failedRuns = recentRuns.filter((entry) => entry.status !== 'succeeded').length
  const failureRatePct = (failedRuns / recentRuns.length) * 100
  if (failureRatePct < instagramAlertFailureRateThresholdPct) return
  const existingRecentAlert = instagramOpsState.alerts.find((entry) =>
    entry.type === 'instagram_failure_rate_threshold'
    && Date.now() - toNumber(entry.createdAtMs) <= Math.max(60_000, instagramOpsRunWindowMs / 2),
  )
  if (existingRecentAlert) return
  recordInstagramAlert('instagram_failure_rate_threshold', {
    failureRatePct: Number(failureRatePct.toFixed(2)),
    thresholdPct: instagramAlertFailureRateThresholdPct,
    runCount: recentRuns.length,
    minRuns: instagramAlertFailureRateMinRuns,
    windowMs: instagramOpsRunWindowMs,
  })
}

const recordInstagramRun = async (entry) => {
  const normalized = {
    runId: normalizeTextInput(entry?.runId, { maxLength: 80 }) || crypto.randomUUID(),
    userId: normalizeTextInput(entry?.userId, { maxLength: 80 }),
    jobId: normalizeTextInput(entry?.jobId, { maxLength: 80 }),
    status: normalizeTextInput(entry?.status, { maxLength: 32 }) || 'unknown',
    startedAt: normalizeTextInput(entry?.startedAt, { maxLength: 64 }) || '',
    finishedAt: normalizeTextInput(entry?.finishedAt, { maxLength: 64 }) || '',
    startedAtMs: parseIsoTime(entry?.startedAt),
    finishedAtMs: parseIsoTime(entry?.finishedAt),
    channelsTotal: Math.max(0, toNumber(entry?.channelsTotal)),
    channelsProcessed: Math.max(0, toNumber(entry?.channelsProcessed)),
    partialFailureCount: Math.max(0, toNumber(entry?.partialFailureCount)),
    errorCode: normalizeTextInput(entry?.errorCode, { maxLength: 80 }),
    errorMessage: redactInstagramErrorMessage(entry?.errorMessage),
    accountOutcomes: Array.isArray(entry?.accountOutcomes)
      ? entry.accountOutcomes
        .map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return null
          const ownerUserId = normalizeTextInput(item.ownerUserId, { maxLength: 80 })
          const accountId = normalizeTextInput(item.accountId, { maxLength: 300 }).toLowerCase()
          if (!isUuid(ownerUserId) || !accountId) return null
          return {
            ownerUserId,
            accountId,
            accountName: normalizeTextInput(item.accountName, { maxLength: 180 }),
            status: normalizeTextInput(item.status, { maxLength: 32 }) || 'unknown',
            errorCode: normalizeTextInput(item.errorCode, { maxLength: 80 }),
            errorMessage: redactInstagramErrorMessage(item.errorMessage),
          }
        })
        .filter((item) => Boolean(item))
      : [],
  }
  instagramOpsState.runs.push(normalized)
  updateInstagramFailureStreak(normalized.userId, normalized.status, {
    jobId: normalized.jobId,
    errorCode: normalized.errorCode,
    partialFailureCount: normalized.partialFailureCount,
  })
  trimInstagramOpsState()
  maybeAlertInstagramFailureRate()
  if (normalized.accountOutcomes.length) {
    const seenAccounts = new Set()
    for (const outcome of normalized.accountOutcomes) {
      const dedupeKey = `${outcome.ownerUserId}:${outcome.accountId}`
      if (seenAccounts.has(dedupeKey)) continue
      seenAccounts.add(dedupeKey)
      await persistInstagramOpsSnapshotForAccount({
        ownerUserId: outcome.ownerUserId,
        accountId: outcome.accountId,
        runEntry: {
          runId: normalized.runId,
          jobId: normalized.jobId,
          status: outcome.status,
          startedAt: normalized.startedAt,
          finishedAt: normalized.finishedAt,
          partialFailureCount: normalized.partialFailureCount,
          errorCode: outcome.errorCode || normalized.errorCode,
          errorMessage: outcome.errorMessage || normalized.errorMessage,
        },
        lastStatus: outcome.status,
        lastErrorCode: outcome.errorCode || normalized.errorCode,
        lastErrorMessage: outcome.errorMessage || normalized.errorMessage,
      })
    }
  }
}

const buildEmptyInstagramSummary = () => ({
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
})

const normalizeCachedInstagramSummaryPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return buildEmptyInstagramSummary()
  const parsed = payload
  return {
    firstVideoUploadDate: normalizeIsoDateOnly(parsed.firstVideoUploadDate),
    channels: Array.isArray(parsed.channels) ? parsed.channels : [],
    topPosts: Array.isArray(parsed.topPosts) ? parsed.topPosts : [],
    timeSeries: Array.isArray(parsed.timeSeries) ? parsed.timeSeries : [],
    timeSeriesByChannel: Array.isArray(parsed.timeSeriesByChannel) ? parsed.timeSeriesByChannel : [],
    ageDistribution: Array.isArray(parsed.ageDistribution) ? parsed.ageDistribution : [],
    ageDistributionByChannel:
      parsed.ageDistributionByChannel && typeof parsed.ageDistributionByChannel === 'object'
        ? parsed.ageDistributionByChannel
        : {},
    genderDistribution: Array.isArray(parsed.genderDistribution) ? parsed.genderDistribution : [],
    genderDistributionByChannel:
      parsed.genderDistributionByChannel && typeof parsed.genderDistributionByChannel === 'object'
        ? parsed.genderDistributionByChannel
        : {},
    topGeos: Array.isArray(parsed.topGeos) ? parsed.topGeos : [],
    topGeosByChannel:
      parsed.topGeosByChannel && typeof parsed.topGeosByChannel === 'object'
        ? parsed.topGeosByChannel
        : {},
  }
}

const instagramSessionEncryptionKeyBuffer = instagramSessionEncryptionKey
  ? crypto.createHash('sha256').update(instagramSessionEncryptionKey).digest()
  : null

const encryptInstagramSessionPayload = (payload) => {
  if (!instagramSessionEncryptionKeyBuffer) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', instagramSessionEncryptionKeyBuffer, iv)
  const serialized = JSON.stringify(payload ?? [])
  const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

const decryptInstagramSessionPayload = (value) => {
  if (!instagramSessionEncryptionKeyBuffer || typeof value !== 'string') return []
  const parts = value.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') return []
  try {
    const iv = Buffer.from(parts[1], 'base64')
    const tag = Buffer.from(parts[2], 'base64')
    const ciphertext = Buffer.from(parts[3], 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', instagramSessionEncryptionKeyBuffer, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(plaintext)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const normalizeInstagramCookieList = (value) => {
  if (!Array.isArray(value)) return []
  const dedupedByKey = new Map()
  for (const entry of value.slice(0, 120)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const name = normalizeTextInput(entry.name, { maxLength: 120 })
    const cookieValue = normalizeTextInput(entry.value, { maxLength: 5000, trim: false })
    const domain = normalizeTextInput(entry.domain, { maxLength: 180 }).toLowerCase() || '.instagram.com'
    if (!name || !cookieValue || !domain) continue
    const pathValue = normalizeTextInput(entry.path, { maxLength: 120 }) || '/'
    const sameSiteRaw = normalizeTextInput(entry.sameSite, { maxLength: 24 }).toLowerCase()
    const sameSite = sameSiteRaw === 'strict' ? 'Strict' : sameSiteRaw === 'none' ? 'None' : 'Lax'
    const expires = Number.isFinite(Number(entry.expires)) ? Number(entry.expires) : -1
    const cookie = {
      name,
      value: cookieValue,
      domain,
      path: pathValue,
      expires,
      httpOnly: Boolean(entry.httpOnly),
      secure: Boolean(entry.secure),
      sameSite,
    }
    const dedupeKey = `${cookie.name}:${cookie.domain}:${cookie.path}`
    dedupedByKey.set(dedupeKey, cookie)
  }
  return [...dedupedByKey.values()]
}

const getInstagramStore = async () => {
  const store = await loadReportingStore()
  ensureInstagramReportingStore(store)
  return store.instagram
}

const upsertInstagramSessionVaultEntry = async ({ ownerUserId, accountId, accountName, cookies }) => {
  const vaultKey = buildInstagramVaultKey({ ownerUserId, accountId })
  if (!vaultKey) return { ok: false, status: 400, error: 'invalid_instagram_vault_key' }
  const normalizedCookies = normalizeInstagramCookieList(cookies)
  if (!normalizedCookies.length) return { ok: false, status: 400, error: 'invalid_instagram_session_cookies' }
  const encryptedCookies = encryptInstagramSessionPayload(normalizedCookies)
  if (!encryptedCookies) return { ok: false, status: 500, error: 'instagram_session_encryption_not_configured' }

  const instagramStore = await getInstagramStore()
  instagramStore.sessionVault[vaultKey] = {
    ownerUserId: normalizeTextInput(ownerUserId, { maxLength: 80 }),
    accountId: normalizeTextInput(accountId, { maxLength: 300 }).toLowerCase(),
    accountName: normalizeTextInput(accountName, { maxLength: 180 }) || normalizeTextInput(accountId, { maxLength: 180 }),
    encryptedCookies,
    updatedAt: new Date().toISOString(),
  }
  await persistReportingStore()
  return { ok: true, status: 200 }
}

const getInstagramSessionVaultCookies = async ({ ownerUserId, accountId }) => {
  const vaultKey = buildInstagramVaultKey({ ownerUserId, accountId })
  if (!vaultKey) return []
  const instagramStore = await getInstagramStore()
  const row = instagramStore.sessionVault[vaultKey]
  if (!row || typeof row !== 'object') return []
  return normalizeInstagramCookieList(decryptInstagramSessionPayload(row.encryptedCookies))
}

const deleteInstagramSessionVaultEntries = async (predicate) => {
  const instagramStore = await getInstagramStore()
  const keys = Object.keys(instagramStore.sessionVault || {})
  let removed = 0
  for (const key of keys) {
    const entry = instagramStore.sessionVault[key]
    if (!entry || typeof entry !== 'object') continue
    if (typeof predicate === 'function' && !predicate(entry, key)) continue
    delete instagramStore.sessionVault[key]
    removed += 1
  }
  if (removed > 0) {
    await persistReportingStore()
  }
  return removed
}

const xOauthEncryptionKeyBuffer = xOauthEncryptionKey
  ? crypto.createHash('sha256').update(xOauthEncryptionKey).digest()
  : null
const X_OAUTH_ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000

const encryptXOauthTokenValue = (value) => {
  if (!xOauthEncryptionKeyBuffer) return ''
  const normalizedValue = normalizeTextInput(value, { maxLength: 6000, trim: false })
  if (!normalizedValue) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', xOauthEncryptionKeyBuffer, iv)
  const ciphertext = Buffer.concat([cipher.update(normalizedValue, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

const decryptXOauthTokenValue = (value) => {
  if (!xOauthEncryptionKeyBuffer || typeof value !== 'string') return ''
  const parts = value.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    return normalizeTextInput(value, { maxLength: 6000, trim: false })
  }
  try {
    const iv = Buffer.from(parts[1], 'base64')
    const tag = Buffer.from(parts[2], 'base64')
    const ciphertext = Buffer.from(parts[3], 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', xOauthEncryptionKeyBuffer, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return plaintext
  } catch {
    return ''
  }
}

const normalizeXOauthTokenRecord = (value = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const accessToken = normalizeTextInput(value.accessToken, { maxLength: 6000, trim: false })
  const refreshToken = normalizeTextInput(value.refreshToken, { maxLength: 6000, trim: false })
  const expiresAt = Math.max(0, toNumber(value.expiresAt))
  const scope = normalizeTextInput(value.scope, { maxLength: 500 })
  const tokenType = normalizeTextInput(value.tokenType, { maxLength: 120 }).toLowerCase()
  const username = normalizeXUsername(value.username)
  const userId = normalizeXUserId(value.userId)
  if (!accessToken && !refreshToken) return null
  return {
    accessToken,
    refreshToken,
    expiresAt,
    scope,
    tokenType,
    username,
    userId,
  }
}

const getXOauthStorageRowByUserId = async (userId) => {
  const normalizedUserId = normalizeXUserId(userId)
  if (!normalizedUserId) return { ok: false, status: 400, row: null }
  const selectFields = encodeURIComponent(
    'user_id,username,follower_count,access_token,refresh_token,token_expires_at,connected_at',
  )
  const userFilter = encodeURIComponent(normalizedUserId)
  const query = `select=${selectFields}&user_id=eq.${userFilter}&limit=1`
  const result = await requestSupabaseTable('x', { query })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const mapXOauthTokenRow = (row) => {
  if (!row || typeof row !== 'object') return null
  const accessToken = decryptXOauthTokenValue(row.access_token)
  const refreshToken = decryptXOauthTokenValue(row.refresh_token)
  const expiresAt = row?.token_expires_at ? Date.parse(row.token_expires_at) : 0
  return normalizeXOauthTokenRecord({
    accessToken,
    refreshToken,
    expiresAt,
    username: normalizeXUsername(row.username),
    userId: normalizeXUserId(row.user_id),
  })
}

const upsertXOauthTokenVaultEntry = async ({
  ownerUserId,
  userId,
  username = '',
  accessToken = '',
  refreshToken = '',
  expiresAt = 0,
  scope = '',
  tokenType = '',
  connectedAt = '',
  followerCount,
}) => {
  const normalizedOwnerUserId = normalizeTextInput(ownerUserId, { maxLength: 80 })
  if (!isUuid(normalizedOwnerUserId)) return { ok: false, status: 400, error: 'invalid_x_oauth_vault_key' }
  const normalizedPayload = normalizeXOauthTokenRecord({
    userId,
    username,
    accessToken,
    refreshToken,
    expiresAt,
    scope,
    tokenType,
  })
  if (!normalizedPayload) return { ok: false, status: 400, error: 'invalid_x_oauth_token_payload' }
  if (!isSupabaseConfigured) return { ok: false, status: 503, error: 'x_storage_not_configured' }
  const encryptedAccessToken = encryptXOauthTokenValue(normalizedPayload.accessToken)
  const encryptedRefreshToken = encryptXOauthTokenValue(normalizedPayload.refreshToken)
  if (!encryptedAccessToken && !encryptedRefreshToken) {
    return { ok: false, status: 500, error: 'x_oauth_token_encryption_not_configured' }
  }
  const tokenExpiresAt = normalizedPayload.expiresAt
    ? new Date(normalizedPayload.expiresAt).toISOString()
    : null
  const normalizedConnectedAt = normalizeTextInput(connectedAt, { maxLength: 64 })
  const existingRowResult = await getXOauthStorageRowByUserId(normalizedPayload.userId)
  const basePayload = {
    user_id: normalizedPayload.userId,
    username: normalizedPayload.username || normalizeXUsername(username),
    access_token: encryptedAccessToken || null,
    refresh_token: encryptedRefreshToken || null,
    token_expires_at: tokenExpiresAt,
  }
  if (normalizedConnectedAt) {
    basePayload.connected_at = normalizedConnectedAt
  }

  if (existingRowResult.row) {
    const userFilter = encodeURIComponent(normalizedPayload.userId)
    const query = `user_id=eq.${userFilter}`
    const updateResult = await requestSupabaseTable('x', {
      method: 'PATCH',
      query,
      body: basePayload,
      prefer: 'return=representation',
    })
    if (!updateResult.ok) {
      return { ok: false, status: updateResult.status || 500, error: 'x_oauth_token_store_failed' }
    }
  } else {
    if (followerCount === undefined || followerCount === null) {
      return { ok: false, status: 400, error: 'x_oauth_token_store_missing_profile' }
    }
    const insertPayload = {
      ...basePayload,
      follower_count: Math.max(0, toNumber(followerCount)),
      connected_at: normalizedConnectedAt || new Date().toISOString(),
    }
    const insertResult = await requestSupabaseTable('x', {
      method: 'POST',
      query: 'on_conflict=user_id',
      body: [insertPayload],
      prefer: 'resolution=merge-duplicates,return=representation',
    })
    if (!insertResult.ok) {
      return { ok: false, status: insertResult.status || 500, error: 'x_oauth_token_store_failed' }
    }
  }
  return { ok: true, status: 200, token: normalizedPayload }
}

const getXOauthTokenVaultEntry = async ({ ownerUserId, userId }) => {
  const normalizedOwnerUserId = normalizeTextInput(ownerUserId, { maxLength: 80 })
  const normalizedUserId = normalizeXUserId(userId)
  if (!isUuid(normalizedOwnerUserId) || !normalizedUserId) return null
  const rowResult = await getXOauthStorageRowByUserId(normalizedUserId)
  if (!rowResult.ok || !rowResult.row) return null
  return mapXOauthTokenRow(rowResult.row)
}

const deleteXOauthTokenVaultEntries = async (predicate) => {
  if (typeof predicate !== 'function' || !isSupabaseConfigured) return 0
  const selectFields = encodeURIComponent(
    'user_id,username,access_token,refresh_token,token_expires_at,connected_at',
  )
  const query = `select=${selectFields}`
  const result = await requestSupabaseTable('x', { query })
  if (!result.ok || !Array.isArray(result.payload)) return 0
  let removed = 0
  for (const row of result.payload) {
    const tokenRecord = mapXOauthTokenRow(row)
    const entry = {
      ownerUserId: '',
      userId: normalizeXUserId(row?.user_id),
      username: normalizeXUsername(row?.username),
      accessToken: tokenRecord?.accessToken || '',
      refreshToken: tokenRecord?.refreshToken || '',
      tokenExpiresAt: row?.token_expires_at,
      connectedAt: row?.connected_at,
    }
    if (!predicate(entry, entry.userId)) continue
    const userFilter = encodeURIComponent(normalizeXUserId(row?.user_id))
    const updateResult = await requestSupabaseTable('x', {
      method: 'PATCH',
      query: `user_id=eq.${userFilter}`,
      body: { access_token: null, refresh_token: null, token_expires_at: null },
    })
    if (updateResult.ok) {
      removed += 1
    }
  }
  return removed
}

const refreshXOauthAccessToken = async ({
  refreshToken = '',
  fallbackScope = '',
} = {}) => {
  const normalizedRefreshToken = normalizeTextInput(refreshToken, { maxLength: 6000, trim: false })
  if (!normalizedRefreshToken) {
    return { ok: false, status: 400, error: 'x_oauth_refresh_token_missing', message: 'Missing X OAuth refresh token.' }
  }
  if (!xOauthClientId) {
    return { ok: false, status: 503, error: 'x_oauth_client_not_configured', message: 'X OAuth client is not configured.' }
  }
  const tokenRequestUrls = resolveXOauthTokenUrls()
  if (!tokenRequestUrls.length) {
    return { ok: false, status: 500, error: 'x_oauth_token_endpoint_not_configured', message: 'X OAuth token endpoint is not configured.' }
  }

  const tokenParams = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: normalizedRefreshToken,
    client_id: xOauthClientId,
  })
  const tokenHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (xOauthClientSecret) {
    tokenHeaders.Authorization = `Basic ${Buffer.from(`${xOauthClientId}:${xOauthClientSecret}`).toString('base64')}`
  }

  let tokenErrorMessage = ''
  for (const tokenUrl of tokenRequestUrls) {
    try {
      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: tokenHeaders,
        body: tokenParams.toString(),
      })
      const tokenPayload = await tokenResponse.json().catch(() => ({}))
      const accessToken = normalizeTextInput(tokenPayload?.access_token, { maxLength: 6000, trim: false })
      if (tokenResponse.ok && accessToken) {
        const nextRefreshToken = normalizeTextInput(tokenPayload?.refresh_token, { maxLength: 6000, trim: false })
          || normalizedRefreshToken
        const expiresInSeconds = Math.max(0, toNumber(tokenPayload?.expires_in))
        const expiresAt = expiresInSeconds > 0 ? Date.now() + expiresInSeconds * 1000 : 0
        const scope = normalizeTextInput(tokenPayload?.scope, { maxLength: 500 }) || normalizeTextInput(fallbackScope, { maxLength: 500 })
        const tokenType = normalizeTextInput(tokenPayload?.token_type, { maxLength: 120 }).toLowerCase()
        return {
          ok: true,
          status: 200,
          accessToken,
          refreshToken: nextRefreshToken,
          expiresAt,
          scope,
          tokenType,
        }
      }
      tokenErrorMessage =
        normalizeTextInput(tokenPayload?.error_description, { maxLength: 240 })
        || normalizeTextInput(tokenPayload?.error, { maxLength: 240 })
        || normalizeTextInput(tokenPayload?.detail, { maxLength: 240 })
        || tokenErrorMessage
    } catch (error) {
      tokenErrorMessage = error instanceof Error ? normalizeTextInput(error.message, { maxLength: 240 }) : tokenErrorMessage
    }
  }
  return {
    ok: false,
    status: 401,
    error: 'x_oauth_refresh_failed',
    message: tokenErrorMessage || 'Unable to refresh X OAuth token.',
  }
}

const ensureValidXOauthAccessToken = async ({ ownerUserId = '', userId = '' } = {}) => {
  const normalizedOwnerUserId = normalizeTextInput(ownerUserId, { maxLength: 80 })
  const normalizedUserId = normalizeXUserId(userId)
  if (!isUuid(normalizedOwnerUserId) || !normalizedUserId) {
    return { ok: false, status: 400, error: 'invalid_x_oauth_token_lookup', message: 'Missing X OAuth token identity.' }
  }

  const existing = await getXOauthTokenVaultEntry({
    ownerUserId: normalizedOwnerUserId,
    userId: normalizedUserId,
  })
  if (!existing) {
    return { ok: false, status: 404, error: 'x_oauth_token_not_found', message: 'No stored X OAuth token for this account.' }
  }

  const shouldRefresh =
    !existing.accessToken
    || (existing.expiresAt && Date.now() >= existing.expiresAt - X_OAUTH_ACCESS_TOKEN_EXPIRY_SKEW_MS)
  if (!shouldRefresh && existing.accessToken) {
    return { ok: true, status: 200, accessToken: existing.accessToken, token: existing }
  }
  if (!existing.refreshToken) {
    return { ok: false, status: 401, error: 'x_oauth_refresh_token_missing', message: 'X OAuth token expired and cannot be refreshed.' }
  }

  const refreshed = await refreshXOauthAccessToken({
    refreshToken: existing.refreshToken,
    fallbackScope: existing.scope,
  })
  if (!refreshed.ok || !refreshed.accessToken) {
    return {
      ok: false,
      status: refreshed.status || 401,
      error: refreshed.error || 'x_oauth_refresh_failed',
      message: refreshed.message || 'Unable to refresh X OAuth token.',
    }
  }

  const upsertResult = await upsertXOauthTokenVaultEntry({
    ownerUserId: normalizedOwnerUserId,
    userId: normalizedUserId,
    username: existing.username,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken || existing.refreshToken,
    expiresAt: refreshed.expiresAt,
    scope: refreshed.scope || existing.scope,
    tokenType: refreshed.tokenType || existing.tokenType,
  })
  if (!upsertResult.ok || !upsertResult.token?.accessToken) {
    return { ok: false, status: 500, error: 'x_oauth_token_store_failed', message: 'Unable to persist refreshed X OAuth token.' }
  }

  return { ok: true, status: 200, accessToken: upsertResult.token.accessToken, token: upsertResult.token }
}

const getCachedInstagramSummaryByUserId = async (userId) => {
  const normalizedUserId = normalizeTextInput(userId, { maxLength: 80 })
  if (!isUuid(normalizedUserId)) return { ok: false, status: 400, row: null, payload: null }
  const userFilter = encodeURIComponent(normalizedUserId)
  const selectFields = encodeURIComponent('id,user_id,summary_json,generated_at,refresh_job_id')
  const query = `select=${selectFields}&user_id=eq.${userFilter}&limit=1`
  const result = await requestSupabaseTable('instagram_cached_summaries', { query })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const upsertCachedInstagramSummary = async ({ userId, summary, generatedAt, refreshJobId = null }) => {
  const normalizedUserId = normalizeTextInput(userId, { maxLength: 80 })
  if (!isUuid(normalizedUserId)) return { ok: false, status: 400, row: null, payload: null }
  const normalizedSummary = normalizeCachedInstagramSummaryPayload(summary)
  const result = await requestSupabaseTable('instagram_cached_summaries', {
    method: 'POST',
    query: 'on_conflict=user_id',
    body: [
      {
        user_id: normalizedUserId,
        summary_json: normalizedSummary,
        generated_at: normalizeTextInput(generatedAt, { maxLength: 64 }) || new Date().toISOString(),
        refresh_job_id: isUuid(refreshJobId) ? refreshJobId : null,
      },
    ],
    prefer: 'resolution=merge-duplicates,return=representation',
  })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const deleteCachedInstagramSummaryByUserId = async (userId) => {
  const normalizedUserId = normalizeTextInput(userId, { maxLength: 80 })
  if (!isUuid(normalizedUserId)) return { ok: false, status: 400 }
  const userFilter = encodeURIComponent(normalizedUserId)
  const query = `user_id=eq.${userFilter}`
  return requestSupabaseTable('instagram_cached_summaries', { method: 'DELETE', query })
}

const insertInstagramRefreshJob = async (job) => {
  const result = await requestSupabaseTable('instagram_refresh_jobs', {
    method: 'POST',
    body: [job],
    prefer: 'return=representation',
  })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const updateInstagramRefreshJob = async (userId, jobId, payload) => {
  const normalizedUserId = normalizeTextInput(userId, { maxLength: 80 })
  const normalizedJobId = normalizeTextInput(jobId, { maxLength: 80 })
  if (!isUuid(normalizedUserId) || !isUuid(normalizedJobId)) {
    return { ok: false, status: 400, row: null, payload: null }
  }
  const userFilter = encodeURIComponent(normalizedUserId)
  const jobFilter = encodeURIComponent(normalizedJobId)
  const query = `user_id=eq.${userFilter}&id=eq.${jobFilter}`
  const result = await requestSupabaseTable('instagram_refresh_jobs', {
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

const getInstagramRefreshJob = async (userId, jobId) => {
  const normalizedUserId = normalizeTextInput(userId, { maxLength: 80 })
  const normalizedJobId = normalizeTextInput(jobId, { maxLength: 80 })
  if (!isUuid(normalizedUserId) || !isUuid(normalizedJobId)) {
    return { ok: false, status: 400, row: null, payload: null }
  }
  const userFilter = encodeURIComponent(normalizedUserId)
  const jobFilter = encodeURIComponent(normalizedJobId)
  const selectFields = encodeURIComponent(
    'id,user_id,status,requested_at,started_at,finished_at,error_message,channels_total,channels_processed,meta',
  )
  const query = `select=${selectFields}&user_id=eq.${userFilter}&id=eq.${jobFilter}&limit=1`
  const result = await requestSupabaseTable('instagram_refresh_jobs', { query })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const getLatestInstagramRefreshJobByUserId = async (userId) => {
  const normalizedUserId = normalizeTextInput(userId, { maxLength: 80 })
  if (!isUuid(normalizedUserId)) return { ok: false, status: 400, row: null, payload: null }
  const userFilter = encodeURIComponent(normalizedUserId)
  const selectFields = encodeURIComponent(
    'id,user_id,status,requested_at,started_at,finished_at,error_message,channels_total,channels_processed,meta',
  )
  const query = `select=${selectFields}&user_id=eq.${userFilter}&order=requested_at.desc&limit=1`
  const result = await requestSupabaseTable('instagram_refresh_jobs', { query })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const getInstagramRefreshJobQueueStats = async () => {
  const selectFields = encodeURIComponent('status')
  const statusFilter = encodeURIComponent('in.(queued,running)')
  const query = `select=${selectFields}&status=${statusFilter}`
  const result = await requestSupabaseTable('instagram_refresh_jobs', { query })
  if (!result.ok || !Array.isArray(result.payload)) {
    return { runningJobs: 0, queuedJobs: 0 }
  }
  let runningJobs = 0
  let queuedJobs = 0
  for (const entry of result.payload) {
    const status = normalizeTextInput(entry?.status, { maxLength: 32 })
    if (status === 'running') runningJobs += 1
    if (status === 'queued') queuedJobs += 1
  }
  return { runningJobs, queuedJobs }
}

const listAccessibleInstagramConnectionsByUserId = async (userId) => {
  const normalizedUserId = normalizeTextInput(userId, { maxLength: 80 })
  if (!isUuid(normalizedUserId)) return { ok: false, status: 400, connections: [] }
  const organizationsResult = await listOrganizationRows()
  if (!organizationsResult.ok) {
    return {
      ok: false,
      status: organizationsResult.status || 500,
      error: 'organizations_read_failed',
      connections: [],
    }
  }
  const connectionByKey = new Map()
  for (const row of organizationsResult.rows) {
    if (!canUserAccessOrganizationChannels(row, normalizedUserId)) continue
    const organizationId = normalizeTextInput(row?.id, { maxLength: 80 })
    const fallbackOwnerUserId = normalizeTextInput(row?.creator, { maxLength: 80 })
    const accounts = normalizeOrganizationConnectedAccounts(row?.connected_accounts)
    for (const account of accounts) {
      if (normalizeOrganizationConnectionPlatform(account.platform) !== ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM) continue
      const accountId = resolveInstagramAccountId(account)
      if (!accountId) continue
      const accountName = normalizeTextInput(account.accountName, { maxLength: 180 }) || accountId
      const ownerUserIdRaw = normalizeTextInput(account.ownerUserId, { maxLength: 80 })
      const ownerUserId =
        isUuid(ownerUserIdRaw) ? ownerUserIdRaw : isUuid(fallbackOwnerUserId) ? fallbackOwnerUserId : ''
      if (!isUuid(ownerUserId)) continue
      const key = `${ownerUserId}:${accountId}`
      if (connectionByKey.has(key)) continue
      connectionByKey.set(key, {
        accountId,
        accountName,
        ownerUserId,
        organizationId: isUuid(organizationId) ? organizationId : undefined,
      })
    }
  }
  return { ok: true, status: 200, connections: [...connectionByKey.values()] }
}

const listAccessibleXConnectionsByUserId = async (userId, options = {}) => {
  const accessScope = options?.accessScope === 'view' ? 'view' : 'manage'
  const normalizedUserId = normalizeTextInput(userId, { maxLength: 80 })
  if (!isUuid(normalizedUserId)) return { ok: false, status: 400, connections: [] }
  const organizationsResult = await listOrganizationRows()
  if (!organizationsResult.ok) {
    return {
      ok: false,
      status: organizationsResult.status || 500,
      error: 'organizations_read_failed',
      connections: [],
    }
  }
  const connectionByUserId = new Map()
  const unresolvedConnectionsByUsername = new Map()
  for (const row of organizationsResult.rows) {
    const canAccessChannels = accessScope === 'view'
      ? canUserSeeOrganization(row, normalizedUserId)
      : canUserAccessOrganizationChannels(row, normalizedUserId)
    if (!canAccessChannels) continue
    const organizationId = normalizeTextInput(row?.id, { maxLength: 80 })
    const fallbackOwnerUserId = normalizeTextInput(row?.creator, { maxLength: 80 })
    const accounts = normalizeOrganizationConnectedAccounts(row?.connected_accounts)
    for (const account of accounts) {
      if (normalizeOrganizationConnectionPlatform(account.platform) !== ORGANIZATION_CONNECTION_PLATFORM_X) continue
      const xUserId = resolveXUserIdFromConnection(account)
      const ownerUserIdRaw = normalizeTextInput(account.ownerUserId, { maxLength: 80 })
      const ownerUserId =
        isUuid(ownerUserIdRaw) ? ownerUserIdRaw : isUuid(fallbackOwnerUserId) ? fallbackOwnerUserId : ''
      if (!isUuid(ownerUserId)) continue
      const accountName =
        normalizeTextInput(account.accountName, { maxLength: 180 }) || (xUserId ? `X Account ${xUserId}` : 'X Account')
      if (xUserId) {
        if (connectionByUserId.has(xUserId)) continue
        connectionByUserId.set(xUserId, {
          userId: xUserId,
          accountName,
          ownerUserId,
          organizationId: isUuid(organizationId) ? organizationId : undefined,
        })
        continue
      }
      const connectionUsername = resolveXUsernameFromConnection(account)
      if (!isValidXUsername(connectionUsername) || unresolvedConnectionsByUsername.has(connectionUsername)) continue
      unresolvedConnectionsByUsername.set(connectionUsername, {
        username: connectionUsername,
        accountName,
        ownerUserId,
        organizationId: isUuid(organizationId) ? organizationId : undefined,
      })
    }
  }
  if (unresolvedConnectionsByUsername.size > 0) {
    const xRowsResult = await listXRowsByUsernames([...unresolvedConnectionsByUsername.keys()])
    if (xRowsResult.ok) {
      for (const row of xRowsResult.rows) {
        const xUserId = resolveXUserIdFromStoredPostsPayload(row?.posts) || normalizeXUserId(row?.user_id)
        const username = normalizeXUsername(row?.username)
        if (!xUserId || !username || connectionByUserId.has(xUserId)) continue
        const unresolved = unresolvedConnectionsByUsername.get(username)
        if (!unresolved) continue
        connectionByUserId.set(xUserId, {
          userId: xUserId,
          accountName: unresolved.accountName || formatXAccountName(username) || `X Account ${xUserId}`,
          ownerUserId: unresolved.ownerUserId,
          organizationId: unresolved.organizationId,
        })
        unresolvedConnectionsByUsername.delete(username)
      }
    }
    for (const [username, unresolved] of unresolvedConnectionsByUsername.entries()) {
      const lookupResult = await fetchXUserByUsername(username)
      if (!lookupResult.ok || !lookupResult.user) continue
      const xUserId = normalizeXUserId(lookupResult.user.userId)
      const resolvedUsername = normalizeXUsername(lookupResult.user.username) || username
      if (!xUserId || connectionByUserId.has(xUserId)) continue
      connectionByUserId.set(xUserId, {
        userId: xUserId,
        accountName:
          unresolved.accountName || formatXAccountName(resolvedUsername) || `X Account ${xUserId}`,
        ownerUserId: unresolved.ownerUserId,
        organizationId: unresolved.organizationId,
      })
      unresolvedConnectionsByUsername.delete(username)
    }
  }
  return { ok: true, status: 200, connections: [...connectionByUserId.values()] }
}

const buildXApiEndpoints = (pathWithQuery = '') => {
  const normalizedPathInput = normalizeTextInput(pathWithQuery, { maxLength: 2000, trim: false })
  const normalizedPath = normalizedPathInput.startsWith('/') ? normalizedPathInput : `/${normalizedPathInput}`
  const endpoints = []
  if (xApiBaseUrl) endpoints.push(`${xApiBaseUrl}${normalizedPath}`)
  if (xApiFallbackBaseUrl && xApiFallbackBaseUrl !== xApiBaseUrl) {
    endpoints.push(`${xApiFallbackBaseUrl}${normalizedPath}`)
  }
  return endpoints
}

const extractXApiErrorMessage = (payload) => {
  const detail = normalizeTextInput(payload?.detail, { maxLength: 240 })
  if (detail) return detail
  const title = normalizeTextInput(payload?.title, { maxLength: 240 })
  if (title) return title
  const rawError = normalizeTextInput(payload?.error, { maxLength: 240 })
  if (rawError) return rawError
  if (Array.isArray(payload?.errors)) {
    for (const entry of payload.errors) {
      const message = normalizeTextInput(entry?.message, { maxLength: 240 })
      if (message) return message
    }
  }
  return ''
}

const requestXApi = async (pathWithQuery, options = {}) => {
  if (!xCollectionEnabled || !xBearerToken) {
    return {
      ok: false,
      status: 503,
      payload: null,
      error: 'x_not_configured',
      message: 'X integration is not configured.',
    }
  }
  const method = normalizeTextInput(options.method, { maxLength: 12 }).toUpperCase() || 'GET'
  const endpoints = buildXApiEndpoints(pathWithQuery)
  if (!endpoints.length) {
    return {
      ok: false,
      status: 500,
      payload: null,
      error: 'x_endpoint_not_configured',
    }
  }
  let lastFailure = {
    ok: false,
    status: 500,
    payload: null,
    error: 'x_request_failed',
    message: '',
  }
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${xBearerToken}`,
          'Content-Type': 'application/json',
        },
      })
      const payload = await response.json().catch(() => null)
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          payload,
        }
      }
      lastFailure = {
        ok: false,
        status: response.status,
        payload,
        error: 'x_api_request_failed',
        message: extractXApiErrorMessage(payload),
      }
    } catch (error) {
      lastFailure = {
        ok: false,
        status: 500,
        payload: null,
        error: 'x_api_request_failed',
        message: error instanceof Error ? normalizeTextInput(error.message, { maxLength: 240 }) : '',
      }
    }
  }
  return lastFailure
}

const requestXApiWithAccessToken = async (pathWithQuery, accessToken, options = {}) => {
  const normalizedAccessToken = normalizeTextInput(accessToken, { maxLength: 5000, trim: true })
  if (!normalizedAccessToken) {
    return {
      ok: false,
      status: 401,
      payload: null,
      error: 'x_access_token_missing',
      message: 'Missing X OAuth access token.',
    }
  }
  const method = normalizeTextInput(options.method, { maxLength: 12 }).toUpperCase() || 'GET'
  const endpoints = buildXApiEndpoints(pathWithQuery)
  if (!endpoints.length) {
    return {
      ok: false,
      status: 500,
      payload: null,
      error: 'x_endpoint_not_configured',
    }
  }
  let lastFailure = {
    ok: false,
    status: 500,
    payload: null,
    error: 'x_request_failed',
    message: '',
  }
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${normalizedAccessToken}`,
          'Content-Type': 'application/json',
        },
      })
      const payload = await response.json().catch(() => null)
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          payload,
        }
      }
      lastFailure = {
        ok: false,
        status: response.status,
        payload,
        error: 'x_api_request_failed',
        message: extractXApiErrorMessage(payload),
      }
    } catch (error) {
      lastFailure = {
        ok: false,
        status: 500,
        payload: null,
        error: 'x_api_request_failed',
        message: error instanceof Error ? normalizeTextInput(error.message, { maxLength: 240 }) : '',
      }
    }
  }
  return lastFailure
}

const fetchXAuthenticatedUser = async (accessToken) => {
  const userFields = encodeURIComponent('public_metrics,username,name')
  const result = await requestXApiWithAccessToken(`/users/me?user.fields=${userFields}`, accessToken)
  if (!result.ok) {
    return {
      ...result,
      user: null,
    }
  }
  const data = result.payload?.data
  const userId = normalizeXUserId(data?.id)
  const username = normalizeXUsername(data?.username)
  const followerCount = Math.max(0, toNumber(data?.public_metrics?.followers_count))
  if (!userId || !username) {
    return {
      ok: false,
      status: 502,
      error: 'x_user_lookup_invalid_response',
      payload: result.payload,
      user: null,
    }
  }
  return {
    ok: true,
    status: 200,
    payload: result.payload,
    user: {
      userId,
      username,
      followerCount,
    },
  }
}

const fetchXUserByUsername = async (usernameInput) => {
  const normalizedUsername = normalizeXUsername(usernameInput)
  if (!isValidXUsername(normalizedUsername)) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_x_username',
      payload: null,
      user: null,
    }
  }
  const fields = encodeURIComponent('public_metrics,username')
  const usernameFilter = encodeURIComponent(normalizedUsername)
  const path = `/users/by/username/${usernameFilter}?user.fields=${fields}`
  const result = await requestXApi(path)
  if (!result.ok) {
    return {
      ...result,
      user: null,
    }
  }
  const data = result.payload?.data
  const userId = normalizeXUserId(data?.id)
  const username = normalizeXUsername(data?.username) || normalizedUsername
  const followerCount = Math.max(0, toNumber(data?.public_metrics?.followers_count))
  if (!userId || !username) {
    return {
      ok: false,
      status: 502,
      error: 'x_user_lookup_invalid_response',
      payload: result.payload,
      user: null,
    }
  }
  return {
    ok: true,
    status: 200,
    payload: result.payload,
    user: {
      userId,
      username,
      followerCount,
    },
  }
}

const fetchXUserById = async (userIdInput, options = {}) => {
  const userId = normalizeXUserId(userIdInput)
  if (!userId) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_x_user_id',
      payload: null,
      user: null,
    }
  }
  const fields = encodeURIComponent('public_metrics,username')
  const userFilter = encodeURIComponent(userId)
  const path = `/users/${userFilter}?user.fields=${fields}`
  const accessToken = normalizeTextInput(options.accessToken, { maxLength: 6000, trim: false })
  const result = accessToken
    ? await requestXApiWithAccessToken(path, accessToken)
    : await requestXApi(path)
  if (!result.ok) {
    return {
      ...result,
      user: null,
    }
  }
  const data = result.payload?.data
  const username = normalizeXUsername(data?.username)
  const followerCount = Math.max(0, toNumber(data?.public_metrics?.followers_count))
  if (!username) {
    return {
      ok: false,
      status: 502,
      error: 'x_user_lookup_invalid_response',
      payload: result.payload,
      user: null,
    }
  }
  return {
    ok: true,
    status: 200,
    payload: result.payload,
    user: {
      userId,
      username,
      followerCount,
    },
  }
}

const normalizeXStoredPost = (value, options = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value
  const fallbackId = normalizeTextInput(options.fallbackId, { maxLength: 300 })
  const id = (
    normalizeTextInput(source.id, { maxLength: 300 })
    || normalizeTextInput(source.postId, { maxLength: 300 })
    || normalizeTextInput(source.post_id, { maxLength: 300 })
    || normalizeTextInput(source.tweetId, { maxLength: 300 })
    || normalizeTextInput(source.tweet_id, { maxLength: 300 })
    || fallbackId
  )
    .replace(/^x:/i, '')
    .replace(/[^0-9A-Za-z_-]/g, '')
  if (!id) return null
  const userId = normalizeXUserId(source.userId || options.userId)
  const username = normalizeXUsername(source.username || options.username)
  const title = normalizeTextInput(source.title ?? source.text, { maxLength: 300, trim: false }) || 'Untitled X post'
  const text = normalizeTextInput(source.text ?? source.title, { maxLength: 2000, trim: false })
  const createdAt = normalizeTextInput(
    source.createdAt ?? source.created_at ?? source.publishedAt,
    { maxLength: 64 },
  )
  const publicMetrics = source.publicMetrics && typeof source.publicMetrics === 'object' && !Array.isArray(source.publicMetrics)
    ? source.publicMetrics
    : source.public_metrics && typeof source.public_metrics === 'object' && !Array.isArray(source.public_metrics)
      ? source.public_metrics
      : {}
  const nonPublicMetrics = source.nonPublicMetrics && typeof source.nonPublicMetrics === 'object' && !Array.isArray(source.nonPublicMetrics)
    ? source.nonPublicMetrics
    : source.non_public_metrics && typeof source.non_public_metrics === 'object' && !Array.isArray(source.non_public_metrics)
      ? source.non_public_metrics
      : {}
  const likes = Math.max(0, toNumber(source.likes ?? publicMetrics.like_count))
  const replies = Math.max(0, toNumber(source.replies ?? source.comments ?? publicMetrics.reply_count))
  const retweets = Math.max(0, toNumber(source.retweets ?? source.reposts ?? source.shares ?? publicMetrics.retweet_count))
  const quotes = Math.max(0, toNumber(source.quotes ?? publicMetrics.quote_count))
  const bookmarks = Math.max(0, toNumber(source.bookmarks ?? publicMetrics.bookmark_count))
  const views = Math.max(
    0,
    toNumber(
      source.views
      ?? source.impressionCount
      ?? nonPublicMetrics.impression_count
      ?? publicMetrics.impression_count,
    ),
  )
  const engagements = Math.max(
    0,
    toNumber(source.engagements ?? likes + replies + retweets + quotes + bookmarks),
  )
  const engagementRate = views > 0
    ? (engagements / views) * 100
    : Math.max(0, toNumber(source.engagementRate))
  const url = normalizeTextInput(source.url, { maxLength: 500 })
    || (username ? `https://x.com/${username}/status/${id}` : '')

  return {
    id,
    userId,
    username,
    title,
    text,
    createdAt,
    url,
    views,
    likes,
    replies,
    retweets,
    quotes,
    bookmarks,
    engagements,
    engagementRate,
    publicMetrics: {
      likeCount: likes,
      replyCount: replies,
      retweetCount: retweets,
      quoteCount: quotes,
      bookmarkCount: bookmarks,
      impressionCount: Math.max(0, toNumber(publicMetrics.impression_count)),
    },
    nonPublicMetrics: {
      impressionCount: Math.max(0, toNumber(nonPublicMetrics.impression_count)),
      userProfileClicks: Math.max(0, toNumber(nonPublicMetrics.user_profile_clicks)),
      urlLinkClicks: Math.max(0, toNumber(nonPublicMetrics.url_link_clicks)),
    },
  }
}

const normalizeXStoredPosts = (value, options = {}) => {
  const sourceEntries = Array.isArray(value)
    ? value.map((entry) => ({ entry, fallbackId: '' }))
    : value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value).map(([key, entry]) => ({ entry, fallbackId: key }))
      : []
  if (!sourceEntries.length) return []
  const postsById = new Map()
  for (const sourceEntry of sourceEntries.slice(0, xCollectorMaxPosts)) {
    const normalized = normalizeXStoredPost(sourceEntry.entry, {
      ...options,
      fallbackId: sourceEntry.fallbackId,
    })
    if (!normalized) continue
    postsById.set(normalized.id, normalized)
  }
  return [...postsById.values()]
}

const buildXStoredPostsObject = (value, options = {}) => {
  const normalizedPosts = normalizeXStoredPosts(value, options)
  const postsById = {}
  for (const post of normalizedPosts) {
    postsById[post.id] = post
  }
  return postsById
}

const fetchXPostsByUserId = async (
  userIdInput,
  { maxResults = xCollectorMaxPosts, username = '', accessToken = '' } = {},
) => {
  const userId = normalizeXUserId(userIdInput)
  if (!userId) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_x_user_id',
      payload: null,
      posts: [],
    }
  }
  const safeMaxResults = Math.max(5, Math.min(100, Number(maxResults) || xCollectorMaxPosts))
  const userFilter = encodeURIComponent(userId)
  const buildBaseParams = () => new URLSearchParams({
    max_results: String(safeMaxResults),
    exclude: 'retweets,replies',
  })
  const attempts = []
  const postsParams = buildBaseParams()
  postsParams.set('post.fields', 'created_at,public_metrics,text')
  attempts.push(`/users/${userFilter}/posts?${postsParams.toString()}`)
  const tweetsParams = buildBaseParams()
  tweetsParams.set('tweet.fields', 'created_at,public_metrics,text')
  attempts.push(`/users/${userFilter}/tweets?${tweetsParams.toString()}`)

  let result = { ok: false, status: 500, payload: null, error: 'x_posts_lookup_failed' }
  const normalizedAccessToken = normalizeTextInput(accessToken, { maxLength: 6000, trim: false })
  for (const path of attempts) {
    result = normalizedAccessToken
      ? await requestXApiWithAccessToken(path, normalizedAccessToken)
      : await requestXApi(path)
    if (result.ok) break
  }
  if (!result.ok) {
    return {
      ...result,
      posts: [],
    }
  }
  const rows = Array.isArray(result.payload?.data) ? result.payload.data : []
  const normalizedPosts = normalizeXStoredPosts(rows, { userId, username })
  return {
    ok: true,
    status: 200,
    payload: result.payload,
    posts: normalizedPosts,
  }
}

const listXRowsByUserIds = async (userIds = []) => {
  const normalizedUserIds = uniqueValues(
    (Array.isArray(userIds) ? userIds : [])
      .map((entry) => normalizeXUserId(entry))
      .filter((entry) => Boolean(entry)),
  )
  if (!normalizedUserIds.length) {
    return { ok: true, status: 200, payload: [], rows: [] }
  }
  const selectFields = encodeURIComponent('id,created_at,user_id,username,follower_count,posts')
  const idsFilter = encodeURIComponent(`in.(${normalizedUserIds.join(',')})`)
  const query = `select=${selectFields}&user_id=${idsFilter}`
  const result = await requestSupabaseTable('x', { query })
  return {
    ...result,
    rows: Array.isArray(result.payload) ? result.payload : [],
  }
}

const listXRowsByUsernames = async (usernames = []) => {
  const normalizedUsernames = uniqueValues(
    (Array.isArray(usernames) ? usernames : [])
      .map((entry) => normalizeXUsername(entry))
      .filter((entry) => Boolean(entry)),
  )
  if (!normalizedUsernames.length) {
    return { ok: true, status: 200, payload: [], rows: [] }
  }
  const selectFields = encodeURIComponent('id,created_at,user_id,username,follower_count,posts')
  const usernamesFilter = encodeURIComponent(`in.(${normalizedUsernames.join(',')})`)
  const query = `select=${selectFields}&username=${usernamesFilter}`
  const result = await requestSupabaseTable('x', { query })
  return {
    ...result,
    rows: Array.isArray(result.payload) ? result.payload : [],
  }
}

const upsertXRow = async ({ userId, username, followerCount, posts }) => {
  const normalizedUserId = normalizeXUserId(userId)
  const normalizedUsername = normalizeXUsername(username)
  if (!normalizedUserId || !normalizedUsername) {
    return { ok: false, status: 400, payload: null, row: null }
  }
  const refreshedAt = new Date().toISOString()
  const normalizedPosts = buildXStoredPostsObject(posts, {
    userId: normalizedUserId,
    username: normalizedUsername,
  })
  const result = await requestSupabaseTable('x', {
    method: 'POST',
    query: 'on_conflict=user_id',
    body: [
      {
        user_id: normalizedUserId,
        username: normalizedUsername,
        follower_count: Math.max(0, toNumber(followerCount)),
        posts: normalizedPosts,
        updated_at: refreshedAt,
      },
    ],
    prefer: 'resolution=merge-duplicates,return=representation',
  })
  return {
    ...result,
    row: Array.isArray(result.payload) ? result.payload[0] ?? null : null,
  }
}

const refreshAndPersistXAccount = async ({
  userId,
  username = '',
  fallbackFollowerCount = 0,
  ownerUserId = '',
  accessToken = '',
}) => {
  if (!xCollectionEnabled) {
    return {
      ok: false,
      status: 410,
      error: 'x_collection_disabled',
      payload: null,
      message: 'X collection is disabled.',
    }
  }
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      status: 503,
      error: 'x_storage_not_configured',
      payload: null,
      message: 'X storage is not configured.',
    }
  }
  const normalizedUserId = normalizeXUserId(userId)
  if (!normalizedUserId) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_x_user_id',
      payload: null,
      message: 'X user id is invalid.',
    }
  }

  const normalizedOwnerUserId = normalizeTextInput(ownerUserId, { maxLength: 80 })
  const hasOwnerUserId = isUuid(normalizedOwnerUserId)
  let oauthAccessToken = normalizeTextInput(accessToken, { maxLength: 6000, trim: false })
  if (!oauthAccessToken && hasOwnerUserId) {
    const oauthTokenResult = await ensureValidXOauthAccessToken({
      ownerUserId: normalizedOwnerUserId,
      userId: normalizedUserId,
    })
    if (oauthTokenResult.ok && oauthTokenResult.accessToken) {
      oauthAccessToken = oauthTokenResult.accessToken
    } else if (!xBearerToken) {
      return {
        ok: false,
        status: oauthTokenResult.status || 401,
        error: oauthTokenResult.error || 'x_oauth_token_not_found',
        payload: null,
        message: oauthTokenResult.message || 'No valid OAuth token found for this X account.',
      }
    }
  }

  const maybeRefreshOAuthTokenOnUnauthorized = async (currentAccessToken = '') => {
    if (!hasOwnerUserId) return currentAccessToken
    const existing = await getXOauthTokenVaultEntry({
      ownerUserId: normalizedOwnerUserId,
      userId: normalizedUserId,
    })
    if (!existing?.refreshToken) return currentAccessToken
    const refreshed = await refreshXOauthAccessToken({
      refreshToken: existing.refreshToken,
      fallbackScope: existing.scope,
    })
    if (!refreshed.ok || !refreshed.accessToken) return currentAccessToken
    const upsertResult = await upsertXOauthTokenVaultEntry({
      ownerUserId: normalizedOwnerUserId,
      userId: normalizedUserId,
      username: existing.username || normalizeXUsername(username),
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || existing.refreshToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope || existing.scope,
      tokenType: refreshed.tokenType || existing.tokenType,
    })
    if (!upsertResult.ok || !upsertResult.token?.accessToken) return currentAccessToken
    return upsertResult.token.accessToken
  }

  const normalizedFallbackUsername = normalizeXUsername(username)
  let userResult = await fetchXUserById(normalizedUserId, { accessToken: oauthAccessToken })
  if (!userResult.ok && oauthAccessToken && userResult.status === 401) {
    oauthAccessToken = await maybeRefreshOAuthTokenOnUnauthorized(oauthAccessToken)
    userResult = await fetchXUserById(normalizedUserId, { accessToken: oauthAccessToken })
  }
  if (!userResult.ok && !oauthAccessToken && xBearerToken) {
    userResult = await fetchXUserById(normalizedUserId)
  }

  const resolvedUsername = userResult.ok && userResult.user?.username
    ? userResult.user.username
    : normalizedFallbackUsername
  const resolvedFollowerCount = userResult.ok && userResult.user
    ? userResult.user.followerCount
    : Math.max(0, toNumber(fallbackFollowerCount))
  if (!resolvedUsername) {
    const isUnauthorizedLookup = Number(userResult.status) === 401 || Number(userResult.status) === 403
    return {
      ok: false,
      status: 502,
      error: 'x_user_lookup_failed',
      payload: userResult.payload ?? null,
      message: isUnauthorizedLookup
        ? 'Unauthorized while reading X profile. Reconnect this X account to grant users.read.'
        : normalizeTextInput(userResult.message, { maxLength: 240 }) || 'Unable to resolve X user profile.',
    }
  }

  let postsResult = await fetchXPostsByUserId(normalizedUserId, {
    maxResults: xCollectorMaxPosts,
    username: resolvedUsername,
    accessToken: oauthAccessToken,
  })
  if (!postsResult.ok && oauthAccessToken && postsResult.status === 401) {
    oauthAccessToken = await maybeRefreshOAuthTokenOnUnauthorized(oauthAccessToken)
    postsResult = await fetchXPostsByUserId(normalizedUserId, {
      maxResults: xCollectorMaxPosts,
      username: resolvedUsername,
      accessToken: oauthAccessToken,
    })
  }
  if (!postsResult.ok && !oauthAccessToken && xBearerToken) {
    postsResult = await fetchXPostsByUserId(normalizedUserId, {
      maxResults: xCollectorMaxPosts,
      username: resolvedUsername,
    })
  }
  if (!postsResult.ok) {
    const isUnauthorizedPostsLookup = Number(postsResult.status) === 401 || Number(postsResult.status) === 403
    return {
      ok: false,
      status: postsResult.status || 502,
      error: postsResult.error || 'x_posts_lookup_failed',
      payload: postsResult.payload ?? null,
      message: isUnauthorizedPostsLookup
        ? 'Unauthorized while reading X posts. Reconnect this X account to grant tweet.read.'
        : normalizeTextInput(postsResult.message, { maxLength: 240 }) || 'Unable to load X posts.',
    }
  }

  const upsertResult = await upsertXRow({
    userId: normalizedUserId,
    username: resolvedUsername,
    followerCount: resolvedFollowerCount,
    posts: postsResult.posts,
  })
  if (!upsertResult.ok) {
    return {
      ok: false,
      status: upsertResult.status || 500,
      error: 'x_row_upsert_failed',
      payload: upsertResult.payload ?? null,
      message: 'Unable to store X data in Supabase.',
    }
  }

  return {
    ok: true,
    status: 200,
    row: upsertResult.row ?? null,
    username: resolvedUsername,
    followerCount: resolvedFollowerCount,
    postCount: postsResult.posts.length,
  }
}

const mapXRowToSummaryPart = (row, { accountNameByUserId = new Map() } = {}) => {
  const xUserId = resolveXUserIdFromStoredPostsPayload(row?.posts) || normalizeXUserId(row?.user_id)
  if (!xUserId) return buildEmptyInstagramSummary()
  const username = normalizeXUsername(row?.username)
  const channelId = `x:${xUserId}`
  const channelName =
    normalizeTextInput(accountNameByUserId.get(xUserId), { maxLength: 180 })
    || formatXAccountName(username)
    || `X Account ${xUserId}`
  const followerCount = Math.max(0, toNumber(row?.follower_count))
  const normalizedPosts = normalizeXStoredPosts(row?.posts, {
    userId: xUserId,
    username,
  })
  const posts = normalizedPosts
    .map((post) => ({
      id: `x:${post.id}`,
      title: post.title || 'Untitled X post',
      platform: ORGANIZATION_CONNECTION_PLATFORM_X,
      channelId,
      channelName,
      views: Math.max(0, toNumber(post.views)),
      engagementRate: Math.max(0, toNumber(post.engagementRate)),
      publishedAt: normalizeTextInput(post.createdAt, { maxLength: 64 }),
      url: normalizeTextInput(post.url, { maxLength: 500 }),
      likes: Math.max(0, toNumber(post.likes)),
      comments: Math.max(0, toNumber(post.replies)),
      shares: Math.max(0, toNumber(post.retweets)),
      reposts: Math.max(0, toNumber(post.retweets)),
      engagements: Math.max(0, toNumber(post.engagements)),
    }))
    .sort((left, right) => Math.max(0, toNumber(right.views)) - Math.max(0, toNumber(left.views)))

  const seriesByDate = new Map()
  for (const post of normalizedPosts) {
    const date = normalizeIsoDateOnly(post.createdAt)
    if (!date) continue
    const current = seriesByDate.get(date) ?? {
      date,
      views: 0,
      engagements: 0,
      posts: 0,
      watchTimeHours: 0,
      followersNetChange: 0,
    }
    seriesByDate.set(date, {
      date,
      views: current.views + Math.max(0, toNumber(post.views)),
      engagements: current.engagements + Math.max(0, toNumber(post.engagements)),
      posts: current.posts + 1,
      watchTimeHours: 0,
      followersNetChange: 0,
    })
  }
  const timeSeries = [...seriesByDate.values()].sort((left, right) => left.date.localeCompare(right.date))
  const totalViews = timeSeries.reduce((sum, point) => sum + Math.max(0, toNumber(point.views)), 0)
  const totalEngagements = timeSeries.reduce((sum, point) => sum + Math.max(0, toNumber(point.engagements)), 0)
  const postsCount = timeSeries.reduce((sum, point) => sum + Math.max(0, toNumber(point.posts)), 0)
  const engagementRate = totalViews > 0 ? (totalEngagements / totalViews) * 100 : 0
  const firstVideoUploadDate = timeSeries[0]?.date || ''

  return {
    firstVideoUploadDate,
    channels: [{
      id: channelId,
      name: channelName,
      platform: ORGANIZATION_CONNECTION_PLATFORM_X,
      views: totalViews,
      engagementRate,
      followers: followerCount,
      status: 'Connected',
    }],
    topPosts: posts,
    timeSeries,
    timeSeriesByChannel: timeSeries.map((point) => ({
      channelId,
      ...point,
    })),
    ageDistribution: [],
    ageDistributionByChannel: {},
    genderDistribution: [],
    genderDistributionByChannel: {},
    topGeos: [],
    topGeosByChannel: {},
  }
}

const mergeInstagramOpsRunEntries = (currentEntries, nextEntry) => {
  const normalizedNextEntry = normalizeInstagramOpsRunEntry(nextEntry)
  if (!normalizedNextEntry) return Array.isArray(currentEntries) ? currentEntries : []
  const mapById = new Map()
  const sourceEntries = Array.isArray(currentEntries) ? currentEntries : []
  sourceEntries.forEach((entry) => {
    const normalizedEntry = normalizeInstagramOpsRunEntry(entry)
    if (!normalizedEntry) return
    const dedupeKey = normalizedEntry.runId
      || normalizedEntry.jobId
      || `${normalizedEntry.startedAt}:${normalizedEntry.status}`
    mapById.set(dedupeKey, normalizedEntry)
  })
  const nextDedupeKey = normalizedNextEntry.runId
    || normalizedNextEntry.jobId
    || `${normalizedNextEntry.startedAt}:${normalizedNextEntry.status}`
  mapById.set(nextDedupeKey, normalizedNextEntry)
  return [...mapById.values()]
    .sort((left, right) => parseIsoTime(right.finishedAt || right.startedAt) - parseIsoTime(left.finishedAt || left.startedAt))
    .slice(0, instagramOpsRecentRunsPerAccount)
}

const mergeInstagramOpsAlertEntries = (currentEntries, nextEntry) => {
  const normalizedNextEntry = normalizeInstagramOpsAlertEntry(nextEntry)
  if (!normalizedNextEntry) return Array.isArray(currentEntries) ? currentEntries : []
  const mapById = new Map()
  const sourceEntries = Array.isArray(currentEntries) ? currentEntries : []
  sourceEntries.forEach((entry) => {
    const normalizedEntry = normalizeInstagramOpsAlertEntry(entry)
    if (!normalizedEntry) return
    mapById.set(normalizedEntry.id, normalizedEntry)
  })
  mapById.set(normalizedNextEntry.id, normalizedNextEntry)
  return [...mapById.values()]
    .sort((left, right) => parseIsoTime(right.createdAt) - parseIsoTime(left.createdAt))
    .slice(0, instagramOpsRecentAlertsPerAccount)
}

const mergeInstagramOpsSnapshot = (
  existingSnapshot,
  {
    runEntry = null,
    alertEntry = null,
    lastStatus = '',
    lastErrorCode = '',
    lastErrorMessage = '',
  } = {},
) => {
  const snapshot = normalizeInstagramOpsSnapshot(existingSnapshot) ?? {
    updatedAt: new Date().toISOString(),
    lastStatus: '',
    lastRunAt: '',
    lastErrorCode: '',
    lastErrorMessage: '',
    failureStreak: 0,
    recentRuns: [],
    recentAlerts: [],
  }

  let nextFailureStreak = Math.max(0, Number(snapshot.failureStreak) || 0)
  let resolvedLastStatus = normalizeTextInput(lastStatus, { maxLength: 32 }) || snapshot.lastStatus
  let resolvedLastErrorCode = normalizeTextInput(lastErrorCode, { maxLength: 80 }) || snapshot.lastErrorCode
  let resolvedLastErrorMessage = normalizeTextInput(lastErrorMessage, { maxLength: 240 }) || snapshot.lastErrorMessage
  const recentRuns = mergeInstagramOpsRunEntries(snapshot.recentRuns, runEntry)
  const recentAlerts = mergeInstagramOpsAlertEntries(snapshot.recentAlerts, alertEntry)

  if (runEntry) {
    const normalizedRunEntry = normalizeInstagramOpsRunEntry(runEntry)
    const runStatus = normalizeTextInput(normalizedRunEntry?.status, { maxLength: 32 })
    if (runStatus) {
      resolvedLastStatus = runStatus
      if (runStatus === 'succeeded') {
        nextFailureStreak = 0
      } else {
        nextFailureStreak += 1
      }
    }
    const runFinishedAt = normalizeTextInput(normalizedRunEntry?.finishedAt, { maxLength: 64 })
      || normalizeTextInput(normalizedRunEntry?.startedAt, { maxLength: 64 })
    if (runFinishedAt) {
      snapshot.lastRunAt = runFinishedAt
    }
    const runErrorCode = normalizeTextInput(normalizedRunEntry?.errorCode, { maxLength: 80 })
    const runErrorMessage = normalizeTextInput(normalizedRunEntry?.errorMessage, { maxLength: 240 })
    if (runErrorCode) resolvedLastErrorCode = runErrorCode
    if (runErrorMessage) resolvedLastErrorMessage = runErrorMessage
  }

  return {
    updatedAt: new Date().toISOString(),
    lastStatus: resolvedLastStatus,
    lastRunAt: snapshot.lastRunAt || normalizeTextInput(snapshot.updatedAt, { maxLength: 64 }),
    lastErrorCode: resolvedLastErrorCode,
    lastErrorMessage: resolvedLastErrorMessage,
    failureStreak: Math.max(0, Math.min(5000, nextFailureStreak)),
    recentRuns,
    recentAlerts,
  }
}

const persistInstagramOpsSnapshotForAccount = async ({
  ownerUserId,
  accountId,
  runEntry = null,
  alertEntry = null,
  lastStatus = '',
  lastErrorCode = '',
  lastErrorMessage = '',
}) => {
  const normalizedOwnerUserId = normalizeTextInput(ownerUserId, { maxLength: 80 })
  const normalizedAccountId = normalizeTextInput(accountId, { maxLength: 300 }).toLowerCase()
  if (!isUuid(normalizedOwnerUserId) || !normalizedAccountId) {
    return { ok: false, status: 400, matchedAccounts: 0, updatedOrganizations: 0 }
  }
  const organizationsResult = await listOrganizationRows()
  if (!organizationsResult.ok) {
    return {
      ok: false,
      status: organizationsResult.status || 500,
      matchedAccounts: 0,
      updatedOrganizations: 0,
    }
  }

  let matchedAccounts = 0
  let updatedOrganizations = 0
  for (const row of organizationsResult.rows) {
    const organizationId = normalizeTextInput(row?.id, { maxLength: 80 })
    if (!isUuid(organizationId)) continue
    const fallbackOwnerUserId = normalizeTextInput(row?.creator, { maxLength: 80 })
    const accounts = normalizeOrganizationConnectedAccounts(row?.connected_accounts)
    let changed = false
    const nextAccounts = accounts.map((account) => {
      if (normalizeOrganizationConnectionPlatform(account.platform) !== ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM) {
        return account
      }
      const resolvedOwnerUserId = isUuid(normalizeTextInput(account.ownerUserId, { maxLength: 80 }))
        ? normalizeTextInput(account.ownerUserId, { maxLength: 80 })
        : isUuid(fallbackOwnerUserId)
          ? fallbackOwnerUserId
          : ''
      if (resolvedOwnerUserId !== normalizedOwnerUserId) return account
      const resolvedAccountId = resolveInstagramAccountId(account)
      if (resolvedAccountId !== normalizedAccountId) return account
      matchedAccounts += 1
      changed = true
      const nextInstagramOps = mergeInstagramOpsSnapshot(account.instagramOps, {
        runEntry,
        alertEntry,
        lastStatus,
        lastErrorCode,
        lastErrorMessage,
      })
      return {
        ...account,
        instagramOps: nextInstagramOps,
      }
    })
    if (!changed) continue
    const updateResult = await updateOrganizationConnectedAccounts(organizationId, nextAccounts)
    if (updateResult.ok) {
      updatedOrganizations += 1
    }
  }
  return {
    ok: true,
    status: 200,
    matchedAccounts,
    updatedOrganizations,
  }
}

const persistInstagramAlertForUser = async (userId, alertEntry) => {
  const normalizedUserId = normalizeTextInput(userId, { maxLength: 80 })
  if (!isUuid(normalizedUserId)) return { ok: false, status: 400, persistedAccounts: 0 }
  const connectionsResult = await listAccessibleInstagramConnectionsByUserId(normalizedUserId)
  if (!connectionsResult.ok) {
    return { ok: false, status: connectionsResult.status || 500, persistedAccounts: 0 }
  }
  const seen = new Set()
  let persistedAccounts = 0
  for (const connection of connectionsResult.connections) {
    const dedupeKey = `${connection.ownerUserId}:${connection.accountId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const persistResult = await persistInstagramOpsSnapshotForAccount({
      ownerUserId: connection.ownerUserId,
      accountId: connection.accountId,
      alertEntry,
    })
    if (persistResult.ok && persistResult.matchedAccounts > 0) {
      persistedAccounts += 1
    }
  }
  return { ok: true, status: 200, persistedAccounts }
}

const loadPersistedInstagramOpsByUserId = async (viewerUserId) => {
  const normalizedViewerUserId = normalizeTextInput(viewerUserId, { maxLength: 80 })
  if (!isUuid(normalizedViewerUserId)) {
    return { ok: false, status: 400, accountSnapshots: [], recentRuns: [], recentAlerts: [] }
  }
  const organizationsResult = await listOrganizationRows()
  if (!organizationsResult.ok) {
    return {
      ok: false,
      status: organizationsResult.status || 500,
      accountSnapshots: [],
      recentRuns: [],
      recentAlerts: [],
    }
  }

  const snapshotByAccount = new Map()
  for (const row of organizationsResult.rows) {
    if (!canUserSeeOrganization(row, normalizedViewerUserId)) continue
    const organizationId = normalizeTextInput(row?.id, { maxLength: 80 })
    const fallbackOwnerUserId = normalizeTextInput(row?.creator, { maxLength: 80 })
    const accounts = normalizeOrganizationConnectedAccounts(row?.connected_accounts)
    for (const account of accounts) {
      if (normalizeOrganizationConnectionPlatform(account.platform) !== ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM) continue
      const accountId = resolveInstagramAccountId(account)
      if (!accountId) continue
      const ownerUserId = isUuid(normalizeTextInput(account.ownerUserId, { maxLength: 80 }))
        ? normalizeTextInput(account.ownerUserId, { maxLength: 80 })
        : isUuid(fallbackOwnerUserId)
          ? fallbackOwnerUserId
          : ''
      if (!isUuid(ownerUserId)) continue
      const key = `${ownerUserId}:${accountId}`
      const normalizedOps = normalizeInstagramOpsSnapshot(account.instagramOps)
      if (!snapshotByAccount.has(key)) {
        snapshotByAccount.set(key, {
          ownerUserId,
          accountId,
          accountName: normalizeTextInput(account.accountName, { maxLength: 180 }) || accountId,
          organizationIds: new Set(),
          instagramOps: normalizedOps ?? {
            updatedAt: '',
            lastStatus: '',
            lastRunAt: '',
            lastErrorCode: '',
            lastErrorMessage: '',
            failureStreak: 0,
            recentRuns: [],
            recentAlerts: [],
          },
        })
      }
      const target = snapshotByAccount.get(key)
      if (isUuid(organizationId)) {
        target.organizationIds.add(organizationId)
      }
      if (normalizedOps) {
        target.instagramOps = mergeInstagramOpsSnapshot(target.instagramOps, {
          lastStatus: normalizedOps.lastStatus,
          lastErrorCode: normalizedOps.lastErrorCode,
          lastErrorMessage: normalizedOps.lastErrorMessage,
        })
        normalizedOps.recentRuns.forEach((entry) => {
          target.instagramOps.recentRuns = mergeInstagramOpsRunEntries(target.instagramOps.recentRuns, entry)
        })
        normalizedOps.recentAlerts.forEach((entry) => {
          target.instagramOps.recentAlerts = mergeInstagramOpsAlertEntries(target.instagramOps.recentAlerts, entry)
        })
        target.instagramOps.failureStreak = Math.max(
          target.instagramOps.failureStreak,
          Math.max(0, Number(normalizedOps.failureStreak) || 0),
        )
        if (parseIsoTime(normalizedOps.lastRunAt) > parseIsoTime(target.instagramOps.lastRunAt)) {
          target.instagramOps.lastRunAt = normalizedOps.lastRunAt
          target.instagramOps.lastStatus = normalizedOps.lastStatus
          target.instagramOps.lastErrorCode = normalizedOps.lastErrorCode
          target.instagramOps.lastErrorMessage = normalizedOps.lastErrorMessage
        }
      }
    }
  }

  const accountSnapshots = [...snapshotByAccount.values()].map((entry) => ({
    ownerUserId: entry.ownerUserId,
    accountId: entry.accountId,
    accountName: entry.accountName,
    organizationIds: [...entry.organizationIds.values()],
    instagramOps: normalizeInstagramOpsSnapshot(entry.instagramOps) ?? {
      updatedAt: '',
      lastStatus: '',
      lastRunAt: '',
      lastErrorCode: '',
      lastErrorMessage: '',
      failureStreak: 0,
      recentRuns: [],
      recentAlerts: [],
    },
  }))

  const runMap = new Map()
  const alertMap = new Map()
  for (const snapshot of accountSnapshots) {
    snapshot.instagramOps.recentRuns.forEach((runEntry) => {
      const dedupeKey = runEntry.runId || runEntry.jobId || `${runEntry.startedAt}:${runEntry.status}`
      if (!dedupeKey) return
      runMap.set(dedupeKey, runEntry)
    })
    snapshot.instagramOps.recentAlerts.forEach((alertEntry) => {
      const dedupeKey = alertEntry.id || `${alertEntry.type}:${alertEntry.createdAt}`
      if (!dedupeKey) return
      alertMap.set(dedupeKey, alertEntry)
    })
  }

  const recentRuns = [...runMap.values()]
    .sort((left, right) => parseIsoTime(right.finishedAt || right.startedAt) - parseIsoTime(left.finishedAt || left.startedAt))
    .slice(0, instagramOpsRecentRunLimit)
  const recentAlerts = [...alertMap.values()]
    .sort((left, right) => parseIsoTime(right.createdAt) - parseIsoTime(left.createdAt))
    .slice(0, instagramOpsRecentAlertLimit)
  return {
    ok: true,
    status: 200,
    accountSnapshots,
    recentRuns,
    recentAlerts,
  }
}

const buildDeterministicInstagramFallback = (connection) => {
  const accountId = resolveInstagramAccountId(connection) || normalizeInstagramHandle(connection?.accountName) || 'instagram'
  const seedHash = crypto.createHash('sha256').update(accountId).digest('hex')
  const seed = Number.parseInt(seedHash.slice(0, 8), 16)
  const followers = 1_000 + (seed % 50_000)
  const posts = [0, 1, 2].map((offset) => {
    const views = 600 + ((seed >> (offset * 3)) % 20_000)
    const likes = Math.max(10, Math.round(views * 0.08))
    const comments = Math.max(3, Math.round(views * 0.01))
    const reposts = Math.max(1, Math.round(views * 0.002))
    const publishedAt = new Date(Date.now() - (offset + 1) * 3 * 24 * 60 * 60 * 1000).toISOString()
    return {
      id: `${accountId}-fallback-${offset + 1}`,
      url: `https://www.instagram.com/${encodeURIComponent(accountId)}/`,
      title: `Instagram Post ${offset + 1}`,
      publishedAt,
      views,
      likes,
      comments,
      saves: 0,
      shares: 0,
      reposts,
      engagements: likes + comments + reposts,
    }
  })
  return {
    account: {
      accountId,
      accountName: normalizeTextInput(connection?.accountName, { maxLength: 180 }) || accountId,
      followers,
      postsCount: posts.length,
      reach: 0,
      impressions: 0,
    },
    posts,
    collectedAt: new Date().toISOString(),
  }
}

const classifyInstagramCollectionError = (error) => {
  const code = normalizeTextInput(error?.code, { maxLength: 160 }).toLowerCase()
  if (code.includes('challenge')) return 'challenge_required'
  if (code.includes('auth_required')) return 'auth_required'
  if (code.includes('rate_limited')) return 'rate_limited'
  if (code.includes('ui_changed')) return 'ui_changed'
  if (code.includes('timeout')) return 'timeout'
  if (code.includes('graph_timeout')) return 'timeout'
  if (code.includes('instagram_graph') || code.includes('missing_instagram_access_token')) return 'auth_required'
  if (code.includes('temporary_network')) return 'temporary_network'
  if (code.includes('collector_unavailable') || code.includes('playwright_not_installed')) return 'collector_unavailable'

  const message = normalizeTextInput(error instanceof Error ? error.message : '', { maxLength: 240 }).toLowerCase()
  if (!message) return 'collection_failed'
  if (message.includes('challenge')) return 'challenge_required'
  if (message.includes('auth') || message.includes('login')) return 'auth_required'
  if (message.includes('rate') || message.includes('too many')) return 'rate_limited'
  if (message.includes('selector') || message.includes('ui')) return 'ui_changed'
  if (message.includes('timeout')) return 'timeout'
  if (message.includes('token') || message.includes('permission') || message.includes('graph')) return 'auth_required'
  if (message.includes('net::') || message.includes('network')) return 'temporary_network'
  if (message.includes('playwright_not_installed')) return 'collector_unavailable'
  return 'collection_failed'
}

const shouldRetryInstagramCollectionFailure = (failureCode) =>
  ['rate_limited', 'timeout', 'temporary_network', 'collection_failed'].includes(failureCode)

const getInstagramRetryDelayMs = (attempt) => {
  const attemptNumber = Math.max(1, toNumber(attempt))
  const exponentialDelay = instagramCollectorRetryBaseDelayMs * (2 ** (attemptNumber - 1))
  const cappedDelay = Math.min(exponentialDelay, 20_000)
  const jitter = Math.round(Math.random() * instagramCollectorRetryJitterMs)
  return cappedDelay + jitter
}

const parseInstagramInsightMetricValue = (value) => {
  if (typeof value === 'number') return Math.max(0, value)
  if (typeof value === 'string') return Math.max(0, toNumber(value))
  if (Array.isArray(value)) {
    return value.reduce((sum, entry) => sum + parseInstagramInsightMetricValue(entry), 0)
  }
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'value')) {
      return parseInstagramInsightMetricValue(value.value)
    }
    return Object.values(value).reduce((sum, entry) => sum + parseInstagramInsightMetricValue(entry), 0)
  }
  return 0
}

const parseInstagramInsightsMetricMap = (payload) => {
  const metrics = {}
  const rows = Array.isArray(payload?.data) ? payload.data : []
  for (const row of rows) {
    const name = normalizeTextInput(row?.name, { maxLength: 80 }).toLowerCase()
    if (!name) continue
    const values = Array.isArray(row?.values) ? row.values : []
    const rawValue = values.length ? values[0]?.value : row?.value
    metrics[name] = Math.max(0, Number(parseInstagramInsightMetricValue(rawValue)) || 0)
  }
  return metrics
}

const fetchInstagramInsightsForMedia = async ({
  mediaId,
  mediaType = '',
  accessToken = instagramAccessToken,
} = {}) => {
  const normalizedMediaId = normalizeTextInput(mediaId, { maxLength: 300 })
  if (!normalizedMediaId) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_instagram_media_id',
      message: 'Instagram media id is required to load insights.',
      metrics: {},
    }
  }

  const normalizedMediaType = normalizeTextInput(mediaType, { maxLength: 60 }).toLowerCase()
  const baseMetricSets = [
    ['impressions', 'reach', 'saved', 'shares', 'total_interactions'],
    ['impressions', 'reach', 'saved', 'shares'],
    ['impressions', 'reach'],
  ]
  if (normalizedMediaType.includes('video') || normalizedMediaType.includes('reel')) {
    baseMetricSets.unshift(['impressions', 'reach', 'saved', 'shares', 'video_views', 'total_interactions'])
  }

  let lastFailure = null
  for (const metricSet of baseMetricSets) {
    const metrics = [...new Set(metricSet)]
    const insightsResult = await requestInstagramGraph({
      base: 'facebook',
      path: `/${encodeURIComponent(normalizedMediaId)}/insights`,
      query: { metric: metrics.join(',') },
      accessToken,
    })
    if (insightsResult.ok) {
      return {
        ok: true,
        status: 200,
        metrics: parseInstagramInsightsMetricMap(insightsResult.payload),
      }
    }

    lastFailure = insightsResult
    const failureMessage = normalizeTextInput(insightsResult.message, { maxLength: 240 }).toLowerCase()
    const isMetricValidationError =
      failureMessage.includes('metric')
      || failureMessage.includes('not available')
      || failureMessage.includes('unsupported')
      || failureMessage.includes('does not support')
    if (!isMetricValidationError) {
      break
    }
  }

  return {
    ok: false,
    status: lastFailure?.status || 502,
    error: lastFailure?.error || 'instagram_insights_fetch_failed',
    message: lastFailure?.message || 'Unable to load Instagram media insights.',
    metrics: {},
  }
}

const resolveInstagramBusinessDiscoveryAnchor = async ({ accessToken = instagramAccessToken } = {}) => {
  const result = await requestInstagramGraph({
    base: 'facebook',
    path: '/me/accounts',
    query: {
      fields: 'id,name,instagram_business_account{id,username}',
      limit: '25',
    },
    accessToken,
  })
  if (!result.ok) {
    return {
      ok: false,
      status: result.status || 502,
      error: result.error || 'instagram_business_discovery_anchor_failed',
      message: result.message || 'Unable to load Facebook pages linked to Instagram business accounts.',
    }
  }
  const pages = Array.isArray(result.payload?.data) ? result.payload.data : []
  for (const page of pages) {
    const instagramBusinessAccount =
      page?.instagram_business_account && typeof page.instagram_business_account === 'object'
        ? page.instagram_business_account
        : null
    if (!instagramBusinessAccount) continue
    const graphUserId = normalizeTextInput(instagramBusinessAccount.id, { maxLength: 120 })
    if (!graphUserId) continue
    return {
      ok: true,
      status: 200,
      graphUserId,
      username: normalizeInstagramHandle(instagramBusinessAccount.username),
    }
  }
  return {
    ok: false,
    status: 400,
    error: 'instagram_business_discovery_anchor_missing',
    message: 'Configured token is not linked to an Instagram business account.',
  }
}

const collectInstagramBusinessDiscoveryMetrics = async ({
  username,
  accessToken = instagramAccessToken,
  maxPosts = instagramCollectorMaxPosts,
} = {}) => {
  const normalizedUsername = normalizeInstagramHandle(username)
  if (!normalizedUsername) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_instagram_username',
      message: 'Instagram username is required.',
      collected: null,
    }
  }

  const anchorResult = await resolveInstagramBusinessDiscoveryAnchor({ accessToken })
  if (!anchorResult.ok) {
    return {
      ok: false,
      status: anchorResult.status || 502,
      error: anchorResult.error || 'instagram_business_discovery_anchor_failed',
      message: anchorResult.message || 'Unable to resolve Instagram business discovery anchor account.',
      collected: null,
    }
  }

  const safeMaxPosts = Math.max(1, Math.min(50, toNumber(maxPosts) || instagramCollectorMaxPosts))
  const fields =
    `business_discovery.username(${normalizedUsername}){`
    + 'id,username,name,followers_count,media_count,'
    + `media.limit(${safeMaxPosts}){`
    + 'id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,like_count,comments_count'
    + '}}'
  const discoveryResult = await requestInstagramGraph({
    base: 'facebook',
    path: `/${encodeURIComponent(anchorResult.graphUserId)}`,
    query: { fields },
    accessToken,
  })
  if (!discoveryResult.ok) {
    return {
      ok: false,
      status: discoveryResult.status || 502,
      error: discoveryResult.error || 'instagram_business_discovery_failed',
      message: discoveryResult.message || `Unable to find Instagram account @${normalizedUsername}.`,
      collected: null,
    }
  }

  const discoveryProfile =
    discoveryResult.payload?.business_discovery && typeof discoveryResult.payload.business_discovery === 'object'
      ? discoveryResult.payload.business_discovery
      : null
  if (!discoveryProfile) {
    return {
      ok: false,
      status: 404,
      error: 'instagram_business_discovery_not_found',
      message: `Unable to find Instagram account @${normalizedUsername}.`,
      collected: null,
    }
  }

  const mediaRows = Array.isArray(discoveryProfile.media?.data) ? discoveryProfile.media.data : []
  const posts = []
  for (const row of mediaRows.slice(0, safeMaxPosts)) {
    const postId = normalizeTextInput(row?.id, { maxLength: 300 })
    if (!postId) continue
    const mediaType = normalizeTextInput(row?.media_type, { maxLength: 60 })
    const caption = normalizeTextInput(row?.caption, { maxLength: 600, allowNewLines: true })
    const fallbackTitle = mediaType.toLowerCase().includes('video') ? 'Instagram reel' : 'Instagram post'
    const title = normalizeTextInput(caption.split('\n')[0], { maxLength: 300 }) || fallbackTitle
    const likes = Math.max(0, toNumber(row?.like_count))
    const comments = Math.max(0, toNumber(row?.comments_count))

    const insightResult = await fetchInstagramInsightsForMedia({
      mediaId: postId,
      mediaType,
      accessToken,
    })
    const insightMetrics = insightResult.ok ? insightResult.metrics : {}

    const saves = Math.max(0, toNumber(insightMetrics.saved))
    const shares = Math.max(0, toNumber(insightMetrics.shares))
    const impressions = Math.max(0, toNumber(insightMetrics.impressions))
    const reach = Math.max(0, toNumber(insightMetrics.reach))
    const videoViews = Math.max(0, toNumber(insightMetrics.video_views))
    const engagements = likes + comments + saves + shares
    const views = Math.max(videoViews, impressions, reach, engagements, likes, comments)
    const permalink = normalizeTextInput(row?.permalink, { maxLength: 500 })
    posts.push({
      id: postId,
      url: permalink || '',
      title,
      publishedAt: normalizeTextInput(row?.timestamp, { maxLength: 64 }),
      views,
      likes,
      comments,
      saves,
      shares,
      reposts: 0,
      engagements,
    })
  }

  const accountId =
    normalizeInstagramHandle(discoveryProfile.username)
    || normalizeTextInput(discoveryProfile.id, { maxLength: 120 }).toLowerCase()
    || normalizedUsername
  const accountName =
    normalizeTextInput(discoveryProfile.name, { maxLength: 180 })
    || normalizeTextInput(discoveryProfile.username, { maxLength: 180 })
    || accountId
  return {
    ok: true,
    status: 200,
    collected: {
      account: {
        accountId,
        accountName,
        followers: Math.max(0, toNumber(discoveryProfile.followers_count)),
        postsCount: Math.max(0, toNumber(discoveryProfile.media_count || posts.length)),
        reach: 0,
        impressions: 0,
      },
      posts,
      collectedAt: new Date().toISOString(),
      selectorVersion: 'graph-api-v2-business-discovery',
    },
  }
}

const listInstagramGraphMediaByCandidate = async (candidate, options = {}) => {
  const normalizedCandidate = candidate && typeof candidate === 'object' ? candidate : {}
  const normalizedGraphUserId = normalizeTextInput(normalizedCandidate.graphUserId, { maxLength: 120 })
  const normalizedSource = normalizeTextInput(normalizedCandidate.source, { maxLength: 40 }).toLowerCase()
  const accessToken = normalizeTextInput(options.accessToken, { maxLength: 4000 }) || instagramAccessToken
  const safeMaxPosts = Math.max(1, Math.min(50, toNumber(options.maxPosts) || instagramCollectorMaxPosts))
  const isBasicDisplay = normalizedSource === 'basic_display'
  const fields = isBasicDisplay
    ? 'id,caption,media_type,media_url,permalink,timestamp,thumbnail_url'
    : 'id,caption,media_type,media_product_type,media_url,permalink,timestamp,thumbnail_url,like_count,comments_count'
  const path = isBasicDisplay || !normalizedGraphUserId
    ? '/me/media'
    : `/${encodeURIComponent(normalizedGraphUserId)}/media`
  const mediaResult = await requestInstagramGraph({
    base: isBasicDisplay ? 'instagram' : 'facebook',
    path,
    query: {
      fields,
      limit: String(safeMaxPosts),
    },
    accessToken,
  })
  if (!mediaResult.ok) {
    return {
      ok: false,
      status: mediaResult.status || 502,
      error: mediaResult.error || 'instagram_graph_media_fetch_failed',
      message: mediaResult.message || 'Unable to load Instagram media.',
      posts: [],
    }
  }

  const mediaRows = Array.isArray(mediaResult.payload?.data) ? mediaResult.payload.data : []
  const posts = []
  for (const row of mediaRows) {
    const postId = normalizeTextInput(row?.id, { maxLength: 300 })
    if (!postId) continue
    const caption = normalizeTextInput(row?.caption, { maxLength: 600, allowNewLines: true })
    const mediaType = normalizeTextInput(row?.media_type, { maxLength: 80 })
    const fallbackTitle = mediaType.toLowerCase().includes('video')
      ? 'Instagram reel'
      : 'Instagram post'
    const title = normalizeTextInput(caption.split('\n')[0], { maxLength: 300 }) || fallbackTitle
    const likes = Math.max(0, toNumber(row?.like_count))
    const comments = Math.max(0, toNumber(row?.comments_count))
    let shares = Math.max(0, toNumber(row?.share_count))
    let saves = Math.max(0, toNumber(row?.saved))
    const reposts = Math.max(0, toNumber(row?.repost_count))
    let views = Math.max(
      0,
      toNumber(row?.video_views),
      toNumber(row?.plays),
      toNumber(row?.impressions),
      toNumber(row?.reach),
    )
    if (!isBasicDisplay) {
      const insightResult = await fetchInstagramInsightsForMedia({
        mediaId: postId,
        mediaType,
        accessToken,
      })
      if (insightResult.ok) {
        const metrics = insightResult.metrics
        saves = Math.max(saves, Math.max(0, toNumber(metrics.saved)))
        shares = Math.max(shares, Math.max(0, toNumber(metrics.shares)))
        views = Math.max(
          views,
          Math.max(0, toNumber(metrics.video_views)),
          Math.max(0, toNumber(metrics.impressions)),
          Math.max(0, toNumber(metrics.reach)),
        )
      }
    }
    const engagements = likes + comments + shares + saves + reposts
    const permalink = normalizeTextInput(row?.permalink, { maxLength: 500 })
    posts.push({
      id: postId,
      url: permalink || '',
      title,
      publishedAt: normalizeTextInput(row?.timestamp, { maxLength: 64 }),
      views: views > 0 ? views : Math.max(engagements, likes, comments),
      likes,
      comments,
      saves,
      shares,
      reposts,
      engagements,
    })
  }

  return {
    ok: true,
    status: 200,
    posts: posts.slice(0, safeMaxPosts),
  }
}

const collectInstagramMetricsWithGraph = async (connection) => {
  const connectionAccountId = resolveInstagramAccountId(connection)
  const connectionKey = buildInstagramVaultKey({
    ownerUserId: connection?.ownerUserId,
    accountId: connectionAccountId,
  })
  const tokenEntry = connectionKey ? instagramGraphAccessTokenByConnectionKey.get(connectionKey) : null
  const scopedAccessToken = normalizeTextInput(tokenEntry?.accessToken, { maxLength: 4000 })
  const globalAccessToken = normalizeTextInput(instagramAccessToken, { maxLength: 4000 })
  const requestedUsername =
    normalizeInstagramHandle(connection?.accountName)
    || normalizeInstagramHandle(connectionAccountId)

  const isInvalidAccessTokenMessage = (value) => {
    const normalized = normalizeTextInput(value, { maxLength: 240 }).toLowerCase()
    return normalized.includes('invalid oauth access token')
      || normalized.includes('cannot parse access token')
      || normalized.includes('error validating access token')
      || normalized.includes('access token could not be decrypted')
      || normalized.includes('session has expired')
  }

  const collectWithToken = async (accessToken) => {
    const normalizedToken = normalizeTextInput(accessToken, { maxLength: 4000 })
    if (!normalizedToken) {
      throw new Error('INSTAGRAM_ACCESS_TOKEN is not configured.')
    }

    if (requestedUsername) {
      const discoveryResult = await collectInstagramBusinessDiscoveryMetrics({
        username: requestedUsername,
        accessToken: normalizedToken,
        maxPosts: instagramCollectorMaxPosts,
      })
      if (discoveryResult.ok && discoveryResult.collected) {
        return discoveryResult.collected
      }
    }

    const candidatesResult = await listInstagramGraphConnectionCandidates({
      accessToken: normalizedToken,
    })
    if (!candidatesResult.ok || !candidatesResult.candidates.length) {
      throw new Error(
        candidatesResult.message
        || `Unable to find Instagram account metadata for ${requestedUsername ? `@${requestedUsername}` : 'the configured account'}.`,
      )
    }
    const candidate = resolveInstagramGraphCandidateForConnection(connection, candidatesResult.candidates)
    if (!candidate) {
      throw new Error(
        requestedUsername
          ? `Instagram account @${requestedUsername} was not found in Graph API responses.`
          : 'Configured Instagram token did not return a matching account.',
      )
    }
    const mediaResult = await listInstagramGraphMediaByCandidate(candidate, {
      maxPosts: instagramCollectorMaxPosts,
      accessToken: normalizedToken,
    })
    if (!mediaResult.ok) {
      throw new Error(mediaResult.message || 'Unable to fetch Instagram media from Graph API.')
    }
    const accountId = normalizeInstagramHandle(candidate.accountId || candidate.username)
      || resolveInstagramAccountId(connection)
      || 'instagram'
    const accountName =
      normalizeTextInput(candidate.accountName, { maxLength: 180 })
      || normalizeTextInput(connection?.accountName, { maxLength: 180 })
      || accountId

    return {
      account: {
        accountId,
        accountName,
        followers: Math.max(0, toNumber(candidate.followers)),
        postsCount: Math.max(0, toNumber(candidate.postsCount || mediaResult.posts.length)),
        reach: 0,
        impressions: 0,
      },
      posts: mediaResult.posts,
      collectedAt: new Date().toISOString(),
      selectorVersion: 'graph-api-v1-legacy',
    }
  }

  const primaryToken = scopedAccessToken || globalAccessToken
  try {
    return await collectWithToken(primaryToken)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : ''
    const canRetryWithGlobalToken = Boolean(
      scopedAccessToken
      && globalAccessToken
      && scopedAccessToken !== globalAccessToken
      && isInvalidAccessTokenMessage(errorMessage),
    )
    if (!canRetryWithGlobalToken) {
      throw error
    }
    if (connectionKey) {
      instagramGraphAccessTokenByConnectionKey.delete(connectionKey)
    }
    return collectWithToken(globalAccessToken)
  }
}

const collectInstagramMetricsForConnection = async (connection) => {
  if (instagramCollectorMode === 'disabled') {
    return {
      ...buildDeterministicInstagramFallback(connection),
      collectionMode: 'disabled',
    }
  }
  if (instagramCollectorMode === 'graph') {
    const collected = await collectInstagramMetricsWithGraph(connection)
    return {
      ...collected,
      collectionMode: 'graph',
    }
  }
  if (
    instagramCollectorMode === 'playwright'
    && !instagramUsername
    && !instagramPassword
    && instagramAccessToken
  ) {
    const collected = await collectInstagramMetricsWithGraph(connection)
    return {
      ...collected,
      collectionMode: 'graph',
    }
  }
  const cookies = await getInstagramSessionVaultCookies({
    ownerUserId: connection.ownerUserId,
    accountId: connection.accountId,
  })
  const instagramCredentials =
    instagramUsername && instagramPassword
      ? { username: instagramUsername, password: instagramPassword }
      : null
  if (instagramCollectorMode === 'mock') {
    return {
      ...buildDeterministicInstagramFallback(connection),
      collectionMode: 'mock',
    }
  }

  const attemptsAllowed = Math.max(1, instagramCollectorMaxRetries + 1)
  let lastError = null
  for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
    try {
      const collected = await collectInstagramMetricsWithPlaywright({
        accountHandle: connection.accountId,
        accountName: connection.accountName,
        cookies,
        credentials: instagramCredentials,
        maxPosts: instagramCollectorMaxPosts,
        timeoutMs: instagramCollectorTimeoutMs,
      })
      return {
        ...collected,
        collectionMode: instagramCollectorMode,
      }
    } catch (error) {
      const failureCode = classifyInstagramCollectionError(error)
      lastError = error
      if (failureCode === 'collector_unavailable') {
        return {
          ...buildDeterministicInstagramFallback(connection),
          collectionMode: 'fallback',
        }
      }
      const canRetry = shouldRetryInstagramCollectionFailure(failureCode)
      const hasAttemptsRemaining = attempt < attemptsAllowed
      if (!canRetry || !hasAttemptsRemaining) break
      await waitForDelay(getInstagramRetryDelayMs(attempt))
    }
  }

  if (lastError instanceof Error) {
    throw lastError
  }
  throw new Error('instagram_collection_failed')
}

const mapInstagramCollectionToSummaryPart = (connection, collected) => {
  const accountId = resolveInstagramAccountId(connection) || normalizeInstagramHandle(connection.accountName)
  const channelId = `instagram:${accountId}`
  const accountName = normalizeTextInput(
    collected?.account?.accountName ?? connection.accountName,
    { maxLength: 180 },
  ) || accountId
  const followers = Math.max(0, toNumber(collected?.account?.followers))
  const posts = Array.isArray(collected?.posts) ? collected.posts : []
  const normalizedPosts = posts
    .map((post) => {
      const postId = normalizeTextInput(post?.id, { maxLength: 300 })
      if (!postId) return null
      const views = Math.max(0, toNumber(post?.views))
      const likes = Math.max(0, toNumber(post?.likes))
      const comments = Math.max(0, toNumber(post?.comments))
      const saves = Math.max(0, toNumber(post?.saves))
      const shares = Math.max(0, toNumber(post?.shares))
      const reposts = Math.max(0, toNumber(post?.reposts))
      const engagements = Math.max(0, toNumber(post?.engagements || likes + comments + saves + shares + reposts))
      const title = normalizeTextInput(post?.title, { maxLength: 300 }) || 'Instagram post'
      const publishedAt = normalizeTextInput(post?.publishedAt, { maxLength: 64 })
      const url = normalizeTextInput(post?.url, { maxLength: 500 })
      return {
        id: `instagram:${postId}`,
        title,
        platform: ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM,
        channelId,
        channelName: accountName,
        views,
        engagementRate: views > 0 ? (engagements / views) * 100 : followers > 0 ? (engagements / followers) * 100 : 0,
        publishedAt,
        url,
        likes,
        comments,
        saves,
        shares,
        reposts,
        engagements,
      }
    })
    .filter(Boolean)

  const totalViews = normalizedPosts.reduce((sum, post) => sum + Math.max(0, toNumber(post.views)), 0)
  const totalEngagements = normalizedPosts.reduce((sum, post) => sum + Math.max(0, toNumber(post.engagements)), 0)
  const postsCount = normalizedPosts.length
  const engagementRate = totalViews > 0
    ? (totalEngagements / totalViews) * 100
    : followers > 0 ? (totalEngagements / followers) * 100 : 0
  const collectedDate = normalizeIsoDateOnly(collected?.collectedAt || new Date().toISOString())
    || normalizeIsoDateOnly(new Date().toISOString())
  const publishedDates = normalizedPosts
    .map((post) => normalizeIsoDateOnly(post.publishedAt))
    .filter((value) => value)
    .sort()

  return {
    collectionMeta: {
      selectorVersion: normalizeTextInput(collected?.selectorVersion, { maxLength: 64 }) || INSTAGRAM_SELECTOR_VERSION,
      collectionMode: normalizeTextInput(collected?.collectionMode, { maxLength: 32 }) || instagramCollectorMode,
    },
    firstVideoUploadDate: publishedDates[0] || '',
    channels: [{
      id: channelId,
      name: accountName,
      platform: ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM,
      views: totalViews,
      engagementRate,
      followers,
      status: 'Connected',
    }],
    topPosts: normalizedPosts
      .sort((left, right) => Math.max(0, toNumber(right.views)) - Math.max(0, toNumber(left.views)))
      .map((post) => ({
        id: post.id,
        title: post.title,
        platform: ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM,
        channelId: post.channelId,
        channelName: post.channelName,
        views: Math.max(0, toNumber(post.views)),
        engagementRate: Math.max(0, toNumber(post.engagementRate)),
        publishedAt: normalizeTextInput(post.publishedAt, { maxLength: 64 }),
        url: normalizeTextInput(post.url, { maxLength: 500 }),
        likes: Math.max(0, toNumber(post.likes)),
        comments: Math.max(0, toNumber(post.comments)),
        saves: Math.max(0, toNumber(post.saves)),
        shares: Math.max(0, toNumber(post.shares)),
        reposts: Math.max(0, toNumber(post.reposts)),
        engagements: Math.max(0, toNumber(post.engagements)),
      })),
    timeSeries: [{
      date: collectedDate,
      views: totalViews,
      engagements: totalEngagements,
      posts: postsCount,
      watchTimeHours: 0,
      followersNetChange: 0,
    }],
    timeSeriesByChannel: [{
      channelId,
      date: collectedDate,
      views: totalViews,
      engagements: totalEngagements,
      posts: postsCount,
      watchTimeHours: 0,
      followersNetChange: 0,
    }],
    ageDistribution: [],
    ageDistributionByChannel: {},
    genderDistribution: [],
    genderDistributionByChannel: {},
    topGeos: [],
    topGeosByChannel: {},
  }
}

const mergeInstagramSummaryParts = (parts) => {
  const normalizedParts = Array.isArray(parts) ? parts : []
  if (!normalizedParts.length) return buildEmptyInstagramSummary()
  const firstDates = normalizedParts
    .map((part) => normalizeIsoDateOnly(part?.firstVideoUploadDate))
    .filter((value) => value)
    .sort()

  const channelById = new Map()
  const postById = new Map()
  const timeSeriesByDate = new Map()
  const timeSeriesByChannelDate = new Map()

  for (const part of normalizedParts) {
    const channels = Array.isArray(part.channels) ? part.channels : []
    for (const channel of channels) {
      const channelId = normalizeTextInput(channel?.id, { maxLength: 300 })
      if (!channelId) continue
      channelById.set(channelId, channel)
    }

    const topPosts = Array.isArray(part.topPosts) ? part.topPosts : []
    for (const post of topPosts) {
      const postId = normalizeTextInput(post?.id, { maxLength: 300 })
      if (!postId || postById.has(postId)) continue
      postById.set(postId, post)
    }

    const series = Array.isArray(part.timeSeries) ? part.timeSeries : []
    for (const point of series) {
      const date = normalizeIsoDateOnly(point?.date)
      if (!date) continue
      const current = timeSeriesByDate.get(date) ?? {
        date,
        views: 0,
        engagements: 0,
        posts: 0,
        watchTimeHours: 0,
        followersNetChange: 0,
      }
      timeSeriesByDate.set(date, {
        date,
        views: current.views + Math.max(0, toNumber(point?.views)),
        engagements: current.engagements + Math.max(0, toNumber(point?.engagements)),
        posts: current.posts + Math.max(0, toNumber(point?.posts)),
        watchTimeHours: current.watchTimeHours + Math.max(0, toNumber(point?.watchTimeHours)),
        followersNetChange: current.followersNetChange + toNumber(point?.followersNetChange),
      })
    }

    const seriesByChannel = Array.isArray(part.timeSeriesByChannel) ? part.timeSeriesByChannel : []
    for (const point of seriesByChannel) {
      const channelId = normalizeTextInput(point?.channelId, { maxLength: 300 })
      const date = normalizeIsoDateOnly(point?.date)
      if (!channelId || !date) continue
      const key = `${channelId}:${date}`
      const current = timeSeriesByChannelDate.get(key) ?? {
        channelId,
        date,
        views: 0,
        engagements: 0,
        posts: 0,
        watchTimeHours: 0,
        followersNetChange: 0,
      }
      timeSeriesByChannelDate.set(key, {
        channelId,
        date,
        views: current.views + Math.max(0, toNumber(point?.views)),
        engagements: current.engagements + Math.max(0, toNumber(point?.engagements)),
        posts: current.posts + Math.max(0, toNumber(point?.posts)),
        watchTimeHours: current.watchTimeHours + Math.max(0, toNumber(point?.watchTimeHours)),
        followersNetChange: current.followersNetChange + toNumber(point?.followersNetChange),
      })
    }
  }

  return {
    firstVideoUploadDate: firstDates[0] || '',
    channels: [...channelById.values()],
    topPosts: [...postById.values()].sort((left, right) => Math.max(0, toNumber(right.views)) - Math.max(0, toNumber(left.views))),
    timeSeries: [...timeSeriesByDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
    timeSeriesByChannel: [...timeSeriesByChannelDate.values()].sort((left, right) => {
      const byChannel = left.channelId.localeCompare(right.channelId)
      if (byChannel !== 0) return byChannel
      return left.date.localeCompare(right.date)
    }),
    ageDistribution: [],
    ageDistributionByChannel: {},
    genderDistribution: [],
    genderDistributionByChannel: {},
    topGeos: [],
    topGeosByChannel: {},
  }
}

const createAndStartInstagramRefreshJob = async (
  userId,
  options = {},
) => {
  if (!instagramCollectionEnabled) {
    return {
      ok: false,
      status: 410,
      error: 'instagram_collection_disabled',
      payload: null,
    }
  }
  const trigger = typeof options.trigger === 'string' ? options.trigger : 'manual'
  const reuseRunning = options.reuseRunning !== false
  const minIntervalMs = Number.isFinite(options.minIntervalMs) ? Number(options.minIntervalMs) : 0

  const latestResult = await getLatestInstagramRefreshJobByUserId(userId)
  if (latestResult.ok && latestResult.row) {
    const latest = latestResult.row
    const latestStatus = normalizeTextInput(latest.status, { maxLength: 32 })
    if (reuseRunning && (latestStatus === 'queued' || latestStatus === 'running')) {
      const latestActiveAt =
        parseIsoTime(latest.started_at)
        || parseIsoTime(latest.requested_at)
      const isStaleRunningJob =
        latestActiveAt > 0 && Date.now() - latestActiveAt >= REFRESH_JOB_STALE_TIMEOUT_MS
      if (!isStaleRunningJob) {
        return {
          ok: true,
          jobId: latest.id,
          status: latestStatus,
          deduped: true,
        }
      }
      await updateInstagramRefreshJob(userId, latest.id, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: 'Refresh job timed out and was replaced by a new run.',
      })
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
  const insertResult = await insertInstagramRefreshJob({
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
      error: 'instagram_refresh_job_create_failed',
      payload: insertResult.payload,
    }
  }

  const jobId = insertResult.row.id
  if (isServerlessRuntime) {
    const dispatchResult = await dispatchInternalRefreshRunner({
      platform: 'instagram',
      userId,
      jobId,
    })
    if (!dispatchResult.ok) {
      const dispatchError =
        normalizeTextInput(dispatchResult.error, { maxLength: 240 })
        || 'instagram_refresh_runner_dispatch_failed'
      await updateInstagramRefreshJob(userId, jobId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: 'Unable to dispatch Instagram refresh worker.',
        meta: { trigger, dispatchError },
      })
      return {
        ok: false,
        status: 503,
        error: 'instagram_refresh_job_dispatch_failed',
        payload: { dispatchError },
      }
    }
  } else {
    void runInstagramRefreshJob(jobId, userId)
  }
  return {
    ok: true,
    jobId,
    status: 'queued',
    deduped: false,
  }
}

const maybeQueueAutoInstagramRefresh = async ({ userId, hasConnections, generatedAt }) => {
  if (!instagramCollectionEnabled) return { queued: false }
  if (!userId || !hasConnections) return { queued: false }
  const generatedAtMs = parseIsoTime(generatedAt)
  const isStale =
    generatedAtMs <= 0 || Date.now() - generatedAtMs >= INSTAGRAM_AUTO_REFRESH_INTERVAL_MS
  if (!isStale) return { queued: false }

  const queued = await createAndStartInstagramRefreshJob(userId, {
    trigger: 'auto',
    reuseRunning: true,
    minIntervalMs: INSTAGRAM_AUTO_REFRESH_RETRY_COOLDOWN_MS,
  })
  if (!queued.ok) return { queued: false, error: queued.error || 'instagram_auto_refresh_enqueue_failed' }
  return {
    queued: true,
    jobId: queued.jobId,
    status: queued.status,
    deduped: queued.deduped,
  }
}

const runInstagramRefreshJob = async (jobId, userId) => {
  if (!instagramCollectionEnabled) return
  if (!jobId || !userId) return
  if (instagramRefreshRunningUsers.has(userId)) {
    return
  }
  instagramRefreshRunningUsers.add(userId)
  const startedAt = new Date().toISOString()
  const runId = crypto.randomUUID()

  await updateInstagramRefreshJob(userId, jobId, {
    status: 'running',
    started_at: startedAt,
    error_message: null,
    meta: {
      runId,
      selectorVersion: INSTAGRAM_SELECTOR_VERSION,
      collectionMode: instagramCollectorMode,
    },
  })

  try {
    const connectionsResult = await listAccessibleInstagramConnectionsByUserId(userId)
    if (!connectionsResult.ok) {
      throw new Error('Unable to load connected Instagram accounts.')
    }
    const connections = connectionsResult.connections
    await updateInstagramRefreshJob(userId, jobId, {
      channels_total: connections.length,
      channels_processed: 0,
    })

    if (!connections.length) {
      const emptySummary = buildEmptyInstagramSummary()
      const finishedAt = new Date().toISOString()
      await upsertCachedInstagramSummary({
        userId,
        summary: emptySummary,
        generatedAt: finishedAt,
        refreshJobId: jobId,
      })
      await updateInstagramRefreshJob(userId, jobId, {
        status: 'succeeded',
        channels_processed: 0,
        finished_at: finishedAt,
        meta: {
          runId,
          message: 'No connected Instagram accounts.',
          selectorVersion: INSTAGRAM_SELECTOR_VERSION,
          collectionMode: instagramCollectorMode,
        },
      })
      await recordInstagramRun({
        runId,
        userId,
        jobId,
        status: 'succeeded',
        startedAt,
        finishedAt,
        channelsTotal: 0,
        channelsProcessed: 0,
        partialFailureCount: 0,
      })
      return
    }

    const collectedParts = []
    const failures = []
    const failureByAccountKey = new Map()
    const collectionModes = new Set()
    const selectorVersions = new Set()
    let processed = 0
    const queue = [...connections]
    const workerCount = Math.max(1, Math.min(instagramRefreshMaxConcurrency, queue.length))

    const worker = async () => {
      while (queue.length > 0) {
        const connection = queue.shift()
        if (!connection) return
        try {
          const collected = await collectInstagramMetricsForConnection(connection)
          const part = mapInstagramCollectionToSummaryPart(connection, collected)
          if (part.channels.length || part.topPosts.length || part.timeSeries.length) {
            collectedParts.push({
              ownerUserId: normalizeTextInput(connection.ownerUserId, { maxLength: 80 }),
              part,
            })
          }
          const collectionModeValue = normalizeTextInput(part.collectionMeta?.collectionMode, { maxLength: 32 })
          if (collectionModeValue) collectionModes.add(collectionModeValue)
          const selectorVersionValue = normalizeTextInput(part.collectionMeta?.selectorVersion, { maxLength: 64 })
          if (selectorVersionValue) selectorVersions.add(selectorVersionValue)
        } catch (error) {
          const failureCode = classifyInstagramCollectionError(error)
          const failureMessage = redactInstagramErrorMessage(error instanceof Error ? error.message : '')
          const accountKey = `${connection.ownerUserId}:${connection.accountId}`
          failureByAccountKey.set(accountKey, {
            ownerUserId: connection.ownerUserId,
            accountId: connection.accountId,
            accountName: connection.accountName,
            code: failureCode,
            message: failureMessage,
          })
          failures.push({
            accountId: connection.accountId,
            accountName: connection.accountName,
            code: failureCode,
            message: failureMessage,
          })
        } finally {
          processed += 1
          await updateInstagramRefreshJob(userId, jobId, {
            channels_processed: processed,
          })
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    const accountOutcomes = connections.map((connection) => {
      const accountKey = `${connection.ownerUserId}:${connection.accountId}`
      const failure = failureByAccountKey.get(accountKey)
      return {
        ownerUserId: connection.ownerUserId,
        accountId: connection.accountId,
        accountName: connection.accountName,
        status: failure ? 'failed' : 'succeeded',
        errorCode: failure?.code || '',
        errorMessage: failure?.message || '',
      }
    })

    const parts = collectedParts.map((entry) => entry.part)
    const summary = mergeInstagramSummaryParts(parts)
    if (!summary.channels.length && failures.length) {
      const dominantFailureCode = normalizeTextInput(failures[0]?.code, { maxLength: 80 }) || 'collection_failed'
      const dominantFailureMessage = redactInstagramErrorMessage(failures[0]?.message || 'No Instagram metrics could be collected.')
      const finishedAt = new Date().toISOString()
      await updateInstagramRefreshJob(userId, jobId, {
        status: 'failed',
        finished_at: finishedAt,
        error_message: dominantFailureMessage,
        meta: {
          runId,
          errorCode: dominantFailureCode,
          selectorVersion: selectorVersions.size ? [...selectorVersions] : [INSTAGRAM_SELECTOR_VERSION],
          collectionMode: collectionModes.size ? [...collectionModes] : [instagramCollectorMode],
          failedAccounts: failures.slice(0, 25),
        },
      })
      await recordInstagramRun({
        runId,
        userId,
        jobId,
        status: 'failed',
        startedAt,
        finishedAt,
        channelsTotal: connections.length,
        channelsProcessed: processed,
        partialFailureCount: failures.length,
        errorCode: dominantFailureCode,
        errorMessage: dominantFailureMessage,
        accountOutcomes,
      })
      return
    }

    const finishedAt = new Date().toISOString()
    await upsertCachedInstagramSummary({
      userId,
      summary,
      generatedAt: finishedAt,
      refreshJobId: jobId,
    })

    const ownerPartsByUserId = new Map()
    for (const entry of collectedParts) {
      const ownerUserId = normalizeTextInput(entry.ownerUserId, { maxLength: 80 })
      if (!isUuid(ownerUserId)) continue
      const existingParts = ownerPartsByUserId.get(ownerUserId) ?? []
      existingParts.push(entry.part)
      ownerPartsByUserId.set(ownerUserId, existingParts)
    }
    for (const [ownerUserId, ownerParts] of ownerPartsByUserId.entries()) {
      const ownerSummary = mergeInstagramSummaryParts(ownerParts)
      await upsertCachedInstagramSummary({
        userId: ownerUserId,
        summary: ownerSummary,
        generatedAt: finishedAt,
        refreshJobId: jobId,
      })
    }
    await updateInstagramRefreshJob(userId, jobId, {
      status: 'succeeded',
      finished_at: finishedAt,
      error_message: null,
      meta: {
        runId,
        channels: summary.channels.length,
        topPosts: summary.topPosts.length,
        failedAccountCount: failures.length,
        failedAccounts: failures.slice(0, 25),
        partialSuccess: failures.length > 0,
        selectorVersion: selectorVersions.size ? [...selectorVersions] : [INSTAGRAM_SELECTOR_VERSION],
        collectionMode: collectionModes.size ? [...collectionModes] : [instagramCollectorMode],
      },
    })
    await recordInstagramRun({
      runId,
      userId,
      jobId,
      status: 'succeeded',
      startedAt,
      finishedAt,
      channelsTotal: connections.length,
      channelsProcessed: processed,
      partialFailureCount: failures.length,
      errorCode: failures.length > 0 ? 'partial_failure' : '',
      errorMessage: failures.length > 0 ? `${failures.length} account(s) partially failed.` : '',
      accountOutcomes,
    })
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const failureCode = classifyInstagramCollectionError(error)
    const failureMessage = redactInstagramErrorMessage(error instanceof Error ? error.message : 'Instagram refresh failed.')
    await updateInstagramRefreshJob(userId, jobId, {
      status: 'failed',
      finished_at: finishedAt,
      error_message: failureMessage,
      meta: {
        runId,
        errorCode: failureCode,
        selectorVersion: INSTAGRAM_SELECTOR_VERSION,
        collectionMode: instagramCollectorMode,
      },
    })
    await recordInstagramRun({
      runId,
      userId,
      jobId,
      status: 'failed',
      startedAt,
      finishedAt,
      errorCode: failureCode,
      errorMessage: failureMessage,
      accountOutcomes: [],
    })
  } finally {
    instagramRefreshRunningUsers.delete(userId)
  }
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
      const latestActiveAt =
        parseIsoTime(latest.started_at)
        || parseIsoTime(latest.requested_at)
      const isStaleRunningJob =
        latestActiveAt > 0 && Date.now() - latestActiveAt >= REFRESH_JOB_STALE_TIMEOUT_MS
      if (!isStaleRunningJob) {
        return {
          ok: true,
          jobId: latest.id,
          status: latestStatus,
          deduped: true,
        }
      }
      await updateYouTubeRefreshJob(userId, latest.id, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: 'Refresh job timed out and was replaced by a new run.',
      })
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
  if (isServerlessRuntime) {
    const dispatchResult = await dispatchInternalRefreshRunner({
      platform: 'youtube',
      userId,
      jobId,
    })
    if (!dispatchResult.ok) {
      const dispatchError =
        normalizeTextInput(dispatchResult.error, { maxLength: 240 })
        || 'youtube_refresh_runner_dispatch_failed'
      await updateYouTubeRefreshJob(userId, jobId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: 'Unable to dispatch YouTube refresh worker.',
        meta: { trigger, dispatchError },
      })
      return {
        ok: false,
        status: 503,
        error: 'youtube_refresh_job_dispatch_failed',
        payload: { dispatchError },
      }
    }
  } else {
    void runYouTubeRefreshJob(jobId, userId)
  }
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
    const connectionResult = await listAccessibleYouTubeConnectionsByUserId(userId)
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
    const summaryParts = []
    const connectionsByOwnerUserId = new Map()
    const failures = []
    let channelsProcessed = 0

    for (const connection of connections) {
      try {
        const ownerUserId = normalizeTextInput(connection.ownerUserId, { maxLength: 80 })
        const tokenOwnerUserId = isUuid(ownerUserId) ? ownerUserId : userId
        if (isUuid(tokenOwnerUserId)) {
          const existing = connectionsByOwnerUserId.get(tokenOwnerUserId) ?? []
          existing.push(connection)
          connectionsByOwnerUserId.set(tokenOwnerUserId, existing)
        }
        const summaryPart = await withTimeout(
          buildLiveYouTubeSummary({
            sessionId,
            connections: [connection],
            resolveAccessToken: (item) => ensureValidAccessTokenForUser(tokenOwnerUserId, item),
          }),
          YOUTUBE_CHANNEL_REFRESH_TIMEOUT_MS,
          `YouTube refresh timed out for channel ${connection.channelName || connection.channelId}.`,
        )
        if (
          summaryPart
          && typeof summaryPart === 'object'
          && (
            Array.isArray(summaryPart.channels)
            || Array.isArray(summaryPart.topPosts)
            || Array.isArray(summaryPart.timeSeries)
          )
        ) {
          summaryParts.push({ ownerUserId: tokenOwnerUserId, summaryPart })
        }
      } catch (error) {
        failures.push({
          channelId: connection.channelId,
          channelName: connection.channelName || 'YouTube Channel',
          message: error instanceof Error ? error.message : 'YouTube channel refresh failed.',
        })
      } finally {
        channelsProcessed += 1
        await updateYouTubeRefreshJob(userId, jobId, {
          channels_processed: channelsProcessed,
        })
      }
    }

    if (!summaryParts.length && !failures.length) {
      for (const [ownerUserId, ownerConnections] of connectionsByOwnerUserId.entries()) {
        summaryParts.push({
          ownerUserId,
          summaryPart: includeConnectedYouTubeChannelsInSummary(
            buildEmptyYouTubeSummary(),
            ownerConnections,
          ),
        })
      }
    }

    if (!summaryParts.length && failures.length) {
      throw new Error(
        failures[0]?.message
        || `Unable to refresh YouTube data for ${channelsTotal} channel(s).`,
      )
    }

    const summaryPartsByOwner = new Map()
    for (const entry of summaryParts) {
      const ownerUserId = normalizeTextInput(entry?.ownerUserId, { maxLength: 80 })
      if (!isUuid(ownerUserId)) continue
      const existing = summaryPartsByOwner.get(ownerUserId) ?? []
      existing.push(entry.summaryPart)
      summaryPartsByOwner.set(ownerUserId, existing)
    }
    const generatedAt = new Date().toISOString()
    for (const [ownerUserId, ownerParts] of summaryPartsByOwner.entries()) {
      const summary = mergeYouTubeSummaryParts(ownerParts)
      await upsertCachedYouTubeSummary({
        userId: ownerUserId,
        summary,
        generatedAt,
        refreshJobId: jobId,
      })
    }
    const mergedSummaryForMeta = mergeYouTubeSummaryParts(
      summaryParts.map((entry) => entry.summaryPart),
    )

    await updateYouTubeRefreshJob(userId, jobId, {
      status: 'succeeded',
      channels_processed: channelsTotal,
      finished_at: new Date().toISOString(),
      error_message: null,
      meta: {
        channels: channelsTotal,
        failedChannelCount: failures.length,
        failedChannels: failures.slice(0, 25),
        partialSuccess: failures.length > 0,
        timeSeriesPoints: mergedSummaryForMeta.timeSeries.length,
        topPosts: mergedSummaryForMeta.topPosts.length,
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

app.post('/api/instagram/session', async (req, res) => {
  if (!instagramCollectionEnabled) {
    res.status(410).json({
      ok: false,
      error: 'instagram_collection_disabled',
      message: 'Instagram collection is disabled.',
    })
    return
  }
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      ok: false,
      error: viewer.error || 'not_authenticated',
      message: viewer.message || 'Unable to authorize Instagram session update.',
    })
    return
  }
  if (!canRoleConnectAccounts(viewerResult.viewer.appRole)) {
    res.status(403).json({
      ok: false,
      error: 'forbidden',
      message: 'Only admins can update Instagram session vault entries.',
    })
    return
  }
  if (!enforceInstagramEndpointRateLimit(req, res, {
    scope: 'instagram_session_update',
    userId: viewerResult.viewer.userId,
    maxRequests: instagramSessionRateLimitMax,
  })) {
    return
  }
  if (!instagramSessionEncryptionKeyBuffer) {
    res.status(500).json({
      ok: false,
      error: 'instagram_session_encryption_not_configured',
      message: 'Set INSTAGRAM_SESSION_ENCRYPTION_KEY before storing Instagram session cookies.',
    })
    return
  }
  if (!enforceInstagramEndpointRateLimit(req, res, {
    scope: 'instagram_disconnect',
    userId: viewerResult.viewer.userId,
    maxRequests: instagramRefreshRateLimitMax,
  })) {
    return
  }

  const userId = viewerResult.viewer.userId
  const connectionsResult = await listAccessibleInstagramConnectionsByUserId(userId)
  if (!connectionsResult.ok) {
    res.status(connectionsResult.status || 500).json({
      ok: false,
      error: 'instagram_connections_read_failed',
      message: 'Unable to load connected Instagram accounts.',
    })
    return
  }
  const connections = connectionsResult.connections
  if (!connections.length) {
    res.status(400).json({
      ok: false,
      error: 'instagram_connection_not_found',
      message: 'No connected Instagram account was found for this user.',
    })
    return
  }

  const payload = req.body ?? {}
  const requestedAccountId = normalizeTextInput(payload.accountId, { maxLength: 300 }).toLowerCase()
  const requestedAccountName = normalizeTextInput(payload.accountName, { maxLength: 180 })
  const cookies = normalizeInstagramCookieList(payload.cookies)
  if (!cookies.length) {
    res.status(400).json({
      ok: false,
      error: 'invalid_instagram_session_cookies',
      message: 'cookies[] is required and must contain valid cookie objects.',
    })
    return
  }

  let target = null
  if (requestedAccountId) {
    target = connections.find((connection) => connection.accountId.toLowerCase() === requestedAccountId) ?? null
  } else if (requestedAccountName) {
    const normalizedRequestedName = normalizeChannelName(requestedAccountName)
    target = connections.find((connection) => normalizeChannelName(connection.accountName) === normalizedRequestedName) ?? null
  } else if (connections.length === 1) {
    target = connections[0]
  }

  if (!target) {
    res.status(400).json({
      ok: false,
      error: 'instagram_connection_not_found',
      message: connections.length > 1
        ? 'Specify accountId or accountName when multiple Instagram accounts are connected.'
        : 'Instagram connection not found.',
    })
    return
  }

  const upsertResult = await upsertInstagramSessionVaultEntry({
    ownerUserId: target.ownerUserId,
    accountId: target.accountId,
    accountName: target.accountName,
    cookies,
  })
  if (!upsertResult.ok) {
    res.status(upsertResult.status || 500).json({
      ok: false,
      error: upsertResult.error || 'instagram_session_vault_update_failed',
    })
    return
  }

  res.json({
    ok: true,
    accountId: target.accountId,
    accountName: target.accountName,
    ownerUserId: target.ownerUserId,
    storedCookies: cookies.length,
  })
})

app.get('/api/instagram/connections', async (req, res) => {
  if (!instagramCollectionEnabled) {
    res.json({
      count: 0,
      connections: [],
      disabled: true,
    })
    return
  }
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
  if (!canRoleConnectAccounts(viewerResult.viewer.appRole)) {
    res.status(403).json({
      count: 0,
      connections: [],
      error: 'forbidden',
      message: 'Only admins can manage connected platforms.',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const connectionsResult = await listAccessibleInstagramConnectionsByUserId(userId)
  if (!connectionsResult.ok) {
    res.status(connectionsResult.status || 500).json({
      count: 0,
      connections: [],
      error: 'instagram_connections_read_failed',
    })
    return
  }

  const summarized = connectionsResult.connections.map((connection) => ({
    accountId: connection.accountId,
    accountName: connection.accountName,
  }))
  res.json({ count: summarized.length, connections: summarized })
})

app.post('/api/instagram/refresh', async (req, res) => {
  if (!instagramCollectionEnabled) {
    res.status(410).json({
      error: 'instagram_collection_disabled',
      message: 'Instagram collection is disabled.',
    })
    return
  }
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      error: viewer.error || 'not_authenticated',
      message: viewer.message || 'Unable to authorize refresh.',
    })
    return
  }
  if (!canViewerRefreshConnectedAccountData(viewerResult.viewer)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization internal/admin members can refresh Instagram data.',
    })
    return
  }
  if (!enforceInstagramEndpointRateLimit(req, res, {
    scope: 'instagram_refresh_trigger',
    userId: viewerResult.viewer.userId,
    maxRequests: instagramRefreshRateLimitMax,
  })) {
    return
  }

  const userId = viewerResult.viewer.userId
  const queued = await createAndStartInstagramRefreshJob(userId, {
    trigger: 'manual',
    reuseRunning: true,
    minIntervalMs: 0,
  })
  if (!queued.ok) {
    res.status(queued.status || 500).json({
      error: queued.error || 'instagram_refresh_job_create_failed',
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

app.get('/api/instagram/refresh/:jobId', async (req, res) => {
  if (!instagramCollectionEnabled) {
    res.status(410).json({
      error: 'instagram_collection_disabled',
      message: 'Instagram collection is disabled.',
    })
    return
  }
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      error: viewer.error || 'not_authenticated',
      message: viewer.message || 'Unable to authorize refresh status lookup.',
    })
    return
  }
  if (!canViewerRefreshConnectedAccountData(viewerResult.viewer)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization internal/admin members can check Instagram refresh jobs.',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const jobId = normalizeTextInput(req.params?.jobId, { maxLength: 80 })
  if (!isUuid(jobId)) {
    res.status(400).json({ error: 'invalid_job_id' })
    return
  }

  const jobResult = await getInstagramRefreshJob(userId, jobId)
  if (!jobResult.ok) {
    res.status(jobResult.status || 500).json({
      error: 'instagram_refresh_job_lookup_failed',
    })
    return
  }
  if (!jobResult.row) {
    res.status(404).json({ error: 'instagram_refresh_job_not_found' })
    return
  }

  res.json({
    id: jobResult.row.id,
    status: normalizeTextInput(jobResult.row.status, { maxLength: 32 }) || 'queued',
    requestedAt: jobResult.row.requested_at ?? null,
    startedAt: jobResult.row.started_at ?? null,
    finishedAt: jobResult.row.finished_at ?? null,
    channelsTotal: Math.max(0, toNumber(jobResult.row.channels_total)),
    channelsProcessed: Math.max(0, toNumber(jobResult.row.channels_processed)),
    errorMessage: normalizeTextInput(jobResult.row.error_message, { maxLength: 400 }),
    meta: jobResult.row.meta && typeof jobResult.row.meta === 'object' ? jobResult.row.meta : {},
  })
})

app.get('/api/instagram/summary', async (req, res) => {
  if (!instagramCollectionEnabled) {
    res.json({
      ...buildEmptyInstagramSummary(),
      cacheStatus: 'disabled',
      generatedAt: null,
      autoRefresh: { queued: false },
    })
    return
  }
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      ...buildEmptyInstagramSummary(),
      error: viewer.error || 'not_authenticated',
      cacheStatus: 'error',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const connectionsResult = await listAccessibleInstagramConnectionsByUserId(userId)
  if (!connectionsResult.ok) {
    res.status(connectionsResult.status || 500).json({
      ...buildEmptyInstagramSummary(),
      error: 'instagram_scope_lookup_failed',
      cacheStatus: 'error',
    })
    return
  }

  const connections = connectionsResult.connections
  const accountIdsByOwnerUserId = new Map()
  for (const connection of connections) {
    const ownerUserId = normalizeTextInput(connection.ownerUserId, { maxLength: 80 })
    const accountId = normalizeTextInput(connection.accountId, { maxLength: 300 }).toLowerCase()
    if (!isUuid(ownerUserId) || !accountId) continue
    const channelId = `instagram:${accountId}`
    const existing = accountIdsByOwnerUserId.get(ownerUserId) ?? new Set()
    existing.add(channelId)
    accountIdsByOwnerUserId.set(ownerUserId, existing)
  }
  const autoRefresh = { queued: false }

  if (!accountIdsByOwnerUserId.size) {
    res.json({
      ...buildEmptyInstagramSummary(),
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

  const summaryParts = []
  let latestGeneratedAt = null
  let latestGeneratedAtMs = 0
  for (const [ownerUserId, allowedChannelIds] of accountIdsByOwnerUserId.entries()) {
    const cachedResult = await getCachedInstagramSummaryByUserId(ownerUserId)
    if (!cachedResult.ok || !cachedResult.row?.summary_json) continue
    const normalizedSummary = normalizeCachedInstagramSummaryPayload(cachedResult.row.summary_json)
    const scopedSummary = scopeCachedSummaryToConnectedChannelIds(normalizedSummary, allowedChannelIds)
    if (
      scopedSummary.channels.length
      || scopedSummary.topPosts.length
      || scopedSummary.timeSeries.length
      || scopedSummary.timeSeriesByChannel.length
    ) {
      summaryParts.push(scopedSummary)
    }
    const generatedAtRaw = normalizeTextInput(cachedResult.row.generated_at, { maxLength: 64 })
    const generatedAtMs = parseIsoTime(generatedAtRaw)
    if (generatedAtMs > latestGeneratedAtMs) {
      latestGeneratedAtMs = generatedAtMs
      latestGeneratedAt = generatedAtRaw || null
    }
  }

  if (!summaryParts.length) {
    res.json({
      ...buildEmptyInstagramSummary(),
      cacheStatus: 'empty',
      generatedAt: latestGeneratedAt,
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

  const summary = mergeInstagramSummaryParts(summaryParts)
  res.json({
    ...summary,
    cacheStatus: 'ready',
    generatedAt: latestGeneratedAt,
    autoRefresh: autoRefresh.queued
      ? {
          queued: true,
          jobId: autoRefresh.jobId ?? null,
          status: autoRefresh.status ?? 'queued',
        }
      : { queued: false },
  })
})

app.post('/api/x/refresh', async (req, res) => {
  if (!xCollectionEnabled) {
    res.status(410).json({
      error: 'x_collection_disabled',
      message: 'X collection is disabled.',
    })
    return
  }
  if (!isSupabaseConfigured) {
    res.status(503).json({
      error: 'x_storage_not_configured',
      message: 'X storage is not configured.',
    })
    return
  }
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      error: viewer.error || 'not_authenticated',
      message: viewer.message || 'Unable to authorize X refresh.',
    })
    return
  }
  if (!canViewerRefreshConnectedAccountData(viewerResult.viewer)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization internal/admin members can refresh X data.',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const connectionsResult = await listAccessibleXConnectionsByUserId(userId, { accessScope: 'view' })
  if (!connectionsResult.ok) {
    res.status(connectionsResult.status || 500).json({
      error: 'x_connections_read_failed',
      message: 'Unable to load connected X accounts.',
    })
    return
  }
  const dedupedConnections = new Map()
  for (const connection of connectionsResult.connections) {
    const xUserId = normalizeXUserId(connection.userId)
    if (!xUserId || dedupedConnections.has(xUserId)) continue
    dedupedConnections.set(xUserId, connection)
  }
  if (!dedupedConnections.size) {
    res.json({
      ok: true,
      refreshedAccounts: 0,
      postsCollected: 0,
      failedAccounts: [],
      partialSuccess: false,
    })
    return
  }

  let refreshedAccounts = 0
  let postsCollected = 0
  const failedAccounts = []

  for (const connection of dedupedConnections.values()) {
    const xUserId = normalizeXUserId(connection.userId)
    const username = normalizeXUsername(connection.accountName)
    const ownerUserId = normalizeTextInput(connection.ownerUserId, { maxLength: 80 })
    const syncResult = await refreshAndPersistXAccount({
      userId: xUserId,
      username,
      ownerUserId,
    })
    if (!syncResult.ok) {
      failedAccounts.push({
        userId: xUserId,
        username,
        error: normalizeTextInput(syncResult.error, { maxLength: 120 }) || 'x_refresh_failed',
        message: normalizeTextInput(syncResult.message, { maxLength: 240 }) || '',
        status: Math.max(0, toNumber(syncResult.status)),
      })
      continue
    }
    refreshedAccounts += 1
    postsCollected += Math.max(0, toNumber(syncResult.postCount))
  }

  const partialSuccess = refreshedAccounts > 0 && failedAccounts.length > 0
  res.json({
    ok: failedAccounts.length === 0,
    partialSuccess,
    refreshedAccounts,
    postsCollected,
    failedAccounts,
  })
})

app.get('/api/x/summary', async (req, res) => {
  if (!isSupabaseConfigured) {
    res.json({
      ...buildEmptyInstagramSummary(),
      cacheStatus: 'disabled',
      generatedAt: null,
      autoRefresh: { queued: false },
    })
    return
  }
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      ...buildEmptyInstagramSummary(),
      error: viewer.error || 'not_authenticated',
      cacheStatus: 'error',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const connectionsResult = await listAccessibleXConnectionsByUserId(userId)
  if (!connectionsResult.ok) {
    res.status(connectionsResult.status || 500).json({
      ...buildEmptyInstagramSummary(),
      error: 'x_scope_lookup_failed',
      cacheStatus: 'error',
    })
    return
  }

  const accountNameByUserId = new Map()
  for (const connection of connectionsResult.connections) {
    const xUserId = normalizeXUserId(connection.userId)
    if (!xUserId) continue
    if (!accountNameByUserId.has(xUserId)) {
      accountNameByUserId.set(
        xUserId,
        normalizeTextInput(connection.accountName, { maxLength: 180 }) || `X Account ${xUserId}`,
      )
    }
  }
  const userIds = [...accountNameByUserId.keys()]
  if (!userIds.length) {
    res.json({
      ...buildEmptyInstagramSummary(),
      cacheStatus: 'empty',
      generatedAt: null,
      autoRefresh: { queued: false },
    })
    return
  }

  const xRowsResult = await listXRowsByUserIds(userIds)
  if (!xRowsResult.ok) {
    res.status(xRowsResult.status || 500).json({
      ...buildEmptyInstagramSummary(),
      error: 'x_rows_read_failed',
      cacheStatus: 'error',
    })
    return
  }

  const summaryParts = xRowsResult.rows
    .map((row) => mapXRowToSummaryPart(row, { accountNameByUserId }))
    .filter((part) =>
      part.channels.length
      || part.topPosts.length
      || part.timeSeries.length
      || part.timeSeriesByChannel.length)

  const generatedAt = xRowsResult.rows
    .map((row) => normalizeTextInput(row?.created_at, { maxLength: 64 }))
    .filter((value) => Boolean(value))
    .sort((left, right) => parseIsoTime(right) - parseIsoTime(left))[0] || null

  if (!summaryParts.length) {
    res.json({
      ...buildEmptyInstagramSummary(),
      cacheStatus: 'empty',
      generatedAt,
      autoRefresh: { queued: false },
    })
    return
  }

  const summary = mergeInstagramSummaryParts(summaryParts)
  res.json({
    ...summary,
    cacheStatus: 'ready',
    generatedAt,
    autoRefresh: { queued: false },
  })
})

app.get('/api/instagram/ops', async (req, res) => {
  if (!instagramCollectionEnabled) {
    res.json({
      ok: true,
      disabled: true,
      collectorMode: instagramCollectorMode,
      selectorVersion: INSTAGRAM_SELECTOR_VERSION,
    })
    return
  }
  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      ok: false,
      error: viewer.error || 'not_authenticated',
      message: viewer.message || 'Unable to authorize Instagram ops status lookup.',
    })
    return
  }
  if (!canRoleConnectAccounts(viewerResult.viewer.appRole)) {
    res.status(403).json({
      ok: false,
      error: 'forbidden',
      message: 'Only admins can view Instagram operations metrics.',
    })
    return
  }

  trimInstagramOpsState()
  const persistedOpsResult = await loadPersistedInstagramOpsByUserId(viewerResult.viewer.userId)
  if (!persistedOpsResult.ok) {
    res.status(persistedOpsResult.status || 500).json({
      ok: false,
      error: 'instagram_ops_read_failed',
      message: 'Unable to load persisted Instagram operations data.',
    })
    return
  }
  const nowMs = Date.now()
  const localRuns = instagramOpsState.runs.filter(
    (entry) => nowMs - toNumber(entry.finishedAtMs || entry.startedAtMs) <= instagramOpsRunWindowMs,
  )
  const combinedRunMap = new Map()
  persistedOpsResult.recentRuns.forEach((entry) => {
    const normalizedEntry = normalizeInstagramOpsRunEntry(entry)
    if (!normalizedEntry) return
    const key = normalizedEntry.runId || normalizedEntry.jobId || `${normalizedEntry.startedAt}:${normalizedEntry.status}`
    if (!key) return
    combinedRunMap.set(key, {
      ...normalizedEntry,
      startedAtMs: parseIsoTime(normalizedEntry.startedAt),
      finishedAtMs: parseIsoTime(normalizedEntry.finishedAt),
    })
  })
  localRuns.forEach((entry) => {
    const key = normalizeTextInput(entry.runId, { maxLength: 80 })
      || normalizeTextInput(entry.jobId, { maxLength: 80 })
      || `${normalizeTextInput(entry.startedAt, { maxLength: 64 })}:${normalizeTextInput(entry.status, { maxLength: 32 })}`
    if (!key) return
    combinedRunMap.set(key, entry)
  })
  const recentRuns = [...combinedRunMap.values()]
    .sort((left, right) => toNumber(right.finishedAtMs || right.startedAtMs) - toNumber(left.finishedAtMs || left.startedAtMs))
    .slice(0, instagramOpsRecentRunLimit)
  const successfulRuns = recentRuns.filter((entry) => normalizeTextInput(entry.status, { maxLength: 32 }) === 'succeeded').length
  const failedRuns = recentRuns.length - successfulRuns

  const combinedAlertMap = new Map()
  persistedOpsResult.recentAlerts.forEach((entry) => {
    const normalizedEntry = normalizeInstagramOpsAlertEntry(entry)
    if (!normalizedEntry) return
    const key = normalizedEntry.id || `${normalizedEntry.type}:${normalizedEntry.createdAt}`
    combinedAlertMap.set(key, normalizedEntry)
  })
  instagramOpsState.alerts.forEach((entry) => {
    const key = normalizeTextInput(entry.id, { maxLength: 80 }) || `${normalizeTextInput(entry.type, { maxLength: 64 })}:${normalizeTextInput(entry.createdAt, { maxLength: 64 })}`
    if (!key) return
    combinedAlertMap.set(key, entry)
  })
  const latestAlerts = [...combinedAlertMap.values()]
    .sort((left, right) => parseIsoTime(right.createdAt) - parseIsoTime(left.createdAt))
    .slice(0, 20)

  const highestPersistedFailureStreak = persistedOpsResult.accountSnapshots.reduce(
    (max, snapshot) => Math.max(max, Math.max(0, Number(snapshot.instagramOps?.failureStreak) || 0)),
    0,
  )
  const highestInMemoryFailureStreak = [...instagramOpsState.failureStreakByUser.values()]
    .reduce((max, streak) => Math.max(max, Math.max(0, toNumber(streak?.count))), 0)
  const combinedFailureRatePct = recentRuns.length
    ? (failedRuns / recentRuns.length) * 100
    : 0
  const queueStats = await getInstagramRefreshJobQueueStats()
  const runningJobs = queueStats.runningJobs
  const queuedJobs = queueStats.queuedJobs

  res.json({
    ok: true,
    selectorVersion: INSTAGRAM_SELECTOR_VERSION,
    collectorMode: instagramCollectorMode,
    refreshMaxConcurrency: instagramRefreshMaxConcurrency,
    retryPolicy: {
      maxRetries: instagramCollectorMaxRetries,
      baseDelayMs: instagramCollectorRetryBaseDelayMs,
      jitterMs: instagramCollectorRetryJitterMs,
    },
    rateLimit: {
      windowMs: instagramRateLimitWindowMs,
      refreshMax: instagramRefreshRateLimitMax,
      sessionMax: instagramSessionRateLimitMax,
    },
    alerts: {
      failureStreakThreshold: instagramAlertFailureStreakThreshold,
      failureRateThresholdPct: instagramAlertFailureRateThresholdPct,
      failureRateMinRuns: instagramAlertFailureRateMinRuns,
    },
    persistence: {
      source: 'Organizations.connected_accounts[].instagramOps',
      accountSnapshots: persistedOpsResult.accountSnapshots.length,
    },
    windowMs: instagramOpsRunWindowMs,
    recent: {
      totalRuns: recentRuns.length,
      successfulRuns,
      failedRuns,
      failureRatePct: Number(combinedFailureRatePct.toFixed(2)),
      highestFailureStreak: Math.max(highestPersistedFailureStreak, highestInMemoryFailureStreak),
      runningJobs,
      queuedJobs,
    },
    latestRuns: recentRuns.slice(0, 20),
    latestAlerts,
    accountSnapshots: persistedOpsResult.accountSnapshots.slice(0, 50),
  })
})

app.post('/api/instagram/disconnect', async (req, res) => {
  const payload = req.body ?? {}
  const accountNames = Array.isArray(payload.accountNames)
    ? payload.accountNames
      .map((name) => normalizeTextInput(name, { maxLength: 180 }))
      .filter((name) => Boolean(name))
    : []

  const viewerResult = await resolveYouTubeViewer(req, res)
  if (!viewerResult.ok) {
    const viewer = viewerResult.viewer
    res.status(viewer.status || 401).json({
      ok: false,
      error: viewer.error || 'not_authenticated',
      message: viewer.message || 'Unable to disconnect Instagram accounts.',
    })
    return
  }
  if (!canRoleConnectAccounts(viewerResult.viewer.appRole)) {
    res.status(403).json({
      ok: false,
      error: 'forbidden',
      message: 'Only admins can disconnect Instagram accounts.',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const organizationsResult = await listOrganizationRows()
  if (!organizationsResult.ok) {
    res.status(organizationsResult.status || 500).json({
      ok: false,
      error: 'organization_connections_update_failed',
      message: 'Unable to load organizations from Supabase.',
    })
    return
  }

  const blockedNames = new Set(accountNames.map((name) => normalizeChannelName(name)))
  const removedVaultKeys = new Set()
  let removed = 0
  let remaining = 0

  for (const row of organizationsResult.rows) {
    if (!canUserSeeOrganization(row, userId)) continue
    if (!canUserManageOrganizationConnections(row, userId)) continue

    const organizationId = normalizeTextInput(row?.id, { maxLength: 80 })
    if (!isUuid(organizationId)) continue
    const fallbackOwnerUserId = normalizeTextInput(row?.creator, { maxLength: 80 })
    const accounts = normalizeOrganizationConnectedAccounts(row?.connected_accounts)
    const nextAccounts = []

    for (const account of accounts) {
      const platform = normalizeOrganizationConnectionPlatform(account.platform)
      if (platform !== ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM) {
        nextAccounts.push(account)
        continue
      }
      const normalizedAccountName = normalizeChannelName(account.accountName)
      const shouldRemove = !blockedNames.size || blockedNames.has(normalizedAccountName)
      if (!shouldRemove) {
        remaining += 1
        nextAccounts.push(account)
        continue
      }

      const ownerUserIdRaw = normalizeTextInput(account.ownerUserId, { maxLength: 80 })
      const ownerUserId =
        isUuid(ownerUserIdRaw) ? ownerUserIdRaw : isUuid(fallbackOwnerUserId) ? fallbackOwnerUserId : ''
      const accountId = resolveInstagramAccountId(account)
      const vaultKey = buildInstagramVaultKey({ ownerUserId, accountId })
      if (vaultKey) {
        removedVaultKeys.add(vaultKey)
      }
      removed += 1
    }

    if (nextAccounts.length !== accounts.length) {
      const updateResult = await updateOrganizationConnectedAccounts(organizationId, nextAccounts)
      if (!updateResult.ok) {
        res.status(updateResult.status || 500).json({
          ok: false,
          error: 'organization_connections_update_failed',
          message: 'Unable to update organization connections in Supabase.',
          details: updateResult.payload,
        })
        return
      }
    }
  }

  if (removedVaultKeys.size) {
    await deleteInstagramSessionVaultEntries((_entry, key) => removedVaultKeys.has(key))
  }
  await deleteCachedInstagramSummaryByUserId(userId)

  res.json({ ok: true, removed, remaining })
})

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
  if (!canRoleConnectAccounts(viewerResult.viewer.appRole)) {
    res.status(403).json({
      ok: false,
      error: 'forbidden',
      message: 'Only admins can initialize YouTube reporting jobs.',
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
  if (!canViewerRefreshConnectedAccountData(viewerResult.viewer)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization internal/admin members can refresh YouTube data.',
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
  if (!canViewerRefreshConnectedAccountData(viewerResult.viewer)) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Only organization internal/admin members can check YouTube refresh jobs.',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const jobId = normalizeTextInput(req.params?.jobId, { maxLength: 80 })
  if (!isUuid(jobId)) {
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
  if (!canRoleConnectAccounts(viewerResult.viewer.appRole)) {
    res.status(403).json({
      count: 0,
      connections: [],
      error: 'forbidden',
      message: 'Only admins can manage connected platforms.',
    })
    return
  }

  const userId = viewerResult.viewer.userId
  const connectionsResult = await listAccessibleYouTubeConnectionsByUserId(userId, { accessScope: 'view' })
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
  const connectionsResult = await listAccessibleYouTubeConnectionsByUserId(userId)
  if (!connectionsResult.ok) {
    res.status(connectionsResult.status || 500).json({
      ...buildEmptyYouTubeSummary(),
      error: 'youtube_scope_lookup_failed',
      cacheStatus: 'error',
    })
    return
  }

  const channelIdsByOwnerUserId = new Map()
  for (const connection of connectionsResult.connections) {
    const ownerUserId = normalizeTextInput(connection.ownerUserId, { maxLength: 80 })
    const channelId = normalizeTextInput(connection.channelId, { maxLength: 300 })
    if (!isUuid(ownerUserId) || !channelId) continue
    const existing = channelIdsByOwnerUserId.get(ownerUserId) ?? new Set()
    existing.add(channelId)
    channelIdsByOwnerUserId.set(ownerUserId, existing)
  }
  const autoRefresh = { queued: false }

  if (!channelIdsByOwnerUserId.size) {
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

  const summaryParts = []
  let latestGeneratedAt = null
  let latestGeneratedAtMs = 0
  for (const [ownerUserId, allowedChannelIds] of channelIdsByOwnerUserId.entries()) {
    const cachedResult = await getCachedYouTubeSummaryByUserId(ownerUserId)
    if (!cachedResult.ok || !cachedResult.row?.summary_json) continue
    const normalizedSummary = normalizeCachedSummaryPayload(cachedResult.row.summary_json)
    const scopedSummary = scopeCachedSummaryToConnectedChannelIds(normalizedSummary, allowedChannelIds)
    if (
      scopedSummary.channels.length
      || scopedSummary.topPosts.length
      || scopedSummary.timeSeries.length
      || scopedSummary.timeSeriesByChannel.length
    ) {
      summaryParts.push(scopedSummary)
    }
    const generatedAtRaw = normalizeTextInput(cachedResult.row.generated_at, { maxLength: 64 })
    const generatedAtMs = parseIsoTime(generatedAtRaw)
    if (generatedAtMs > latestGeneratedAtMs) {
      latestGeneratedAtMs = generatedAtMs
      latestGeneratedAt = generatedAtRaw || null
    }
  }

  if (!summaryParts.length) {
    const summaryWithConnectedChannels = includeConnectedYouTubeChannelsInSummary(
      buildEmptyYouTubeSummary(),
      connectionsResult.connections,
    )
    res.json({
      ...summaryWithConnectedChannels,
      cacheStatus: 'empty',
      generatedAt: latestGeneratedAt,
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

  const summary = includeConnectedYouTubeChannelsInSummary(
    mergeYouTubeSummaryParts(summaryParts),
    connectionsResult.connections,
  )
  res.json({
    ...summary,
    cacheStatus: 'ready',
    generatedAt: latestGeneratedAt,
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
  if (!canRoleConnectAccounts(viewerResult.viewer.appRole)) {
    res.status(403).json({
      ok: false,
      error: 'forbidden',
      message: 'Only admins can disconnect YouTube channels.',
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
  res.clearCookie(GOOGLE_OAUTH_CONTEXT_COOKIE)
  res.clearCookie('youtube_oauth_state')
  res.clearCookie(YOUTUBE_OAUTH_CONTEXT_COOKIE)
  res.clearCookie(INSTAGRAM_OAUTH_STATE_COOKIE)
  res.clearCookie(INSTAGRAM_OAUTH_CONTEXT_COOKIE)
  res.clearCookie(X_OAUTH_STATE_COOKIE)
  res.clearCookie(X_OAUTH_CONTEXT_COOKIE)
  res.clearCookie(APP_REDIRECT_COOKIE)
  res.clearCookie(YOUTUBE_SESSION_COOKIE)
  res.clearCookie(YOUTUBE_CONNECTIONS_COOKIE)
  clearSupabaseSessionCookies(res)
  res.sendStatus(204)
})

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

const runScheduledInstagramAutoRefresh = async () => {
  if (!instagramCollectionEnabled) return
  const organizationsResult = await listOrganizationRows()
  if (!organizationsResult.ok) return
  const ownerUserIds = new Set()
  for (const row of organizationsResult.rows) {
    const fallbackOwnerUserId = normalizeTextInput(row?.creator, { maxLength: 80 })
    const accounts = normalizeOrganizationConnectedAccounts(row?.connected_accounts)
    for (const account of accounts) {
      if (normalizeOrganizationConnectionPlatform(account.platform) !== ORGANIZATION_CONNECTION_PLATFORM_INSTAGRAM) continue
      const ownerUserIdRaw = normalizeTextInput(account.ownerUserId, { maxLength: 80 })
      const ownerUserId =
        isUuid(ownerUserIdRaw) ? ownerUserIdRaw : isUuid(fallbackOwnerUserId) ? fallbackOwnerUserId : ''
      if (isUuid(ownerUserId)) {
        ownerUserIds.add(ownerUserId)
      }
    }
  }

  for (const userId of ownerUserIds.values()) {
    if (instagramRefreshRunningUsers.has(userId)) continue
    const cachedResult = await getCachedInstagramSummaryByUserId(userId)
    const generatedAt =
      cachedResult.ok && typeof cachedResult.row?.generated_at === 'string'
        ? cachedResult.row.generated_at
        : ''
    await maybeQueueAutoInstagramRefresh({
      userId,
      hasConnections: true,
      generatedAt,
    })
  }
}

const runScheduledTaskSafely = async (taskName, task) => {
  try {
    await task()
  } catch (error) {
    console.error(`${taskName} failed:`, error)
  }
}

if (!isServerlessRuntime) {
  void runScheduledTaskSafely('runScheduledYouTubeAutoRefresh', runScheduledYouTubeAutoRefresh)
  if (instagramCollectionEnabled) {
    void runScheduledTaskSafely('runScheduledInstagramAutoRefresh', runScheduledInstagramAutoRefresh)
  }
  setInterval(() => {
    void runScheduledTaskSafely('runScheduledYouTubeAutoRefresh', runScheduledYouTubeAutoRefresh)
    if (instagramCollectionEnabled) {
      void runScheduledTaskSafely('runScheduledInstagramAutoRefresh', runScheduledInstagramAutoRefresh)
    }
  }, 60 * 60 * 1000)
  app.listen(port, () => {
    console.log(`Auth server listening on ${serverBaseUrl}`)
  })
}

export {
  app,
  isValidInternalRefreshRunnerToken,
  runInstagramRefreshJob,
  runYouTubeRefreshJob,
}
