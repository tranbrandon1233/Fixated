import type { CampaignStatus } from '../types/dashboard'

const DAY_MS = 24 * 60 * 60 * 1000

export interface CampaignLifecycleSnapshot {
  status: CampaignStatus
  pacing: string
  deliveryPercent: number
  targetDeliveryPercent: number
  flightElapsedPercent: number
}

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const parseStartMs = (dateOnly: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return Number.NaN
  return Date.parse(`${dateOnly}T00:00:00Z`)
}

const parseEndExclusiveMs = (dateOnly: string) => {
  const startMs = parseStartMs(dateOnly)
  if (Number.isNaN(startMs)) return Number.NaN
  return startMs + DAY_MS
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export const resolveCampaignLifecycle = ({
  startDate,
  endDate,
  guaranteedViews,
  deliveredViews,
  nowMs = Date.now(),
}: {
  startDate: string
  endDate: string
  guaranteedViews: unknown
  deliveredViews: unknown
  nowMs?: number
}): CampaignLifecycleSnapshot => {
  const guaranteed = toNumber(guaranteedViews)
  const delivered = toNumber(deliveredViews)
  const deliveryPercent = guaranteed > 0 ? (delivered / guaranteed) * 100 : 0

  const startMs = parseStartMs(startDate)
  const endExclusiveMs = parseEndExclusiveMs(endDate)
  const hasFlightWindow = Number.isFinite(startMs) && Number.isFinite(endExclusiveMs) && endExclusiveMs > startMs

  if (hasFlightWindow && nowMs < startMs) {
    return {
      status: 'Draft',
      pacing: 'Not started',
      deliveryPercent,
      targetDeliveryPercent: 0,
      flightElapsedPercent: 0,
    }
  }

  if (hasFlightWindow && nowMs >= endExclusiveMs) {
    return {
      status: 'Completed',
      pacing: 'Finished',
      deliveryPercent,
      targetDeliveryPercent: 100,
      flightElapsedPercent: 100,
    }
  }

  const elapsedPercent = hasFlightWindow
    ? clamp(((nowMs - startMs) / (endExclusiveMs - startMs)) * 100, 0, 100)
    : 0
  const targetDeliveryPercent = elapsedPercent

  const pacing =
    deliveryPercent > targetDeliveryPercent * 1.05
      ? 'Ahead'
      : deliveryPercent < targetDeliveryPercent * 0.95
        ? 'Behind'
        : 'On track'

  if (deliveryPercent >= 100) {
    return {
      status: 'Overdelivering',
      pacing: 'Ahead',
      deliveryPercent,
      targetDeliveryPercent,
      flightElapsedPercent: elapsedPercent,
    }
  }

  const isAtRisk = elapsedPercent > 25 && deliveryPercent < targetDeliveryPercent * 0.9

  return {
    status: isAtRisk ? 'At Risk' : 'Active',
    pacing,
    deliveryPercent,
    targetDeliveryPercent,
    flightElapsedPercent: elapsedPercent,
  }
}
