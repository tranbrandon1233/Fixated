import { useCallback, useEffect, useState } from 'react'
import { fetchAndCacheYouTubeSummary, getCachedYouTubeSummary } from '../utils/youtube'
import type { YouTubeSummary } from '../utils/youtube'
import { fetchAndCacheInstagramSummary, getCachedInstagramSummary } from '../utils/instagram'
import { fetchAndCacheXSummary, getCachedXSummary } from '../utils/x'
import { DASHBOARD_DATA_REFRESHED_EVENT } from '../utils/dataRefresh'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

const emptySummary: YouTubeSummary = {
  firstVideoUploadDate: '',
  channels: [],
  topPosts: [],
  timeSeries: [],
  timeSeriesByChannel: [],
  ageDistribution: [],
  ageDistributionByChannel: {},
  genderDistribution: [],
  genderDistributionByChannel: {},
  topGeos: [],
  topGeosByChannel: {},
}

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const mergeDemographicList = (
  lists: YouTubeSummary['ageDistribution'][],
): YouTubeSummary['ageDistribution'] => {
  const totalsByLabel = new Map<string, number>()
  lists.forEach((rows) => {
    rows.forEach((row) => {
      if (!row?.label) return
      totalsByLabel.set(row.label, (totalsByLabel.get(row.label) ?? 0) + toNumber(row.value))
    })
  })
  return [...totalsByLabel.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
}

const mergeDemographicMapByChannel = (
  maps: YouTubeSummary['ageDistributionByChannel'][],
): YouTubeSummary['ageDistributionByChannel'] => {
  const byChannel = new Map<string, Map<string, number>>()
  maps.forEach((entry) => {
    Object.entries(entry ?? {}).forEach(([channelId, rows]) => {
      const labelTotals = byChannel.get(channelId) ?? new Map<string, number>()
      rows.forEach((row) => {
        if (!row?.label) return
        labelTotals.set(row.label, (labelTotals.get(row.label) ?? 0) + toNumber(row.value))
      })
      byChannel.set(channelId, labelTotals)
    })
  })
  const merged: YouTubeSummary['ageDistributionByChannel'] = {}
  byChannel.forEach((labelTotals, channelId) => {
    merged[channelId] = [...labelTotals.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => right.value - left.value)
  })
  return merged
}

const mergeSummaryPayloads = (summaries: YouTubeSummary[]): YouTubeSummary => {
  if (!summaries.length) return emptySummary
  const firstVideoDates = summaries
    .map((summary) => summary.firstVideoUploadDate)
    .filter((value) => Boolean(value))
    .sort((left, right) => left.localeCompare(right))

  const channelsById = new Map<string, YouTubeSummary['channels'][number]>()
  const postsById = new Map<string, YouTubeSummary['topPosts'][number]>()
  const timeSeriesByDate = new Map<string, YouTubeSummary['timeSeries'][number]>()
  const timeSeriesByChannelDate = new Map<string, YouTubeSummary['timeSeriesByChannel'][number]>()

  summaries.forEach((summary) => {
    summary.channels.forEach((channel) => {
      if (!channel?.id) return
      channelsById.set(channel.id, channel)
    })
    summary.topPosts.forEach((post) => {
      if (!post?.id || postsById.has(post.id)) return
      postsById.set(post.id, post)
    })
    summary.timeSeries.forEach((point) => {
      if (!point?.date) return
      const current = timeSeriesByDate.get(point.date) ?? {
        date: point.date,
        views: 0,
        engagements: 0,
        posts: 0,
        watchTimeHours: 0,
        followersNetChange: 0,
      }
      timeSeriesByDate.set(point.date, {
        date: point.date,
        views: current.views + toNumber(point.views),
        engagements: current.engagements + toNumber(point.engagements),
        posts: current.posts + toNumber(point.posts),
        watchTimeHours: toNumber(current.watchTimeHours) + toNumber(point.watchTimeHours),
        followersNetChange:
          Math.round(toNumber(current.followersNetChange) + toNumber(point.followersNetChange)),
      })
    })
    summary.timeSeriesByChannel.forEach((point) => {
      if (!point?.channelId || !point?.date) return
      const key = `${point.channelId}:${point.date}`
      const current = timeSeriesByChannelDate.get(key) ?? {
        channelId: point.channelId,
        date: point.date,
        views: 0,
        engagements: 0,
        posts: 0,
        watchTimeHours: 0,
        followersNetChange: 0,
      }
      timeSeriesByChannelDate.set(key, {
        channelId: point.channelId,
        date: point.date,
        views: current.views + toNumber(point.views),
        engagements: current.engagements + toNumber(point.engagements),
        posts: current.posts + toNumber(point.posts),
        watchTimeHours: toNumber(current.watchTimeHours) + toNumber(point.watchTimeHours),
        followersNetChange:
          Math.round(toNumber(current.followersNetChange) + toNumber(point.followersNetChange)),
      })
    })
  })

  return {
    firstVideoUploadDate: firstVideoDates[0] ?? '',
    channels: [...channelsById.values()],
    topPosts: [...postsById.values()].sort((left, right) => toNumber(right.views) - toNumber(left.views)),
    timeSeries: [...timeSeriesByDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
    timeSeriesByChannel: [...timeSeriesByChannelDate.values()].sort((left, right) => {
      const byChannel = left.channelId.localeCompare(right.channelId)
      if (byChannel !== 0) return byChannel
      return left.date.localeCompare(right.date)
    }),
    ageDistribution: mergeDemographicList(summaries.map((summary) => summary.ageDistribution)),
    ageDistributionByChannel: mergeDemographicMapByChannel(
      summaries.map((summary) => summary.ageDistributionByChannel),
    ),
    genderDistribution: mergeDemographicList(summaries.map((summary) => summary.genderDistribution)),
    genderDistributionByChannel: mergeDemographicMapByChannel(
      summaries.map((summary) => summary.genderDistributionByChannel),
    ),
    topGeos: mergeDemographicList(summaries.map((summary) => summary.topGeos)),
    topGeosByChannel: mergeDemographicMapByChannel(
      summaries.map((summary) => summary.topGeosByChannel),
    ),
  }
}

const formatProviderErrorLabel = (failedProviders: string[]) => {
  if (!failedProviders.length) return ''
  if (failedProviders.length === 1) {
    return `Live ${failedProviders[0]} sync is temporarily unavailable.`
  }
  if (failedProviders.length === 2) {
    return `Live ${failedProviders[0]} and ${failedProviders[1]} sync are temporarily unavailable.`
  }
  return `Live ${failedProviders.slice(0, -1).join(', ')}, and ${failedProviders.at(-1)} sync are temporarily unavailable.`
}

export const useYouTubeSummary = () => {
  const initialYouTubeSummary = getCachedYouTubeSummary()
  const initialInstagramSummary = getCachedInstagramSummary()
  const initialXSummary = getCachedXSummary()
  const initialSummaryParts = [initialYouTubeSummary, initialInstagramSummary, initialXSummary].filter(
    (entry): entry is YouTubeSummary => Boolean(entry),
  )
  const initialSummary = initialSummaryParts.length
    ? mergeSummaryPayloads(initialSummaryParts)
    : null
  const [summary, setSummary] = useState<YouTubeSummary>(initialSummary ?? emptySummary)
  const [status, setStatus] = useState<LoadStatus>(initialSummary ? 'ready' : 'loading')
  const [error, setError] = useState<string | null>(null)

  const loadSummary = useCallback(async (options?: { force?: boolean }) => {
    const [youtubeResult, instagramResult, xResult] = await Promise.allSettled([
      fetchAndCacheYouTubeSummary(options),
      fetchAndCacheInstagramSummary(options),
      fetchAndCacheXSummary(options),
    ])
    const successfulSummaries: YouTubeSummary[] = []
    const failedProviders: string[] = []

    const providerResults: Array<{ label: string; result: PromiseSettledResult<YouTubeSummary> }> = [
      { label: 'YouTube', result: youtubeResult },
      { label: 'Instagram', result: instagramResult },
      { label: 'X', result: xResult },
    ]
    providerResults.forEach(({ label, result }) => {
      if (result.status === 'fulfilled') {
        successfulSummaries.push(result.value)
      } else {
        failedProviders.push(label)
      }
    })

    if (!successfulSummaries.length) {
      const cachedSummaries = [getCachedYouTubeSummary(), getCachedInstagramSummary(), getCachedXSummary()].filter(
        (entry): entry is YouTubeSummary => Boolean(entry),
      )
      if (cachedSummaries.length) {
        setSummary(mergeSummaryPayloads(cachedSummaries))
        setStatus('ready')
        setError('Live platform sync is temporarily unavailable.')
        return
      }
      setStatus('error')
      setError('Unable to load dashboard platform data.')
      return
    }

    setSummary(mergeSummaryPayloads(successfulSummaries))
    setStatus('ready')
    setError(formatProviderErrorLabel(failedProviders) || null)
  }, [])

  useEffect(() => {
    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return
      void loadSummary()
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [loadSummary])

  useEffect(() => {
    const handleDashboardDataRefreshed = () => {
      void loadSummary({ force: true })
    }
    window.addEventListener(DASHBOARD_DATA_REFRESHED_EVENT, handleDashboardDataRefreshed)
    return () => {
      window.removeEventListener(DASHBOARD_DATA_REFRESHED_EVENT, handleDashboardDataRefreshed)
    }
  }, [loadSummary])

  const refresh = useCallback(() => {
    setStatus('loading')
    setError(null)
    return loadSummary({ force: true })
  }, [loadSummary])

  return { summary, status, error, refresh }
}
