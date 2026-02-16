import { sanitizeDateInput, sanitizeTextInput } from './sanitize'

export const toIsoDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const todayIsoDate = () => toIsoDate(new Date())

const parseToIsoDate = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return toIsoDate(parsed)
}

export const normalizeSummaryIsoDate = (value: unknown, today = todayIsoDate()) => {
  if (typeof value !== 'string') return ''
  const normalizedValue = sanitizeTextInput(value, { maxLength: 64 })
  if (!normalizedValue) return ''

  const isoValue = sanitizeDateInput(normalizedValue)
  if (isoValue) return isoValue <= today ? isoValue : ''

  const compactIsoMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(normalizedValue)
  if (compactIsoMatch) {
    const [, year, month, day] = compactIsoMatch
    const compactIso = sanitizeDateInput(`${year}-${month}-${day}`)
    return compactIso && compactIso <= today ? compactIso : ''
  }

  const hasExplicitYear = /\b\d{4}\b/.test(normalizedValue)
  if (hasExplicitYear) {
    const explicitIso = parseToIsoDate(normalizedValue)
    return explicitIso && explicitIso <= today ? explicitIso : ''
  }

  const fallbackYear = Number(today.slice(0, 4))
  const currentYearIso = parseToIsoDate(`${normalizedValue} ${fallbackYear}`)
  if (currentYearIso && currentYearIso <= today) return currentYearIso

  const priorYearIso = parseToIsoDate(`${normalizedValue} ${fallbackYear - 1}`)
  if (priorYearIso && priorYearIso <= today) return priorYearIso

  return ''
}
