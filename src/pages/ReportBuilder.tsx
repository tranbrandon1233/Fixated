import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import { SectionHeader } from '../components/ui/SectionHeader'
import {
  ageDistribution,
  campaigns,
  genderDistribution,
  portfolioSeriesDaily as mockSeries,
  reportConfig,
  topChannels as mockTopChannels,
  topGeos,
  topPosts as mockTopPosts,
} from '../data/mock'
import { useYouTubeSummary } from '../hooks/useYouTubeSummary'
import { createCsvContent, downloadCsv, toFileSlug } from '../utils/csv'
import { formatNumber } from '../utils/format'

export const ReportBuilder = () => {
  const channelOptions = ['All ONO/LNO', 'ONO Highlights', 'Game Day Clips', 'All Access Network']
  const platformOptions = ['TikTok', 'Instagram', 'YouTube', 'X']
  const metricOptions = ['Views', 'Engagements', 'Posts', 'Watch Time', 'Followers']
  const rangeOptions = [
    'Last 7 days',
    'Last 30 days',
    'Jan 1 - Feb 2, 2026',
    'Q1 to date',
    'Custom',
  ]
  const dataStartDate = '2026-01-01'
  const dataEndDate = '2026-02-02'
  const campaignFilterOptions = ['No campaign filter', ...campaigns.map((campaign) => campaign.name)]
  const { summary: youtubeSummary } = useYouTubeSummary()

  const resolvedChannels = useMemo(() => {
    if (!youtubeSummary.channels.length) return mockTopChannels
    const nonYoutubeChannels = mockTopChannels.filter((channel) => channel.platform !== 'YouTube')
    return [...youtubeSummary.channels, ...nonYoutubeChannels]
  }, [youtubeSummary.channels])

  const resolvedPosts = useMemo(() => {
    if (!youtubeSummary.topPosts.length) return mockTopPosts
    const nonYoutubePosts = mockTopPosts.filter((post) => post.platform !== 'YouTube')
    return [...youtubeSummary.topPosts, ...nonYoutubePosts]
  }, [youtubeSummary.topPosts])

  const resolvedSeries = useMemo(
    () => (youtubeSummary.timeSeries.length ? youtubeSummary.timeSeries : mockSeries),
    [youtubeSummary.timeSeries],
  )

  const parseListParam = (value: string | null, allowed: string[], fallback: string[]) => {
    if (!value) return fallback
    const normalized = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => allowed.includes(item))
    return normalized.length ? normalized : fallback
  }

  const parseDateParam = (value: string | null, fallback: string, min: string, max: string) => {
    if (!value) return fallback
    if (value < min || value > max) return fallback
    return value
  }

  const [initialShareState] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const initialChannels = parseListParam(params.get('channels'), channelOptions, ['All ONO/LNO'])
    const hasAllChannel = initialChannels.includes('All ONO/LNO')

    return {
      brandName: params.get('brand') ?? reportConfig.brand,
      campaignName: params.get('campaign') ?? reportConfig.campaign,
      campaignFilter: campaignFilterOptions.includes(params.get('filter') ?? '')
        ? (params.get('filter') as string)
        : 'No campaign filter',
      rangeSelection: rangeOptions.includes(params.get('range') ?? '')
        ? (params.get('range') as string)
        : reportConfig.range,
      customStart: parseDateParam(params.get('start'), dataStartDate, dataStartDate, dataEndDate),
      customEnd: parseDateParam(params.get('end'), dataEndDate, dataStartDate, dataEndDate),
      showCPM: (params.get('showCpm') ?? String(reportConfig.showCPM)) === 'true',
      showGuarantee: (params.get('showGuarantee') ?? String(reportConfig.showGuarantee)) === 'true',
      notes:
        params.get('notes') ??
        'Key win: TikTok drove 42% of total views.\nStrong engagement lift after Jan 20.',
      channels: hasAllChannel ? ['All ONO/LNO'] : initialChannels,
      platforms: parseListParam(params.get('platforms'), platformOptions, platformOptions),
      metrics: parseListParam(params.get('metrics'), metricOptions, ['Views', 'Engagements', 'Posts']),
    }
  })

  const [brandName, setBrandName] = useState(initialShareState.brandName)
  const [campaignName, setCampaignName] = useState(initialShareState.campaignName)
  const [campaignFilter, setCampaignFilter] = useState(initialShareState.campaignFilter)
  const [rangeSelection, setRangeSelection] = useState(initialShareState.rangeSelection)
  const [customStart, setCustomStart] = useState(initialShareState.customStart)
  const [customEnd, setCustomEnd] = useState(initialShareState.customEnd)
  const [showCPM, setShowCPM] = useState(initialShareState.showCPM)
  const [showGuarantee, setShowGuarantee] = useState(initialShareState.showGuarantee)
  const [notes, setNotes] = useState(initialShareState.notes)
  const [channels, setChannels] = useState<string[]>(initialShareState.channels)
  const [platforms, setPlatforms] = useState<string[]>(initialShareState.platforms)
  const [metrics, setMetrics] = useState<string[]>(initialShareState.metrics)
  const [shareStatus, setShareStatus] = useState('')

  const allChannelsSelected = channels.includes('All ONO/LNO')

  const selectedCampaign = useMemo(() => {
    if (campaignFilter !== 'No campaign filter') {
      return campaigns.find((campaign) => campaign.name === campaignFilter) ?? null
    }
    return (
      campaigns.find((campaign) => campaign.name === campaignName) ??
      campaigns.find((campaign) => campaign.name === reportConfig.campaign) ??
      null
    )
  }, [campaignFilter, campaignName])

  const filteredChannels = useMemo(() => {
    const byPlatform = resolvedChannels.filter((channel) => platforms.includes(channel.platform))
    return byPlatform.length ? byPlatform : resolvedChannels
  }, [platforms, resolvedChannels])

  const filteredPosts = useMemo(() => {
    const byPlatform = resolvedPosts.filter((post) => platforms.includes(post.platform))
    if (!selectedCampaign) return byPlatform.length ? byPlatform : resolvedPosts
    const byCampaign = byPlatform.filter((post) => post.campaignTag === selectedCampaign.name)
    if (byCampaign.length) return byCampaign
    return byPlatform.length ? byPlatform : resolvedPosts
  }, [platforms, resolvedPosts, selectedCampaign])

  const formatDateLabel = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date)
  }

  const displayRange = useMemo(() => {
    if (rangeSelection !== 'Custom') return rangeSelection
    return `${formatDateLabel(customStart)} - ${formatDateLabel(customEnd)}`
  }, [customEnd, customStart, rangeSelection])

  const handleExportPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 48
    const availableWidth = pageWidth - margin * 2
    const generatedAt = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date())
    const totalPages = 6
    const totalViews = selectedCampaign?.deliveredViews ?? 33_600_000
    const totalEngagements = selectedCampaign?.deliveredEngagements ?? 1_580_000
    const totalPublishedPosts = filteredPosts.length ? filteredPosts.length : 0
    const top3Channels = filteredChannels.slice(0, 3)
    const channelViewTotal = filteredChannels.reduce((sum, channel) => sum + channel.views, 0)
    const insightBullets = notes
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
    const deliveryProgress = selectedCampaign
      ? Math.min(100, Math.round((selectedCampaign.deliveredViews / selectedCampaign.guaranteedViews) * 100))
      : 0

    const addFooter = (pageNumber: number) => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(90, 90, 90)
      doc.text(
        `Generated ${generatedAt}  |  Range: ${displayRange}  |  Confidential`,
        margin,
        pageHeight - 24,
      )
      doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - margin, pageHeight - 24, {
        align: 'right',
      })
    }

    const addPageTitle = (title: string, subtitle: string) => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(22)
      doc.setTextColor(20, 20, 20)
      doc.text(title, margin, 72)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.setTextColor(95, 95, 95)
      doc.text(subtitle, margin, 92)
    }

    // Page 1 - Cover
    addPageTitle('Brand Performance Report', 'Premium export generated from Reports page')
    doc.setDrawColor(205, 205, 205)
    doc.roundedRect(margin, 120, availableWidth, 260, 6, 6)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(20, 20, 20)
    doc.text(brandName || 'Brand Name', margin + 20, 165)
    doc.setFontSize(13)
    doc.setFont('helvetica', 'normal')
    doc.text(`Campaign/Deal: ${campaignName || 'Campaign Name'}`, margin + 20, 195)
    doc.text(`Time range: ${displayRange}`, margin + 20, 220)
    doc.text(`Title: ${campaignName || 'Brand Campaign Report'}`, margin + 20, 245)
    doc.text(`Layout: Clean PDF`, margin + 20, 270)
    doc.text(`Channels: ${allChannelsSelected ? 'All ONO/LNO' : channels.join(', ')}`, margin + 20, 295)
    doc.text(`Platforms: ${platforms.join(', ')}`, margin + 20, 320)
    doc.setFont('helvetica', 'italic')
    doc.text('Logo placeholder (brand logo inserted in production export)', margin + 20, 350)
    addFooter(1)

    // Page 2 - Executive Summary
    doc.addPage()
    addPageTitle('Executive Summary', 'Delivered totals, channel leaders, and key insights')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('Totals', margin, 130)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.text(`Total views: ${formatNumber(totalViews)}`, margin, 154)
    doc.text(`Total engagements: ${formatNumber(totalEngagements)}`, margin, 176)
    doc.text(`Posts published: ${totalPublishedPosts}`, margin, 198)
    doc.setFont('helvetica', 'bold')
    doc.text('Top 3 channels', margin, 236)
    doc.setFont('helvetica', 'normal')
    top3Channels.forEach((channel, index) => {
      doc.text(
        `${index + 1}. ${channel.name} (${channel.platform}) - ${formatNumber(channel.views)} views`,
        margin,
        260 + index * 22,
      )
    })
    doc.setFont('helvetica', 'bold')
    doc.text('Insight bullets', margin, 342)
    doc.setFont('helvetica', 'normal')
    ;(insightBullets.length ? insightBullets : ['No additional notes provided.']).forEach(
      (bullet, index) => {
        const wrapped = doc.splitTextToSize(`- ${bullet}`, availableWidth - 10)
        doc.text(wrapped, margin, 365 + index * 24)
      },
    )
    if (showGuarantee && selectedCampaign) {
      doc.setFont('helvetica', 'bold')
      doc.text('Guaranteed vs Delivered', margin, 520)
      doc.setFont('helvetica', 'normal')
      doc.text(
        `Views: ${formatNumber(selectedCampaign.guaranteedViews)} guaranteed vs ${formatNumber(selectedCampaign.deliveredViews)} delivered`,
        margin,
        544,
      )
      doc.text(
        `Engagements: ${formatNumber(selectedCampaign.guaranteedEngagements)} guaranteed vs ${formatNumber(selectedCampaign.deliveredEngagements)} delivered`,
        margin,
        566,
      )
    }
    addFooter(2)

    // Page 3 - Performance Chart
    doc.addPage()
    addPageTitle('Performance Chart', 'Combined view trend over time and channel contribution')
    const chartLeft = margin
    const chartTop = 130
    const chartWidth = availableWidth
    const chartHeight = 230
    const maxViews = resolvedSeries.length ? Math.max(...resolvedSeries.map((point) => point.views)) : 0
    doc.setDrawColor(205, 205, 205)
    doc.rect(chartLeft, chartTop, chartWidth, chartHeight)
    if (resolvedSeries.length && maxViews > 0) {
      resolvedSeries.forEach((point, index) => {
        const barWidth = chartWidth / resolvedSeries.length - 8
        const x = chartLeft + index * (chartWidth / resolvedSeries.length) + 4
        const height = (point.views / maxViews) * (chartHeight - 35)
        const y = chartTop + chartHeight - height - 20
        doc.setFillColor(28, 79, 216)
        doc.rect(x, y, barWidth, height, 'F')
        doc.setFontSize(8)
        doc.setTextColor(90, 90, 90)
        if (index % 2 === 0) {
          doc.text(point.date, x + barWidth / 2, chartTop + chartHeight - 6, { align: 'center' })
        }
      })
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(20, 20, 20)
    doc.text('Channel contribution breakdown', margin, 410)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    filteredChannels.forEach((channel, index) => {
      const share = channelViewTotal ? Math.round((channel.views / channelViewTotal) * 100) : 0
      doc.text(
        `${channel.name}: ${share}% (${formatNumber(channel.views)} views)`,
        margin,
        434 + index * 22,
      )
    })
    addFooter(3)

    // Page 4 - Audience
    doc.addPage()
    addPageTitle('Audience', 'Age distribution, gender split, and top geographies')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('Age distribution', margin, 130)
    doc.setFont('helvetica', 'normal')
    ageDistribution.forEach((point, index) => {
      doc.text(`${point.label}: ${point.value}%`, margin, 154 + index * 20)
    })
    doc.setFont('helvetica', 'bold')
    doc.text('Gender', margin + 230, 130)
    doc.setFont('helvetica', 'normal')
    genderDistribution.forEach((point, index) => {
      doc.text(`${point.label}: ${point.value}%`, margin + 230, 154 + index * 20)
    })
    doc.setFont('helvetica', 'bold')
    doc.text('Top geographies', margin, 280)
    doc.setFont('helvetica', 'normal')
    topGeos.forEach((point, index) => {
      doc.text(`${point.label}: ${point.value}%`, margin, 304 + index * 20)
    })
    addFooter(4)

    // Page 5 - Top Content
    doc.addPage()
    addPageTitle('Top Content', 'Best-performing posts with views and engagement')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Post', margin, 130)
    doc.text('Platform', margin + 235, 130)
    doc.text('Views', margin + 340, 130)
    doc.text('Engagement', margin + 430, 130)
    doc.setFont('helvetica', 'normal')
    filteredPosts.slice(0, 8).forEach((post, index) => {
      const y = 156 + index * 30
      doc.setTextColor(20, 20, 20)
      doc.text(post.title, margin, y)
      doc.setTextColor(70, 70, 70)
      doc.text(post.platform, margin + 235, y)
      doc.text(formatNumber(post.views), margin + 340, y)
      doc.text(`${post.engagementRate.toFixed(1)}%`, margin + 430, y)
      doc.setFontSize(8)
      doc.text('Thumbnail: not available in mock export', margin, y + 12)
      doc.setFontSize(11)
    })
    addFooter(5)

    // Page 6 - Campaign ROI
    doc.addPage()
    addPageTitle('Campaign ROI', 'Delivery progress, guarantee attainment, and distribution')
    if (selectedCampaign) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.text('Delivery progress', margin, 130)
      doc.setDrawColor(210, 210, 210)
      doc.rect(margin, 145, availableWidth, 18)
      doc.setFillColor(28, 79, 216)
      doc.rect(margin, 145, (availableWidth * deliveryProgress) / 100, 18, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.text(`${deliveryProgress}% delivered`, margin, 180)
      doc.text(
        `Guaranteed vs Actual Views: ${formatNumber(selectedCampaign.guaranteedViews)} vs ${formatNumber(selectedCampaign.deliveredViews)}`,
        margin,
        210,
      )
      doc.text(
        `Guaranteed vs Actual Engagements: ${formatNumber(selectedCampaign.guaranteedEngagements)} vs ${formatNumber(selectedCampaign.deliveredEngagements)}`,
        margin,
        234,
      )
      if (showCPM) {
        doc.text('CPV: $0.04', margin, 262)
        doc.text('CPM: $6.80', margin + 120, 262)
      }
      doc.setFont('helvetica', 'bold')
      doc.text('Distribution breakdown', margin, 310)
      doc.setFont('helvetica', 'normal')
      doc.text(`ONO: ${selectedCampaign.distribution.ono}%`, margin, 334)
      doc.text(`Clipper: ${selectedCampaign.distribution.clipper}%`, margin + 150, 334)
      doc.text(`Pacing: ${selectedCampaign.pacing}`, margin, 358)
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(12)
      doc.text(
        'No campaign selected. Enable a campaign filter to include guaranteed vs delivered ROI.',
        margin,
        140,
      )
    }
    addFooter(6)

    const safeFileName = `${(campaignName || 'brand-report').toLowerCase().replace(/\s+/g, '-')}-report.pdf`
    doc.save(safeFileName)
  }

  const handleExportCsv = () => {
    const generatedAt = new Date().toISOString()
    const selectedMetrics = new Set(metrics)
    const filePrefix = toFileSlug(campaignName || brandName || 'brand-report')

    const overviewRows: Array<{ field: string; value: string | number }> = [
      { field: 'generated_at', value: generatedAt },
      { field: 'brand', value: brandName || '' },
      { field: 'campaign_name', value: campaignName || '' },
      { field: 'campaign_filter', value: campaignFilter },
      { field: 'date_range', value: displayRange },
      { field: 'channels_included', value: allChannelsSelected ? 'All ONO/LNO' : channels.join(', ') },
      { field: 'platforms_included', value: platforms.join(', ') },
      { field: 'metrics_included', value: metrics.join(', ') },
      { field: 'show_cpm', value: showCPM ? 'yes' : 'no' },
      { field: 'show_guarantee_vs_delivered', value: showGuarantee ? 'yes' : 'no' },
    ]

    if (selectedCampaign) {
      overviewRows.push(
        { field: 'campaign_status', value: selectedCampaign.status },
        { field: 'guaranteed_views', value: selectedCampaign.guaranteedViews },
        { field: 'delivered_views', value: selectedCampaign.deliveredViews },
        { field: 'guaranteed_engagements', value: selectedCampaign.guaranteedEngagements },
        { field: 'delivered_engagements', value: selectedCampaign.deliveredEngagements },
        { field: 'ono_distribution_percent', value: selectedCampaign.distribution.ono },
        { field: 'clipper_distribution_percent', value: selectedCampaign.distribution.clipper },
        { field: 'pacing', value: selectedCampaign.pacing },
      )
    }

    const channelRows = filteredChannels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      platform: channel.platform,
      views: channel.views,
      engagement_rate_percent: channel.engagementRate,
      followers: channel.followers,
      status: channel.status,
    }))

    const postRows = filteredPosts.map((post) => ({
      id: post.id,
      title: post.title,
      platform: post.platform,
      views: post.views,
      engagement_rate_percent: post.engagementRate,
      campaign_tag: post.campaignTag ?? '',
    }))

    const audienceRows = [
      ...ageDistribution.map((point) => ({
        segment: 'age',
        label: point.label,
        percent: point.value,
      })),
      ...genderDistribution.map((point) => ({
        segment: 'gender',
        label: point.label,
        percent: point.value,
      })),
      ...topGeos.map((point) => ({
        segment: 'geo',
        label: point.label,
        percent: point.value,
      })),
    ]

    const timeSeriesRows = resolvedSeries.map((point) => ({
      date: point.date,
      ...(selectedMetrics.has('Views') ? { views_millions: point.views } : {}),
      ...(selectedMetrics.has('Engagements') ? { engagements_millions: point.engagements } : {}),
      ...(selectedMetrics.has('Posts') ? { posts: point.posts } : {}),
      ...(selectedMetrics.has('Watch Time') ? { watch_time_hours: '' } : {}),
      ...(selectedMetrics.has('Followers') ? { followers_net_change: '' } : {}),
    }))

    downloadCsv(
      `${filePrefix}-overview.csv`,
      createCsvContent(overviewRows, ['field', 'value']),
    )
    downloadCsv(`${filePrefix}-channels.csv`, createCsvContent(channelRows))
    downloadCsv(`${filePrefix}-posts.csv`, createCsvContent(postRows))
    downloadCsv(
      `${filePrefix}-audience.csv`,
      createCsvContent(audienceRows, ['segment', 'label', 'percent']),
    )
    downloadCsv(`${filePrefix}-timeseries.csv`, createCsvContent(timeSeriesRows))
  }

  const toggleSelection = (value: string, list: string[], setList: (next: string[]) => void) => {
    if (list.includes(value)) {
      setList(list.filter((item) => item !== value))
    } else {
      setList([...list, value])
    }
  }

  const handleChannelToggle = (value: string) => {
    if (value === 'All ONO/LNO') {
      setChannels(['All ONO/LNO'])
      return
    }
    const next = channels.includes(value)
      ? channels.filter((item) => item !== value)
      : [...channels.filter((item) => item !== 'All ONO/LNO'), value]
    setChannels(next.length ? next : ['All ONO/LNO'])
  }

  const buildShareUrl = () => {
    const params = new URLSearchParams()
    params.set('brand', brandName)
    params.set('campaign', campaignName)
    params.set('filter', campaignFilter)
    params.set('range', rangeSelection)
    params.set('start', customStart)
    params.set('end', customEnd)
    params.set('showCpm', String(showCPM))
    params.set('showGuarantee', String(showGuarantee))
    params.set('notes', notes)
    params.set('channels', channels.join(','))
    params.set('platforms', platforms.join(','))
    params.set('metrics', metrics.join(','))
    return `${window.location.origin}/reports?${params.toString()}`
  }

  const fallbackCopy = (value: string) => {
    const textArea = document.createElement('textarea')
    textArea.value = value
    textArea.style.position = 'fixed'
    textArea.style.opacity = '0'
    document.body.appendChild(textArea)
    textArea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textArea)
    return copied
  }

  const handleShareLink = async () => {
    const shareUrl = buildShareUrl()
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl)
      } else if (!fallbackCopy(shareUrl)) {
        window.prompt('Copy this report link', shareUrl)
      }
      setShareStatus('Shareable link copied.')
    } catch {
      if (!fallbackCopy(shareUrl)) {
        window.prompt('Copy this report link', shareUrl)
        setShareStatus('Clipboard blocked. Link opened for manual copy.')
        return
      }
      setShareStatus('Shareable link copied.')
    }
  }

  useEffect(() => {
    if (!shareStatus) return
    const timeoutId = window.setTimeout(() => setShareStatus(''), 2500)
    return () => window.clearTimeout(timeoutId)
  }, [shareStatus])

  return (
    <>
      <SectionHeader
        title="Brand Report Builder"
        subtitle="Configure a polished, client-ready report."
        actions={
          <div className="filter-bar">
            <button className="ghost-button" onClick={handleExportCsv}>
              Export CSV
            </button>
            <button className="primary-button" onClick={handleExportPdf}>
              Export PDF
            </button>
          </div>
        }
      />

      <div className="grid grid-2">
        <div className="card">
          <div className="section-title">Report configuration</div>
          <div className="section-subtitle">Select scope and visibility options.</div>
          <div className="grid" style={{ marginTop: '16px' }}>
            <div className="form-field">
              <label className="section-subtitle">Brand name (header)</label>
              <input
                className="input"
                value={brandName}
                onChange={(event) => setBrandName(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="section-subtitle">Campaign name (header)</label>
              <input
                className="input"
                value={campaignName}
                onChange={(event) => setCampaignName(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="section-subtitle">Campaign filter</label>
              <select
                className="select"
                value={campaignFilter}
                onChange={(event) => setCampaignFilter(event.target.value)}
              >
                <option value="No campaign filter">No campaign filter</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.name}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="section-subtitle">Date range</label>
              <select
                className="select"
                value={rangeSelection}
                onChange={(event) => setRangeSelection(event.target.value)}
              >
                {rangeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            {rangeSelection === 'Custom' ? (
              <div className="form-field">
                <label className="section-subtitle">Custom range</label>
                <div className="check-row">
                  <input
                    className="input"
                    type="date"
                    min={dataStartDate}
                    max={dataEndDate}
                    value={customStart}
                    onChange={(event) => {
                      const next = event.target.value
                      setCustomStart(next)
                      if (next > customEnd) {
                        setCustomEnd(next)
                      }
                    }}
                  />
                  <input
                    className="input"
                    type="date"
                    min={customStart}
                    max={dataEndDate}
                    value={customEnd}
                    onChange={(event) => setCustomEnd(event.target.value)}
                  />
                </div>
                <div className="section-subtitle">
                  Available data: {formatDateLabel(dataStartDate)} - {formatDateLabel(dataEndDate)}
                </div>
              </div>
            ) : null}
            <div className="form-field">
              <label className="section-subtitle">Channels included</label>
              <div className="check-row">
                {channelOptions.map((option) => (
                  <label key={option} className="check-pill">
                    <input
                      type="checkbox"
                      checked={channels.includes(option)}
                      onChange={() => handleChannelToggle(option)}
                      disabled={allChannelsSelected && option !== 'All ONO/LNO'}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-field">
              <label className="section-subtitle">Platforms included</label>
              <div className="check-row">
                {platformOptions.map((option) => (
                  <label key={option} className="check-pill">
                    <input
                      type="checkbox"
                      checked={platforms.includes(option)}
                      onChange={() => toggleSelection(option, platforms, setPlatforms)}
                      disabled={platforms.length === 1 && platforms.includes(option)}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-field">
              <label className="section-subtitle">Metrics included</label>
              <div className="check-row">
                {metricOptions.map((option) => (
                  <label key={option} className="check-pill">
                    <input
                      type="checkbox"
                      checked={metrics.includes(option)}
                      onChange={() => toggleSelection(option, metrics, setMetrics)}
                      disabled={metrics.length === 1 && metrics.includes(option)}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-field">
              <label className="section-subtitle">Optional notes / summary bullets</label>
              <textarea
                className="textarea"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add short bullets, one per line."
              />
            </div>
            <label className="check-pill">
              <input type="checkbox" checked={showCPM} onChange={() => setShowCPM(!showCPM)} />
              Show CPM/CPV
            </label>
            <label className="check-pill">
              <input
                type="checkbox"
                checked={showGuarantee}
                onChange={() => setShowGuarantee(!showGuarantee)}
              />
              Show guarantee vs delivered
            </label>
          </div>

          <div className="filter-bar" style={{ marginTop: '16px' }}>
            <button className="ghost-button" onClick={handleExportPdf}>
              Clean PDF
            </button>
            <button className="ghost-button">Deck-style PDF</button>
            <button className="ghost-button" onClick={handleShareLink}>
              Shareable link
            </button>
            <button className="ghost-button" onClick={handleExportCsv}>
              CSV export
            </button>
          </div>
          {shareStatus ? (
            <div className="section-subtitle" style={{ marginTop: '8px' }}>
              {shareStatus}
            </div>
          ) : null}
        </div>
        <div className="card">
          <div className="section-title">Live preview</div>
          <div className="section-subtitle">Auto-updates with your selections.</div>
          <div className="report-preview" style={{ marginTop: '16px' }}>
            <div className="section-title">{campaignName || 'Report Preview'}</div>
            <div className="muted">
              {brandName || 'Brand'} • {displayRange}
            </div>
            <div className="grid grid-2" style={{ marginTop: '16px' }}>
              <div className="card compact">
                <div className="kpi-label">Total Views</div>
                <div className="kpi-value">33.6M</div>
              </div>
              <div className="card compact">
                <div className="kpi-label">Engagements</div>
                <div className="kpi-value">1.58M</div>
              </div>
            </div>
            {showGuarantee ? (
              <>
                <div className="section-subtitle" style={{ marginTop: '16px' }}>
                  Guarantee vs Delivered
                </div>
                <div className="progress-track" style={{ marginTop: '8px' }}>
                  <div className="progress-fill" style={{ width: '67%' }} />
                </div>
                <div className="filter-bar" style={{ marginTop: '12px' }}>
                  <span className="filter-chip">Delivery: 67%</span>
                  {showCPM ? (
                    <>
                      <span className="filter-chip">CPV: $0.04</span>
                      <span className="filter-chip">CPM: $6.80</span>
                    </>
                  ) : null}
                </div>
              </>
            ) : null}
           
          </div>
        </div>
      </div>

    </>
  )
}
