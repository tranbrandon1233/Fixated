import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import { SectionHeader } from '../components/ui/SectionHeader'
import { useYouTubeSummary } from '../hooks/useYouTubeSummary'
import { fetchCampaigns } from '../utils/campaigns'
import { createCsvContent, downloadCsv, toFileSlug } from '../utils/csv'
import { formatNumber } from '../utils/format'
import { mapCampaignForReport, type ReportCampaign } from '../utils/reportCampaigns'

export const ReportBuilder = () => {
  const [campaignList, setCampaignList] = useState<ReportCampaign[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(true)
  const [campaignsError, setCampaignsError] = useState<string | null>(null)
  const platformOptions = ['TikTok', 'Instagram', 'YouTube', 'X']
  const metricOptions = ['Views', 'Engagements', 'Posts', 'Watch Time', 'Followers']
  const rangeOptions = ['Campaign flight', 'Last 7 days', 'Last 30 days', 'Q1 to date', 'Custom']
  const fallbackMinDate = '2000-01-01'
  const fallbackMaxDate = '2100-12-31'
  const { summary: youtubeSummary } = useYouTubeSummary()

  const resolvedChannels = useMemo(
    () =>
      youtubeSummary.channels.filter(
        (channel) => Boolean(channel?.id && channel?.name && channel?.platform),
      ),
    [youtubeSummary.channels],
  )

  const resolvedPosts = useMemo(
    () =>
      youtubeSummary.topPosts.filter((post) => Boolean(post?.id && post?.title && post?.platform)),
    [youtubeSummary.topPosts],
  )

  const resolvedSeries = useMemo(() => youtubeSummary.timeSeries, [youtubeSummary.timeSeries])

  const resolvedAgeDistribution = useMemo(() => youtubeSummary.ageDistribution, [youtubeSummary.ageDistribution])

  const resolvedGenderDistribution = useMemo(() => youtubeSummary.genderDistribution, [youtubeSummary.genderDistribution])

  const resolvedTopGeos = useMemo(() => youtubeSummary.topGeos, [youtubeSummary.topGeos])

  const channelOptions = useMemo(() => {
    const uniqueChannelNames = [...new Set(resolvedChannels.map((channel) => channel.name))]
    return ['All ONO/LNO', ...uniqueChannelNames]
  }, [resolvedChannels])

  const todayDate = useMemo(() => {
    const now = new Date()
    const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    return localTime.toISOString().slice(0, 10)
  }, [])

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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback
    if (value < min || value > max) return fallback
    return value
  }

  const [initialShareState] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const initialChannels = parseListParam(params.get('channels'), channelOptions, ['All ONO/LNO'])
    const hasAllChannel = initialChannels.includes('All ONO/LNO')

    return {
      brandName: params.get('brand') ?? '',
      campaignName: params.get('campaign') ?? '',
      campaignFilter: params.get('filter') ?? 'No campaign filter',
      rangeSelection: rangeOptions.includes(params.get('range') ?? '')
        ? (params.get('range') as string)
        : 'Campaign flight',
      customStart: parseDateParam(params.get('start'), todayDate, fallbackMinDate, fallbackMaxDate),
      customEnd: parseDateParam(params.get('end'), todayDate, fallbackMinDate, fallbackMaxDate),
      showCPM: (params.get('showCpm') ?? 'true') === 'true',
      showGuarantee: (params.get('showGuarantee') ?? 'true') === 'true',
      notes:
        params.get('notes') ??
        'Performance summary generated from campaign delivery data.',
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

  useEffect(() => {
    let cancelled = false

    const loadCampaigns = async () => {
      setCampaignsLoading(true)
      setCampaignsError(null)
      try {
        const response = await fetchCampaigns()
        if (cancelled) return
        setCampaignList(response.campaigns.map((campaign) => mapCampaignForReport(campaign)))
      } catch (err) {
        if (cancelled) return
        setCampaignList([])
        setCampaignsError(err instanceof Error ? err.message : 'Unable to load campaigns.')
      } finally {
        if (!cancelled) setCampaignsLoading(false)
      }
    }

    void loadCampaigns()
    return () => {
      cancelled = true
    }
  }, [])

  const { dataStartDate, dataEndDate } = useMemo(() => {
    const campaignDates = campaignList.flatMap((campaign) => [campaign.startDate, campaign.endDate])
    const validDates = campaignDates.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort()
    if (!validDates.length) {
      return { dataStartDate: todayDate, dataEndDate: todayDate }
    }
    return {
      dataStartDate: validDates[0],
      dataEndDate: validDates[validDates.length - 1],
    }
  }, [campaignList, todayDate])

  const allChannelsSelected = channels.includes('All ONO/LNO')

  const selectedCampaign = useMemo(() => {
    if (!campaignList.length) return null
    if (campaignFilter !== 'No campaign filter') {
      return campaignList.find((campaign) => campaign.name === campaignFilter) ?? null
    }
    return (
      campaignList.find((campaign) => campaign.name === campaignName) ??
      campaignList[0] ??
      null
    )
  }, [campaignFilter, campaignList, campaignName])

  useEffect(() => {
    if (!campaignList.length) return
    if (campaignFilter === 'No campaign filter') return
    if (!campaignList.some((campaign) => campaign.name === campaignFilter)) {
      setCampaignFilter('No campaign filter')
    }
  }, [campaignFilter, campaignList])

  useEffect(() => {
    if (!selectedCampaign) return
    setCampaignName((current) => {
      if (current.trim() && campaignList.some((campaign) => campaign.name === current.trim())) {
        return current
      }
      return selectedCampaign.name
    })
    setBrandName((current) => (current.trim() ? current : selectedCampaign.brand))
  }, [campaignList, selectedCampaign])

  useEffect(() => {
    const fallbackStart = selectedCampaign?.startDate ?? dataStartDate
    const nextStart = parseDateParam(customStart, fallbackStart, dataStartDate, dataEndDate)
    if (nextStart !== customStart) {
      setCustomStart(nextStart)
    }

    const fallbackEnd = selectedCampaign?.endDate ?? dataEndDate
    const nextEndValue = parseDateParam(customEnd, fallbackEnd, dataStartDate, dataEndDate)
    const boundedEnd = nextEndValue < nextStart ? nextStart : nextEndValue
    if (boundedEnd !== customEnd) {
      setCustomEnd(boundedEnd)
    }
  }, [customEnd, customStart, dataEndDate, dataStartDate, selectedCampaign])

  const filteredChannels = useMemo(() => {
    return resolvedChannels.filter((channel) => platforms.includes(channel.platform))
  }, [platforms, resolvedChannels])

  const filteredPosts = useMemo(() => {
    const byPlatform = resolvedPosts.filter((post) => platforms.includes(post.platform))
    if (!selectedCampaign) return byPlatform
    const byCampaign = byPlatform.filter((post) => post.campaignTag === selectedCampaign.name)
    if (byCampaign.length) return byCampaign
    return byPlatform
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
    if (rangeSelection === 'Campaign flight' && selectedCampaign) {
      return `${formatDateLabel(selectedCampaign.startDate)} - ${formatDateLabel(selectedCampaign.endDate)}`
    }
    if (rangeSelection !== 'Custom') return rangeSelection
    return `${formatDateLabel(customStart)} - ${formatDateLabel(customEnd)}`
  }, [customEnd, customStart, rangeSelection, selectedCampaign])

  const readBlobAsDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => reject(new Error('Unable to read image data.'))
      reader.readAsDataURL(blob)
    })

  const loadLogoDataUrl = async () => {
    try {
      const response = await fetch('/logo.png', { cache: 'no-store' })
      if (!response.ok) return ''
      const blob = await response.blob()
      return await readBlobAsDataUrl(blob)
    } catch {
      return ''
    }
  }

  const brandPalette = {
    bg: [247, 248, 246] as const,
    surface: [255, 255, 255] as const,
    surfaceAlt: [238, 243, 239] as const,
    border: [219, 227, 222] as const,
    text: [15, 31, 24] as const,
    muted: [83, 97, 89] as const,
    primary: [15, 95, 68] as const,
    primaryStrong: [10, 75, 52] as const,
    onPrimary: [255, 255, 255] as const,
    onPrimaryMuted: [224, 236, 229] as const,
  }

  const pieChartColors = ['#0f5f44', '#0a4b34', '#1c7c54', '#536159', '#2f6f57', '#7f9488']

  const hexToRgb = (hex: string): [number, number, number] => {
    const normalized = hex.replace('#', '').trim()
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return [15, 95, 68]
    const red = Number.parseInt(normalized.slice(0, 2), 16)
    const green = Number.parseInt(normalized.slice(2, 4), 16)
    const blue = Number.parseInt(normalized.slice(4, 6), 16)
    return [red, green, blue]
  }

  const truncateAudienceLabel = (label: string, maxLength: number) => {
    if (label.length <= maxLength) return label
    return `${label.slice(0, maxLength - 1)}...`
  }

  const getTopAudiencePoints = (
    points: Array<{ label: string; value: number }>,
    limit = 5,
  ) => {
    return points
      .filter((point) => Number(point.value) > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
  }

  const buildPieChartImage = (points: Array<{ label: string; value: number }>) => {
    if (typeof document === 'undefined') return ''
    if (!points.length) return ''

    const canvas = document.createElement('canvas')
    canvas.width = 280
    canvas.height = 280
    const context = canvas.getContext('2d')
    if (!context) return ''

    const centerX = 140
    const centerY = 140
    const radius = 110
    const innerRadius = 58
    const total = points.reduce((sum, point) => sum + point.value, 0)
    if (!total) return ''

    let angle = -Math.PI / 2
    points.forEach((point, index) => {
      const slice = (point.value / total) * Math.PI * 2
      const endAngle = angle + slice
      context.beginPath()
      context.moveTo(centerX, centerY)
      context.arc(centerX, centerY, radius, angle, endAngle)
      context.closePath()
      context.fillStyle = pieChartColors[index % pieChartColors.length]
      context.fill()
      angle = endAngle
    })

    context.beginPath()
    context.arc(centerX, centerY, innerRadius, 0, Math.PI * 2)
    context.fillStyle = '#ffffff'
    context.fill()

    context.fillStyle = '#0f1f18'
    context.font = '600 16px Inter, Arial, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('Audience', centerX, centerY - 10)
    context.font = '700 18px Inter, Arial, sans-serif'
    context.fillText('100%', centerX, centerY + 14)

    return canvas.toDataURL('image/png')
  }

  const handleExportPdf = async () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 48
    const availableWidth = pageWidth - margin * 2
    const logoDataUrl = await loadLogoDataUrl()
    const generatedAt = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date())
    const totalPages = 6
    const totalViews = selectedCampaign?.deliveredViews ?? 0
    const totalEngagements = selectedCampaign?.deliveredEngagements ?? 0
    const totalPublishedPosts = filteredPosts.length ? filteredPosts.length : 0
    const top3Channels = filteredChannels.slice(0, 3)
    const channelViewTotal = filteredChannels.reduce((sum, channel) => sum + channel.views, 0)
    const hasTimeSeriesData = resolvedSeries.some(
      (point) => Number(point.views) > 0 || Number(point.engagements) > 0 || Number(point.posts) > 0,
    )
    const insightBullets = notes
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
    const deliveryProgress =
      selectedCampaign && selectedCampaign.guaranteedViews > 0
        ? Math.min(100, Math.round((selectedCampaign.deliveredViews / selectedCampaign.guaranteedViews) * 100))
        : 0
    const ageAudiencePoints = getTopAudiencePoints(resolvedAgeDistribution)
    const genderAudiencePoints = getTopAudiencePoints(resolvedGenderDistribution)
    const geoAudiencePoints = getTopAudiencePoints(resolvedTopGeos)
    const agePieDataUrl = buildPieChartImage(ageAudiencePoints)
    const genderPieDataUrl = buildPieChartImage(genderAudiencePoints)
    const geoPieDataUrl = buildPieChartImage(geoAudiencePoints)

    const addPageFrame = () => {
      doc.setFillColor(...brandPalette.bg)
      doc.rect(0, 0, pageWidth, pageHeight, 'F')
      doc.setFillColor(...brandPalette.surface)
      doc.roundedRect(margin - 12, 46, availableWidth + 24, pageHeight - 88, 8, 8, 'F')
      doc.setDrawColor(...brandPalette.border)
      doc.roundedRect(margin - 12, 46, availableWidth + 24, pageHeight - 88, 8, 8)
      doc.setFillColor(...brandPalette.primary)
      doc.roundedRect(margin - 12, 46, availableWidth + 24, 58, 8, 8, 'F')
    }

    const addFooter = (pageNumber: number) => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...brandPalette.muted)
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
      addPageFrame()
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(22)
      doc.setTextColor(...brandPalette.onPrimary)
      doc.text(title, margin, 80)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.setTextColor(...brandPalette.onPrimaryMuted)
      doc.text(subtitle, margin, 100)
    }

    const renderAudienceColumn = (
      x: number,
      title: string,
      points: Array<{ label: string; value: number }>,
      pieDataUrl: string,
      columnWidth: number,
    ) => {
      const panelTop = 122
      const panelHeight = 538
      const chartSize = Math.min(132, columnWidth - 34)
      const chartX = x + (columnWidth - chartSize) / 2
      const chartY = panelTop + 34
      const listStartY = chartY + chartSize + 24

      doc.setFillColor(...brandPalette.surfaceAlt)
      doc.setDrawColor(...brandPalette.border)
      doc.roundedRect(x, panelTop, columnWidth, panelHeight, 6, 6, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.setTextColor(...brandPalette.text)
      doc.text(title, x + 12, panelTop + 20)

      if (pieDataUrl) {
        doc.addImage(pieDataUrl, 'PNG', chartX, chartY, chartSize, chartSize)
      } else {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(10)
        doc.setTextColor(...brandPalette.muted)
        doc.text('No chart data available.', x + 12, chartY + 64)
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...brandPalette.muted)
      if (points.length) {
        points.forEach((point, index) => {
          const [red, green, blue] = hexToRgb(pieChartColors[index % pieChartColors.length])
          const rowY = listStartY + index * 20
          doc.setFillColor(red, green, blue)
          doc.rect(x + 12, rowY - 8, 10, 10, 'F')
          doc.setTextColor(...brandPalette.muted)
          const label = truncateAudienceLabel(point.label, 14)
          doc.text(`${label}: ${point.value}%`, x + 28, rowY)
        })
      } else {
        doc.text('No audience data available.', x + 12, listStartY)
      }
    }

    // Page 1 - Cover
    addPageTitle('Brand Performance Report', 'Premium export generated from Reports page')
    doc.setFillColor(...brandPalette.surfaceAlt)
    doc.setDrawColor(...brandPalette.border)
    doc.roundedRect(margin, 120, availableWidth, 260, 6, 6, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...brandPalette.text)
    doc.text(brandName || 'Brand Name', margin + 20, 165)
    doc.setFontSize(13)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...brandPalette.muted)
    doc.text(`Campaign/Deal: ${campaignName || 'Campaign Name'}`, margin + 20, 195)
    doc.text(`Time range: ${displayRange}`, margin + 20, 220)
    doc.text(`Title: ${campaignName || 'Brand Campaign Report'}`, margin + 20, 245)
    doc.setTextColor(...brandPalette.primary)
    doc.text(`Layout: Clean PDF`, margin + 20, 270)
    doc.setTextColor(...brandPalette.muted)
    doc.text(`Channels: ${allChannelsSelected ? 'All ONO/LNO' : channels.join(', ')}`, margin + 20, 295)
    doc.text(`Platforms: ${platforms.join(', ')}`, margin + 20, 320)
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, 'PNG', margin + 20, 334, 120, 42)
    } else {
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(...brandPalette.muted)
      doc.text('Logo image not available.', margin + 20, 350)
    }
    addFooter(1)

    // Page 2 - Executive Summary
    doc.addPage()
    addPageTitle('Executive Summary', 'Delivered totals, channel leaders, and key insights')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...brandPalette.text)
    doc.text('Totals', margin, 130)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...brandPalette.muted)
    doc.text(`Total views: ${formatNumber(totalViews)}`, margin, 154)
    doc.text(`Total engagements: ${formatNumber(totalEngagements)}`, margin, 176)
    doc.text(`Posts published: ${totalPublishedPosts}`, margin, 198)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...brandPalette.text)
    doc.text('Top 3 channels', margin, 236)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...brandPalette.muted)
    if (top3Channels.length) {
      top3Channels.forEach((channel, index) => {
        doc.text(
          `${index + 1}. ${channel.name} (${channel.platform}) - ${formatNumber(channel.views)} views`,
          margin,
          260 + index * 22,
        )
      })
    } else {
      doc.text('No live channel data available for this section.', margin, 260)
    }
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...brandPalette.text)
    doc.text('Insight bullets', margin, 342)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...brandPalette.muted)
    ;(insightBullets.length ? insightBullets : ['No additional notes provided.']).forEach(
      (bullet, index) => {
        const wrapped = doc.splitTextToSize(`- ${bullet}`, availableWidth - 10)
        doc.text(wrapped, margin, 365 + index * 24)
      },
    )
    if (showGuarantee && selectedCampaign) {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...brandPalette.text)
      doc.text('Guaranteed vs Delivered', margin, 520)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...brandPalette.muted)
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
    doc.setDrawColor(...brandPalette.border)
    doc.rect(chartLeft, chartTop, chartWidth, chartHeight)
    if (resolvedSeries.length && maxViews > 0 && hasTimeSeriesData) {
      resolvedSeries.forEach((point, index) => {
        const barWidth = chartWidth / resolvedSeries.length - 8
        const x = chartLeft + index * (chartWidth / resolvedSeries.length) + 4
        const height = (point.views / maxViews) * (chartHeight - 35)
        const y = chartTop + chartHeight - height - 20
        doc.setFillColor(...brandPalette.primary)
        doc.rect(x, y, barWidth, height, 'F')
        doc.setFontSize(8)
        doc.setTextColor(...brandPalette.muted)
        if (index % 2 === 0) {
          doc.text(point.date, x + barWidth / 2, chartTop + chartHeight - 6, { align: 'center' })
        }
      })
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.setTextColor(...brandPalette.muted)
      doc.text(
        'No live performance time-series data is available for this section.',
        chartLeft + 16,
        chartTop + 24,
      )
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...brandPalette.text)
    doc.text('Channel contribution breakdown', margin, 410)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...brandPalette.muted)
    if (filteredChannels.length) {
      filteredChannels.forEach((channel, index) => {
        const share = channelViewTotal ? Math.round((channel.views / channelViewTotal) * 100) : 0
        doc.text(
          `${channel.name}: ${share}% (${formatNumber(channel.views)} views)`,
          margin,
          434 + index * 22,
        )
      })
    } else {
      doc.text('No live channel data is available for contribution breakdown.', margin, 434)
    }
    addFooter(3)

    // Page 4 - Audience
    doc.addPage()
    addPageTitle('Audience', 'Age distribution, gender split, and top geographies')
    const audienceColumnWidth = (availableWidth - 24) / 3
    renderAudienceColumn(margin, 'Age distribution', ageAudiencePoints, agePieDataUrl, audienceColumnWidth)
    renderAudienceColumn(
      margin + audienceColumnWidth + 12,
      'Gender split',
      genderAudiencePoints,
      genderPieDataUrl,
      audienceColumnWidth,
    )
    renderAudienceColumn(
      margin + (audienceColumnWidth + 12) * 2,
      'Top geographies',
      geoAudiencePoints,
      geoPieDataUrl,
      audienceColumnWidth,
    )
    addFooter(4)

    // Page 5 - Top Content
    doc.addPage()
    addPageTitle('Top Content', 'Best-performing posts with views and engagement')
    doc.setFillColor(...brandPalette.surfaceAlt)
    doc.setDrawColor(...brandPalette.border)
    doc.rect(margin, 116, availableWidth, 24, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...brandPalette.text)
    doc.text('Post', margin, 130)
    doc.text('Platform', margin + 235, 130)
    doc.text('Views', margin + 340, 130)
    doc.text('Engagement', margin + 430, 130)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...brandPalette.muted)
    if (filteredPosts.length) {
      filteredPosts.slice(0, 8).forEach((post, index) => {
        const y = 156 + index * 30
        doc.setTextColor(...brandPalette.text)
        doc.text(post.title, margin, y)
        doc.setTextColor(...brandPalette.muted)
        doc.text(post.platform, margin + 235, y)
        doc.text(formatNumber(post.views), margin + 340, y)
        doc.text(`${post.engagementRate.toFixed(1)}%`, margin + 430, y)
        doc.setFontSize(8)
        doc.text('Thumbnail: not available in live export', margin, y + 12)
        doc.setFontSize(11)
      })
    } else {
      doc.text('No live top-content data is available for this section.', margin, 156)
    }
    addFooter(5)

    // Page 6 - Campaign ROI
    doc.addPage()
    addPageTitle('Campaign ROI', 'Delivery progress, guarantee attainment, and distribution')
    if (selectedCampaign) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.setTextColor(...brandPalette.text)
      doc.text('Delivery progress', margin, 130)
      doc.setDrawColor(...brandPalette.border)
      doc.rect(margin, 145, availableWidth, 18)
      doc.setFillColor(...brandPalette.primaryStrong)
      doc.rect(margin, 145, (availableWidth * deliveryProgress) / 100, 18, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.setTextColor(...brandPalette.muted)
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
        doc.text('CPV: N/A', margin, 262)
        doc.text('CPM: N/A', margin + 120, 262)
      }
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...brandPalette.text)
      doc.text('Distribution breakdown', margin, 310)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...brandPalette.muted)
      doc.text(`ONO: ${selectedCampaign.distribution.ono}%`, margin, 334)
      doc.text(`Clipper: ${selectedCampaign.distribution.clipper}%`, margin + 150, 334)
      doc.text(`Pacing: ${selectedCampaign.pacing}`, margin, 358)
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(12)
      doc.setTextColor(...brandPalette.muted)
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

  const handleExportDeckPdf = async () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 44
    const contentWidth = pageWidth - margin * 2
    const contentHeight = pageHeight - 96
    const logoDataUrl = await loadLogoDataUrl()
    const generatedAt = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date())
    const totalSlides = 6
    const totalViews = selectedCampaign?.deliveredViews ?? 0
    const totalEngagements = selectedCampaign?.deliveredEngagements ?? 0
    const totalPublishedPosts = filteredPosts.length ? filteredPosts.length : 0
    const topChannels = filteredChannels.slice(0, 5)
    const topPosts = filteredPosts.slice(0, 6)
    const channelViewTotal = filteredChannels.reduce((sum, channel) => sum + channel.views, 0)
    const hasTimeSeriesData = resolvedSeries.some(
      (point) => Number(point.views) > 0 || Number(point.engagements) > 0 || Number(point.posts) > 0,
    )
    const maxViews = resolvedSeries.length ? Math.max(...resolvedSeries.map((point) => point.views)) : 0
    const insightBullets = notes
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5)
    const deliveryProgress =
      selectedCampaign && selectedCampaign.guaranteedViews > 0
        ? Math.min(100, Math.round((selectedCampaign.deliveredViews / selectedCampaign.guaranteedViews) * 100))
        : 0
    const baseFileName = toFileSlug(campaignName || brandName || 'brand-report')
    const ageAudiencePoints = getTopAudiencePoints(resolvedAgeDistribution, 4)
    const genderAudiencePoints = getTopAudiencePoints(resolvedGenderDistribution, 4)
    const geoAudiencePoints = getTopAudiencePoints(resolvedTopGeos, 4)
    const agePieDataUrl = buildPieChartImage(ageAudiencePoints)
    const genderPieDataUrl = buildPieChartImage(genderAudiencePoints)
    const geoPieDataUrl = buildPieChartImage(geoAudiencePoints)

    const addSlideShell = (slideNumber: number, title: string, subtitle: string) => {
      doc.setFillColor(...brandPalette.bg)
      doc.rect(0, 0, pageWidth, pageHeight, 'F')
      doc.setFillColor(...brandPalette.primary)
      doc.rect(0, 0, pageWidth, 76, 'F')
      doc.setFillColor(...brandPalette.primaryStrong)
      doc.rect(pageWidth - 220, 0, 220, 76, 'F')

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(23)
      doc.setTextColor(...brandPalette.onPrimary)
      doc.text(title, margin, 42)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.setTextColor(...brandPalette.onPrimaryMuted)
      doc.text(subtitle, margin, 60)

      doc.setFontSize(9)
      doc.setTextColor(...brandPalette.muted)
      doc.text(`Generated ${generatedAt} | Range: ${displayRange}`, margin, pageHeight - 18)
      doc.text(`Slide ${slideNumber} of ${totalSlides}`, pageWidth - margin, pageHeight - 18, {
        align: 'right',
      })
    }

    const addMetricCard = (
      x: number,
      y: number,
      width: number,
      height: number,
      label: string,
      value: string,
      detail?: string,
    ) => {
      doc.setFillColor(...brandPalette.surface)
      doc.roundedRect(x, y, width, height, 8, 8, 'F')
      doc.setDrawColor(...brandPalette.border)
      doc.roundedRect(x, y, width, height, 8, 8)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...brandPalette.muted)
      doc.text(label, x + 16, y + 24)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(22)
      doc.setTextColor(...brandPalette.text)
      doc.text(value, x + 16, y + 50)

      if (!detail) return
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...brandPalette.muted)
      doc.text(detail, x + 16, y + 68)
    }

    const addPanel = (x: number, y: number, width: number, height: number) => {
      doc.setFillColor(...brandPalette.surfaceAlt)
      doc.roundedRect(x, y, width, height, 8, 8, 'F')
      doc.setDrawColor(...brandPalette.border)
      doc.roundedRect(x, y, width, height, 8, 8)
    }

    // Slide 1 - Cover
    addSlideShell(1, 'Brand Performance Deck', 'Slide-style report export for external brand sharing')
    addPanel(margin, 98, contentWidth, contentHeight - 18)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(30)
    doc.setTextColor(...brandPalette.text)
    doc.text(campaignName || 'Campaign Name', margin + 28, 160)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(15)
    doc.setTextColor(...brandPalette.muted)
    doc.text(brandName || 'Brand Name', margin + 28, 188)
    doc.setFontSize(12)
    doc.text(`Date range: ${displayRange}`, margin + 28, 216)
    doc.text(`Channels: ${allChannelsSelected ? 'All ONO/LNO' : channels.join(', ')}`, margin + 28, 238)
    doc.text(`Platforms: ${platforms.join(', ')}`, margin + 28, 260)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...brandPalette.primary)
    doc.text('Layout: Deck-style PDF', margin + 28, 292)
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, 'PNG', pageWidth - margin - 180, 120, 150, 54)
    } else {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(20)
      doc.text('Fixated', pageWidth - margin - 128, 158)
    }

    // Slide 2 - Executive summary
    doc.addPage()
    addSlideShell(2, 'Executive Summary', 'Key campaign totals and top delivery drivers')
    const summaryCardWidth = (contentWidth - 32) / 3
    addMetricCard(
      margin,
      104,
      summaryCardWidth,
      86,
      'Total views delivered',
      formatNumber(totalViews),
      selectedCampaign ? `Guarantee: ${formatNumber(selectedCampaign.guaranteedViews)}` : undefined,
    )
    addMetricCard(
      margin + summaryCardWidth + 16,
      104,
      summaryCardWidth,
      86,
      'Total engagements',
      formatNumber(totalEngagements),
      selectedCampaign
        ? `Guarantee: ${formatNumber(selectedCampaign.guaranteedEngagements)}`
        : undefined,
    )
    addMetricCard(
      margin + (summaryCardWidth + 16) * 2,
      104,
      summaryCardWidth,
      86,
      'Posts published',
      String(totalPublishedPosts),
      `Platforms: ${platforms.length}`,
    )
    addPanel(margin, 210, contentWidth * 0.58, 210)
    addPanel(margin + contentWidth * 0.58 + 14, 210, contentWidth * 0.42 - 14, 210)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...brandPalette.text)
    doc.text('Insights', margin + 18, 236)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...brandPalette.muted)
    ;(insightBullets.length ? insightBullets : ['No additional notes provided.']).forEach(
      (bullet, index) => {
        const wrapped = doc.splitTextToSize(`- ${bullet}`, contentWidth * 0.54)
        doc.text(wrapped, margin + 18, 262 + index * 26)
      },
    )

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...brandPalette.text)
    doc.text('Top channels', margin + contentWidth * 0.58 + 32, 236)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...brandPalette.muted)
    if (topChannels.length) {
      topChannels.forEach((channel, index) => {
        const share = channelViewTotal ? Math.round((channel.views / channelViewTotal) * 100) : 0
        doc.text(
          `${index + 1}. ${channel.name} (${channel.platform}) - ${share}%`,
          margin + contentWidth * 0.58 + 32,
          262 + index * 26,
        )
      })
    } else {
      doc.text('No live channel data available.', margin + contentWidth * 0.58 + 32, 262)
    }

    // Slide 3 - Performance trend
    doc.addPage()
    addSlideShell(3, 'Performance Trend', 'Combined view trend and channel contribution')
    addPanel(margin, 104, contentWidth, 320)
    const chartX = margin + 20
    const chartY = 142
    const chartWidth = contentWidth - 40
    const chartHeight = 190
    doc.setDrawColor(...brandPalette.border)
    doc.rect(chartX, chartY, chartWidth, chartHeight)
    if (resolvedSeries.length && maxViews > 0 && hasTimeSeriesData) {
      resolvedSeries.forEach((point, index) => {
        const barSlot = chartWidth / resolvedSeries.length
        const barWidth = Math.max(4, barSlot - 6)
        const x = chartX + index * barSlot + (barSlot - barWidth) / 2
        const height = Math.max(2, (point.views / maxViews) * (chartHeight - 28))
        const y = chartY + chartHeight - height - 14
        doc.setFillColor(...brandPalette.primary)
        doc.rect(x, y, barWidth, height, 'F')
        if (index % 2 === 0) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8)
          doc.setTextColor(...brandPalette.muted)
          doc.text(point.date, x + barWidth / 2, chartY + chartHeight - 3, { align: 'center' })
        }
      })
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.setTextColor(...brandPalette.muted)
      doc.text('No live performance time-series data available.', chartX + 14, chartY + 26)
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...brandPalette.text)
    doc.text('Channel contribution', margin + 20, 362)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...brandPalette.muted)
    if (filteredChannels.length) {
      filteredChannels.slice(0, 6).forEach((channel, index) => {
        const share = channelViewTotal ? Math.round((channel.views / channelViewTotal) * 100) : 0
        doc.text(
          `${channel.name}: ${formatNumber(channel.views)} views (${share}%)`,
          margin + 20,
          382 + index * 16,
        )
      })
    } else {
      doc.text('No live channel data is available for contribution breakdown.', margin + 20, 382)
    }

    // Slide 4 - Audience snapshot
    doc.addPage()
    addSlideShell(4, 'Audience Snapshot', 'Age, gender, and top geographies')
    const panelWidth = (contentWidth - 24) / 3
    addPanel(margin, 110, panelWidth, 304)
    addPanel(margin + panelWidth + 12, 110, panelWidth, 304)
    addPanel(margin + (panelWidth + 12) * 2, 110, panelWidth, 304)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...brandPalette.text)
    doc.text('Age distribution', margin + 16, 136)
    doc.text('Gender split', margin + panelWidth + 28, 136)
    doc.text('Top geographies', margin + (panelWidth + 12) * 2 + 16, 136)
    const deckPieSize = Math.min(116, panelWidth - 34)
    const deckPieY = 148
    const renderDeckAudienceColumn = (
      x: number,
      points: Array<{ label: string; value: number }>,
      pieDataUrl: string,
    ) => {
      if (pieDataUrl) {
        doc.addImage(
          pieDataUrl,
          'PNG',
          x + (panelWidth - deckPieSize) / 2,
          deckPieY,
          deckPieSize,
          deckPieSize,
        )
      } else {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(...brandPalette.muted)
        doc.text('No chart data available.', x + 16, deckPieY + 58)
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...brandPalette.muted)
      const listStartY = deckPieY + deckPieSize + 22
      if (points.length) {
        points.forEach((point, index) => {
          const [red, green, blue] = hexToRgb(pieChartColors[index % pieChartColors.length])
          const rowY = listStartY + index * 20
          doc.setFillColor(red, green, blue)
          doc.rect(x + 16, rowY - 8, 10, 10, 'F')
          doc.setTextColor(...brandPalette.muted)
          const label = truncateAudienceLabel(point.label, 14)
          doc.text(`${label}: ${point.value}%`, x + 32, rowY)
        })
      } else {
        doc.text('No audience data available.', x + 16, listStartY)
      }
    }
    renderDeckAudienceColumn(margin, ageAudiencePoints, agePieDataUrl)
    renderDeckAudienceColumn(margin + panelWidth + 12, genderAudiencePoints, genderPieDataUrl)
    renderDeckAudienceColumn(margin + (panelWidth + 12) * 2, geoAudiencePoints, geoPieDataUrl)

    // Slide 5 - Top content
    doc.addPage()
    addSlideShell(5, 'Top Content Breakdown', 'Highest-performing posts by views and engagement')
    addPanel(margin, 110, contentWidth, 304)
    doc.setFillColor(...brandPalette.surface)
    doc.rect(margin + 14, 130, contentWidth - 28, 28, 'F')
    doc.setDrawColor(...brandPalette.border)
    doc.rect(margin + 14, 130, contentWidth - 28, 28)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...brandPalette.text)
    doc.text('Post', margin + 24, 148)
    doc.text('Platform', margin + contentWidth * 0.58, 148)
    doc.text('Views', margin + contentWidth * 0.74, 148)
    doc.text('Eng. rate', margin + contentWidth * 0.86, 148)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...brandPalette.muted)
    if (topPosts.length) {
      topPosts.forEach((post, index) => {
        const y = 182 + index * 34
        const title = doc.splitTextToSize(post.title, contentWidth * 0.52)
        doc.text(title, margin + 24, y)
        doc.text(post.platform, margin + contentWidth * 0.58, y)
        doc.text(formatNumber(post.views), margin + contentWidth * 0.74, y)
        doc.text(`${post.engagementRate.toFixed(1)}%`, margin + contentWidth * 0.86, y)
      })
    } else {
      doc.text('No live top-content data is available.', margin + 24, 182)
    }

    // Slide 6 - Campaign ROI
    doc.addPage()
    addSlideShell(6, 'Campaign ROI', 'Guaranteed vs delivered performance and pacing')
    addPanel(margin, 110, contentWidth, 304)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...brandPalette.text)
    doc.text('Delivery progress', margin + 20, 144)
    doc.setDrawColor(...brandPalette.border)
    doc.roundedRect(margin + 20, 160, contentWidth - 40, 24, 6, 6)
    doc.setFillColor(...brandPalette.primaryStrong)
    doc.roundedRect(
      margin + 20,
      160,
      ((contentWidth - 40) * deliveryProgress) / 100,
      24,
      6,
      6,
      'F',
    )
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...brandPalette.text)
    doc.text(`${deliveryProgress}%`, margin + 24, 177)
    if (selectedCampaign) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(12)
      doc.setTextColor(...brandPalette.muted)
      doc.text(
        `Views: ${formatNumber(selectedCampaign.deliveredViews)} delivered / ${formatNumber(selectedCampaign.guaranteedViews)} guaranteed`,
        margin + 20,
        218,
      )
      doc.text(
        `Engagements: ${formatNumber(selectedCampaign.deliveredEngagements)} delivered / ${formatNumber(selectedCampaign.guaranteedEngagements)} guaranteed`,
        margin + 20,
        242,
      )
      doc.text(`Distribution source: ONO ${selectedCampaign.distribution.ono}%`, margin + 20, 266)
      doc.text(`Distribution source: Clipper ${selectedCampaign.distribution.clipper}%`, margin + 20, 290)
      doc.text(`Pacing status: ${selectedCampaign.pacing}`, margin + 20, 314)
      if (showCPM) {
        doc.text('CPV: N/A', margin + 20, 338)
        doc.text('CPM: N/A', margin + 120, 338)
      }
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(12)
      doc.setTextColor(58, 71, 97)
      doc.text(
        'No campaign selected. Enable a campaign filter to include guaranteed vs delivered ROI.',
        margin + 20,
        218,
      )
    }

    doc.save(`${baseFileName}-deck-report.pdf`)
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
      ...resolvedAgeDistribution.map((point) => ({
        segment: 'age',
        label: point.label,
        percent: point.value,
      })),
      ...resolvedGenderDistribution.map((point) => ({
        segment: 'gender',
        label: point.label,
        percent: point.value,
      })),
      ...resolvedTopGeos.map((point) => ({
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

  const handleCampaignFilterChange = (value: string) => {
    setCampaignFilter(value)
    if (value === 'No campaign filter') return
    const matchedCampaign = campaignList.find((campaign) => campaign.name === value)
    if (!matchedCampaign) return
    setCampaignName(matchedCampaign.name)
    setBrandName(matchedCampaign.brand)
    if (rangeSelection === 'Campaign flight') {
      setCustomStart(matchedCampaign.startDate)
      setCustomEnd(matchedCampaign.endDate)
    }
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

  const previewTotalViews = selectedCampaign?.deliveredViews ?? 0
  const previewTotalEngagements = selectedCampaign?.deliveredEngagements ?? 0
  const previewDeliveryPercent =
    selectedCampaign && selectedCampaign.guaranteedViews > 0
      ? Math.min(100, Math.round((selectedCampaign.deliveredViews / selectedCampaign.guaranteedViews) * 100))
      : 0
  const canExport = Boolean(campaignList.length && !campaignsLoading)

  return (
    <>
      <SectionHeader
        title="Brand Report Builder"
        subtitle="Configure a polished, client-ready report."
        actions={
          <div className="filter-bar">
            <button className="ghost-button" onClick={handleExportCsv} disabled={!canExport}>
              Export CSV
            </button>
            <button className="primary-button" onClick={handleExportPdf} disabled={!canExport}>
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
                onChange={(event) => handleCampaignFilterChange(event.target.value)}
                disabled={campaignsLoading}
              >
                <option value="No campaign filter">No campaign filter</option>
                {campaignList.map((campaign) => (
                  <option key={campaign.id} value={campaign.name}>
                    {campaign.name}
                  </option>
                ))}
              </select>
              {campaignsLoading ? (
                <div className="section-subtitle">Loading campaign options...</div>
              ) : null}
              {campaignsError ? (
                <div className="section-subtitle" style={{ color: 'var(--danger)' }}>
                  {campaignsError}
                </div>
              ) : null}
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
            <button className="ghost-button" onClick={handleExportPdf} disabled={!canExport}>
              Clean PDF
            </button>
            <button className="ghost-button" onClick={handleExportDeckPdf} disabled={!canExport}>
              Deck-style PDF
            </button>
            <button className="ghost-button" onClick={handleShareLink}>
              Shareable link
            </button>
            <button className="ghost-button" onClick={handleExportCsv} disabled={!canExport}>
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
              {brandName || 'Brand'} | {displayRange}
            </div>
            <div className="grid grid-2" style={{ marginTop: '16px' }}>
              <div className="card compact">
                <div className="kpi-label">Total Views</div>
                <div className="kpi-value">{formatNumber(previewTotalViews)}</div>
              </div>
              <div className="card compact">
                <div className="kpi-label">Engagements</div>
                <div className="kpi-value">{formatNumber(previewTotalEngagements)}</div>
              </div>
            </div>
            {showGuarantee ? (
              <>
                <div className="section-subtitle" style={{ marginTop: '16px' }}>
                  Guarantee vs Delivered
                </div>
                <div className="progress-track" style={{ marginTop: '8px' }}>
                  <div className="progress-fill" style={{ width: `${previewDeliveryPercent}%` }} />
                </div>
                <div className="filter-bar" style={{ marginTop: '12px' }}>
                  <span className="filter-chip">Delivery: {previewDeliveryPercent}%</span>
                  {showCPM ? (
                    <>
                      <span className="filter-chip">CPV: N/A</span>
                      <span className="filter-chip">CPM: N/A</span>
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

