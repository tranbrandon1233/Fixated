import { sanitizeTextInput } from './sanitize'

export type ExportPreviewFallbackType = 'pdf' | 'csv'

interface ExportPreviewFallbackEntry {
  type: ExportPreviewFallbackType
  fileName: string
  dataBase64: string
  createdAt: number
}

type ExportPreviewFallbackStore = Record<string, ExportPreviewFallbackEntry>

const EXPORT_PREVIEW_FALLBACK_STORAGE_KEY = 'fixated.exportPreviewFallback.v1'
const EXPORT_PREVIEW_FALLBACK_TTL_MS = 30 * 60 * 1000
const EXPORT_PREVIEW_FALLBACK_MAX_ENTRIES = 24

const readFallbackStore = (): ExportPreviewFallbackStore => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(EXPORT_PREVIEW_FALLBACK_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as ExportPreviewFallbackStore
  } catch {
    return {}
  }
}

const pruneFallbackStore = (store: ExportPreviewFallbackStore): ExportPreviewFallbackStore => {
  const now = Date.now()
  const validEntries = Object.entries(store).filter(([, entry]) => {
    if (!entry || typeof entry !== 'object') return false
    const createdAt = Number((entry as { createdAt?: unknown }).createdAt)
    if (!Number.isFinite(createdAt) || createdAt <= 0) return false
    if (now - createdAt > EXPORT_PREVIEW_FALLBACK_TTL_MS) return false
    const type = (entry as { type?: unknown }).type
    if (type !== 'pdf' && type !== 'csv') return false
    const dataBase64 = sanitizeTextInput((entry as { dataBase64?: unknown }).dataBase64, {
      maxLength: 15_000_000,
      trim: true,
    })
    if (!dataBase64) return false
    return true
  })

  validEntries.sort((left, right) => right[1].createdAt - left[1].createdAt)
  return Object.fromEntries(validEntries.slice(0, EXPORT_PREVIEW_FALLBACK_MAX_ENTRIES))
}

const writeFallbackStore = (store: ExportPreviewFallbackStore) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(EXPORT_PREVIEW_FALLBACK_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Ignore storage failures to avoid blocking preview flow.
  }
}

export const cacheExportPreviewFallback = (
  previewId: string,
  payload: {
    type: ExportPreviewFallbackType
    fileName: string
    dataBase64: string
  },
) => {
  const normalizedPreviewId = sanitizeTextInput(previewId, { maxLength: 80 })
  if (!normalizedPreviewId) return
  const normalizedFileName = sanitizeTextInput(payload.fileName, { maxLength: 180 })
  const normalizedData = sanitizeTextInput(payload.dataBase64, { maxLength: 15_000_000, trim: true })
  if (!normalizedData) return
  const store = pruneFallbackStore(readFallbackStore())
  store[normalizedPreviewId] = {
    type: payload.type,
    fileName: normalizedFileName,
    dataBase64: normalizedData,
    createdAt: Date.now(),
  }
  writeFallbackStore(pruneFallbackStore(store))
}

export const getExportPreviewFallback = (
  previewId: string,
): {
  type: ExportPreviewFallbackType
  fileName: string
  dataBase64: string
} | null => {
  const normalizedPreviewId = sanitizeTextInput(previewId, { maxLength: 80 })
  if (!normalizedPreviewId) return null
  const store = pruneFallbackStore(readFallbackStore())
  const entry = store[normalizedPreviewId]
  writeFallbackStore(store)
  if (!entry) return null
  return {
    type: entry.type,
    fileName: sanitizeTextInput(entry.fileName, { maxLength: 180 }),
    dataBase64: sanitizeTextInput(entry.dataBase64, { maxLength: 15_000_000, trim: true }),
  }
}
