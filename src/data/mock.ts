import type {
  CampaignSummary,
  ChannelSummary,
  DemographicPoint,
  KPI,
  PostSummary,
  ReportConfig,
  TimeSeriesPoint,
} from '../types/dashboard'

export const portfolioKpis: KPI[] = [
  { label: 'Total Views', value: '428.6M', trend: '+12.4% vs prior' },
  { label: 'Engagements', value: '18.9M', trend: '+6.7% vs prior' },
  { label: 'Posts Published', value: '3,642', trend: '+4.1% vs prior' },
  { label: 'Watch Time', value: '9.4M hrs', trend: '+9.8% vs prior' },
]

export const portfolioSeries: TimeSeriesPoint[] = [
  { date: 'Jan 5', views: 18.2, engagements: 0.9, posts: 74 },
  { date: 'Jan 12', views: 21.4, engagements: 1.1, posts: 81 },
  { date: 'Jan 19', views: 19.8, engagements: 1.0, posts: 77 },
  { date: 'Jan 26', views: 23.6, engagements: 1.2, posts: 88 },
  { date: 'Feb 2', views: 27.4, engagements: 1.4, posts: 96 },
]

export const topChannels: ChannelSummary[] = [
  {
    id: 'ch-1',
    name: 'ONO Highlights',
    platform: 'TikTok',
    views: 102_400_000,
    engagementRate: 6.2,
    followers: 2_400_000,
    status: 'Trending',
  },
  {
    id: 'ch-2',
    name: 'Game Day Clips',
    platform: 'Instagram',
    views: 88_600_000,
    engagementRate: 5.1,
    followers: 1_920_000,
    status: 'Stable',
  },
  {
    id: 'ch-3',
    name: 'All Access Network',
    platform: 'YouTube',
    views: 76_900_000,
    engagementRate: 3.8,
    followers: 3_100_000,
    status: 'Rising',
  },
  {
    id: 'ch-4',
    name: 'Live Moments',
    platform: 'X',
    views: 48_100_000,
    engagementRate: 2.9,
    followers: 980_000,
    status: 'Stable',
  },
]

export const topPosts: PostSummary[] = [
  {
    id: 'post-1',
    title: 'Championship walk-off moment',
    platform: 'TikTok',
    views: 18_900_000,
    engagementRate: 7.1,
    campaignTag: 'PowerPlay Q1',
  },
  {
    id: 'post-2',
    title: 'Locker room celebration',
    platform: 'Instagram',
    views: 14_200_000,
    engagementRate: 6.5,
    campaignTag: 'PowerPlay Q1',
  },
  {
    id: 'post-3',
    title: 'Mic’d up highlight reel',
    platform: 'YouTube',
    views: 11_800_000,
    engagementRate: 4.2,
  },
  {
    id: 'post-4',
    title: 'Behind the scenes cut',
    platform: 'X',
    views: 7_900_000,
    engagementRate: 3.1,
  },
]

export const ageDistribution: DemographicPoint[] = [
  { label: '13-17', value: 12 },
  { label: '18-24', value: 36 },
  { label: '25-34', value: 28 },
  { label: '35-44', value: 14 },
  { label: '45+', value: 10 },
]

export const genderDistribution: DemographicPoint[] = [
  { label: 'Women', value: 46 },
  { label: 'Men', value: 52 },
  { label: 'Non-binary', value: 2 },
]

export const topGeos: DemographicPoint[] = [
  { label: 'United States', value: 48 },
  { label: 'Canada', value: 12 },
  { label: 'United Kingdom', value: 10 },
  { label: 'Brazil', value: 8 },
  { label: 'Australia', value: 6 },
]

export const campaigns: CampaignSummary[] = [
  {
    id: 'camp-1',
    name: 'PowerPlay Q1',
    brand: 'Vertex Energy',
    status: 'Active',
    startDate: 'Jan 10, 2026',
    endDate: 'Mar 15, 2026',
    guaranteedViews: 50_000_000,
    deliveredViews: 33_600_000,
    guaranteedEngagements: 2_300_000,
    deliveredEngagements: 1_580_000,
    pacing: 'On track',
    distribution: {
      ono: 64,
      clipper: 36,
    },
  },
  {
    id: 'camp-2',
    name: 'Ultra Sports Launch',
    brand: 'Summit Sportswear',
    status: 'Overdelivering',
    startDate: 'Dec 1, 2025',
    endDate: 'Jan 31, 2026',
    guaranteedViews: 36_000_000,
    deliveredViews: 49_200_000,
    guaranteedEngagements: 1_900_000,
    deliveredEngagements: 2_420_000,
    pacing: 'Ahead',
    distribution: {
      ono: 58,
      clipper: 42,
    },
  },
  {
    id: 'camp-3',
    name: 'Community Drive',
    brand: 'Horizon Health',
    status: 'AtRisk',
    startDate: 'Jan 20, 2026',
    endDate: 'Apr 5, 2026',
    guaranteedViews: 24_000_000,
    deliveredViews: 7_100_000,
    guaranteedEngagements: 1_100_000,
    deliveredEngagements: 280_000,
    pacing: 'Behind',
    distribution: {
      ono: 71,
      clipper: 29,
    },
  },
]

export const reportConfig: ReportConfig = {
  brand: 'Vertex Energy',
  campaign: 'PowerPlay Q1',
  range: 'Jan 1 - Feb 2, 2026',
  channels: 'All ONO channels',
  platforms: 'TikTok, Instagram, YouTube, X',
  metrics: 'Views, Engagements, Posts',
  showCPM: true,
  showGuarantee: true,
}
