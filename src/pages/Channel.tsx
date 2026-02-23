import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts'
import { Badge } from '../components/ui/Badge'
import { SectionHeader } from '../components/ui/SectionHeader'
import { useYouTubeSummary } from '../hooks/useYouTubeSummary'
import { todayIsoDate, toIsoDate, normalizeSummaryIsoDate } from '../utils/date'
import { formatNumber, formatPercent } from '../utils/format'
import { sanitizeDateInput } from '../utils/sanitize'

const formatDateLabel = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  })

export const Channel = () => {
  const { summary } = useYouTubeSummary()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const today = useMemo(() => todayIsoDate(), [])
  const channelOptions = useMemo(
    () => [...summary.channels].sort((a, b) => b.views - a.views),
    [summary.channels],
  )
  const channel = useMemo(() => {
    if (!channelOptions.length) return undefined
    if (selectedChannelId) {
      const selected = channelOptions.find((entry) => entry.id === selectedChannelId)
      if (selected) return selected
    }
    return channelOptions[0]
  }, [channelOptions, selectedChannelId])
  const resolvedPosts = useMemo(() => {
    if (!channel) return summary.topPosts
    return summary.topPosts.filter((post) => {
      if (post.channelId) return post.channelId === channel.id
      if (post.channelName) return post.channelName === channel.name
      return true
    })
  }, [channel, summary.topPosts])
  const resolvedTopGeos = useMemo(() => {
    if (!channel) return summary.topGeos
    const byChannel = summary.topGeosByChannel?.[channel.id]
    if (Array.isArray(byChannel) && byChannel.length) return byChannel
    return []
  }, [channel, summary.topGeos, summary.topGeosByChannel])
  const channelCount = summary.channels.length
  const portfolioViewsAverage =
    channelCount > 0
      ? summary.channels.reduce((total, item) => total + item.views, 0) / channelCount
      : 0
  const portfolioEngagementAverage =
    channelCount > 0
      ? summary.channels.reduce((total, item) => total + item.engagementRate, 0) / channelCount
      : 0
  const normalizedPortfolioSeries = useMemo(() => {
    return summary.timeSeries
      .map((point) => ({
        ...point,
        isoDate: normalizeSummaryIsoDate(point.date, today),
        label: point.date,
      }))
      .filter((point) => point.isoDate)
  }, [summary.timeSeries, today])
  const normalizedSeriesByChannel = useMemo(() => {
    return summary.timeSeriesByChannel
      .map((point) => ({
        ...point,
        isoDate: normalizeSummaryIsoDate(point.date, today),
        label: point.date,
      }))
      .filter((point) => point.isoDate)
  }, [summary.timeSeriesByChannel, today])
  const activeSeries = useMemo(() => {
    if (!channel) return normalizedPortfolioSeries
    const scopedSeries = normalizedSeriesByChannel
      .filter((point) => point.channelId === channel.id)
      .map((point) => ({
        date: point.date,
        views: point.views,
        engagements: point.engagements,
        posts: point.posts,
        watchTimeHours: point.watchTimeHours,
        followersNetChange: point.followersNetChange,
        isoDate: point.isoDate,
        label: point.label,
      }))
    return scopedSeries.length ? scopedSeries : normalizedPortfolioSeries
  }, [channel, normalizedPortfolioSeries, normalizedSeriesByChannel])
  const selectedChannelFirstVideoDate = useMemo(
    () => normalizeSummaryIsoDate(channel?.firstVideoUploadDate, today),
    [channel?.firstVideoUploadDate, today],
  )
  const fallbackFirstVideoUploadDate = useMemo(
    () => normalizeSummaryIsoDate(summary.firstVideoUploadDate, today),
    [summary.firstVideoUploadDate, today],
  )
  const dateBounds = useMemo(() => {
    const orderedDates = activeSeries.map((record) => record.isoDate).sort((a, b) => a.localeCompare(b))
    const nonFutureDates = orderedDates.filter((value) => value <= today)
    const earliestSeriesDate = nonFutureDates.length ? nonFutureDates[0] : ''
    const firstUploadDate = selectedChannelFirstVideoDate || fallbackFirstVideoUploadDate
    const minDate = firstUploadDate || earliestSeriesDate
    if (!minDate) return { min: '', max: today }
    return {
      min: minDate,
      max: today,
    }
  }, [activeSeries, fallbackFirstVideoUploadDate, selectedChannelFirstVideoDate, today])
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
  const filteredSeries = useMemo(() => {
    if (!hasDateBounds) return activeSeries
    return activeSeries.filter(
      (point) => point.isoDate >= effectiveStartDate && point.isoDate <= effectiveEndDate,
    )
  }, [activeSeries, effectiveEndDate, effectiveStartDate, hasDateBounds])
  const viewsSeries = useMemo(() => {
    if (!hasDateBounds || !effectiveStartDate || !effectiveEndDate) {
      return filteredSeries.map((point) => ({ label: point.label, value: point.views }))
    }

    const viewsByDate = new Map(filteredSeries.map((point) => [point.isoDate, point.views]))
    const series: { label: string; value: number }[] = []
    const cursor = new Date(`${effectiveStartDate}T00:00:00`)
    const end = new Date(`${effectiveEndDate}T00:00:00`)

    while (cursor <= end) {
      const isoDate = toIsoDate(cursor)
      series.push({
        label: formatDateLabel(isoDate),
        value: viewsByDate.get(isoDate) ?? 0,
      })
      cursor.setDate(cursor.getDate() + 1)
    }

    return series
  }, [effectiveEndDate, effectiveStartDate, filteredSeries, hasDateBounds])
  const isLiveViews = activeSeries.length > 0
  const hasChannel = Boolean(channel)
  const hasPosts = resolvedPosts.length > 0
  const hasTimeSeries = viewsSeries.length > 0
  const hasAgeDistribution = summary.ageDistribution.length > 0
  const hasGenderDistribution = summary.genderDistribution.length > 0
  const hasTopGeos = resolvedTopGeos.length > 0
  const pieColors = [
    'var(--primary)',
    '#FC46AA',
    '#4aa3df',
    '#f2a24b',
    '#f97066',
    '#9fb2a7',
  ]
  const formatSignedPercentChange = (value: number) =>
    `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}%`
  const formatSignedPoints = (value: number) =>
    `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1)} pts`
  const formatSignedCompact = (value: number) =>
    `${value >= 0 ? '+' : '-'}${formatNumber(Math.abs(value))}`
  const viewsTrend =
    hasChannel && channelCount > 0 && portfolioViewsAverage > 0
      ? `${formatSignedPercentChange((((channel?.views ?? 0) - portfolioViewsAverage) / portfolioViewsAverage) * 100)} vs portfolio average`
      : ''
  const engagementDiff =
    hasChannel && channelCount > 0
      ? (channel?.engagementRate ?? 0) - portfolioEngagementAverage
      : null
  const engagementTrend =
    engagementDiff === null || !Number.isFinite(engagementDiff)
      ? ''
      : `${formatSignedPoints(engagementDiff)} ${
          engagementDiff >= 0 ? 'above' : 'below'
        } average`
  const followersDelta30d =
    hasChannel && typeof channel?.followersDelta30d === 'number' ? channel.followersDelta30d : null
  const followersTrend =
    followersDelta30d === null || !Number.isFinite(followersDelta30d)
      ? ''
      : `${formatSignedCompact(followersDelta30d)} in last 30 days`

  return (
    <>
      <SectionHeader
        title={hasChannel ? `${channel?.name ?? 'Channel'} (${channel?.platform ?? 'YouTube'})` : 'Channel'}
        subtitle="Per-channel drilldown with audience insights."
        actions={(
          <div className="filter-bar">
            <select
              className="select"
              value={channel?.id ?? ''}
              onChange={(event) => {
                const nextChannelId = event.target.value
                if (channelOptions.some((entry) => entry.id === nextChannelId)) {
                  setSelectedChannelId(nextChannelId)
                  return
                }
                setSelectedChannelId('')
              }}
              disabled={!channelOptions.length}
              aria-label="Select channel"
            >
              {channelOptions.length ? (
                channelOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {`${entry.name} [${entry.platform}]`}
                  </option>
                ))
              ) : (
                <option value="">No channels</option>
              )}
            </select>
            <Badge tone={hasChannel ? 'success' : 'default'} label={channel?.status ?? 'Not connected'} />
          </div>
        )}
      />

      <div className="grid grid-3">
        <div className="card">
          <div className="kpi-label">Total Views</div>
          <div className="kpi-value">{hasChannel ? formatNumber(channel?.views ?? 0) : ''}</div>
          <div className="kpi-trend">{viewsTrend}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Engagement Rate</div>
          <div className="kpi-value">{hasChannel ? formatPercent(channel?.engagementRate ?? 0) : ''}</div>
          <div className="kpi-trend">{engagementTrend}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Followers</div>
          <div className="kpi-value">{hasChannel ? formatNumber(channel?.followers ?? 0) : '—'}</div>
          <div className="kpi-trend">{followersTrend}</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <SectionHeader
            title="Views over time"
            subtitle="Weekly channel performance."
            actions={
              <div className="filter-bar">
                <input
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
                  aria-label="Start date"
                />
                <input
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
                  aria-label="End date"
                />
              </div>
            }
          />
          {hasTimeSeries ? (
            <div style={{ height: '260px', marginTop: '16px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={viewsSeries}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                  <YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                  <Tooltip
                    formatter={(value) => {
                      const numericValue = typeof value === 'number' ? value : Number(value ?? 0)
                      const safeValue = Number.isFinite(numericValue) ? numericValue : 0
                      if (isLiveViews) {
                        return [formatNumber(safeValue), 'Views']
                      }
                      return [`${safeValue}%`, 'Share']
                    }}
                    labelStyle={{ color: 'var(--muted)' }}
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      color: 'var(--primary)',
                    }}
                  />
                  <Bar dataKey="value" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="section-subtitle" style={{ marginTop: '16px' }}>
              Reporting data is still processing for this channel.
            </div>
          )}
        </div>
        <div className="card">
          <SectionHeader title="Top posts" subtitle="Ranked by views and engagement rate." />
          <table className="data-table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Platform</th>
                <th>Views</th>
                <th>Eng. Rate</th>
                <th>Campaign</th>
              </tr>
            </thead>
            <tbody>
              {hasPosts ? (
                resolvedPosts.map((post) => (
                  <tr key={post.id}>
                    <td>{post.title}</td>
                    <td>{post.platform}</td>
                    <td>{formatNumber(post.views)}</td>
                    <td>{formatPercent(post.engagementRate)}</td>
                    <td>{post.campaignTag ?? ''}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="muted">
                    Reporting data is still processing for this channel.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card">
          <SectionHeader title="Age Distribution" subtitle="Audience age bands." />
          {hasAgeDistribution ? (
            <div style={{ height: '220px', marginTop: '12px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    formatter={(value, _name, payload) => [
                      `${typeof value === 'number' ? value : value ?? 0}%`,
                      payload?.payload?.label ?? 'Share',
                    ]}
                    labelStyle={{ color: 'var(--muted)' }}
                    itemStyle={{ color: 'var(--muted)' }}
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      color: 'var(--primary)',
                    }}
                  />
                  <Pie
                    data={summary.ageDistribution}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {summary.ageDistribution.map((entry, index) => (
                      <Cell key={entry.label} fill={pieColors[index % pieColors.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="section-subtitle" style={{ marginTop: '12px' }}>
              Audience data is not available yet for the selected range.
            </div>
          )}
        </div>
        <div className="card">
          <SectionHeader title="Gender" subtitle="Audience gender split." />
          {hasGenderDistribution ? (
            <div style={{ height: '220px', marginTop: '12px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    formatter={(value, _name, payload) => [
                      `${typeof value === 'number' ? value : value ?? 0}%`,
                      payload?.payload?.label ?? 'Share',
                    ]}
                    labelStyle={{ color: 'var(--muted)' }}
                    itemStyle={{ color: 'var(--muted)' }}
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      color: 'var(--primary)',
                    }}
                  />
                  <Pie
                    data={summary.genderDistribution}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {summary.genderDistribution.map((entry, index) => (
                      <Cell key={entry.label} fill={pieColors[index % pieColors.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="section-subtitle" style={{ marginTop: '12px' }}>
              Audience data is not available yet for the selected range.
            </div>
          )}
        </div>
        <div className="card">
          <SectionHeader title="Top Geos" subtitle="Top countries/cities." />
          {hasTopGeos ? (
            <div style={{ height: '220px', marginTop: '12px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    formatter={(value, _name, payload) => [
                      `${typeof value === 'number' ? value : value ?? 0}%`,
                      payload?.payload?.label ?? 'Share',
                    ]}
                    labelStyle={{ color: 'var(--muted)' }}
                    itemStyle={{ color: 'var(--muted)' }}
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      color: 'var(--primary)',
                    }}
                  />
                  <Pie
                    data={resolvedTopGeos}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {resolvedTopGeos.map((entry, index) => (
                      <Cell key={entry.label} fill={pieColors[index % pieColors.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="section-subtitle" style={{ marginTop: '12px' }}>
              Audience data is not available yet for the selected range.
            </div>
          )}
        </div>
      </div>
    </>
  )
}
