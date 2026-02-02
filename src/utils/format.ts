export const formatNumber = (value: number) =>
  Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)

export const formatPercent = (value: number) => `${value.toFixed(1)}%`

export const formatThousands = (value: number) => Intl.NumberFormat('en-US').format(value)
