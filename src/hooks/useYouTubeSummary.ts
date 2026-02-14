import { useCallback, useEffect, useState } from 'react'
import { fetchAndCacheYouTubeSummary, getCachedYouTubeSummary } from '../utils/youtube'
import type { YouTubeSummary } from '../utils/youtube'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

const emptySummary: YouTubeSummary = {
  channels: [],
  topPosts: [],
  timeSeries: [],
  ageDistribution: [],
  genderDistribution: [],
  topGeos: [],
}

export const useYouTubeSummary = () => {
  const initialSummary = getCachedYouTubeSummary()
  const [summary, setSummary] = useState<YouTubeSummary>(initialSummary ?? emptySummary)
  const [status, setStatus] = useState<LoadStatus>(initialSummary ? 'ready' : 'loading')
  const [error, setError] = useState<string | null>(null)

  const loadSummary = useCallback(async (options?: { force?: boolean }) => {
    try {
      const nextSummary = await fetchAndCacheYouTubeSummary(options)
      setSummary(nextSummary)
      setStatus('ready')
      setError(null)
    } catch (err) {
      const cached = getCachedYouTubeSummary()
      if (cached) {
        setSummary(cached)
        setStatus('ready')
        setError('Live YouTube sync is temporarily unavailable.')
        return
      }
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Unable to load YouTube data.')
    }
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

  const refresh = useCallback(() => {
    setStatus('loading')
    setError(null)
    return loadSummary({ force: true })
  }, [loadSummary])

  return { summary, status, error, refresh }
}
