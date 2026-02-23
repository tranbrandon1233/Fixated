import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { MetricCard } from '../components/ui/MetricCard'
import { SectionHeader } from '../components/ui/SectionHeader'
import { useYouTubeSummary } from '../hooks/useYouTubeSummary'
import type { KPI, Platform } from '../types/dashboard'
import { fetchCampaigns } from '../utils/campaigns'
import { normalizeSummaryIsoDate, todayIsoDate } from '../utils/date'
import { formatNumber, formatPercent, formatThousands } from '../utils/format'
import { sanitizeDateInput, sanitizeTextInput, sanitizeTokenInput } from '../utils/sanitize'

type PortfolioRange = 'daily' | 'weekly' | 'monthly'

interface PortfolioRecord {
  date: string
  platform: Platform
  channelId: string
  channel: string
  campaign: string
  views: number
  engagements: number
  posts: number
  watchTimeHours: number
}

interface AggregatedPoint {
  date: string
  views: number
  engagements: number
  posts: number
}

interface ChannelRollup {
  id: string
  name: string
  platform: Platform
  views: number
  engagementRate: number
}

interface CampaignFilterOption {
  id: string
  label: string
  channelIds: string[]
  postIds: string[]
}

const formatDate = (isoDate: string) => {
  const parsed = new Date(`${isoDate}T00:00:00`)
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const formatMonth = (yearMonth: string) => {
  const [year, month] = yearMonth.split('-')
  const parsed = new Date(Number(year), Number(month) - 1, 1)
  return parsed.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

const startOfWeekIso = (isoDate: string) => {
  const date = new Date(`${isoDate}T00:00:00`)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${dayOfMonth}`
}

const aggregateSeries = (records: PortfolioRecord[], range: PortfolioRange): AggregatedPoint[] => {
  const buckets = new Map<string, AggregatedPoint>()

  records.forEach((record) => {
    const key =
      range === 'daily'
        ? record.date
        : range === 'weekly'
          ? startOfWeekIso(record.date)
          : record.date.slice(0, 7)
    const current = buckets.get(key) ?? { date: key, views: 0, engagements: 0, posts: 0 }
    current.views += record.views
    current.engagements += record.engagements
    current.posts += record.posts
    buckets.set(key, current)
  })

  const ordered = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))

  if (range === 'weekly') {
    return ordered.map((point, index) => ({
      ...point,
      date: `Wk ${index + 1} (${formatDate(point.date)})`,
    }))
  }

  if (range === 'monthly') {
    return ordered.map((point) => ({ ...point, date: formatMonth(point.date) }))
  }

  return ordered.map((point) => ({ ...point, date: formatDate(point.date) }))
}

const inferPlatformFromChannelId = (channelId: string): Platform => {
  if (channelId.toLowerCase().startsWith('instagram:')) return 'Instagram'
  if (channelId.toLowerCase().startsWith('x:')) return 'X'
  return 'YouTube'
}

const earliestDateFrom = (values: string[], maxDate = '') => {
  const ordered = values
    .filter((value) => Boolean(value))
    .filter((value) => !maxDate || value <= maxDate)
    .sort((left, right) => left.localeCompare(right))
  return ordered[0] || ''
}

export const Portfolio = () => {
  const { summary, status, error } = useYouTubeSummary()
  const [range, setRange] = useState<PortfolioRange>('daily')
  const [selectedPlatform, setSelectedPlatform] = useState('All')
  const [selectedChannel, setSelectedChannel] = useState('All')
  const [selectedCampaignId, setSelectedCampaignId] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [campaignFilterOptions, setCampaignFilterOptions] = useState<CampaignFilterOption[]>([])
  const isLoading = status === 'loading'
  const today = useMemo(() => todayIsoDate(), [])

  useEffect(() => {
    let cancelled = false
    const loadCampaignFilterOptions = async () => {
      try {
        const payload = await fetchCampaigns()
        if (cancelled) return
        const options = payload.campaigns
          .map((campaign) => {
            const id = sanitizeTokenInput(campaign.id, 80)
            const label = sanitizeTextInput(campaign.campaignName, { maxLength: 140 })
            if (!id || !label) return null
            const channelIds = [
              ...new Set(
                (Array.isArray(campaign.posts) ? campaign.posts : [])
                  .map((group) => sanitizeTokenInput(group?.channelId, 300))
                  .filter((value) => Boolean(value)),
              ),
            ]
            const postIds = [
              ...new Set(
                (Array.isArray(campaign.selectedPostIds) ? campaign.selectedPostIds : [])
                  .map((value) => sanitizeTokenInput(value, 300))
                  .filter((value) => Boolean(value)),
              ),
            ]
            return { id, label, channelIds, postIds }
          })
          .filter((entry): entry is CampaignFilterOption => Boolean(entry))
          .sort((left, right) => left.label.localeCompare(right.label))
        setCampaignFilterOptions(options)
      } catch {
        if (!cancelled) {
          setCampaignFilterOptions([])
        }
      }
    }
    void loadCampaignFilterOptions()
    return () => {
      cancelled = true
    }
  }, [])

  const normalizedSeries = useMemo(() => {
    return summary.timeSeries
      .map((point) => ({
        ...point,
        isoDate: normalizeSummaryIsoDate(point.date, today),
        label: point.date,
      }))
      .filter((point) => point.isoDate)
  }, [summary.timeSeries, today])
  const firstVideoUploadDate = useMemo(
    () => normalizeSummaryIsoDate(summary.firstVideoUploadDate, today),
    [summary.firstVideoUploadDate, today],
  )
  const earliestChannelUploadDate = useMemo(() => {
    const sortedDates = summary.channels
      .map((channel) => normalizeSummaryIsoDate(channel.firstVideoUploadDate || '', today))
      .filter((value) => value)
      .sort((left, right) => left.localeCompare(right))
    return sortedDates[0] || ''
  }, [summary.channels, today])
  const earliestTopPostPublishedDate = useMemo(() => {
    const sortedDates = summary.topPosts
      .map((post) => normalizeSummaryIsoDate(post.publishedAt || '', today))
      .filter((value) => value)
      .sort((left, right) => left.localeCompare(right))
    return sortedDates[0] || ''
  }, [summary.topPosts, today])

  const portfolioRecords = useMemo<PortfolioRecord[]>(() => {
    const channelById = new Map(summary.channels.map((channel) => [channel.id, channel]))
    if (summary.timeSeriesByChannel.length) {
      return summary.timeSeriesByChannel
        .map((point) => {
          const isoDate = normalizeSummaryIsoDate(point.date, today)
          if (!isoDate) return null
          const channel = channelById.get(point.channelId)
          const platform = channel?.platform || inferPlatformFromChannelId(point.channelId)
          return {
            date: isoDate,
            platform,
            channelId: point.channelId || channel?.id || '',
            channel: channel?.name || point.channelId || 'Unknown channel',
            campaign: `${platform} Portfolio`,
            views: Number(point.views || 0),
            engagements: Number(point.engagements || 0),
            posts: Number(point.posts || 0),
            watchTimeHours: Number(point.watchTimeHours || 0),
          }
        })
        .filter((point): point is PortfolioRecord => Boolean(point))
    }

    // Fallback for legacy payloads that omit per-channel series.
    if (!normalizedSeries.length) return []
    return normalizedSeries.map((point) => ({
      date: point.isoDate,
      platform: 'YouTube',
      channelId: '',
      channel: 'All Channels',
      campaign: 'Portfolio',
      views: Number(point.views || 0),
      engagements: Number(point.engagements || 0),
      posts: Number(point.posts || 0),
      watchTimeHours: Number(point.watchTimeHours || 0),
    }))
  }, [normalizedSeries, summary.channels, summary.timeSeriesByChannel, today])

  const platformOptions = useMemo(() => {
    const platforms = summary.channels.length
      ? summary.channels.map((channel) => channel.platform)
      : portfolioRecords.map((record) => record.platform)
    return ['All', ...new Set(platforms)]
  }, [portfolioRecords, summary.channels])

  const channelOptions = useMemo(() => {
    const channels = summary.channels.length
      ? summary.channels
        .filter((channel) => selectedPlatform === 'All' || channel.platform === selectedPlatform)
        .map((channel) => channel.name)
      : portfolioRecords
        .filter((record) => selectedPlatform === 'All' || record.platform === selectedPlatform)
        .map((record) => record.channel)
    return ['All', ...new Set(channels)]
  }, [portfolioRecords, selectedPlatform, summary.channels])

  useEffect(() => {
    if (!channelOptions.includes(selectedChannel)) {
      setSelectedChannel('All')
    }
  }, [channelOptions, selectedChannel])

  const campaignOptions = useMemo(
    () => [{ id: 'all', label: 'All' }, ...campaignFilterOptions.map((campaign) => ({
      id: campaign.id,
      label: campaign.label,
    }))],
    [campaignFilterOptions],
  )

  useEffect(() => {
    if (selectedCampaignId === 'all') return
    if (!campaignFilterOptions.some((campaign) => campaign.id === selectedCampaignId)) {
      setSelectedCampaignId('all')
    }
  }, [campaignFilterOptions, selectedCampaignId])

  const selectedCampaign = useMemo(
    () => campaignFilterOptions.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [campaignFilterOptions, selectedCampaignId],
  )
  const selectedCampaignChannelIds = useMemo(
    () => new Set((selectedCampaign?.channelIds ?? []).filter(Boolean)),
    [selectedCampaign],
  )
  const selectedCampaignPostIds = useMemo(
    () => new Set((selectedCampaign?.postIds ?? []).filter(Boolean)),
    [selectedCampaign],
  )

  const earliestXPostDate = useMemo(
    () => earliestDateFrom(
      portfolioRecords
        .filter((record) => record.platform === 'X')
        .map((record) => record.date),
      today,
    ),
    [portfolioRecords, today],
  )
  const earliestYouTubeVideoDate = useMemo(() => {
    const channelFirstUploadDate = earliestDateFrom(
      summary.channels
        .filter((channel) => channel.platform === 'YouTube')
        .map((channel) => normalizeSummaryIsoDate(channel.firstVideoUploadDate || '', today)),
      today,
    )
    const topPostDate = earliestDateFrom(
      summary.topPosts
        .filter((post) => (post.platform || inferPlatformFromChannelId(post.channelId || '')) === 'YouTube')
        .map((post) => normalizeSummaryIsoDate(post.publishedAt || '', today)),
      today,
    )
    const seriesDate = earliestDateFrom(
      portfolioRecords
        .filter((record) => record.platform === 'YouTube')
        .map((record) => record.date),
      today,
    )
    return earliestDateFrom([channelFirstUploadDate, topPostDate, seriesDate], today)
  }, [portfolioRecords, summary.channels, summary.topPosts, today])

  const dateBounds = useMemo(() => {
    const scopedRecords = selectedPlatform === 'All'
      ? portfolioRecords
      : portfolioRecords.filter((record) => record.platform === selectedPlatform)
    const earliestSeriesDate = earliestDateFrom(scopedRecords.map((record) => record.date), today)
    const minDateCandidates = selectedPlatform === 'YouTube'
      ? [earliestYouTubeVideoDate, earliestSeriesDate]
      : selectedPlatform === 'X'
        ? [earliestXPostDate, earliestSeriesDate]
        : [
          earliestChannelUploadDate,
          firstVideoUploadDate,
          earliestTopPostPublishedDate,
          earliestXPostDate,
          earliestSeriesDate,
        ]
    const minDate = earliestDateFrom(minDateCandidates, today)
    if (!minDate) return { min: '', max: today }
    return {
      min: minDate,
      max: today,
    }
  }, [
    earliestChannelUploadDate,
    earliestYouTubeVideoDate,
    earliestXPostDate,
    earliestTopPostPublishedDate,
    firstVideoUploadDate,
    portfolioRecords,
    selectedPlatform,
    today,
  ])

  const hasDateBounds = Boolean(dateBounds.min && dateBounds.max)
  const boundedStartDate = useMemo(() => {
    if (!dateBounds.min) return startDate
    if (!startDate || startDate < dateBounds.min || startDate > dateBounds.max) return dateBounds.min
    return startDate
  }, [dateBounds.max, dateBounds.min, startDate])
  const boundedEndDate = useMemo(() => {
    if (!dateBounds.max) return endDate
    if (!endDate || endDate < dateBounds.min || endDate > dateBounds.max) return dateBounds.max
    return endDate
  }, [dateBounds.max, dateBounds.min, endDate])
  const effectiveStartDate =
    boundedStartDate <= boundedEndDate ? boundedStartDate : boundedEndDate
  const effectiveEndDate = boundedStartDate <= boundedEndDate ? boundedEndDate : boundedStartDate

  const series = useMemo(() => {
    const filtered = portfolioRecords.filter((record) => {
      const platformMatch = selectedPlatform === 'All' || record.platform === selectedPlatform
      const channelMatch = selectedChannel === 'All' || record.channel === selectedChannel
      const campaignMatch =
        selectedCampaignId === 'all'
        || (selectedCampaignChannelIds.size ? selectedCampaignChannelIds.has(record.channelId) : false)
      const dateMatch =
        !hasDateBounds || (record.date >= effectiveStartDate && record.date <= effectiveEndDate)
      return platformMatch && channelMatch && campaignMatch && dateMatch
    })

    return aggregateSeries(filtered, range)
  }, [
    effectiveEndDate,
    effectiveStartDate,
    hasDateBounds,
    range,
    selectedCampaignChannelIds,
    selectedCampaignId,
    selectedChannel,
    selectedPlatform,
    portfolioRecords,
  ])

  const filteredRecords = useMemo(
    () =>
      portfolioRecords.filter((record) => {
        const platformMatch = selectedPlatform === 'All' || record.platform === selectedPlatform
        const channelMatch = selectedChannel === 'All' || record.channel === selectedChannel
        const campaignMatch =
          selectedCampaignId === 'all'
          || (selectedCampaignChannelIds.size ? selectedCampaignChannelIds.has(record.channelId) : false)
        const dateMatch =
          !hasDateBounds || (record.date >= effectiveStartDate && record.date <= effectiveEndDate)
        return platformMatch && channelMatch && campaignMatch && dateMatch
      }),
    [
      effectiveEndDate,
      effectiveStartDate,
      hasDateBounds,
      portfolioRecords,
      selectedCampaignChannelIds,
      selectedCampaignId,
      selectedChannel,
      selectedPlatform,
    ],
  )

  const filteredRecordTotals = useMemo(
    () =>
      filteredRecords.reduce(
        (accumulator, record) => {
          accumulator.views += record.views
          accumulator.engagements += record.engagements
          accumulator.posts += record.posts
          accumulator.watchTimeHours += record.watchTimeHours
          return accumulator
        },
        { views: 0, engagements: 0, posts: 0, watchTimeHours: 0 },
      ),
    [filteredRecords],
  )

  const summaryDateTotals = useMemo(
    () =>
      normalizedSeries
        .filter((point) => !hasDateBounds || (point.isoDate >= effectiveStartDate && point.isoDate <= effectiveEndDate))
        .reduce(
          (accumulator, point) => {
            accumulator.views += Number(point.views || 0)
            accumulator.engagements += Number(point.engagements || 0)
            accumulator.posts += Number(point.posts || 0)
            accumulator.watchTimeHours += Number(point.watchTimeHours || 0)
            return accumulator
          },
          { views: 0, engagements: 0, posts: 0, watchTimeHours: 0 },
        ),
    [effectiveEndDate, effectiveStartDate, hasDateBounds, normalizedSeries],
  )

  const isAllChannelScope =
    selectedPlatform === 'All' && selectedChannel === 'All' && selectedCampaignId === 'all'

  const totals = useMemo(() => {
    if (!isAllChannelScope) return filteredRecordTotals
    const channelViewsTotal = summary.channels.reduce(
      (sum, channel) => sum + Number(channel.views || 0),
      0,
    )
    const youtubeVideoTotal = summary.channels.reduce(
      (sum, channel) =>
        channel.platform === 'YouTube' ? sum + Number(channel.videoCount || 0) : sum,
      0,
    )
    return {
      views: channelViewsTotal > 0 ? channelViewsTotal : summaryDateTotals.views,
      engagements: summaryDateTotals.engagements,
      posts: youtubeVideoTotal > 0 ? youtubeVideoTotal : summaryDateTotals.posts,
      watchTimeHours: summaryDateTotals.watchTimeHours,
    }
  }, [filteredRecordTotals, isAllChannelScope, summary.channels, summaryDateTotals])

  const fallbackPostCount = useMemo(() => {
    const channelNameById = new Map(summary.channels.map((channel) => [channel.id, channel.name]))
    return summary.topPosts.filter((post) => {
      const platform = post.platform || inferPlatformFromChannelId(post.channelId || '')
      const channelName = post.channelName || (post.channelId ? channelNameById.get(post.channelId) || '' : '')
      const platformMatch = selectedPlatform === 'All' || platform === selectedPlatform
      const channelMatch = selectedChannel === 'All' || channelName === selectedChannel
      const normalizedPostId = sanitizeTokenInput(post.id, 300)
      const campaignMatch = selectedCampaignId === 'all'
        || (
          selectedCampaignPostIds.size
            ? selectedCampaignPostIds.has(normalizedPostId)
            : post.channelId
              ? selectedCampaignChannelIds.has(post.channelId)
              : false
        )
      if (!platformMatch || !channelMatch || !campaignMatch) return false
      if (!hasDateBounds) return true
      const publishedDate = normalizeSummaryIsoDate(post.publishedAt || '', today)
      if (!publishedDate) return true
      return publishedDate >= effectiveStartDate && publishedDate <= effectiveEndDate
    }).length
  }, [
    effectiveEndDate,
    effectiveStartDate,
    hasDateBounds,
    selectedCampaignChannelIds,
    selectedCampaignId,
    selectedCampaignPostIds,
    selectedChannel,
    selectedPlatform,
    summary.channels,
    summary.topPosts,
    today,
  ])
  const displayedPostsPublished = totals.posts > 0 ? totals.posts : fallbackPostCount

  const baselineTotals = useMemo(
    () => {
      if (isAllChannelScope) {
        return { views: totals.views }
      }
      return portfolioRecords.reduce(
        (accumulator, record) => {
          accumulator.views += record.views
          return accumulator
        },
        { views: 0 },
      )
    },
    [isAllChannelScope, portfolioRecords, totals.views],
  )

  const hasRecords = isAllChannelScope
    ? summary.channels.length > 0 || summaryDateTotals.posts > 0 || summaryDateTotals.watchTimeHours > 0
    : filteredRecords.length > 0 || fallbackPostCount > 0
  const hasViewsOverTimeData = series.some((point) => point.views > 0)
  const hasDeliveryLift = !isAllChannelScope && hasRecords && baselineTotals.views > 0
  const deliveryLift = baselineTotals.views
    ? ((totals.views - baselineTotals.views) / baselineTotals.views) * 100
    : 0
  const engagementRate = totals.views ? (totals.engagements / totals.views) * 100 : 0

  const portfolioKpis: KPI[] = [
    {
      label: 'Total Views',
      value: hasRecords ? formatNumber(totals.views) : '—',
      trend: hasRecords ? `${formatPercent(deliveryLift)} vs full range` : undefined,
    },
    {
      label: 'Engagements',
      value: hasRecords ? formatNumber(totals.engagements) : '—',
      trend: hasRecords ? `Rate ${formatPercent(engagementRate)}` : undefined,
    },
    {
      label: 'Posts Published',
      value: hasRecords ? formatThousands(displayedPostsPublished) : '—',
    },
    {
      label: 'Watch Time',
      value: totals.watchTimeHours > 0 ? `${formatNumber(totals.watchTimeHours)} hrs` : '—',
    },
  ]

  const topChannels = useMemo<ChannelRollup[]>(() => {
    if (summary.channels.length) {
      return summary.channels
        .filter((channel) => selectedPlatform === 'All' || channel.platform === selectedPlatform)
        .filter((channel) => selectedChannel === 'All' || channel.name === selectedChannel)
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          platform: channel.platform,
          views: channel.views,
          engagementRate: channel.engagementRate,
        }))
        .sort((a, b) => b.views - a.views)
    }

    const buckets = new Map<string, { name: string; platform: Platform; views: number; engagements: number }>()

    filteredRecords.forEach((record) => {
      const key = `${record.channel}:${record.platform}`
      const current = buckets.get(key) ?? {
        name: record.channel,
        platform: record.platform,
        views: 0,
        engagements: 0,
      }
      current.views += record.views
      current.engagements += record.engagements
      buckets.set(key, current)
    })

    return [...buckets.entries()]
      .map(([key, value]) => ({
        id: key,
        name: value.name,
        platform: value.platform,
        views: value.views,
        engagementRate: value.views ? (value.engagements / value.views) * 100 : 0,
      }))
      .sort((a, b) => b.views - a.views)
  }, [filteredRecords, selectedChannel, selectedPlatform, summary.channels])

  const loadingSkeleton = (
    <>
      <div className="grid grid-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="card" key={`portfolio-kpi-skeleton-${index}`}>
            <div className="skeleton skeleton-line" style={{ width: '40%' }} />
            <div className="skeleton skeleton-line" style={{ width: '70%', height: 22, marginTop: 12 }} />
            <div className="skeleton skeleton-line" style={{ width: '55%', marginTop: 12 }} />
          </div>
        ))}
      </div>
      <div className="card">
        <div className="section-header">
          <div>
            <div className="skeleton skeleton-line" style={{ width: 220, height: 16 }} />
            <div className="skeleton skeleton-line" style={{ width: 280, marginTop: 10 }} />
          </div>
          <div className="filter-bar">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                className="skeleton skeleton-line"
                key={`portfolio-range-skeleton-${index}`}
                style={{ width: 70, height: 32 }}
              />
            ))}
          </div>
        </div>
        <div style={{ height: '280px', marginTop: '16px' }}>
          <div className="skeleton skeleton-block" style={{ width: '100%', height: '100%' }} />
        </div>
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="skeleton skeleton-line" style={{ width: 200, height: 16 }} />
          <div className="skeleton skeleton-line" style={{ width: 260, marginTop: 10 }} />
          <div style={{ marginTop: '18px', display: 'grid', gap: 12 }}>
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                className="skeleton skeleton-line"
                key={`portfolio-table-skeleton-${index}`}
                style={{ width: '100%', height: 12 }}
              />
            ))}
          </div>
        </div>
        <div className="card">
          <div className="skeleton skeleton-line" style={{ width: 120, height: 16 }} />
          <div className="skeleton skeleton-line" style={{ width: 240, marginTop: 10 }} />
          <div style={{ marginTop: '18px', display: 'grid', gap: 12 }}>
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                className="skeleton skeleton-line"
                key={`portfolio-filter-skeleton-${index}`}
                style={{ width: '100%', height: 38 }}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )

  return (
    <>
      <SectionHeader
        title="All Channels Performance"
        subtitle="Unified portfolio view with campaign-ready insights."
      />
      {isLoading ? (
        loadingSkeleton
      ) : (
        <>
          {status === 'error' ? (
            <div className="card">
              <div className="section-subtitle">Unable to load YouTube data. {error ?? ''}</div>
            </div>
          ) : null}
          {status === 'ready' && !summary.channels.length ? (
            <div className="card">
              <div className="section-subtitle">
                No connected accounts yet. Connect YouTube, Instagram, or X to populate the portfolio.
              </div>
            </div>
          ) : null}
          

          <div className="grid grid-4">
            {portfolioKpis.map((kpi) => (
              <MetricCard key={kpi.label} kpi={kpi} />
            ))}
          </div>

          {hasViewsOverTimeData ? (
            <div className="card">
              <div className="section-header">
                <div>
                  <div className="section-title">Combined Views Over Time</div>
                  <div className="section-subtitle">
                    {range === 'daily'
                      ? 'Daily performance with engagement overlay.'
                      : range === 'weekly'
                        ? 'Weekly rollup with engagement overlay.'
                        : 'Monthly rollup with engagement overlay.'}
                  </div>
                </div>
                <div className="filter-bar">
                  <button
                    type="button"
                    className={`filter-chip ${range === 'daily' ? 'active' : ''}`}
                    onClick={() => setRange('daily')}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    className={`filter-chip ${range === 'weekly' ? 'active' : ''}`}
                    onClick={() => setRange('weekly')}
                  >
                    Weekly
                  </button>
                  <button
                    type="button"
                    className={`filter-chip ${range === 'monthly' ? 'active' : ''}`}
                    onClick={() => setRange('monthly')}
                  >
                    Monthly
                  </button>
                </div>
              </div>
              <div style={{ height: '280px', marginTop: '16px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series}>
                    <defs>
                      <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                    <Tooltip
                      formatter={(value: number | undefined) => [formatNumber(value ?? 0), 'Views']}
                      labelStyle={{ color: 'var(--muted)' }}
                      contentStyle={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                      }}
                    />
                    <Area type="monotone" dataKey="views" stroke="var(--primary)" fill="url(#viewsFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}

          <div className="grid grid-2">
            <div className="card">
              <SectionHeader
                title="Top Contributing Channels"
                subtitle="Channels driving the latest performance spike."
              />
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Platform</th>
                    <th>Views</th>
                    <th>Eng. Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {topChannels.length ? (
                    topChannels.map((channel) => (
                      <tr key={channel.id}>
                        <td>{channel.name}</td>
                        <td>{channel.platform}</td>
                        <td>{formatNumber(channel.views)}</td>
                        <td>{formatPercent(channel.engagementRate)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="muted">
                        No channels match the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="card">
              <SectionHeader
                title="Filters"
                subtitle="Use filters to isolate platform, group, or campaign."
              />
              <div className="grid grid-2" style={{ marginTop: '8px' }}>
                <div className="form-field">
                  <label className="section-subtitle" htmlFor="platform-filter">
                    Platform
                  </label>
                  <select
                    id="platform-filter"
                    className="select"
                    value={selectedPlatform}
                    onChange={(event) => setSelectedPlatform(event.target.value)}
                  >
                    {platformOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label className="section-subtitle" htmlFor="channel-filter">
                    Channel
                  </label>
                  <select
                    id="channel-filter"
                    className="select"
                    value={selectedChannel}
                    onChange={(event) => setSelectedChannel(event.target.value)}
                  >
                    {channelOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label className="section-subtitle" htmlFor="campaign-filter">
                    Campaign
                  </label>
                  <select
                    id="campaign-filter"
                    className="select"
                    value={selectedCampaignId}
                    onChange={(event) => setSelectedCampaignId(event.target.value)}
                  >
                    {campaignOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label className="section-subtitle" htmlFor="start-date-filter">
                    Start date
                  </label>
                  <input
                    id="start-date-filter"
                    className="input"
                    type="date"
                    min={dateBounds.min || undefined}
                    max={dateBounds.max || undefined}
                    value={boundedStartDate}
                    onChange={(event) =>
                      setStartDate(
                        sanitizeDateInput(event.target.value, {
                          fallback: boundedStartDate || dateBounds.min,
                          min: dateBounds.min,
                          max: dateBounds.max,
                        }),
                      )}
                    disabled={!dateBounds.min}
                  />
                </div>
                <div className="form-field">
                  <label className="section-subtitle" htmlFor="end-date-filter">
                    End date
                  </label>
                  <input
                    id="end-date-filter"
                    className="input"
                    type="date"
                    min={dateBounds.min || undefined}
                    max={dateBounds.max || undefined}
                    value={boundedEndDate}
                    onChange={(event) =>
                      setEndDate(
                        sanitizeDateInput(event.target.value, {
                          fallback: boundedEndDate || dateBounds.max,
                          min: dateBounds.min,
                          max: dateBounds.max,
                        }),
                      )}
                    disabled={!dateBounds.min}
                  />
                </div>
              </div>
             
              <div style={{ marginTop: '18px' }}>
                <div className="split">
                  <div>
                    <div className="section-title">Portfolio totals</div>
                    <div className="section-subtitle">Selected range totals</div>
                  </div>
                  <div
                    className={`pill ${hasDeliveryLift ? (deliveryLift >= 0 ? 'success' : 'danger') : ''}`}
                  >
                    {hasDeliveryLift
                      ? `${deliveryLift >= 0 ? '+' : ''}${formatPercent(deliveryLift)} lift`
                      : '—'}
                  </div>
                </div>
                <div className="grid grid-2" style={{ marginTop: '16px' }}>
                  <div className="card compact">
                    <div className="kpi-label">Views</div>
                    <div className="kpi-value">{hasRecords ? formatNumber(totals.views) : '—'}</div>
                  </div>
                  <div className="card compact">
                    <div className="kpi-label">Engagements</div>
                    <div className="kpi-value">{hasRecords ? formatNumber(totals.engagements) : '—'}</div>
                  </div>
                  <div className="card compact">
                    <div className="kpi-label">Posts</div>
                    <div className="kpi-value">{hasRecords ? formatThousands(displayedPostsPublished) : '—'}</div>
                  </div>
                  <div className="card compact">
                    <div className="kpi-label">Watch Time</div>
                    <div className="kpi-value">
                      {totals.watchTimeHours > 0 ? `${formatNumber(totals.watchTimeHours)} hrs` : '—'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
