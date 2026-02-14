import { resolveAuthBaseUrl } from './baseUrl'

export const getGoogleLoginUrl = () => `${resolveAuthBaseUrl()}/oauth/google`
export const getYouTubeConnectUrl = () => {
  const base = resolveAuthBaseUrl()
  if (typeof window === 'undefined') return `${base}/oauth/youtube`
  const url = new URL(`${base}/oauth/youtube`)
  url.searchParams.set('app_origin', window.location.origin)
  return url.toString()
}

export interface SessionStatus {
  authenticated: boolean
  userId?: string
  email?: string
}

export const fetchSessionStatus = async (): Promise<SessionStatus> => {
  try {
    const response = await fetch(`${resolveAuthBaseUrl()}/auth/session`, {
      credentials: 'include',
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      return { authenticated: false }
    }
    const authenticated = Boolean(payload && typeof payload === 'object' && payload.authenticated)
    const userId = payload && typeof payload === 'object' && typeof payload.userId === 'string'
      ? payload.userId
      : undefined
    const email = payload && typeof payload === 'object' && typeof payload.email === 'string'
      ? payload.email
      : undefined
    return { authenticated, userId, email }
  } catch {
    return { authenticated: false }
  }
}

export const logout = async () => {
  try {
    await fetch(`${resolveAuthBaseUrl()}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // no-op: local state will be cleared regardless
  }
}
