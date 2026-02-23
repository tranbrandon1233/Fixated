import { useCallback, useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import { SectionHeader } from '../components/ui/SectionHeader'
import { useYouTubeSummary } from '../hooks/useYouTubeSummary'
import type { Role } from '../types/dashboard'
import { resolveAuthBaseUrl } from '../utils/baseUrl'
import { fetchCampaigns } from '../utils/campaigns'
import { createCsvContent, downloadCsv, toFileSlug } from '../utils/csv'
import { cacheExportPreviewFallback } from '../utils/exportPreviewFallback'
import { formatNumber } from '../utils/format'
import {
  mapCampaignForReport,
  resolveViewerCampaignRole,
  type ReportCampaign,
} from '../utils/reportCampaigns'
import {
  sanitizeAllowlistedValue,
  sanitizeDateInput,
  sanitizeMultilineInput,
  sanitizeTextInput,
  sanitizeTokenInput,
} from '../utils/sanitize'

interface ReportBuilderProps {
  role: Role
}

const formatChannelOptionValue = (channelName: string, platform: string) =>
  `${channelName} [${platform}]`

const areStringArraysEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index])

export const ReportBuilder = ({ role }: ReportBuilderProps) => {
  const [campaignList, setCampaignList] = useState<ReportCampaign[]>([])
  const [viewerUserId, setViewerUserId] = useState('')
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
  const resolvedSeriesByChannel = useMemo(
    () => youtubeSummary.timeSeriesByChannel ?? [],
    [youtubeSummary.timeSeriesByChannel],
  )

  const resolvedAgeDistribution = useMemo(() => youtubeSummary.ageDistribution, [youtubeSummary.ageDistribution])
  const resolvedAgeDistributionByChannel = useMemo(
    () => youtubeSummary.ageDistributionByChannel ?? {},
    [youtubeSummary.ageDistributionByChannel],
  )

  const resolvedGenderDistribution = useMemo(() => youtubeSummary.genderDistribution, [youtubeSummary.genderDistribution])
  const resolvedGenderDistributionByChannel = useMemo(
    () => youtubeSummary.genderDistributionByChannel ?? {},
    [youtubeSummary.genderDistributionByChannel],
  )

  const resolvedTopGeos = useMemo(() => youtubeSummary.topGeos, [youtubeSummary.topGeos])
  const resolvedTopGeosByChannel = useMemo(
    () => youtubeSummary.topGeosByChannel ?? {},
    [youtubeSummary.topGeosByChannel],
  )

  const channelOptions = useMemo(() => {
    const uniqueChannelLabels = [
      ...new Set(resolvedChannels.map((channel) => formatChannelOptionValue(channel.name, channel.platform))),
    ]
    return ['All ONO/LNO', ...uniqueChannelLabels]
  }, [resolvedChannels])

  const todayDate = useMemo(() => {
    const now = new Date()
    const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    return localTime.toISOString().slice(0, 10)
  }, [])

  const parseListParam = (
    value: string | null,
    allowed: string[],
    fallback: string[],
    options?: { allowEmpty?: boolean },
  ) => {
    if (value === null) return fallback
    if (!value.trim()) return options?.allowEmpty ? [] : fallback
    const normalized = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => allowed.includes(item))
    if (normalized.length) return normalized
    return options?.allowEmpty ? [] : fallback
  }

  const parseDateParam = (value: string | null, fallback: string, min: string, max: string) => {
    return sanitizeDateInput(value, { fallback, min, max })
  }

  const parseTokenListParam = (value: string | null, maxLength: number) => {
    if (!value) return []
    const seen = new Set<string>()
    return value
      .split(',')
      .map((entry) => sanitizeTokenInput(entry, maxLength))
      .filter((entry) => {
        if (!entry || seen.has(entry)) return false
        seen.add(entry)
        return true
      })
  }

  const toMetricNumber = (value: unknown) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const roundMetric = (value: number, digits = 2) => {
    const precision = 10 ** digits
    return Math.round(value * precision) / precision
  }

  const [initialShareState] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const initialChannels = parseListParam(
      params.get('channels'),
      channelOptions,
      ['All ONO/LNO'],
      { allowEmpty: true },
    )
    const hasAllChannel = initialChannels.includes('All ONO/LNO')

    return {
      brandName: sanitizeTextInput(params.get('brand'), { maxLength: 140 }),
      campaignName: sanitizeTextInput(params.get('campaign'), { maxLength: 140 }),
      campaignFilter: sanitizeTextInput(params.get('filter') ?? '', { maxLength: 140 }),
      campaignIds: (() => {
        const rawCampaignIds = parseTokenListParam(params.get('campaignIds'), 80)
        const singleCampaignId = sanitizeTokenInput(params.get('campaignId'), 80)
        if (!singleCampaignId) return rawCampaignIds
        if (rawCampaignIds.includes(singleCampaignId)) return rawCampaignIds
        return [...rawCampaignIds, singleCampaignId]
      })(),
      rangeSelection: sanitizeAllowlistedValue(params.get('range'), rangeOptions, 'Campaign flight'),
      customStart: parseDateParam(params.get('start'), todayDate, fallbackMinDate, fallbackMaxDate),
      customEnd: parseDateParam(params.get('end'), todayDate, fallbackMinDate, fallbackMaxDate),
      showCPM: (params.get('showCpm') ?? 'true') === 'true',
      showGuarantee: (params.get('showGuarantee') ?? 'true') === 'true',
      notes:
        sanitizeMultilineInput(params.get('notes'), 4000) ||
        'Performance summary generated from campaign delivery data.',
      channels: hasAllChannel ? ['All ONO/LNO'] : initialChannels,
      platforms: parseListParam(params.get('platforms'), platformOptions, platformOptions),
      metrics: parseListParam(params.get('metrics'), metricOptions, ['Views', 'Engagements', 'Posts', 'Watch Time', 'Followers']),
    }
  })

  const [brandName, setBrandName] = useState(initialShareState.brandName)
  const [campaignName, setCampaignName] = useState(initialShareState.campaignName)
  const [selectedCampaignIds, setSelectedCampaignIds] = useState(initialShareState.campaignIds)
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
  const canAccessReportBuilder = role === 'admin' || role === 'internal'
  const authBaseUrl = resolveAuthBaseUrl()

  const blobToBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('Unable to read export preview payload.'))
          return
        }
        const [, data = ''] = reader.result.split(',', 2)
        resolve(data)
      }
      reader.onerror = () => reject(new Error('Unable to read export preview payload.'))
      reader.readAsDataURL(blob)
    })

  const openProtectedPreview = async (blob: Blob, type: 'pdf' | 'csv', fileName: string) => {
    const previewWindow = window.open('', '_blank')
    if (!previewWindow) {
      setShareStatus('Popup blocked. Allow popups to open export previews.')
      return
    }
    const writePreviewWindowText = (title: string, message: string) => {
      const document = previewWindow.document
      document.title = title
      const body = document.body
      body.textContent = ''
      const paragraph = document.createElement('p')
      paragraph.style.fontFamily = 'Arial, sans-serif'
      paragraph.style.padding = '24px'
      paragraph.textContent = message
      body.appendChild(paragraph)
    }
    try {
      writePreviewWindowText('Preparing export preview...', 'Preparing export preview...')
    } catch {
      // Ignore document write errors and continue with navigation.
    }

    try {
      if (!exportAuthorizationCampaign?.id) {
        setShareStatus('Select a campaign you are a member of to export reports.')
        previewWindow.close()
        return
      }
      const dataBase64 = await blobToBase64(blob)
      const scopedCampaignIdsForPreview = scopedCampaigns.length
        ? scopedCampaigns.map((campaign) => campaign.id)
        : [exportAuthorizationCampaign.id]
      const sanitizedCampaignIds = [...new Set(
        scopedCampaignIdsForPreview
          .map((campaignId) => sanitizeTokenInput(campaignId, 80))
          .filter((campaignId) => Boolean(campaignId)),
      )]
      const response = await fetch(`${authBaseUrl}/api/exports/preview`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: exportAuthorizationCampaign.id,
          campaignIds: sanitizedCampaignIds,
          type,
          fileName,
          dataBase64,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string'
            ? (payload as { message: string }).message
            : 'Unable to create export preview.',
        )
      }

      const previewId =
        payload && typeof payload === 'object' && typeof (payload as { id?: unknown }).id === 'string'
          ? (payload as { id: string }).id
          : ''
      if (!previewId) {
        throw new Error('Unable to create export preview.')
      }
      cacheExportPreviewFallback(previewId, {
        type,
        fileName,
        dataBase64,
      })
      const previewUrl = `${window.location.origin}/exports/preview?id=${encodeURIComponent(previewId)}&type=${encodeURIComponent(type)}&fileName=${encodeURIComponent(fileName)}`
      try {
        previewWindow.location.href = previewUrl
      } catch {
        window.open(previewUrl, '_blank')
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? sanitizeTextInput(err.message, { maxLength: 300 })
          : 'Unable to create export preview.'
      try {
        writePreviewWindowText('Export preview unavailable', message)
      } catch {
        previewWindow.close()
      }
      setShareStatus(message)
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadCampaigns = async () => {
      setCampaignsLoading(true)
      setCampaignsError(null)
      try {
        const response = await fetchCampaigns()
        if (cancelled) return
        setViewerUserId(response.viewerUserId)
        const memberCampaigns = response.campaigns.flatMap((campaign) => {
          const viewerRole = resolveViewerCampaignRole(campaign, response.viewerUserId)
          if (!viewerRole) return []
          return [mapCampaignForReport(campaign, viewerRole)]
        })
        setCampaignList(memberCampaigns)
      } catch (err) {
        if (cancelled) return
        setCampaignList([])
        setViewerUserId('')
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
  const includesWatchTimeMetric = metrics.includes('Watch Time')
  const includesFollowersMetric = metrics.includes('Followers')
  const selectedChannelOptions = useMemo(
    () => channels.filter((item) => item !== 'All ONO/LNO' && channelOptions.includes(item)),
    [channelOptions, channels],
  )
  const selectedChannelsLabel = allChannelsSelected
    ? 'All ONO/LNO'
    : selectedChannelOptions.length
      ? selectedChannelOptions.join(', ')
      : 'No channels selected'
  const selectedChannelOptionSet = useMemo(() => new Set(selectedChannelOptions), [selectedChannelOptions])
  const resolveChannelOptionLabel = (option: string) => {
    if (option === 'All ONO/LNO') return option
    return option
  }

  useEffect(() => {
    if (!campaignList.length) return
    setSelectedCampaignIds((current) => {
      const allowedCampaignIds = new Set(campaignList.map((campaign) => campaign.id))
      const normalizedCurrent = [...new Set(
        current
          .map((campaignId) => sanitizeTokenInput(campaignId, 80))
          .filter((campaignId) => campaignId && allowedCampaignIds.has(campaignId)),
      )]
      if (normalizedCurrent.length) {
        return areStringArraysEqual(normalizedCurrent, current) ? current : normalizedCurrent
      }
      const legacyFilter = sanitizeTextInput(initialShareState.campaignFilter, { maxLength: 140 })
      const legacyCampaignName = sanitizeTextInput(initialShareState.campaignName, { maxLength: 140 })
      const fallbackMatch = campaignList.find((campaign) => campaign.name === legacyFilter)
        ?? campaignList.find((campaign) => campaign.name === legacyCampaignName)
      if (!fallbackMatch) {
        return current.length ? [] : current
      }
      return current.length === 1 && current[0] === fallbackMatch.id ? current : [fallbackMatch.id]
    })
  }, [campaignList, initialShareState.campaignFilter, initialShareState.campaignName])

  const selectedCampaignIdSet = useMemo(
    () => new Set(selectedCampaignIds),
    [selectedCampaignIds],
  )
  const isAllCampaignFilter = selectedCampaignIds.length === 0
  const scopedCampaigns = useMemo(() => {
    if (!campaignList.length) return []
    if (isAllCampaignFilter) return campaignList
    return campaignList.filter((campaign) => selectedCampaignIdSet.has(campaign.id))
  }, [campaignList, isAllCampaignFilter, selectedCampaignIdSet])
  const activeCampaign = scopedCampaigns.length === 1 ? scopedCampaigns[0] : null
  const campaignFilterLabel = isAllCampaignFilter
    ? 'All campaigns'
    : scopedCampaigns.length === 1
      ? scopedCampaigns[0].name
      : scopedCampaigns.length
        ? `${scopedCampaigns.length} campaigns selected`
        : 'Selected campaigns'
  const scopedCampaignDateRange = useMemo(() => {
    const scopedDates = scopedCampaigns
      .flatMap((campaign) => [campaign.startDate, campaign.endDate])
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort()
    if (!scopedDates.length) {
      return {
        startDate: dataStartDate,
        endDate: dataEndDate,
      }
    }
    return {
      startDate: scopedDates[0],
      endDate: scopedDates[scopedDates.length - 1],
    }
  }, [dataEndDate, dataStartDate, scopedCampaigns])
  const exportAuthorizationCampaign = useMemo(
    () =>
      scopedCampaigns.find(
        (campaign) => campaign.viewerRole === 'admin' || campaign.viewerRole === 'internal',
      ) ?? null,
    [scopedCampaigns],
  )
  const scopedCampaignTotals = useMemo(
    () =>
      scopedCampaigns.reduce(
        (totals, campaign) => ({
          guaranteedViews: totals.guaranteedViews + toMetricNumber(campaign.guaranteedViews),
          deliveredViews: totals.deliveredViews + toMetricNumber(campaign.deliveredViews),
          guaranteedEngagements:
            totals.guaranteedEngagements + toMetricNumber(campaign.guaranteedEngagements),
          deliveredEngagements: totals.deliveredEngagements + toMetricNumber(campaign.deliveredEngagements),
        }),
        {
          guaranteedViews: 0,
          deliveredViews: 0,
          guaranteedEngagements: 0,
          deliveredEngagements: 0,
        },
      ),
    [scopedCampaigns],
  )
  const scopedCampaignDeliveryPercent =
    scopedCampaignTotals.guaranteedViews > 0
      ? Math.min(100, Math.round((scopedCampaignTotals.deliveredViews / scopedCampaignTotals.guaranteedViews) * 100))
      : 0
  const scopedCampaignDistribution = useMemo(() => {
    const deliveredTotal = scopedCampaigns.reduce(
      (sum, campaign) => sum + Math.max(0, toMetricNumber(campaign.deliveredViews)),
      0,
    )
    if (!deliveredTotal) {
      return { ono: 0, clipper: 0 }
    }
    const onoWeighted = scopedCampaigns.reduce(
      (sum, campaign) =>
        sum + toMetricNumber(campaign.distribution.ono) * Math.max(0, toMetricNumber(campaign.deliveredViews)),
      0,
    )
    const clipperWeighted = scopedCampaigns.reduce(
      (sum, campaign) =>
        sum + toMetricNumber(campaign.distribution.clipper) * Math.max(0, toMetricNumber(campaign.deliveredViews)),
      0,
    )
    return {
      ono: roundMetric(onoWeighted / deliveredTotal, 1),
      clipper: roundMetric(clipperWeighted / deliveredTotal, 1),
    }
  }, [scopedCampaigns])
  const scopedCampaignPacingLabel = activeCampaign
    ? activeCampaign.pacing
    : scopedCampaigns.length
      ? `Mixed (${scopedCampaigns.length} campaigns)`
      : 'N/A'

  const canExportReports = Boolean(exportAuthorizationCampaign)

  useEffect(() => {
    if (!activeCampaign) return
    setCampaignName((current) => {
      const sanitizedCurrent = sanitizeTextInput(current, { maxLength: 140 })
      if (
        sanitizedCurrent &&
        campaignList.some((campaign) => campaign.name === sanitizedCurrent)
      ) {
        return sanitizedCurrent
      }
      return activeCampaign.name
    })
    setBrandName((current) => {
      const sanitizedCurrent = sanitizeTextInput(current, { maxLength: 140 })
      return sanitizedCurrent || activeCampaign.brand
    })
  }, [activeCampaign, campaignList])

  useEffect(() => {
    const fallbackStart = activeCampaign?.startDate ?? scopedCampaignDateRange.startDate
    const nextStart = parseDateParam(customStart, fallbackStart, dataStartDate, dataEndDate)
    if (nextStart !== customStart) {
      setCustomStart(nextStart)
    }

    const fallbackEnd = activeCampaign?.endDate ?? scopedCampaignDateRange.endDate
    const nextEndValue = parseDateParam(customEnd, fallbackEnd, dataStartDate, dataEndDate)
    const boundedEnd = nextEndValue < nextStart ? nextStart : nextEndValue
    if (boundedEnd !== customEnd) {
      setCustomEnd(boundedEnd)
    }
  }, [activeCampaign, customEnd, customStart, dataEndDate, dataStartDate, scopedCampaignDateRange])

  const scopedCampaignPostIdSet = useMemo(() => {
    const ids = new Set<string>()
    scopedCampaigns.forEach((campaign) => {
      campaign.selectedPostIds.forEach((postId) => {
        const normalizedPostId = typeof postId === 'string' ? postId.trim() : ''
        if (!normalizedPostId) return
        ids.add(normalizedPostId)
      })
      campaign.posts.forEach((group) => {
        if (!group || typeof group !== 'object') return
        const posts = group.posts && typeof group.posts === 'object' && !Array.isArray(group.posts)
          ? group.posts
          : {}
        Object.keys(posts).forEach((postId) => {
          const normalizedPostId = typeof postId === 'string' ? postId.trim() : ''
          if (!normalizedPostId) return
          ids.add(normalizedPostId)
        })
      })
    })
    return ids
  }, [scopedCampaigns])

  const scopedCampaignAssignedPosts = useMemo(
    () => {
      const byId = new Map<string, {
        id: string
        title: string
        platform: string
        channelId: string
        channelName: string
        views: number
        engagementRate: number
      }>()
      scopedCampaigns.forEach((campaign) => {
        campaign.posts.forEach((group) => {
          if (!group || typeof group !== 'object') return
          const channelId = typeof group.channelId === 'string' ? group.channelId.trim() : ''
          const channelName = typeof group.channelName === 'string' ? group.channelName.trim() : ''
          const groupPlatform = typeof group.platform === 'string' ? group.platform.trim() : ''
          const posts = group.posts && typeof group.posts === 'object' && !Array.isArray(group.posts)
            ? group.posts
            : {}
          Object.entries(posts).forEach(([postId, postValue]) => {
            const normalizedPostId = typeof postId === 'string' ? postId.trim() : ''
            if (!normalizedPostId) return
            const source = postValue && typeof postValue === 'object' && !Array.isArray(postValue)
              ? postValue as {
                title?: unknown
                platform?: unknown
                channelId?: unknown
                channelName?: unknown
                views?: unknown
                engagementRate?: unknown
              }
              : {}
            byId.set(normalizedPostId, {
              id: normalizedPostId,
              title: sanitizeTextInput(source.title, { maxLength: 300 }) || 'Untitled post',
              platform: sanitizeTextInput(source.platform, { maxLength: 64 }) || groupPlatform || 'YouTube',
              channelId: sanitizeTextInput(source.channelId, { maxLength: 300 }) || channelId,
              channelName: sanitizeTextInput(source.channelName, { maxLength: 180 }) || channelName,
              views: toMetricNumber(source.views),
              engagementRate: toMetricNumber(source.engagementRate),
            })
          })
        })
      })
      return [...byId.values()]
    },
    [scopedCampaigns],
  )

  const scopedCampaignChannelIdSet = useMemo(() => {
    const ids = new Set<string>()
    scopedCampaignAssignedPosts.forEach((post) => {
      const channelId = typeof post.channelId === 'string' ? post.channelId.trim() : ''
      if (!channelId) return
      ids.add(channelId)
    })
    resolvedPosts.forEach((post) => {
      if (!scopedCampaignPostIdSet.has(post.id)) return
      const channelId = typeof post.channelId === 'string' ? post.channelId.trim() : ''
      if (!channelId) return
      ids.add(channelId)
    })
    return ids
  }, [resolvedPosts, scopedCampaignAssignedPosts, scopedCampaignPostIdSet])

  const scopedCampaignPostMetricsByChannel = useMemo(() => {
    const summaryPostById = new Map(resolvedPosts.map((post) => [post.id, post]))
    const assignedPostById = new Map(scopedCampaignAssignedPosts.map((post) => [post.id, post]))
    const byChannelId = new Map<string, {
      views: number
      weightedEngagement: number
      engagementTotal: number
      postCount: number
    }>()
    const byChannelName = new Map<string, {
      views: number
      weightedEngagement: number
      engagementTotal: number
      postCount: number
    }>()
    const addMetric = (
      postId: string,
      channelIdValue: unknown,
      channelNameValue: unknown,
      viewsValue: unknown,
      engagementRateValue: unknown,
    ) => {
      const channelId = sanitizeTokenInput(channelIdValue, 300)
      const channelName = sanitizeTextInput(channelNameValue, { maxLength: 180 }).toLowerCase()
      if (!channelId && !channelName) return
      const views = Math.max(0, toMetricNumber(viewsValue))
      const engagementRate = Math.max(0, toMetricNumber(engagementRateValue))
      const weightedEngagement = engagementRate * views
      const updateRow = (
        row:
          | {
              views: number
              weightedEngagement: number
              engagementTotal: number
              postCount: number
            }
          | undefined,
      ) => ({
        views: (row?.views ?? 0) + views,
        weightedEngagement: (row?.weightedEngagement ?? 0) + weightedEngagement,
        engagementTotal: (row?.engagementTotal ?? 0) + engagementRate,
        postCount: (row?.postCount ?? 0) + 1,
      })
      if (channelId) {
        byChannelId.set(channelId, updateRow(byChannelId.get(channelId)))
      }
      if (channelName) {
        byChannelName.set(channelName, updateRow(byChannelName.get(channelName)))
      }
      const assignedPost = assignedPostById.get(postId)
      if (assignedPost?.channelId && assignedPost.channelId !== channelId) {
        byChannelId.set(assignedPost.channelId, updateRow(byChannelId.get(assignedPost.channelId)))
      }
      const assignedChannelName = sanitizeTextInput(assignedPost?.channelName ?? '', { maxLength: 180 }).toLowerCase()
      if (assignedChannelName && assignedChannelName !== channelName) {
        byChannelName.set(assignedChannelName, updateRow(byChannelName.get(assignedChannelName)))
      }
    }

    for (const postId of scopedCampaignPostIdSet.values()) {
      const summaryPost = summaryPostById.get(postId)
      const assignedPost = assignedPostById.get(postId)
      addMetric(
        postId,
        summaryPost?.channelId ?? assignedPost?.channelId ?? '',
        summaryPost?.channelName ?? assignedPost?.channelName ?? '',
        summaryPost?.views ?? assignedPost?.views ?? 0,
        summaryPost?.engagementRate ?? assignedPost?.engagementRate ?? 0,
      )
    }

    return { byChannelId, byChannelName }
  }, [resolvedPosts, scopedCampaignAssignedPosts, scopedCampaignPostIdSet])

  const filteredChannels = useMemo(() => {
    const rows: typeof resolvedChannels = []
    resolvedChannels.forEach((channel) => {
      if (!platforms.includes(channel.platform)) return
      if (
        !allChannelsSelected
        && !selectedChannelOptionSet.has(formatChannelOptionValue(channel.name, channel.platform))
      ) {
        return
      }
      if (!scopedCampaignChannelIdSet.has(channel.id)) return

      const channelMetrics = scopedCampaignPostMetricsByChannel.byChannelId.get(channel.id)
        ?? scopedCampaignPostMetricsByChannel.byChannelName.get(channel.name.toLowerCase())
      if (!channelMetrics || channelMetrics.postCount <= 0) return

      const resolvedViews = Math.max(0, roundMetric(channelMetrics.views, 2))
      const resolvedEngagementRate = channelMetrics.views > 0
        ? roundMetric(channelMetrics.weightedEngagement / channelMetrics.views, 2)
        : roundMetric(channelMetrics.engagementTotal / Math.max(1, channelMetrics.postCount), 2)
      rows.push({
        ...channel,
        views: resolvedViews,
        engagementRate: resolvedEngagementRate,
      })
    })
    return rows.sort((left, right) => right.views - left.views)
  }, [
    allChannelsSelected,
    platforms,
    resolvedChannels,
    scopedCampaignChannelIdSet,
    scopedCampaignPostMetricsByChannel.byChannelId,
    scopedCampaignPostMetricsByChannel.byChannelName,
    selectedChannelOptionSet,
  ])

  const filteredPosts = useMemo(() => {
    const allowedPostChannelIds = new Set(filteredChannels.map((channel) => channel.id))
    const allowedPostChannelNames = new Set(
      filteredChannels.map((channel) => channel.name.toLowerCase()),
    )
    if (!allowedPostChannelIds.size && !allowedPostChannelNames.size) return []

    const assignedPostById = new Map(scopedCampaignAssignedPosts.map((post) => [post.id, post]))
    const summaryPostById = new Map(resolvedPosts.map((post) => [post.id, post]))
    const rows: Array<{
      id: string
      title: string
      platform: 'YouTube' | 'Instagram' | 'TikTok' | 'X'
      channelId?: string
      channelName?: string
      views: number
      engagementRate: number
      campaignTag: string
    }> = []

    for (const postId of scopedCampaignPostIdSet.values()) {
      const summaryPost = summaryPostById.get(postId)
      const assignedPost = assignedPostById.get(postId)
      const resolvedPlatform = sanitizeAllowlistedValue(
        summaryPost?.platform ?? assignedPost?.platform ?? 'YouTube',
        ['TikTok', 'Instagram', 'YouTube', 'X'],
        'YouTube',
      ) as 'YouTube' | 'Instagram' | 'TikTok' | 'X'
      if (!platforms.includes(resolvedPlatform)) continue

      const channelId =
        sanitizeTokenInput(summaryPost?.channelId ?? assignedPost?.channelId ?? '', 300)
        || ''
      const channelName =
        sanitizeTextInput(summaryPost?.channelName ?? assignedPost?.channelName ?? '', {
          maxLength: 180,
        }).toLowerCase()
      const belongsToSelectedChannel =
        (channelId && allowedPostChannelIds.has(channelId))
        || (channelName && allowedPostChannelNames.has(channelName))
      if (!belongsToSelectedChannel) continue

      rows.push({
        id: postId,
        title:
          sanitizeTextInput(summaryPost?.title ?? assignedPost?.title ?? 'Untitled post', {
            maxLength: 300,
          }) || 'Untitled post',
        platform: resolvedPlatform,
        channelId: channelId || undefined,
        channelName:
          sanitizeTextInput(summaryPost?.channelName ?? assignedPost?.channelName ?? '', {
            maxLength: 180,
          }) || undefined,
        views: toMetricNumber(summaryPost?.views ?? assignedPost?.views),
        engagementRate: toMetricNumber(summaryPost?.engagementRate ?? assignedPost?.engagementRate),
        campaignTag: '',
      })
    }

    return rows.sort((left, right) => right.views - left.views)
  }, [filteredChannels, platforms, resolvedPosts, scopedCampaignAssignedPosts, scopedCampaignPostIdSet])
  const platformScopedChannels = useMemo(
    () => resolvedChannels.filter((channel) => platforms.includes(channel.platform)),
    [platforms, resolvedChannels],
  )
  const selectedChannelViews = useMemo(
    () => filteredChannels.reduce((sum, channel) => sum + toMetricNumber(channel.views), 0),
    [filteredChannels],
  )
  const selectedFollowerCount = useMemo(
    () => filteredChannels.reduce((sum, channel) => sum + toMetricNumber(channel.followers), 0),
    [filteredChannels],
  )
  const platformScopedViews = useMemo(
    () => platformScopedChannels.reduce((sum, channel) => sum + toMetricNumber(channel.views), 0),
    [platformScopedChannels],
  )
  const filteredChannelIdSet = useMemo(
    () => new Set(filteredChannels.map((channel) => channel.id)),
    [filteredChannels],
  )
  const resolvedChannelViewsById = useMemo(
    () => new Map(resolvedChannels.map((channel) => [channel.id, Math.max(0, toMetricNumber(channel.views))])),
    [resolvedChannels],
  )
  const campaignSeriesShareByChannelId = useMemo(() => {
    const shareById = new Map<string, number>()
    filteredChannels.forEach((channel) => {
      const campaignViews = Math.max(0, toMetricNumber(channel.views))
      const channelViews = resolvedChannelViewsById.get(channel.id) ?? 0
      if (campaignViews <= 0) {
        shareById.set(channel.id, 0)
        return
      }
      if (channelViews <= 0) {
        shareById.set(channel.id, 1)
        return
      }
      shareById.set(channel.id, Math.min(1, campaignViews / channelViews))
    })
    return shareById
  }, [filteredChannels, resolvedChannelViewsById])
  const campaignScopedSeries = useMemo(() => {
    if (!filteredChannelIdSet.size) return []
    if (resolvedSeriesByChannel.length) {
      const byDate = new Map<string, {
        date: string
        views: number
        engagements: number
        posts: number
        watchTimeHours: number
        followersNetChange: number
      }>()
      resolvedSeriesByChannel.forEach((point) => {
        if (!filteredChannelIdSet.has(point.channelId)) return
        const channelShare = campaignSeriesShareByChannelId.get(point.channelId) ?? 0
        if (channelShare <= 0) return
        const date = typeof point.date === 'string' ? point.date : ''
        if (!date) return
        const current = byDate.get(date) ?? {
          date,
          views: 0,
          engagements: 0,
          posts: 0,
          watchTimeHours: 0,
          followersNetChange: 0,
        }
        current.views += toMetricNumber(point.views) * channelShare
        current.engagements += toMetricNumber(point.engagements) * channelShare
        current.posts += toMetricNumber(point.posts) * channelShare
        current.watchTimeHours += toMetricNumber(point.watchTimeHours) * channelShare
        current.followersNetChange += toMetricNumber(point.followersNetChange) * channelShare
        byDate.set(date, current)
      })
      return [...byDate.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((point) => ({
          ...point,
          watchTimeHours: roundMetric(point.watchTimeHours, 2),
          followersNetChange: Math.round(point.followersNetChange),
        }))
    }
    const ratio = platformScopedViews > 0 ? Math.min(1, selectedChannelViews / platformScopedViews) : 0
    if (!ratio) return []
    return resolvedSeries.map((point) => ({
      date: point.date,
      views: roundMetric(toMetricNumber(point.views) * ratio, 2),
      engagements: roundMetric(toMetricNumber(point.engagements) * ratio, 2),
      posts: roundMetric(toMetricNumber(point.posts) * ratio, 2),
      watchTimeHours: roundMetric(toMetricNumber(point.watchTimeHours) * ratio, 2),
      followersNetChange: Math.round(toMetricNumber(point.followersNetChange) * ratio),
    }))
  }, [
    campaignSeriesShareByChannelId,
    filteredChannelIdSet,
    platformScopedViews,
    resolvedSeries,
    resolvedSeriesByChannel,
    selectedChannelViews,
  ])
  const channelViewById = useMemo(
    () => new Map(filteredChannels.map((channel) => [channel.id, Math.max(1, toMetricNumber(channel.views))])),
    [filteredChannels],
  )
  const buildScopedAudienceDistribution = useCallback((
    distributionByChannel: Record<string, Array<{ label: string; value: number }>>,
    fallback: Array<{ label: string; value: number }>,
    limit?: number,
  ) => {
    const weightedTotals = new Map<string, number>()
    filteredChannelIdSet.forEach((channelId) => {
      const rows = Array.isArray(distributionByChannel[channelId]) ? distributionByChannel[channelId] : []
      if (!rows.length) return
      const weight = channelViewById.get(channelId) ?? 1
      rows.forEach((row) => {
        const label = sanitizeTextInput(row.label, { maxLength: 140 })
        if (!label) return
        const value = toMetricNumber(row.value)
        weightedTotals.set(label, (weightedTotals.get(label) ?? 0) + value * weight)
      })
    })
    const total = [...weightedTotals.values()].reduce((sum, value) => sum + value, 0)
    const rows = total
      ? [...weightedTotals.entries()]
        .map(([label, value]) => ({
          label,
          value: Math.round((value / total) * 100),
        }))
        .sort((a, b) => b.value - a.value)
      : []
    const resolved = rows.length ? rows : (filteredChannelIdSet.size ? [] : fallback)
    return typeof limit === 'number' ? resolved.slice(0, limit) : resolved
  }, [filteredChannelIdSet, channelViewById])
  const scopedAgeDistribution = useMemo(
    () => buildScopedAudienceDistribution(resolvedAgeDistributionByChannel, resolvedAgeDistribution),
    [resolvedAgeDistribution, resolvedAgeDistributionByChannel, buildScopedAudienceDistribution],
  )
  const scopedGenderDistribution = useMemo(
    () => buildScopedAudienceDistribution(resolvedGenderDistributionByChannel, resolvedGenderDistribution),
    [resolvedGenderDistribution, resolvedGenderDistributionByChannel, buildScopedAudienceDistribution],
  )
  const scopedTopGeos = useMemo(
    () => buildScopedAudienceDistribution(resolvedTopGeosByChannel, resolvedTopGeos, 5),
    [resolvedTopGeos, resolvedTopGeosByChannel, buildScopedAudienceDistribution],
  )

  const formatDateLabel = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date)
  }

  const formatChartDateLabel = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
    }).format(date)
  }

  const displayRange = useMemo(() => {
    if (rangeSelection === 'Campaign flight') {
      if (activeCampaign) {
        return `${formatDateLabel(activeCampaign.startDate)} - ${formatDateLabel(activeCampaign.endDate)}`
      }
      return `${formatDateLabel(dataStartDate)} - ${formatDateLabel(dataEndDate)}`
    }
    if (rangeSelection !== 'Custom') return rangeSelection
    return `${formatDateLabel(customStart)} - ${formatDateLabel(customEnd)}`
  }, [activeCampaign, customEnd, customStart, dataEndDate, dataStartDate, rangeSelection])

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

  const TOP_CONTENT_POST_TITLE_MAX_LENGTH = 30
  const truncateTopContentPostTitle = (
    title: string,
    maxLength = TOP_CONTENT_POST_TITLE_MAX_LENGTH,
  ) => {
    if (title.length <= maxLength) return title
    if (maxLength <= 3) return title.slice(0, maxLength)
    return `${title.slice(0, maxLength - 3)}...`
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

  const handleExportPdf = async (options?: { preview?: boolean }) => {
    if (!canExportReports) {
      setShareStatus('You do not have permission to export reports.')
      return
    }
    if (!scopedCampaigns.length) {
      setShareStatus('Select a campaign you are a member of to export reports.')
      return
    }
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
    const totalViews = scopedCampaignTotals.deliveredViews
    const totalEngagements = scopedCampaignTotals.deliveredEngagements
    const totalPublishedPosts = filteredPosts.length ? filteredPosts.length : 0
    const totalFollowers = selectedFollowerCount
    const totalWatchTimeHours = roundMetric(
      campaignScopedSeries.reduce((sum, point) => sum + toMetricNumber(point.watchTimeHours), 0),
      1,
    )
    const campaignScopeLabel = isAllCampaignFilter
      ? `All campaigns (${scopedCampaigns.length})`
      : scopedCampaigns.length === 1
        ? campaignName || activeCampaign?.name || 'Campaign Name'
        : `Selected campaigns (${scopedCampaigns.length})`
    const top3Channels = filteredChannels.slice(0, 3)
    const channelViewTotal = filteredChannels.reduce((sum, channel) => sum + channel.views, 0)
    const hasTimeSeriesData = campaignScopedSeries.some(
      (point) => Number(point.views) > 0 || Number(point.engagements) > 0 || Number(point.posts) > 0,
    )
    const insightBullets = notes
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
    const deliveryProgress = scopedCampaignDeliveryPercent
    const ageAudiencePoints = getTopAudiencePoints(scopedAgeDistribution)
    const genderAudiencePoints = getTopAudiencePoints(scopedGenderDistribution)
    const geoAudiencePoints = getTopAudiencePoints(scopedTopGeos)
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
    doc.text(`Campaign/Deal: ${campaignScopeLabel}`, margin + 20, 195)
    doc.text(`Time range: ${displayRange}`, margin + 20, 220)
    doc.text(`Title: ${campaignScopeLabel}`, margin + 20, 245)
    doc.setTextColor(...brandPalette.primary)
    doc.text(`Layout: Clean PDF`, margin + 20, 270)
    doc.setTextColor(...brandPalette.muted)
    doc.text(`Channels: ${selectedChannelsLabel}`, margin + 20, 295)
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
    if (includesWatchTimeMetric) {
      doc.text(`Watch time: ${formatNumber(totalWatchTimeHours)} hrs`, margin, 198)
    }
    if (includesFollowersMetric) {
      doc.text(`Follower count: ${formatNumber(totalFollowers)}`, margin, 220)
    }
    doc.text(`Posts published: ${totalPublishedPosts}`, margin, 242)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...brandPalette.text)
    doc.text('Top 3 channels', margin, 274)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...brandPalette.muted)
    if (top3Channels.length) {
      top3Channels.forEach((channel, index) => {
        const followerSuffix = includesFollowersMetric
          ? ` | ${formatNumber(toMetricNumber(channel.followers))} followers`
          : ''
        doc.text(
          `${index + 1}. ${channel.name} (${channel.platform}) - ${formatNumber(channel.views)} views${followerSuffix}`,
          margin,
          298 + index * 18,
        )
      })
    } else {
      doc.text('No live channel data available for this section.', margin, 298)
    }
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...brandPalette.text)
    doc.text('Insight bullets', margin, 370)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...brandPalette.muted)
    ;(insightBullets.length ? insightBullets : ['No additional notes provided.']).forEach(
      (bullet, index) => {
        const wrapped = doc.splitTextToSize(`- ${bullet}`, availableWidth - 10)
        doc.text(wrapped, margin, 393 + index * 24)
      },
    )
    if (showGuarantee && scopedCampaigns.length) {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...brandPalette.text)
      doc.text('Guaranteed vs Delivered', margin, 520)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...brandPalette.muted)
      doc.text(
        `Views: ${formatNumber(scopedCampaignTotals.guaranteedViews)} guaranteed vs ${formatNumber(scopedCampaignTotals.deliveredViews)} delivered`,
        margin,
        544,
      )
      doc.text(
        `Engagements: ${formatNumber(scopedCampaignTotals.guaranteedEngagements)} guaranteed vs ${formatNumber(scopedCampaignTotals.deliveredEngagements)} delivered`,
        margin,
        566,
      )
      if (scopedCampaigns.length > 1) {
        const wrappedCampaigns = doc.splitTextToSize(
          `Campaigns: ${scopedCampaigns.map((campaign) => campaign.name).join(', ')}`,
          availableWidth - 10,
        )
        doc.text(wrappedCampaigns, margin, 588)
      }
    }
    addFooter(2)

    // Page 3 - Performance Chart
    doc.addPage()
    addPageTitle('Performance Chart', 'Combined view trend over time and channel contribution')
    const chartLeft = margin
    const chartTop = 130
    const chartWidth = availableWidth
    const chartHeight = 230
    const maxViews = campaignScopedSeries.length
      ? Math.max(...campaignScopedSeries.map((point) => point.views))
      : 0
    doc.setDrawColor(...brandPalette.border)
    doc.rect(chartLeft, chartTop, chartWidth, chartHeight)
    if (campaignScopedSeries.length && maxViews > 0 && hasTimeSeriesData) {
      const labelTargetCount = Math.min(6, Math.max(2, Math.floor(chartWidth / 90)))
      const labelStep = Math.max(1, Math.ceil(campaignScopedSeries.length / labelTargetCount))
      campaignScopedSeries.forEach((point, index) => {
        const barWidth = chartWidth / campaignScopedSeries.length - 8
        const x = chartLeft + index * (chartWidth / campaignScopedSeries.length) + 4
        const height = (point.views / maxViews) * (chartHeight - 35)
        const y = chartTop + chartHeight - height - 20
        doc.setFillColor(...brandPalette.primary)
        doc.rect(x, y, barWidth, height, 'F')
        doc.setFontSize(8)
        doc.setTextColor(...brandPalette.muted)
        const isLabelTick = index % labelStep === 0 || index === campaignScopedSeries.length - 1
        if (isLabelTick) {
          doc.text(
            formatChartDateLabel(point.date),
            x + barWidth / 2,
            chartTop + chartHeight - 6,
            { align: 'center' },
          )
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
        doc.text(truncateTopContentPostTitle(post.title), margin, y)
        doc.setTextColor(...brandPalette.muted)
        doc.text(post.platform, margin + 235, y)
        doc.text(formatNumber(post.views), margin + 340, y)
        doc.text(`${post.engagementRate.toFixed(1)}%`, margin + 430, y)
        doc.setFontSize(11)
      })
    } else {
      doc.text('No live top-content data is available for this section.', margin, 156)
    }
    addFooter(5)

    // Page 6 - Campaign ROI
    doc.addPage()
    addPageTitle('Campaign ROI', 'Delivery progress, guarantee attainment, and distribution')
    if (scopedCampaigns.length) {
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
        `Guaranteed vs Actual Views: ${formatNumber(scopedCampaignTotals.guaranteedViews)} vs ${formatNumber(scopedCampaignTotals.deliveredViews)}`,
        margin,
        210,
      )
      doc.text(
        `Guaranteed vs Actual Engagements: ${formatNumber(scopedCampaignTotals.guaranteedEngagements)} vs ${formatNumber(scopedCampaignTotals.deliveredEngagements)}`,
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
      doc.text(`ONO: ${scopedCampaignDistribution.ono}%`, margin, 334)
      doc.text(`Clipper: ${scopedCampaignDistribution.clipper}%`, margin + 150, 334)
      doc.text(`Pacing: ${scopedCampaignPacingLabel}`, margin, 358)
      if (scopedCampaigns.length > 1) {
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...brandPalette.text)
        doc.text(`Campaigns included (${scopedCampaigns.length})`, margin, 390)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...brandPalette.muted)
        const visibleCampaigns = scopedCampaigns.slice(0, 10)
        visibleCampaigns.forEach((campaign, index) => {
          doc.text(
            `${campaign.name}: ${formatNumber(campaign.deliveredViews)}/${formatNumber(campaign.guaranteedViews)} views`,
            margin,
            412 + index * 16,
          )
        })
        if (scopedCampaigns.length > visibleCampaigns.length) {
          doc.text(
            `+${scopedCampaigns.length - visibleCampaigns.length} more campaigns`,
            margin,
            412 + visibleCampaigns.length * 16,
          )
        }
      }
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
    if (options?.preview) {
      await openProtectedPreview(doc.output('blob'), 'pdf', safeFileName)
      return
    }
    doc.save(safeFileName)
  }

  const handleExportDeckPdf = async (options?: { preview?: boolean }) => {
    if (!canExportReports) {
      setShareStatus('You do not have permission to export reports.')
      return
    }
    if (!scopedCampaigns.length) {
      setShareStatus('Select a campaign you are a member of to export reports.')
      return
    }
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
    const totalViews = scopedCampaignTotals.deliveredViews
    const totalEngagements = scopedCampaignTotals.deliveredEngagements
    const totalPublishedPosts = filteredPosts.length ? filteredPosts.length : 0
    const totalFollowers = selectedFollowerCount
    const totalWatchTimeHours = roundMetric(
      campaignScopedSeries.reduce((sum, point) => sum + toMetricNumber(point.watchTimeHours), 0),
      1,
    )
    const campaignScopeLabel = isAllCampaignFilter
      ? `All campaigns (${scopedCampaigns.length})`
      : scopedCampaigns.length === 1
        ? campaignName || activeCampaign?.name || 'Campaign Name'
        : `Selected campaigns (${scopedCampaigns.length})`
    const topChannels = filteredChannels.slice(0, 5)
    const topPosts = filteredPosts.slice(0, 6)
    const channelViewTotal = filteredChannels.reduce((sum, channel) => sum + channel.views, 0)
    const hasTimeSeriesData = campaignScopedSeries.some(
      (point) => Number(point.views) > 0 || Number(point.engagements) > 0 || Number(point.posts) > 0,
    )
    const maxViews = campaignScopedSeries.length
      ? Math.max(...campaignScopedSeries.map((point) => point.views))
      : 0
    const insightBullets = notes
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5)
    const deliveryProgress = scopedCampaignDeliveryPercent
    const baseFileName = toFileSlug(campaignName || brandName || 'brand-report')
    const ageAudiencePoints = getTopAudiencePoints(scopedAgeDistribution, 4)
    const genderAudiencePoints = getTopAudiencePoints(scopedGenderDistribution, 4)
    const geoAudiencePoints = getTopAudiencePoints(scopedTopGeos, 4)
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
    doc.text(campaignScopeLabel, margin + 28, 160)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(15)
    doc.setTextColor(...brandPalette.muted)
    doc.text(brandName || 'Brand Name', margin + 28, 188)
    doc.setFontSize(12)
    doc.text(`Date range: ${displayRange}`, margin + 28, 216)
    doc.text(`Channels: ${selectedChannelsLabel}`, margin + 28, 238)
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
      `Guarantee: ${formatNumber(scopedCampaignTotals.guaranteedViews)}`,
    )
    addMetricCard(
      margin + summaryCardWidth + 16,
      104,
      summaryCardWidth,
      86,
      'Total engagements',
      formatNumber(totalEngagements),
      `Guarantee: ${formatNumber(scopedCampaignTotals.guaranteedEngagements)}`,
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
    doc.setFontSize(10)
    doc.setTextColor(...brandPalette.muted)
    if (includesWatchTimeMetric) {
      doc.text(`Watch time: ${formatNumber(totalWatchTimeHours)} hrs`, margin + 18, 256)
    }
    if (includesFollowersMetric) {
      doc.text(`Follower count: ${formatNumber(totalFollowers)}`, margin + 18, 276)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...brandPalette.muted)
    ;(insightBullets.length ? insightBullets : ['No additional notes provided.']).forEach(
      (bullet, index) => {
        const wrapped = doc.splitTextToSize(`- ${bullet}`, contentWidth * 0.54)
        doc.text(wrapped, margin + 18, 304 + index * 22)
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
    if (campaignScopedSeries.length && maxViews > 0 && hasTimeSeriesData) {
      campaignScopedSeries.forEach((point, index) => {
        const barSlot = chartWidth / campaignScopedSeries.length
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
        const title = doc.splitTextToSize(
          truncateTopContentPostTitle(post.title),
          contentWidth * 0.52,
        )
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
    if (scopedCampaigns.length) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(12)
      doc.setTextColor(...brandPalette.muted)
      doc.text(
        `Views: ${formatNumber(scopedCampaignTotals.deliveredViews)} delivered / ${formatNumber(scopedCampaignTotals.guaranteedViews)} guaranteed`,
        margin + 20,
        218,
      )
      doc.text(
        `Engagements: ${formatNumber(scopedCampaignTotals.deliveredEngagements)} delivered / ${formatNumber(scopedCampaignTotals.guaranteedEngagements)} guaranteed`,
        margin + 20,
        242,
      )
      doc.text(`Distribution source: ONO ${scopedCampaignDistribution.ono}%`, margin + 20, 266)
      doc.text(`Distribution source: Clipper ${scopedCampaignDistribution.clipper}%`, margin + 20, 290)
      doc.text(`Pacing status: ${scopedCampaignPacingLabel}`, margin + 20, 314)
      if (showCPM) {
        doc.text('CPV: N/A', margin + 20, 338)
        doc.text('CPM: N/A', margin + 120, 338)
      }
      if (scopedCampaigns.length > 1) {
        const deckCampaignSummary = doc.splitTextToSize(
          `Campaigns: ${scopedCampaigns.map((campaign) => campaign.name).join(', ')}`,
          contentWidth - 40,
        )
        doc.text(deckCampaignSummary, margin + 20, 362)
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

    const deckFileName = `${baseFileName}-deck-report.pdf`
    if (options?.preview) {
      await openProtectedPreview(doc.output('blob'), 'pdf', deckFileName)
      return
    }
    doc.save(deckFileName)
  }

  const handleExportCsv = (options?: { preview?: boolean }) => {
    if (!canExportReports) {
      setShareStatus('You do not have permission to export reports.')
      return
    }
    if (!scopedCampaigns.length) {
      setShareStatus('Select a campaign you are a member of to export reports.')
      return
    }
    const generatedAt = new Date().toISOString()
    const selectedMetrics = new Set(metrics)
    const filePrefix = toFileSlug(campaignName || brandName || 'brand-report')
    const totalFollowers = selectedFollowerCount
    const totalWatchTimeHours = roundMetric(
      campaignScopedSeries.reduce((sum, point) => sum + toMetricNumber(point.watchTimeHours), 0),
      2,
    )
    const campaignScopeLabel = isAllCampaignFilter
      ? `All campaigns (${scopedCampaigns.length})`
      : scopedCampaigns.length === 1
        ? campaignName || activeCampaign?.name || ''
        : `Selected campaigns (${scopedCampaigns.length})`

    const overviewRows: Array<{ field: string; value: string | number }> = [
      { field: 'generated_at', value: generatedAt },
      { field: 'brand', value: brandName || '' },
      { field: 'campaign_name', value: campaignScopeLabel },
      { field: 'campaign_filter', value: campaignFilterLabel },
      { field: 'date_range', value: displayRange },
      { field: 'channels_included', value: selectedChannelsLabel },
      { field: 'platforms_included', value: platforms.join(', ') },
      { field: 'metrics_included', value: metrics.join(', ') },
      { field: 'show_cpm', value: showCPM ? 'yes' : 'no' },
      { field: 'show_guarantee_vs_delivered', value: showGuarantee ? 'yes' : 'no' },
    ]
    if (includesWatchTimeMetric) {
      overviewRows.push({ field: 'total_watch_time_hours', value: totalWatchTimeHours })
    }
    if (includesFollowersMetric) {
      overviewRows.push({ field: 'total_follower_count', value: totalFollowers })
    }

    overviewRows.push(
      { field: 'campaign_count', value: scopedCampaigns.length },
      { field: 'guaranteed_views', value: scopedCampaignTotals.guaranteedViews },
      { field: 'delivered_views', value: scopedCampaignTotals.deliveredViews },
      { field: 'guaranteed_engagements', value: scopedCampaignTotals.guaranteedEngagements },
      { field: 'delivered_engagements', value: scopedCampaignTotals.deliveredEngagements },
      { field: 'ono_distribution_percent', value: scopedCampaignDistribution.ono },
      { field: 'clipper_distribution_percent', value: scopedCampaignDistribution.clipper },
      { field: 'pacing', value: scopedCampaignPacingLabel },
    )

    const campaignRows = scopedCampaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      brand: campaign.brand,
      status: campaign.status,
      pacing: campaign.pacing,
      start_date: campaign.startDate,
      end_date: campaign.endDate,
      guaranteed_views: campaign.guaranteedViews,
      delivered_views: campaign.deliveredViews,
      guaranteed_engagements: campaign.guaranteedEngagements,
      delivered_engagements: campaign.deliveredEngagements,
      ono_distribution_percent: campaign.distribution.ono,
      clipper_distribution_percent: campaign.distribution.clipper,
    }))

    const channelRows = filteredChannels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      platform: channel.platform,
      views: channel.views,
      engagement_rate_percent: channel.engagementRate,
      ...(includesFollowersMetric
        ? {
          followers: channel.followers,
          follower_count: channel.followers,
        }
        : {}),
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
      ...scopedAgeDistribution.map((point) => ({
        segment: 'age',
        label: point.label,
        percent: point.value,
      })),
      ...scopedGenderDistribution.map((point) => ({
        segment: 'gender',
        label: point.label,
        percent: point.value,
      })),
      ...scopedTopGeos.map((point) => ({
        segment: 'geo',
        label: point.label,
        percent: point.value,
      })),
    ]

    const timeSeriesRows = campaignScopedSeries.map((point) => ({
      date: point.date,
      ...(selectedMetrics.has('Views') ? { views_millions: point.views } : {}),
      ...(selectedMetrics.has('Engagements') ? { engagements_millions: point.engagements } : {}),
      ...(selectedMetrics.has('Posts') ? { posts: point.posts } : {}),
      ...(selectedMetrics.has('Watch Time')
        ? { watch_time_hours: roundMetric(toMetricNumber(point.watchTimeHours), 2) }
        : {}),
      ...(selectedMetrics.has('Followers')
        ? {
          follower_count_total: totalFollowers,
          followers_net_change: Math.round(toMetricNumber(point.followersNetChange)),
        }
        : {}),
    }))

    const overviewCsv = createCsvContent(overviewRows, ['field', 'value'])
    const campaignsCsv = createCsvContent(campaignRows)
    const channelsCsv = createCsvContent(channelRows)
    const postsCsv = createCsvContent(postRows)
    const audienceCsv = createCsvContent(audienceRows, ['segment', 'label', 'percent'])
    const timeSeriesCsv = createCsvContent(timeSeriesRows)

    if (options?.preview) {
      const combinedPreview = [
        '# overview.csv',
        overviewCsv,
        '',
        '# campaigns.csv',
        campaignsCsv,
        '',
        '# channels.csv',
        channelsCsv,
        '',
        '# posts.csv',
        postsCsv,
        '',
        '# audience.csv',
        audienceCsv,
        '',
        '# timeseries.csv',
        timeSeriesCsv,
      ].join('\n')
      void openProtectedPreview(
        new Blob([combinedPreview], { type: 'text/plain;charset=utf-8' }),
        'csv',
        `${filePrefix}-bundle-preview.csv`,
      )
      return
    }

    downloadCsv(
      `${filePrefix}-overview.csv`,
      overviewCsv,
    )
    downloadCsv(`${filePrefix}-campaigns.csv`, campaignsCsv)
    downloadCsv(`${filePrefix}-channels.csv`, channelsCsv)
    downloadCsv(`${filePrefix}-posts.csv`, postsCsv)
    downloadCsv(
      `${filePrefix}-audience.csv`,
      audienceCsv,
    )
    downloadCsv(`${filePrefix}-timeseries.csv`, timeSeriesCsv)
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
      setChannels((current) => (current.includes('All ONO/LNO') ? [] : ['All ONO/LNO']))
      return
    }
    setChannels((current) => {
      const withoutAll = current.filter((item) => item !== 'All ONO/LNO')
      if (withoutAll.includes(value)) {
        return withoutAll.filter((item) => item !== value)
      }
      return [...withoutAll, value]
    })
  }

  const handleCampaignFilterToggle = (campaignId: string) => {
    const sanitizedCampaignId = sanitizeTokenInput(campaignId, 80)
    if (!sanitizedCampaignId) return
    setSelectedCampaignIds((current) => {
      const normalizedCurrent = [...new Set(
        current
          .map((value) => sanitizeTokenInput(value, 80))
          .filter((value) => Boolean(value)),
      )]
      if (normalizedCurrent.includes(sanitizedCampaignId)) {
        return normalizedCurrent.filter((value) => value !== sanitizedCampaignId)
      }
      return [...normalizedCurrent, sanitizedCampaignId]
    })
  }

  const clearCampaignFilter = () => {
    setSelectedCampaignIds([])
  }

  useEffect(() => {
    if (!shareStatus) return
    const timeoutId = window.setTimeout(() => setShareStatus(''), 2500)
    return () => window.clearTimeout(timeoutId)
  }, [shareStatus])

  const previewTotalViews = scopedCampaignTotals.deliveredViews
  const previewTotalEngagements = scopedCampaignTotals.deliveredEngagements
  const previewDeliveryPercent = scopedCampaignDeliveryPercent
  const previewCampaignLabel = isAllCampaignFilter
    ? `All campaigns (${scopedCampaigns.length})`
    : scopedCampaigns.length === 1
      ? campaignName || activeCampaign?.name || 'Report Preview'
      : `Selected campaigns (${scopedCampaigns.length})`
  const canExport = Boolean(canAccessReportBuilder && canExportReports && campaignList.length && !campaignsLoading)

  return (
    <>
      <SectionHeader
        title="Brand Report Builder"
        subtitle="Configure a polished, client-ready report."
        actions={canExportReports ? (
          <div className="filter-bar">
            <button className="ghost-button" onClick={() => handleExportCsv()} disabled={!canExport}>
              Export CSV
            </button>
            <button className="primary-button" onClick={() => void handleExportPdf()} disabled={!canExport}>
              Export PDF
            </button>
          </div>
        ) : (
          <span className="filter-chip static">
            {campaignList.length
              ? 'View-only access for this campaign'
              : viewerUserId
                ? 'No report access: you are not a campaign member.'
                : 'Loading report access...'}
          </span>
        )}
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
                onChange={(event) =>
                  setBrandName(sanitizeTextInput(event.target.value, { maxLength: 140 }))
                }
              />
            </div>
            <div className="form-field">
              <label className="section-subtitle">Campaign name (header)</label>
              <input
                className="input"
                value={campaignName}
                onChange={(event) =>
                  setCampaignName(sanitizeTextInput(event.target.value, { maxLength: 140 }))
                }
              />
            </div>
            <div className="form-field">
              <label className="section-subtitle">Campaign filter</label>
              <div className="check-row">
                <label className="check-pill">
                  <input
                    type="checkbox"
                    checked={isAllCampaignFilter}
                    onChange={clearCampaignFilter}
                    disabled={campaignsLoading || !campaignList.length}
                  />
                  All campaigns
                </label>
                {campaignList.map((campaign) => (
                  <label key={campaign.id} className="check-pill">
                    <input
                      type="checkbox"
                      checked={selectedCampaignIdSet.has(campaign.id)}
                      onChange={() => handleCampaignFilterToggle(campaign.id)}
                      disabled={campaignsLoading}
                    />
                    {campaign.name}
                  </label>
                ))}
              </div>
              <div className="section-subtitle">Scope: {campaignFilterLabel}</div>
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
                onChange={(event) =>
                  setRangeSelection(
                    sanitizeAllowlistedValue(event.target.value, rangeOptions, 'Campaign flight'),
                  )
                }
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
                      const next = sanitizeDateInput(event.target.value, {
                        fallback: customStart,
                        min: dataStartDate,
                        max: dataEndDate,
                      })
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
                    onChange={(event) =>
                      setCustomEnd(sanitizeDateInput(event.target.value, {
                        fallback: customEnd,
                        min: customStart,
                        max: dataEndDate,
                      }))
                    }
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
                    {resolveChannelOptionLabel(option)}
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
                onChange={(event) => setNotes(sanitizeMultilineInput(event.target.value, 4000))}
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

          {canExportReports ? (
            <div className="filter-bar" style={{ marginTop: '16px' }}>
              <button
                className="ghost-button"
                onClick={() => void handleExportPdf({ preview: true })}
                disabled={!canExport}
              >
                View clean PDF
              </button>
              <button
                className="ghost-button"
                onClick={() => void handleExportDeckPdf({ preview: true })}
                disabled={!canExport}
              >
                View deck PDF
              </button>
              <button
                className="ghost-button"
                onClick={() => handleExportCsv({ preview: true })}
                disabled={!canExport}
              >
                View CSV
              </button>
            </div>
          ) : null}
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
            <div className="section-title">{previewCampaignLabel}</div>
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
