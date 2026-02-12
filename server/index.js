import 'dotenv/config'
import crypto from 'node:crypto'
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
const redirectUri = getEnv('GOOGLE_REDIRECT_URI', `${serverBaseUrl}/oauth/google/callback`)
const scope = getEnv('GOOGLE_SCOPE', 'openid email profile')
const youtubeClientId = getEnv('YOUTUBE_CLIENT_ID', clientId)
const youtubeClientSecret = getEnv('YOUTUBE_CLIENT_SECRET', clientSecret)
const youtubeRedirectUri = getEnv(
  'YOUTUBE_REDIRECT_URI',
  `${serverBaseUrl}/oauth/youtube/callback`,
)
const youtubeScope = getEnv('YOUTUBE_SCOPE', 'https://www.googleapis.com/auth/youtube.readonly')

const parsedServerUrl = new URL(serverBaseUrl)
const port = Number(getEnv('PORT', parsedServerUrl.port || '5000'))
const isProd = getEnv('NODE_ENV') === 'production'

const buildAppRedirect = ({ status, message, provider = 'google', path = '/login', extraParams = {} }) => {
  const params = new URLSearchParams({ status, provider })
  if (message) params.set('message', message)
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(key, String(value))
  })
  return `${appBaseUrl}${path}?${params.toString()}`
}

const fetchYouTubeChannelName = async (accessToken) => {
  try {
    const response = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=1',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    )

    if (!response.ok) return ''
    const payload = await response.json().catch(() => ({}))
    const channelTitle = payload?.items?.[0]?.snippet?.title
    if (typeof channelTitle !== 'string') return ''
    return channelTitle.trim()
  } catch (_err) {
    return ''
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
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', appBaseUrl)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/oauth/google', (_req, res) => {
  if (!clientId || !clientSecret || !redirectUri) {
    res.redirect(buildAppRedirect({ status: 'error', message: 'Google OAuth not configured.' }))
    return
  }

  const state = crypto.randomBytes(16).toString('hex')
  res.cookie('google_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
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

    res.clearCookie('google_oauth_state')
    res.redirect(buildAppRedirect({ status: 'success' }))
  } catch (_err) {
    res.redirect(buildAppRedirect({ status: 'error', message: 'Google login failed.' }))
  }
})

app.get('/oauth/youtube', (_req, res) => {
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

  const state = crypto.randomBytes(16).toString('hex')
  res.cookie('youtube_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
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

  if (error) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: typeof errorDescription === 'string' ? errorDescription : 'YouTube connection failed.',
        path: '/settings',
      }),
    )
    return
  }

  if (!state || !expectedState || state !== expectedState) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: 'YouTube connection state mismatch.',
        path: '/settings',
      }),
    )
    return
  }

  if (!code || typeof code !== 'string') {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: 'Missing authorization code.',
        path: '/settings',
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
        }),
      )
      return
    }

    const youtubeChannelName = await fetchYouTubeChannelName(accessToken)
    const fallbackProfileName = youtubeChannelName ? '' : await fetchGoogleProfileName(accessToken)
    const connectedDisplayName = youtubeChannelName || fallbackProfileName

    res.clearCookie('youtube_oauth_state')
    res.redirect(
      buildAppRedirect({
        status: 'success',
        provider: 'youtube',
        path: '/settings',
        extraParams: { youtube_channel_name: connectedDisplayName },
      }),
    )
  } catch (_err) {
    res.redirect(
      buildAppRedirect({
        status: 'error',
        provider: 'youtube',
        message: 'YouTube connection failed.',
        path: '/settings',
      }),
    )
  }
})

app.post('/auth/logout', (_req, res) => {
  res.clearCookie('google_oauth_state')
  res.clearCookie('youtube_oauth_state')
  res.sendStatus(204)
})

const isServerlessRuntime = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME)

if (!isServerlessRuntime) {
  app.listen(port, () => {
    console.log(`Auth server listening on ${serverBaseUrl}`)
  })
}

export { app }
