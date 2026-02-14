import { useMemo, useState } from 'react'
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
import { formatNumber, formatPercent, formatThousands } from '../utils/format'

type PortfolioRange = 'daily' | 'weekly' | 'monthly'

interface PortfolioRecord {
  date: string
  platform: Platform
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

const toIsoDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const todayIso = () => toIsoDate(new Date())

const normalizeIsoDate = (value: string, fallbackYear: number) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const hasExplicitYear = /\b\d{4}\b/.test(value)
  if (!hasExplicitYear) {
    const parsedWithFallbackYear = new Date(`${value} ${fallbackYear}`)
    if (!Number.isNaN(parsedWithFallbackYear.getTime())) return toIsoDate(parsedWithFallbackYear)
  }
  const direct = new Date(value)
  if (!Number.isNaN(direct.getTime())) return toIsoDate(direct)
  const parsed = new Date(`${value} ${fallbackYear}`)
  if (Number.isNaN(parsed.getTime())) return ''
  return toIsoDate(parsed)
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

export const Portfolio = () => {
  const { summary, status, error } = useYouTubeSummary()
  const [range, setRange] = useState<PortfolioRange>('daily')
  const [selectedPlatform, setSelectedPlatform] = useState('All')
  const [selectedChannel, setSelectedChannel] = useState('All')
  const [selectedCampaign, setSelectedCampaign] = useState('All')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const isLoading = status === 'loading'

  const normalizedSeries = useMemo(() => {
    const fallbackYear = new Date().getFullYear()
    return summary.timeSeries
      .map((point) => ({
        ...point,
        isoDate: normalizeIsoDate(point.date, fallbackYear),
        label: point.date,
      }))
      .filter((point) => point.isoDate)
  }, [summary.timeSeries])

  const channelWeights = useMemo(() => {
    if (!summary.channels.length) {
      return [{ name: 'YouTube', platform: 'YouTube' as Platform, weight: 1 }]
    }
    const totalViews = summary.channels.reduce((sum, channel) => sum + channel.views, 0)
    return summary.channels.map((channel) => ({
      name: channel.name,
      platform: channel.platform,
      weight: totalViews ? channel.views / totalViews : 1 / summary.channels.length,
    }))
  }, [summary.channels])

  const portfolioRecords = useMemo<PortfolioRecord[]>(() => {
    if (!normalizedSeries.length) return []
    const campaignLabel = 'YouTube Portfolio'
    return normalizedSeries.flatMap((point) =>
      channelWeights.map((channel) => ({
        date: point.isoDate,
        platform: channel.platform,
        channel: channel.name,
        campaign: campaignLabel,
        views: Math.round(point.views * channel.weight),
        engagements: Math.round(point.engagements * channel.weight),
        posts: Math.round(point.posts * channel.weight),
        watchTimeHours: 0,
      })),
    )
  }, [channelWeights, normalizedSeries])

  const platformOptions = useMemo(() => {
    const platforms = summary.channels.length
      ? summary.channels.map((channel) => channel.platform)
      : portfolioRecords.map((record) => record.platform)
    return ['All', ...new Set(platforms)]
  }, [portfolioRecords, summary.channels])

  const channelOptions = useMemo(() => {
    const channels = summary.channels.length
      ? summary.channels.map((channel) => channel.name)
      : portfolioRecords.map((record) => record.channel)
    return ['All', ...new Set(channels)]
  }, [portfolioRecords, summary.channels])

  const campaignOptions = useMemo(
    () => ['All', ...new Set(portfolioRecords.map((record) => record.campaign))],
    [portfolioRecords],
  )

  const dateBounds = useMemo(() => {
    const orderedDates = portfolioRecords.map((record) => record.date).sort((a, b) => a.localeCompare(b))
    const today = todayIso()
    if (!orderedDates.length) return { min: '', max: today }
    return {
      min: orderedDates[0],
      max: orderedDates[orderedDates.length - 1] > today ? orderedDates[orderedDates.length - 1] : today,
    }
  }, [portfolioRecords])

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
      const campaignMatch = selectedCampaign === 'All' || record.campaign === selectedCampaign
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
    selectedCampaign,
    selectedChannel,
    selectedPlatform,
    portfolioRecords,
  ])

  const filteredRecords = useMemo(
    () =>
      portfolioRecords.filter((record) => {
        const platformMatch = selectedPlatform === 'All' || record.platform === selectedPlatform
        const channelMatch = selectedChannel === 'All' || record.channel === selectedChannel
        const campaignMatch = selectedCampaign === 'All' || record.campaign === selectedCampaign
        const dateMatch =
          !hasDateBounds || (record.date >= effectiveStartDate && record.date <= effectiveEndDate)
        return platformMatch && channelMatch && campaignMatch && dateMatch
      }),
    [
      effectiveEndDate,
      effectiveStartDate,
      hasDateBounds,
      portfolioRecords,
      selectedCampaign,
      selectedChannel,
      selectedPlatform,
    ],
  )

  const totals = useMemo(
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

  const baselineTotals = useMemo(
    () =>
      portfolioRecords.reduce(
        (accumulator, record) => {
          accumulator.views += record.views
          return accumulator
        },
        { views: 0 },
      ),
    [portfolioRecords],
  )

  const hasRecords = filteredRecords.length > 0
  const hasViewsOverTimeData = series.some((point) => point.views > 0)
  const hasDeliveryLift = hasRecords && baselineTotals.views > 0
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
      value: hasRecords ? formatThousands(totals.posts) : '—',
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
                No connected YouTube accounts yet. Connect a channel to populate the portfolio.
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
                    value={selectedCampaign}
                    onChange={(event) => setSelectedCampaign(event.target.value)}
                  >
                    {campaignOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
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
                    onChange={(event) => setStartDate(event.target.value)}
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
                    onChange={(event) => setEndDate(event.target.value)}
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
                    <div className="kpi-value">{hasRecords ? formatThousands(totals.posts) : '—'}</div>
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
