export type Role = 'admin' | 'internal' | 'brand'

export type Platform = 'YouTube' | 'Instagram' | 'TikTok' | 'X'

export type CampaignStatus = 'Draft' | 'Active' | 'Completed' | 'Overdelivering' | 'AtRisk'

export interface KPI {
  label: string
  value: string
  trend?: string
}

export interface TimeSeriesPoint {
  date: string
  views: number
  engagements: number
  posts: number
}

export interface ChannelSummary {
  id: string
  name: string
  platform: Platform
  views: number
  engagementRate: number
  followers: number
  status: string
}

export interface PostSummary {
  id: string
  title: string
  platform: Platform
  views: number
  engagementRate: number
  campaignTag?: string
}

export interface DemographicPoint {
  label: string
  value: number
}

export interface CampaignSummary {
  id: string
  name: string
  brand: string
  status: CampaignStatus
  startDate: string
  endDate: string
  guaranteedViews: number
  deliveredViews: number
  guaranteedEngagements: number
  deliveredEngagements: number
  pacing: string
  distribution: {
    ono: number
    clipper: number
  }
}

export interface ReportConfig {
  brand: string
  campaign: string
  range: string
  channels: string
  platforms: string
  metrics: string
  showCPM: boolean
  showGuarantee: boolean
}
