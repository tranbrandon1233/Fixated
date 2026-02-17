import { resolveAuthBaseUrl } from './baseUrl'

const apiBaseUrl = resolveAuthBaseUrl()

export interface RefreshCounterPayload {
  refreshCount: number
  refreshWindowStartedAt: string | null
  refreshesRemaining: number
  refreshLimit: number
  nextWindowStartsAt: string | null
}

const normalizePayload = (payload: unknown): RefreshCounterPayload => {
  if (!payload || typeof payload !== 'object') {
    return {
      refreshCount: 0,
      refreshWindowStartedAt: null,
      refreshesRemaining: 0,
      refreshLimit: 10,
      nextWindowStartsAt: null,
    }
  }

  const data = payload as Partial<RefreshCounterPayload>
  return {
    refreshCount: Number.isFinite(data.refreshCount) ? Number(data.refreshCount) : 0,
    refreshWindowStartedAt:
      typeof data.refreshWindowStartedAt === 'string' ? data.refreshWindowStartedAt : null,
    refreshesRemaining: Number.isFinite(data.refreshesRemaining) ? Number(data.refreshesRemaining) : 0,
    refreshLimit: Number.isFinite(data.refreshLimit) ? Number(data.refreshLimit) : 10,
    nextWindowStartsAt: typeof data.nextWindowStartsAt === 'string' ? data.nextWindowStartsAt : null,
  }
}

export class RefreshCounterLimitError extends Error {
  payload: RefreshCounterPayload

  constructor(message: string, payload: RefreshCounterPayload) {
    super(message)
    this.name = 'RefreshCounterLimitError'
    this.payload = payload
  }
}

const requestRefreshCounter = async (
  path: string,
  options?: { method?: 'GET' | 'POST' },
): Promise<RefreshCounterPayload> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options?.method ?? 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(options?.method === 'POST' ? { body: '{}' } : {}),
  })
  const payload = await response.json().catch(() => null)
  const normalized = normalizePayload(payload)
  if (!response.ok) {
    if (response.status === 429) {
      throw new RefreshCounterLimitError('Daily refresh limit reached.', normalized)
    }
    throw new Error('Unable to update refresh counter.')
  }
  return normalized
}

export const fetchRefreshCounterStatus = async (): Promise<RefreshCounterPayload> =>
  requestRefreshCounter('/api/refresh-counter/status')

export const bumpRefreshCounter = async (): Promise<RefreshCounterPayload> =>
  requestRefreshCounter('/api/refresh-counter/bump', { method: 'POST' })
