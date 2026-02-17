import {
  isValidInternalRefreshRunnerToken,
  runInstagramRefreshJob,
  runYouTubeRefreshJob,
} from '../../server/index.js'

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const normalizeText = (value, maxLength = 120) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.slice(0, Math.max(1, maxLength))
}

const parseBody = (rawBody) => {
  if (!rawBody) return {}
  if (typeof rawBody === 'object' && !Array.isArray(rawBody)) return rawBody
  if (typeof rawBody !== 'string') return {}
  try {
    const parsed = JSON.parse(rawBody)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

const buildResponse = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

export const handler = async (event) => {
  const method = normalizeText(event?.httpMethod || 'POST', 12).toUpperCase()
  if (method !== 'POST') {
    return buildResponse(405, { ok: false, error: 'method_not_allowed' })
  }

  if (!isValidInternalRefreshRunnerToken(event?.headers ?? {})) {
    return buildResponse(401, { ok: false, error: 'unauthorized' })
  }

  const payload = parseBody(event?.body)
  const platform = normalizeText(payload.platform, 20).toLowerCase()
  const userId = normalizeText(payload.userId, 80)
  const jobId = normalizeText(payload.jobId, 80)

  if (!uuidRegex.test(userId) || !uuidRegex.test(jobId)) {
    return buildResponse(400, { ok: false, error: 'invalid_payload' })
  }

  try {
    if (platform === 'youtube') {
      await runYouTubeRefreshJob(jobId, userId)
    } else if (platform === 'instagram') {
      await runInstagramRefreshJob(jobId, userId)
    } else {
      return buildResponse(400, { ok: false, error: 'invalid_platform' })
    }
    return buildResponse(200, { ok: true })
  } catch (error) {
    return buildResponse(500, {
      ok: false,
      error: error instanceof Error ? error.message : 'refresh_runner_failed',
    })
  }
}
