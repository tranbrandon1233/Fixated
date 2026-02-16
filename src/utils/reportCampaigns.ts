import type { CampaignStatus } from '../types/dashboard'
import type {
  CampaignApiItem,
  CampaignChannelPostsGroup,
  CampaignMemberRole,
} from './campaigns'
import { sanitizeDateInput, sanitizeTextInput, sanitizeTokenInput } from './sanitize'

export interface ReportCampaign {
  id: string
  name: string
  viewerRole: CampaignMemberRole
  brand: string
  startDate: string
  endDate: string
  guaranteedViews: number
  deliveredViews: number
  engagementRate: number
  guaranteedEngagements: number
  deliveredEngagements: number
  distribution: {
    ono: number
    clipper: number
  }
  status: CampaignStatus
  pacing: string
  selectedPostIds: string[]
  posts: CampaignChannelPostsGroup[]
}

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const resolveDistribution = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return { ono: 0, clipper: 0 }
  }
  const source = value as Record<string, unknown>
  return {
    ono: toNumber(source.ono),
    clipper: toNumber(source.clipper),
  }
}

const resolveStatus = (startDate: string, endDate: string, deliveryPercent: number): CampaignStatus => {
  const startTime = Date.parse(`${startDate}T00:00:00Z`)
  const endTime = Date.parse(`${endDate}T00:00:00Z`)
  const now = Date.now()
  if (!Number.isNaN(startTime) && now < startTime) return 'Draft'
  if (!Number.isNaN(endTime) && now > endTime) return 'Completed'
  if (deliveryPercent >= 100) return 'Overdelivering'
  if (deliveryPercent < 50) return 'At Risk'
  return 'Active'
}

const resolvePacing = (status: CampaignStatus) => {
  if (status === 'Draft') return 'Not started'
  if (status === 'Completed') return 'Finished'
  if (status === 'Overdelivering') return 'Ahead'
  if (status === 'At Risk') return 'Behind'
  return 'On track'
}

export const resolveViewerCampaignRole = (
  campaign: CampaignApiItem,
  viewerUserId: string,
): CampaignMemberRole | '' => {
  const normalizedViewerId = sanitizeTokenInput(viewerUserId, 80)
  if (!normalizedViewerId) return ''
  if (campaign.creator === normalizedViewerId) return 'admin'
  const memberRole = campaign.allowedMemberRoles?.[normalizedViewerId]
  if (memberRole === 'admin' || memberRole === 'internal' || memberRole === 'brand viewer') {
    return memberRole
  }
  return ''
}

export const mapCampaignForReport = (
  campaign: CampaignApiItem,
  viewerRole: CampaignMemberRole,
): ReportCampaign => {
  const guaranteedViews = toNumber(campaign.guaranteed)
  const deliveredViews = toNumber(campaign.viewsDelivered)
  const engagementRate = toNumber(campaign.engagementRate)
  const guaranteedEngagements = Math.round((guaranteedViews * engagementRate) / 100)
  const deliveredEngagements = Math.round((deliveredViews * engagementRate) / 100)
  const deliveryPercent = guaranteedViews > 0 ? (deliveredViews / guaranteedViews) * 100 : 0
  const status = resolveStatus(campaign.startDate, campaign.endDate, deliveryPercent)

  return {
    id: campaign.id,
    name: sanitizeTextInput(campaign.campaignName, { maxLength: 140 }) || 'Untitled campaign',
    viewerRole,
    brand: sanitizeTextInput(campaign.brand, { maxLength: 140 }) || 'Unknown brand',
    startDate: sanitizeDateInput(campaign.startDate),
    endDate: sanitizeDateInput(campaign.endDate),
    guaranteedViews,
    deliveredViews,
    engagementRate,
    guaranteedEngagements,
    deliveredEngagements,
    distribution: resolveDistribution(campaign.distributionSources),
    status,
    pacing: resolvePacing(status),
    selectedPostIds: Array.isArray(campaign.selectedPostIds)
      ? campaign.selectedPostIds
        .map((value) => sanitizeTokenInput(value, 300))
        .filter((value) => Boolean(value))
      : [],
    posts: Array.isArray(campaign.posts) ? campaign.posts : [],
  }
}
