import { useCallback, useEffect, useState } from 'react'
import { fetchAndCacheYouTubeSummary, getCachedYouTubeSummary } from '../utils/youtube'
import { fetchAndCacheInstagramSummary, getCachedInstagramSummary } from '../utils/instagram'
import type { YouTubeSummary } from '../utils/youtube'
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

export const useYouTubeSummary = () => {
  const mergeSummaries = useCallback((youtubeSummary: YouTubeSummary, instagramSummary: YouTubeSummary) => {
    const channelByKey = new Map<string, YouTubeSummary['channels'][number]>()
    const postByKey = new Map<string, YouTubeSummary['topPosts'][number]>()
    const timeSeriesByDate = new Map<string, YouTubeSummary['timeSeries'][number]>()
    const seriesByChannelDate = new Map<string, YouTubeSummary['timeSeriesByChannel'][number]>()

    const addChannel = (channel: YouTubeSummary['channels'][number]) => {
      if (!channel || !channel.id) return
      const key = `${channel.platform}:${channel.id}`
      channelByKey.set(key, channel)
    }
    const addPost = (post: YouTubeSummary['topPosts'][number]) => {
      if (!post || !post.id) return
      const key = `${post.platform}:${post.id}`
      postByKey.set(key, post)
    }
    const addTimeSeries = (point: YouTubeSummary['timeSeries'][number]) => {
      if (!point || !point.date) return
      const existing = timeSeriesByDate.get(point.date) ?? {
        date: point.date,
        views: 0,
        engagements: 0,
        posts: 0,
        watchTimeHours: 0,
        followersNetChange: 0,
      }
      timeSeriesByDate.set(point.date, {
        ...existing,
        views: existing.views + Number(point.views || 0),
        engagements: existing.engagements + Number(point.engagements || 0),
        posts: existing.posts + Number(point.posts || 0),
        watchTimeHours: Number(existing.watchTimeHours || 0) + Number(point.watchTimeHours || 0),
        followersNetChange: Number(existing.followersNetChange || 0) + Number(point.followersNetChange || 0),
      })
    }
    const addTimeSeriesByChannel = (point: YouTubeSummary['timeSeriesByChannel'][number]) => {
      if (!point || !point.channelId || !point.date) return
      const key = `${point.channelId}:${point.date}`
      const existing = seriesByChannelDate.get(key) ?? {
        channelId: point.channelId,
        date: point.date,
        views: 0,
        engagements: 0,
        posts: 0,
        watchTimeHours: 0,
        followersNetChange: 0,
      }
      seriesByChannelDate.set(key, {
        ...existing,
        views: existing.views + Number(point.views || 0),
        engagements: existing.engagements + Number(point.engagements || 0),
        posts: existing.posts + Number(point.posts || 0),
        watchTimeHours: Number(existing.watchTimeHours || 0) + Number(point.watchTimeHours || 0),
        followersNetChange: Number(existing.followersNetChange || 0) + Number(point.followersNetChange || 0),
      })
    }

    ;[...youtubeSummary.channels, ...instagramSummary.channels].forEach(addChannel)
    ;[...youtubeSummary.topPosts, ...instagramSummary.topPosts].forEach(addPost)
    ;[...youtubeSummary.timeSeries, ...instagramSummary.timeSeries].forEach(addTimeSeries)
    ;[...youtubeSummary.timeSeriesByChannel, ...instagramSummary.timeSeriesByChannel].forEach(addTimeSeriesByChannel)

    const firstDateCandidates = [
      youtubeSummary.firstVideoUploadDate,
      instagramSummary.firstVideoUploadDate,
    ].filter((value) => typeof value === 'string' && value.trim())

    return {
      firstVideoUploadDate: firstDateCandidates.sort()[0] ?? '',
      channels: [...channelByKey.values()],
      topPosts: [...postByKey.values()].sort((left, right) => Number(right.views) - Number(left.views)),
      timeSeries: [...timeSeriesByDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
      timeSeriesByChannel: [...seriesByChannelDate.values()].sort((left, right) => {
        const channelOrder = left.channelId.localeCompare(right.channelId)
        if (channelOrder !== 0) return channelOrder
        return left.date.localeCompare(right.date)
      }),
      ageDistribution: youtubeSummary.ageDistribution,
      ageDistributionByChannel: youtubeSummary.ageDistributionByChannel,
      genderDistribution: youtubeSummary.genderDistribution,
      genderDistributionByChannel: youtubeSummary.genderDistributionByChannel,
      topGeos: youtubeSummary.topGeos,
      topGeosByChannel: youtubeSummary.topGeosByChannel,
    }
  }, [])

  const initialYouTubeSummary = getCachedYouTubeSummary()
  const initialInstagramSummary = getCachedInstagramSummary()
  const initialSummary =
    initialYouTubeSummary || initialInstagramSummary
      ? mergeSummaries(initialYouTubeSummary ?? emptySummary, initialInstagramSummary ?? emptySummary)
      : null
  const [summary, setSummary] = useState<YouTubeSummary>(initialSummary ?? emptySummary)
  const [status, setStatus] = useState<LoadStatus>(initialSummary ? 'ready' : 'loading')
  const [error, setError] = useState<string | null>(null)

  const loadSummary = useCallback(async (options?: { force?: boolean }) => {
    try {
      const [nextYouTubeSummary, nextInstagramSummary] = await Promise.all([
        fetchAndCacheYouTubeSummary(options),
        fetchAndCacheInstagramSummary(options).catch(() => emptySummary),
      ])
      setSummary(mergeSummaries(nextYouTubeSummary, nextInstagramSummary))
      setStatus('ready')
      setError(null)
    } catch (err) {
      const cachedYouTubeSummary = getCachedYouTubeSummary()
      const cachedInstagramSummary = getCachedInstagramSummary()
      if (cachedYouTubeSummary || cachedInstagramSummary) {
        setSummary(mergeSummaries(cachedYouTubeSummary ?? emptySummary, cachedInstagramSummary ?? emptySummary))
        setStatus('ready')
        setError('Live social sync is temporarily unavailable.')
        return
      }
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Unable to load YouTube data.')
    }
  }, [mergeSummaries])

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
