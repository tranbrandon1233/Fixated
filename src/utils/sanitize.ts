interface SanitizeTextOptions {
  maxLength?: number
  allowNewLines?: boolean
  trim?: boolean
}

interface SanitizeDateOptions {
  fallback?: string
  min?: string
  max?: string
}

const DANGEROUS_HTML_CHAR_REGEX = /[<>]/g

const stripControlChars = (value: string) => {
  let sanitized = ''
  for (const char of value) {
    const code = char.charCodeAt(0)
    const isControl =
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    if (!isControl) {
      sanitized += char
    }
  }
  return sanitized
}

const normalizeUnicode = (value: string) => {
  try {
    return value.normalize('NFKC')
  } catch {
    return value
  }
}

export const sanitizeTextInput = (
  value: unknown,
  options: SanitizeTextOptions = {},
) => {
  if (typeof value !== 'string') return ''
  const {
    maxLength = 256,
    allowNewLines = false,
    trim = true,
  } = options

  let next = normalizeUnicode(value).replace(/\r\n?/g, '\n')
  next = stripControlChars(next)
  next = next.replace(DANGEROUS_HTML_CHAR_REGEX, '')

  if (allowNewLines) {
    next = next.replace(/[^\S\n]+/g, ' ')
  } else {
    next = next.replace(/[\n\t]+/g, ' ')
    next = next.replace(/\s+/g, ' ')
  }

  if (trim) {
    next = next.trim()
  }

  return next.slice(0, Math.max(0, maxLength))
}

export const sanitizeMultilineInput = (value: unknown, maxLength = 4000) =>
  sanitizeTextInput(value, { maxLength, allowNewLines: true })

export const sanitizeEmailInput = (value: unknown) =>
  sanitizeTextInput(value, { maxLength: 320 }).replace(/\s+/g, '').toLowerCase()

export const sanitizeTokenInput = (value: unknown, maxLength = 200) =>
  sanitizeTextInput(value, { maxLength })

export const sanitizeDateInput = (
  value: unknown,
  options: SanitizeDateOptions = {},
) => {
  const { fallback = '', min = '', max = '' } = options
  const candidate = sanitizeTokenInput(value, 32)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return fallback
  if (min && candidate < min) return fallback
  if (max && candidate > max) return fallback
  return candidate
}

export const sanitizeAllowlistedValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => {
  if (typeof value !== 'string') return fallback
  const sanitized = sanitizeTextInput(value, { maxLength: 140 })
  return allowed.includes(sanitized as T) ? (sanitized as T) : fallback
}
