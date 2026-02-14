import { resolveAuthBaseUrl } from './baseUrl'

const apiBaseUrl = resolveAuthBaseUrl()

export interface RefreshCounterPayload {
  refreshCount: number
  refreshWindowStartedAt: string | null
}

const normalizePayload = (payload: unknown): RefreshCounterPayload => {
  if (!payload || typeof payload !== 'object') {
    return { refreshCount: 0, refreshWindowStartedAt: null }
  }

  const data = payload as Partial<RefreshCounterPayload>
  return {
    refreshCount: Number.isFinite(data.refreshCount) ? Number(data.refreshCount) : 0,
    refreshWindowStartedAt:
      typeof data.refreshWindowStartedAt === 'string' ? data.refreshWindowStartedAt : null,
  }
}

export const bumpRefreshCounter = async (): Promise<RefreshCounterPayload> => {
  const response = await fetch(`${apiBaseUrl}/api/refresh-counter/bump`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })

  if (!response.ok) {
    throw new Error('Unable to update refresh counter.')
  }

  const payload = await response.json().catch(() => null)
  return normalizePayload(payload)
}
