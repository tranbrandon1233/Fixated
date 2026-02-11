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

const getEnv = (key, fallback = '') => normalizeEnvValue(process.env[key] ?? fallback)

const serverBaseUrl = getEnv('SERVER_BASE_URL', 'https://fixated-dashboard.netlify.app')
const appBaseUrl = getEnv('APP_BASE_URL', 'https://fixated-dashboard.netlify.app')
const clientId = getEnv('GOOGLE_CLIENT_ID')
const clientSecret = getEnv('GOOGLE_CLIENT_SECRET')
const redirectUri = getEnv('GOOGLE_REDIRECT_URI', `${serverBaseUrl}/oauth/google/callback`)
const scope = getEnv('GOOGLE_SCOPE', 'openid email profile')

const parsedServerUrl = new URL(serverBaseUrl)
const port = Number(getEnv('PORT', parsedServerUrl.port || '5000'))
const isProd = getEnv('NODE_ENV') === 'production'

const buildAppRedirect = ({ status, message, provider = 'google' }) => {
  const params = new URLSearchParams({ status, provider })
  if (message) params.set('message', message)
  return `${appBaseUrl}/login?${params.toString()}`
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

app.post('/auth/logout', (_req, res) => {
  res.clearCookie('google_oauth_state')
  res.sendStatus(204)
})

const isServerlessRuntime = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME)

if (!isServerlessRuntime) {
  app.listen(port, () => {
    console.log(`Auth server listening on ${serverBaseUrl}`)
  })
}

export { app }
