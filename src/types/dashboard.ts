export type Role = 'admin' | 'internal' | 'brand'

export type Platform = 'YouTube' | 'Instagram' | 'TikTok' | 'X'

export type CampaignStatus = 'Draft' | 'Active' | 'Completed' | 'Overdelivering' | 'At Risk'

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
  watchTimeHours?: number
  followersNetChange?: number
}

export interface ChannelTimeSeriesPoint extends TimeSeriesPoint {
  channelId: string
}

export interface ChannelSummary {
  id: string
  name: string
  platform: Platform
  views: number
  engagementRate: number
  followers: number
  videoCount?: number
  followersDelta30d?: number
  firstVideoUploadDate?: string
  status: string
}

export interface PostSummary {
  id: string
  title: string
  platform: Platform
  channelId?: string
  channelName?: string
  views: number
  engagementRate: number
  likes?: number
  dislikes?: number
  comments?: number
  shares?: number
  saves?: number
  reposts?: number
  engagements?: number
  publishedAt?: string
  url?: string
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
