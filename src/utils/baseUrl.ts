const normalizeBaseUrl = (value?: string) => {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

const resolveDevBaseUrl = () => {
  if (typeof window === 'undefined') return ''
  return `${window.location.protocol}//${window.location.hostname}:5000`
}

export const resolveAuthBaseUrl = () => {
  const envValue = normalizeBaseUrl(import.meta.env.VITE_AUTH_BASE_URL)
  if (typeof window === 'undefined') return envValue

  const fallback = import.meta.env.DEV ? resolveDevBaseUrl() : window.location.origin
  const allowCrossOrigin = String(import.meta.env.VITE_ALLOW_CROSS_ORIGIN_AUTH_BASE || '')
    .trim()
    .toLowerCase() === 'true'
  if (!envValue) return fallback

  try {
    const parsed = new URL(envValue)
    if (!allowCrossOrigin && parsed.hostname !== window.location.hostname) {
      // Default to same-origin auth base to avoid CORS/cookie breakage from stale env values.
      return fallback
    }
    if (!allowCrossOrigin && parsed.protocol !== window.location.protocol) {
      // Prevent protocol mismatches that surface as browser "Failed to fetch" errors.
      return fallback
    }
    return normalizeBaseUrl(parsed.toString())
  } catch {
    return fallback
  }
}
