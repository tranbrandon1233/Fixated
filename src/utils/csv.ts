type CsvValue = string | number | boolean | null | undefined

type CsvRecord = Record<string, CsvValue>

const escapeCsvValue = (value: CsvValue) => {
  if (value === null || value === undefined) return ''
  const stringValue = String(value)
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

export const createCsvContent = (rows: CsvRecord[], columns?: string[]) => {
  if (!rows.length) return ''
  const resolvedColumns =
    columns && columns.length
      ? columns
      : rows.reduce<string[]>((keys, row) => {
          Object.keys(row).forEach((key) => {
            if (!keys.includes(key)) {
              keys.push(key)
            }
          })
          return keys
        }, [])

  const header = resolvedColumns.join(',')
  const lines = rows.map((row) =>
    resolvedColumns.map((column) => escapeCsvValue(row[column])).join(','),
  )

  return [header, ...lines].join('\n')
}

export const downloadCsv = (fileName: string, csvContent: string) => {
  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export const toFileSlug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
