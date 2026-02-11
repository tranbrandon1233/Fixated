const normalizeBaseUrl = (value?: string) => {
  if (!value) return ''
  return value.endsWith('/') ? value.slice(0, -1) : value
}

const authBaseUrl =
  normalizeBaseUrl(import.meta.env.VITE_AUTH_BASE_URL) || 'http://localhost:5000'

export const getGoogleLoginUrl = () => `${authBaseUrl}/oauth/google`

export const logout = async () => {
  try {
    await fetch(`${authBaseUrl}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // no-op: local state will be cleared regardless
  }
}
