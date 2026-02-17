import { bumpRefreshCounter } from './refreshCounter'
import {
  clearInstagramSummaryCache,
  fetchAndCacheInstagramSummary,
  startInstagramRefresh,
  waitForInstagramRefresh,
} from './instagram'
import {
  clearYouTubeSummaryCache,
  fetchAndCacheYouTubeSummary,
  startYouTubeRefresh,
  waitForYouTubeRefresh,
} from './youtube'

export const DASHBOARD_DATA_REFRESHED_EVENT = 'fixated:dashboard-data-refreshed'

interface RefreshOptions {
  onProgress?: (message: string) => void
}

interface RefreshResult {
  refreshedAt: number
  refreshCount24h: number | null
  refreshesRemaining: number | null
}

const emitDashboardDataRefreshed = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(DASHBOARD_DATA_REFRESHED_EVENT))
}

export const refreshAllConnectedAccountData = async (
  options?: RefreshOptions,
): Promise<RefreshResult> => {
  const refreshCounter = await bumpRefreshCounter()
  options?.onProgress?.(
    `Refresh started (${refreshCounter.refreshesRemaining} remaining in this 24h window).`,
  )

  options?.onProgress?.('Refreshing YouTube data...')

  const [youtubeStatus, instagramStatus] = await Promise.all([
    startYouTubeRefresh()
      .then((job) =>
        waitForYouTubeRefresh(job.jobId, {
          onProgress: (status) => {
            if (status.status === 'running' && status.channelsTotal > 0) {
              options?.onProgress?.(
                `Refreshing YouTube... ${Math.min(status.channelsProcessed, status.channelsTotal)}/${status.channelsTotal} channels`,
              )
            }
          },
        }),
      ),
    startInstagramRefresh()
      .then((job) =>
        waitForInstagramRefresh(job.jobId, {
          onProgress: (status) => {
            if (status.status === 'running' && status.channelsTotal > 0) {
              options?.onProgress?.(
                `Refreshing Instagram... ${Math.min(status.channelsProcessed, status.channelsTotal)}/${status.channelsTotal} accounts`,
              )
            }
          },
        }),
      ),
  ])

  if (youtubeStatus.status === 'failed') {
    throw new Error(youtubeStatus.errorMessage || 'YouTube refresh failed.')
  }
  if (instagramStatus.status === 'failed') {
    throw new Error(instagramStatus.errorMessage || 'Instagram refresh failed.')
  }

  options?.onProgress?.('Updating cached dashboard data...')
  clearYouTubeSummaryCache()
  clearInstagramSummaryCache()
  await Promise.all([
    fetchAndCacheYouTubeSummary({ force: true }),
    fetchAndCacheInstagramSummary({ force: true }).catch(() => null),
  ])
  emitDashboardDataRefreshed()

  return {
    refreshedAt: Date.now(),
    refreshCount24h: refreshCounter.refreshCount,
    refreshesRemaining: refreshCounter.refreshesRemaining,
  }
}
