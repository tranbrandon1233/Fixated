import { bumpRefreshCounter } from './refreshCounter'
import {
  clearYouTubeSummaryCache,
  fetchAndCacheYouTubeSummary,
  startYouTubeRefresh,
  waitForYouTubeRefresh,
} from './youtube'
import {
  clearInstagramSummaryCache,
  fetchAndCacheInstagramSummary,
  startInstagramRefresh,
  waitForInstagramRefresh,
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

const emitDashboardDataRefreshed = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(DASHBOARD_DATA_REFRESHED_EVENT))
}

export const refreshAllConnectedAccountData = async (
  options?: RefreshOptions,
): Promise<RefreshResult> => {
  const warnings: string[] = []
  const refreshCounter = await bumpRefreshCounter()
  options?.onProgress?.(
    `Refresh started (${refreshCounter.refreshesRemaining} remaining in this 24h window).`,
  )

  options?.onProgress?.('Refreshing YouTube data...')

  const youtubeStatus = await startYouTubeRefresh()
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
    )

  if (youtubeStatus.status === 'failed') {
    throw new Error(youtubeStatus.errorMessage || 'YouTube refresh failed.')
  }

  options?.onProgress?.('Refreshing Instagram data...')
  try {
    const instagramStatus = await startInstagramRefresh()
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
      )
    if (instagramStatus.status === 'failed') {
      throw new Error(instagramStatus.errorMessage || 'Instagram refresh failed.')
    }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Instagram refresh failed.'
    const message = rawMessage.toLowerCase()
    const canSkipInstagram =
      message.includes('instagram collection is disabled')
      || message.includes('unable to start instagram refresh')
    if (canSkipInstagram) {
      const warning = 'Instagram refresh skipped (not configured yet).'
      warnings.push(warning)
      options?.onProgress?.(warning)
    } else {
      const warning = `Instagram refresh failed (${rawMessage}). Continuing with available data.`
      warnings.push(warning)
      options?.onProgress?.(warning)
    }
  }

  options?.onProgress?.('Refreshing X data...')
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
      options?.onProgress?.(warning)
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
      options?.onProgress?.(warning)
    } else {
      const warning = `X refresh failed (${rawMessage}). Continuing with available data.`
      warnings.push(warning)
      options?.onProgress?.(warning)
    }
  }

  options?.onProgress?.('Updating cached dashboard data...')
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
}
