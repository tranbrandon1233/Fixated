import { resolveAuthBaseUrl } from './baseUrl'
import type { Role } from '../types/dashboard'

export const getGoogleLoginUrl = () => {
  const base = resolveAuthBaseUrl()
  if (typeof window === 'undefined') return `${base}/oauth/google`
  const url = new URL(`${base}/oauth/google`)
  url.searchParams.set('app_origin', window.location.origin)
  return url.toString()
}
export interface YouTubeConnectUrlOptions {
  organizationId?: string
  path?: string
}

export const getYouTubeConnectUrl = (options?: YouTubeConnectUrlOptions) => {
  const base = resolveAuthBaseUrl()
  if (typeof window === 'undefined') return `${base}/oauth/youtube`
  const url = new URL(`${base}/oauth/youtube`)
  url.searchParams.set('app_origin', window.location.origin)
  if (options?.organizationId) {
    url.searchParams.set('organization_id', options.organizationId)
  }
  if (options?.path) {
    url.searchParams.set('path', options.path)
  }
  return url.toString()
}

export interface InstagramConnectUrlOptions {
  organizationId?: string
  path?: string
}

export const getInstagramConnectUrl = (options?: InstagramConnectUrlOptions) => {
  const base = resolveAuthBaseUrl()
  if (typeof window === 'undefined') return `${base}/oauth/instagram`
  const url = new URL(`${base}/oauth/instagram`)
  url.searchParams.set('app_origin', window.location.origin)
  if (options?.organizationId) {
    url.searchParams.set('organization_id', options.organizationId)
  }
  if (options?.path) {
    url.searchParams.set('path', options.path)
  }
  return url.toString()
}

export interface XConnectUrlOptions {
  organizationId?: string
  path?: string
}

export const getXConnectUrl = (options?: XConnectUrlOptions) => {
  const base = resolveAuthBaseUrl()
  if (typeof window === 'undefined') return `${base}/oauth/x`
  const url = new URL(`${base}/oauth/x`)
  url.searchParams.set('app_origin', window.location.origin)
  if (options?.organizationId) {
    url.searchParams.set('organization_id', options.organizationId)
  }
  if (options?.path) {
    url.searchParams.set('path', options.path)
  }
  return url.toString()
}

export interface SessionStatus {
  authenticated: boolean
  userId?: string
  email?: string
  role?: Role
  transientError?: boolean
}

const normalizeRole = (value: unknown): Role => {
  if (typeof value !== 'string') return 'admin'
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('admin')) return 'admin'
  if (normalized.includes('brand')) return 'brand'
  return 'internal'
}

export const fetchSessionStatus = async (): Promise<SessionStatus> => {
  try {
    const response = await fetch(`${resolveAuthBaseUrl()}/auth/session`, {
      credentials: 'include',
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      if (response.status === 401) {
        return { authenticated: false }
      }
      return { authenticated: false, transientError: true }
    }
    const authenticated = Boolean(payload && typeof payload === 'object' && payload.authenticated)
    const userId = payload && typeof payload === 'object' && typeof payload.userId === 'string'
      ? payload.userId
      : undefined
    const email = payload && typeof payload === 'object' && typeof payload.email === 'string'
      ? payload.email
      : undefined
    const role = payload && typeof payload === 'object'
      ? normalizeRole((payload as { role?: unknown }).role)
      : 'admin'
    return { authenticated, userId, email, role }
  } catch {
    return { authenticated: false, transientError: true }
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
