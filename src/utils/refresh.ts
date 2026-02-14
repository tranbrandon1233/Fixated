const LAST_DATA_REFRESH_KEY = 'fixated.last_data_refresh_at'

export const readLastDataRefreshAt = (): number | null => {
  if (typeof window === 'undefined') return null
  const rawValue = window.localStorage.getItem(LAST_DATA_REFRESH_KEY)
  if (!rawValue) return null
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

export const persistLastDataRefreshAt = (timestamp: number) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LAST_DATA_REFRESH_KEY, String(timestamp))
  } catch {
    // Ignore storage failures to avoid blocking dashboard usage.
  }
}

export const formatRelativeRefreshTime = (timestamp: number | null, nowMs: number = Date.now()): string => {
  if (!timestamp) return '---'

  const elapsedMs = Math.max(0, nowMs - timestamp)
  const elapsedMinutes = Math.floor(elapsedMs / 60_000)

  if (elapsedMinutes < 1) return 'just now'
  if (elapsedMinutes === 1) return '1 min ago'
  if (elapsedMinutes < 60) return `${elapsedMinutes} mins ago`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours === 1) return '1 hr ago'
  if (elapsedHours < 24) return `${elapsedHours} hrs ago`

  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays === 1) return '1 day ago'
  return `${elapsedDays} days ago`
}
