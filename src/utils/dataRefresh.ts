import { bumpRefreshCounter } from './refreshCounter'
import {
  clearYouTubeSummaryCache,
  fetchAndCacheYouTubeSummary,
  getYouTubeRefreshStatus,
  startYouTubeRefresh,
  type YouTubeRefreshStatusResponse,
  waitForYouTubeRefresh,
} from './youtube'
import {
  clearInstagramSummaryCache,
  fetchAndCacheInstagramSummary,
  // startInstagramRefresh,
  // waitForInstagramRefresh,
} from './instagram'
import {
  clearXSummaryCache,
  fetchAndCacheXSummary,
  startXRefresh,
} from './x'

export const DASHBOARD_DATA_REFRESHED_EVENT = 'fixated:dashboard-data-refreshed'

interface RefreshOptions {
  onProgress?: (message: string) => void
}

interface RefreshResult {
  refreshedAt: number
  refreshCount24h: number | null
  refreshesRemaining: number | null
  warnings: string[]
}

let inFlightRefreshPromise: Promise<RefreshResult> | null = null
const refreshProgressSubscribers = new Set<(message: string) => void>()

const emitDashboardDataRefreshed = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(DASHBOARD_DATA_REFRESHED_EVENT))
}

const emitRefreshProgress = (message: string) => {
  for (const subscriber of refreshProgressSubscribers) {
    try {
      subscriber(message)
    } catch {
      // Ignore subscriber errors so refresh flow is not interrupted.
    }
  }
}

export const refreshAllConnectedAccountData = async (
  options?: RefreshOptions,
): Promise<RefreshResult> => {
  if (typeof options?.onProgress === 'function') {
    refreshProgressSubscribers.add(options.onProgress)
  }

  if (inFlightRefreshPromise) {
    emitRefreshProgress('Refresh already in progress...')
    try {
      return await inFlightRefreshPromise
    } finally {
      if (typeof options?.onProgress === 'function') {
        refreshProgressSubscribers.delete(options.onProgress)
      }
    }
  }

  inFlightRefreshPromise = (async () => {
    const warnings: string[] = []
    const refreshCounter = await bumpRefreshCounter()
    emitRefreshProgress(
      `Refresh started (${refreshCounter.refreshesRemaining} remaining in this 24h window).`,
    )

    emitRefreshProgress('Refreshing YouTube data...')

    const youtubeStart = await startYouTubeRefresh()
    let youtubeStatus: YouTubeRefreshStatusResponse | null = null
    try {
      youtubeStatus = youtubeStart.status === 'failed'
        ? await getYouTubeRefreshStatus(youtubeStart.jobId)
        : await waitForYouTubeRefresh(youtubeStart.jobId, {
          timeoutMs: 90 * 1000, // 90 seconds
          intervalMs: 30 * 1000, // 30 seconds
          onProgress: (status) => {
            if (status.status === 'running' && status.channelsTotal > 0) {
              emitRefreshProgress(
                `Refreshing YouTube... ${Math.min(status.channelsProcessed, status.channelsTotal)}/${status.channelsTotal} channels`,
              )
            }
          },
        })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'YouTube refresh timed out.'
      const normalizedMessage = rawMessage.toLowerCase()
      const canContinueInBackground =
        normalizedMessage.includes('timed out waiting for youtube refresh')
        || normalizedMessage.includes('still queued after')
      if (!canContinueInBackground) {
        throw error
      }
      const warning = 'YouTube refresh is still running in the background. Latest metrics may appear shortly.'
      warnings.push(warning)
      emitRefreshProgress(warning)
    }

    if (youtubeStatus?.status === 'failed') {
      throw new Error(youtubeStatus.errorMessage || 'YouTube refresh failed.')
    }

    // emitRefreshProgress('Refreshing Instagram data...')
    // try {
    //   const instagramStatus = await startInstagramRefresh()
    //     .then((job) =>
    //       waitForInstagramRefresh(job.jobId, {
    //         onProgress: (status) => {
    //           if (status.status === 'running' && status.channelsTotal > 0) {
    //             emitRefreshProgress(
    //               `Refreshing Instagram... ${Math.min(status.channelsProcessed, status.channelsTotal)}/${status.channelsTotal} accounts`,
    //             )
    //           }
    //         },
    //       }),
    //     )
    //   if (instagramStatus.status === 'failed') {
    //     throw new Error(instagramStatus.errorMessage || 'Instagram refresh failed.')
    //   }
    // } catch (error) {
    //   const rawMessage = error instanceof Error ? error.message : 'Instagram refresh failed.'
    //   const message = rawMessage.toLowerCase()
    //   const canSkipInstagram =
    //     message.includes('instagram collection is disabled')
    //     || message.includes('unable to start instagram refresh')
    //   if (canSkipInstagram) {
    //     const warning = 'Instagram refresh skipped (not configured yet).'
    //     warnings.push(warning)
    //     emitRefreshProgress(warning)
    //   } else {
    //     const warning = `Instagram refresh failed (${rawMessage}). Continuing with available data.`
    //     warnings.push(warning)
    //     emitRefreshProgress(warning)
    //   }
    // }

    emitRefreshProgress('Refreshing X data...')
    try {
      const xRefresh = await startXRefresh()
      if (!xRefresh.ok || xRefresh.failedAccounts.length > 0) {
        const firstFailure = xRefresh.failedAccounts[0]
        const failureReason = firstFailure
          ? firstFailure.message || firstFailure.error || 'unknown_error'
          : 'unknown_error'
        const warning = xRefresh.partialSuccess
          ? `X refresh partially completed (${xRefresh.refreshedAccounts} accounts updated, ${xRefresh.failedAccounts.length} failed: ${failureReason}).`
          : `X refresh failed for ${xRefresh.failedAccounts.length || 1} account(s): ${failureReason}.`
        warnings.push(warning)
        emitRefreshProgress(warning)
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'X refresh failed.'
      const errorCode =
        error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
          ? String((error as { code?: string }).code).toLowerCase()
          : ''
      const canSkipX =
        errorCode === 'x_collection_disabled'
        || errorCode === 'x_not_configured'
        || errorCode === 'x_storage_not_configured'
      if (canSkipX) {
        const warning = 'X refresh skipped (not configured yet).'
        warnings.push(warning)
        emitRefreshProgress(warning)
      } else {
        const warning = `X refresh failed (${rawMessage}). Continuing with available data.`
        warnings.push(warning)
        emitRefreshProgress(warning)
      }
    }

    emitRefreshProgress('Updating cached dashboard data...')
    clearYouTubeSummaryCache()
    clearInstagramSummaryCache()
    clearXSummaryCache()
    await Promise.allSettled([
      fetchAndCacheYouTubeSummary({ force: true }),
      fetchAndCacheInstagramSummary({ force: true }),
      fetchAndCacheXSummary({ force: true }),
    ])
    emitDashboardDataRefreshed()

    return {
      refreshedAt: Date.now(),
      refreshCount24h: refreshCounter.refreshCount,
      refreshesRemaining: refreshCounter.refreshesRemaining,
      warnings,
    }
  })()

  try {
    return await inFlightRefreshPromise
  } finally {
    inFlightRefreshPromise = null
    refreshProgressSubscribers.clear()
    if (typeof options?.onProgress === 'function') {
      refreshProgressSubscribers.delete(options.onProgress)
    }
  }
}
