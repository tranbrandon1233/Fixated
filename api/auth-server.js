import { URL } from 'node:url'
import { app } from '../server/index.js'

const PATHNAME_QUERY_KEY = '__pathname'

const normalizePathname = (value) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

const resolveForwardedUrl = (rawUrl = '/') => {
  const parsed = new URL(rawUrl, 'http://localhost')
  const forwardedPathname = normalizePathname(parsed.searchParams.get(PATHNAME_QUERY_KEY))
  if (!forwardedPathname) return rawUrl
  parsed.searchParams.delete(PATHNAME_QUERY_KEY)
  const query = parsed.searchParams.toString()
  return query ? `${forwardedPathname}?${query}` : forwardedPathname
}

export default function authServerHandler(req, res) {
  req.url = resolveForwardedUrl(req.url)
  return app(req, res)
}
