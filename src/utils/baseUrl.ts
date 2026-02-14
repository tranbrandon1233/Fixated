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
  if (!envValue) return fallback

  try {
    const parsed = new URL(envValue)
    if (import.meta.env.DEV && parsed.hostname !== window.location.hostname) {
      // Prevent localhost/127.0.0.1 host mismatches that break cookie-based auth in dev.
      return fallback
    }
    return normalizeBaseUrl(parsed.toString())
  } catch {
    return fallback
  }
}
