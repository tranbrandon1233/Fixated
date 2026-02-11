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

const portfolioRecords: PortfolioRecord[] = [
  {
    date: '2026-01-05',
    platform: 'TikTok',
    channel: 'ONO Highlights',
    campaign: 'PowerPlay Q1',
    views: 18_200_000,
    engagements: 900_000,
    posts: 74,
    watchTimeHours: 350_000,
  },
  {
    date: '2026-01-07',
    platform: 'Instagram',
    channel: 'Game Day Clips',
    campaign: 'PowerPlay Q1',
    views: 19_600_000,
    engagements: 950_000,
    posts: 76,
    watchTimeHours: 380_000,
  },
  {
    date: '2026-01-09',
    platform: 'YouTube',
    channel: 'All Access Network',
    campaign: 'Ultra Sports Launch',
    views: 20_100_000,
    engagements: 1_000_000,
    posts: 78,
    watchTimeHours: 430_000,
  },
  {
    date: '2026-01-12',
    platform: 'X',
    channel: 'Live Moments',
    campaign: 'Community Drive',
    views: 21_400_000,
    engagements: 1_100_000,
    posts: 81,
    watchTimeHours: 390_000,
  },
  {
    date: '2026-01-15',
    platform: 'TikTok',
    channel: 'ONO Highlights',
    campaign: 'PowerPlay Q1',
    views: 20_600_000,
    engagements: 1_020_000,
    posts: 80,
    watchTimeHours: 410_000,
  },
  {
    date: '2026-01-19',
    platform: 'Instagram',
    channel: 'Game Day Clips',
    campaign: 'Ultra Sports Launch',
    views: 19_800_000,
    engagements: 1_000_000,
    posts: 77,
    watchTimeHours: 395_000,
  },
  {
    date: '2026-01-22',
    platform: 'YouTube',
    channel: 'All Access Network',
    campaign: 'Community Drive',
    views: 22_200_000,
    engagements: 1_150_000,
    posts: 84,
    watchTimeHours: 465_000,
  },
  {
    date: '2026-01-26',
    platform: 'X',
    channel: 'Live Moments',
    campaign: 'Community Drive',
    views: 23_600_000,
    engagements: 1_200_000,
    posts: 88,
    watchTimeHours: 430_000,
  },
  {
    date: '2026-01-29',
    platform: 'TikTok',
    channel: 'ONO Highlights',
    campaign: 'PowerPlay Q1',
    views: 25_100_000,
    engagements: 1_280_000,
    posts: 92,
    watchTimeHours: 520_000,
  },
  {
    date: '2026-02-02',
    platform: 'Instagram',
    channel: 'Game Day Clips',
    campaign: 'Ultra Sports Launch',
    views: 27_400_000,
    engagements: 1_400_000,
    posts: 96,
    watchTimeHours: 540_000,
  },
]

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
  const [range, setRange] = useState<PortfolioRange>('daily')
  const [selectedPlatform, setSelectedPlatform] = useState('All')
  const [selectedChannel, setSelectedChannel] = useState('All')
  const [selectedCampaign, setSelectedCampaign] = useState('All')
  const [startDate, setStartDate] = useState('2026-01-05')
  const [endDate, setEndDate] = useState('2026-02-02')

  const platformOptions = useMemo(
    () => ['All', ...new Set(portfolioRecords.map((record) => record.platform))],
    [],
  )

  const channelOptions = useMemo(
    () => ['All', ...new Set(portfolioRecords.map((record) => record.channel))],
    [],
  )

  const campaignOptions = useMemo(
    () => ['All', ...new Set(portfolioRecords.map((record) => record.campaign))],
    [],
  )

  const dateBounds = useMemo(() => {
    const orderedDates = portfolioRecords.map((record) => record.date).sort((a, b) => a.localeCompare(b))
    return { min: orderedDates[0], max: orderedDates[orderedDates.length - 1] }
  }, [])

  const boundedStartDate = startDate || dateBounds.min
  const boundedEndDate = endDate || dateBounds.max
  const effectiveStartDate =
    boundedStartDate <= boundedEndDate ? boundedStartDate : boundedEndDate
  const effectiveEndDate = boundedStartDate <= boundedEndDate ? boundedEndDate : boundedStartDate

  const series = useMemo(() => {
    const filtered = portfolioRecords.filter((record) => {
      const platformMatch = selectedPlatform === 'All' || record.platform === selectedPlatform
      const channelMatch = selectedChannel === 'All' || record.channel === selectedChannel
      const campaignMatch = selectedCampaign === 'All' || record.campaign === selectedCampaign
      const dateMatch = record.date >= effectiveStartDate && record.date <= effectiveEndDate
      return platformMatch && channelMatch && campaignMatch && dateMatch
    })

    return aggregateSeries(filtered, range)
  }, [
    effectiveEndDate,
    effectiveStartDate,
    range,
    selectedCampaign,
    selectedChannel,
    selectedPlatform,
  ])

  const filteredRecords = useMemo(
    () =>
      portfolioRecords.filter((record) => {
        const platformMatch = selectedPlatform === 'All' || record.platform === selectedPlatform
        const channelMatch = selectedChannel === 'All' || record.channel === selectedChannel
        const campaignMatch = selectedCampaign === 'All' || record.campaign === selectedCampaign
        const dateMatch = record.date >= effectiveStartDate && record.date <= effectiveEndDate
        return platformMatch && channelMatch && campaignMatch && dateMatch
      }),
    [effectiveEndDate, effectiveStartDate, selectedCampaign, selectedChannel, selectedPlatform],
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
    [],
  )

  const deliveryLift = baselineTotals.views
    ? ((totals.views - baselineTotals.views) / baselineTotals.views) * 100
    : 0
  const engagementRate = totals.views ? (totals.engagements / totals.views) * 100 : 0

  const portfolioKpis: KPI[] = [
    {
      label: 'Total Views',
      value: formatNumber(totals.views),
      trend: `${formatPercent(deliveryLift)} vs full range`,
    },
    {
      label: 'Engagements',
      value: formatNumber(totals.engagements),
      trend: `Rate ${formatPercent(engagementRate)}`,
    },
    {
      label: 'Posts Published',
      value: formatThousands(totals.posts),
    },
    {
      label: 'Watch Time',
      value: `${formatNumber(totals.watchTimeHours)} hrs`,
    },
  ]

  const topChannels = useMemo<ChannelRollup[]>(() => {
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
  }, [filteredRecords])

  return (
    <>
      <SectionHeader
        title="All Channels Performance"
        subtitle="Unified portfolio view with campaign-ready insights."
      />

      <div className="grid grid-4">
        {portfolioKpis.map((kpi) => (
          <MetricCard key={kpi.label} kpi={kpi} />
        ))}
      </div>

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
                min={dateBounds.min}
                max={dateBounds.max}
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
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
                min={dateBounds.min}
                max={dateBounds.max}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>
         
          <div style={{ marginTop: '18px' }}>
            <div className="split">
              <div>
                <div className="section-title">Portfolio totals</div>
                <div className="section-subtitle">Selected range totals</div>
              </div>
              <div className={`pill ${deliveryLift >= 0 ? 'success' : 'danger'}`}>
                {deliveryLift >= 0 ? '+' : ''}
                {formatPercent(deliveryLift)} lift
              </div>
            </div>
            <div className="grid grid-2" style={{ marginTop: '16px' }}>
              <div className="card compact">
                <div className="kpi-label">Views</div>
                <div className="kpi-value">{formatNumber(totals.views)}</div>
              </div>
              <div className="card compact">
                <div className="kpi-label">Engagements</div>
                <div className="kpi-value">{formatNumber(totals.engagements)}</div>
              </div>
              <div className="card compact">
                <div className="kpi-label">Posts</div>
                <div className="kpi-value">{formatThousands(totals.posts)}</div>
              </div>
              <div className="card compact">
                <div className="kpi-label">Watch Time</div>
                <div className="kpi-value">{formatNumber(totals.watchTimeHours)} hrs</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
