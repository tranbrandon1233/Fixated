import { useEffect, useMemo, useState } from 'react'
import { useYouTubeSummary } from '../hooks/useYouTubeSummary'
import { fetchCampaigns } from '../utils/campaigns'
import { formatNumber } from '../utils/format'
import { mapCampaignForReport, resolveViewerCampaignRole, type ReportCampaign } from '../utils/reportCampaigns'
import { sanitizeTextInput, sanitizeTokenInput } from '../utils/sanitize'

interface ReportViewerProps {
  onLogout?: () => void
}

const parseCampaignIds = (value: string | null) => {
  if (!value) return []
  const seen = new Set<string>()
  return value
    .split(',')
    .map((entry) => sanitizeTokenInput(entry, 80))
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

const formatDateLabel = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export const ReportViewer = ({ onLogout }: ReportViewerProps) => {
  const [campaigns, setCampaigns] = useState<ReportCampaign[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { summary: youtubeSummary } = useYouTubeSummary()
  const logoutControl = onLogout ? (
    <div className="filter-bar" style={{ justifyContent: 'flex-end', marginBottom: '12px' }}>
      <button className="ghost-button" type="button" onClick={onLogout}>
        Log out
      </button>
    </div>
  ) : null

  useEffect(() => {
    let cancelled = false

    const loadCampaigns = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetchCampaigns()
        if (cancelled) return
        const memberCampaigns = response.campaigns.flatMap((campaign) => {
          const viewerRole = resolveViewerCampaignRole(campaign, response.viewerUserId)
          if (!viewerRole) return []
          return [mapCampaignForReport(campaign, viewerRole)]
        })
        setCampaigns(memberCampaigns)
      } catch (err) {
        if (cancelled) return
        setCampaigns([])
        setError(err instanceof Error ? err.message : 'Unable to load campaigns.')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadCampaigns()
    return () => {
      cancelled = true
    }
  }, [])

  const requestedCampaignIds = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const queryCampaignIds = parseCampaignIds(params.get('campaignIds'))
    const queryCampaignId = sanitizeTokenInput(params.get('campaignId'), 80)
    if (queryCampaignId && !queryCampaignIds.includes(queryCampaignId)) {
      queryCampaignIds.push(queryCampaignId)
    }
    return queryCampaignIds
  }, [])

  const sharedScopeAccessError = useMemo(() => {
    if (!requestedCampaignIds.length) return ''
    const accessibleIdSet = new Set(campaigns.map((campaign) => campaign.id))
    const hasAllRequestedCampaigns = requestedCampaignIds.every((campaignId) =>
      accessibleIdSet.has(campaignId))
    if (hasAllRequestedCampaigns) return ''
    return 'You can view this shared report only if you have access to all campaigns in the report.'
  }, [campaigns, requestedCampaignIds])

  const scopedCampaigns = useMemo(() => {
    if (!campaigns.length) return []

    if (requestedCampaignIds.length) {
      const selectedCampaignIdSet = new Set(requestedCampaignIds)
      const byId = campaigns.filter((campaign) => selectedCampaignIdSet.has(campaign.id))
      if (byId.length === requestedCampaignIds.length) return byId
      return []
    }

    const params = new URLSearchParams(window.location.search)
    const queryCampaign = sanitizeTextInput(params.get('campaign'), { maxLength: 140 })
    const queryFilter = sanitizeTextInput(params.get('filter'), { maxLength: 140 })
    const wantsAllCampaigns =
      queryFilter === 'All campaigns'
      || queryFilter === 'No campaign filter'
      || queryFilter.includes('campaigns selected')
    if (wantsAllCampaigns) {
      return campaigns
    }
    const fallbackCampaignName = queryFilter
      ? (
        queryFilter
      )
      : queryCampaign

    if (!fallbackCampaignName) return campaigns.length ? [campaigns[0]] : []
    return [campaigns.find((campaign) => campaign.name === fallbackCampaignName) ?? campaigns[0]]
  }, [campaigns, requestedCampaignIds])

  const activeCampaign = scopedCampaigns.length === 1 ? scopedCampaigns[0] : null
  const campaignBrandLabel = useMemo(() => {
    const brands = [...new Set(
      scopedCampaigns
        .map((campaign) => sanitizeTextInput(campaign.brand, { maxLength: 140 }))
        .filter((brand) => Boolean(brand)),
    )]
    if (!brands.length) return 'Brand'
    return brands.length === 1 ? brands[0] : 'Multiple brands'
  }, [scopedCampaigns])

  const campaignDateRange = useMemo(() => {
    const dates = scopedCampaigns
      .flatMap((campaign) => [campaign.startDate, campaign.endDate])
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort()
    if (!dates.length) {
      return { startDate: '', endDate: '' }
    }
    return {
      startDate: dates[0],
      endDate: dates[dates.length - 1],
    }
  }, [scopedCampaigns])

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

  const deliveryPercent =
    scopedCampaignTotals.guaranteedViews > 0
      ? Math.min(100, Math.round((scopedCampaignTotals.deliveredViews / scopedCampaignTotals.guaranteedViews) * 100))
      : 0
  const blendedEngagementRate = activeCampaign
    ? activeCampaign.engagementRate
    : scopedCampaignTotals.deliveredViews > 0
      ? (scopedCampaignTotals.deliveredEngagements / scopedCampaignTotals.deliveredViews) * 100
      : 0
  const pacingLabel = activeCampaign
    ? activeCampaign.pacing
    : scopedCampaigns.length > 1
      ? `Mixed (${scopedCampaigns.length} campaigns)`
      : 'N/A'
  const campaignScopeLabel = activeCampaign
    ? activeCampaign.name
    : `Selected campaigns (${scopedCampaigns.length})`

  const scopedCampaignPostIdSet = useMemo(() => {
    const ids = new Set<string>()
    scopedCampaigns.forEach((campaign) => {
      campaign.selectedPostIds.forEach((postId) => {
        const normalized = sanitizeTokenInput(postId, 300)
        if (!normalized) return
        ids.add(normalized)
      })
      campaign.posts.forEach((group) => {
        if (!group || typeof group !== 'object') return
        const posts = group.posts && typeof group.posts === 'object' && !Array.isArray(group.posts)
          ? group.posts
          : {}
        Object.keys(posts).forEach((postId) => {
          const normalized = sanitizeTokenInput(postId, 300)
          if (!normalized) return
          ids.add(normalized)
        })
      })
    })
    return ids
  }, [scopedCampaigns])

  const assignedPostsById = useMemo(() => {
    const byId = new Map<string, { title: string; platform: string; views: number; engagementRate: number }>()
    scopedCampaigns.forEach((campaign) => {
      campaign.posts.forEach((group) => {
        if (!group || typeof group !== 'object') return
        const posts = group.posts && typeof group.posts === 'object' && !Array.isArray(group.posts)
          ? group.posts
          : {}
        Object.values(posts).forEach((post) => {
          if (!post || typeof post !== 'object') return
          const postId = sanitizeTokenInput((post as { id?: unknown }).id, 300)
          if (!postId) return
          const title = sanitizeTextInput((post as { title?: unknown }).title, { maxLength: 300 }) || 'Untitled post'
          const platform = sanitizeTextInput((post as { platform?: unknown }).platform, { maxLength: 64 }) || 'YouTube'
          byId.set(postId, {
            title,
            platform,
            views: toMetricNumber((post as { views?: unknown }).views),
            engagementRate: toMetricNumber((post as { engagementRate?: unknown }).engagementRate),
          })
        })
      })
    })
    return byId
  }, [scopedCampaigns])

  const topContent = useMemo(() => {
    if (!scopedCampaignPostIdSet.size) return []

    const summaryPostsById = new Map(
      youtubeSummary.topPosts
        .map((post) => {
          const postId = sanitizeTokenInput(post.id, 300)
          if (!postId) return null
          return [postId, post] as const
        })
        .filter((entry): entry is readonly [string, typeof youtubeSummary.topPosts[number]] => Boolean(entry)),
    )

    return [...scopedCampaignPostIdSet]
      .map((postId) => {
        const summaryPost = summaryPostsById.get(postId)
        const assignedPost = assignedPostsById.get(postId)
        if (!summaryPost && !assignedPost) return null
        return {
          id: postId,
          title:
            sanitizeTextInput(summaryPost?.title ?? assignedPost?.title ?? 'Untitled post', {
              maxLength: 300,
            }) || 'Untitled post',
          platform: sanitizeTextInput(summaryPost?.platform ?? assignedPost?.platform ?? 'YouTube', {
            maxLength: 64,
          }) || 'YouTube',
          views: toMetricNumber(summaryPost?.views ?? assignedPost?.views),
          engagementRate: toMetricNumber(summaryPost?.engagementRate ?? assignedPost?.engagementRate),
        }
      })
      .filter((post): post is {
        id: string
        title: string
        platform: string
        views: number
        engagementRate: number
      } => Boolean(post))
      .sort((left, right) => right.views - left.views)
      .slice(0, 3)
  }, [assignedPostsById, scopedCampaignPostIdSet, youtubeSummary.topPosts])

  if (isLoading) {
    return (
      <div className="page" style={{ maxWidth: '1100px', margin: '0 auto' }}>
        {logoutControl}
        <div className="card">
          <div className="section-subtitle">Loading report...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page" style={{ maxWidth: '1100px', margin: '0 auto' }}>
        {logoutControl}
        <div className="card">
          <div className="section-subtitle" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        </div>
      </div>
    )
  }

  if (sharedScopeAccessError) {
    return (
      <div className="page" style={{ maxWidth: '1100px', margin: '0 auto' }}>
        {logoutControl}
        <div className="card">
          <div className="section-subtitle" style={{ color: 'var(--danger)' }}>
            {sharedScopeAccessError}
          </div>
        </div>
      </div>
    )
  }

  if (!scopedCampaigns.length) {
    return (
      <div className="page" style={{ maxWidth: '1100px', margin: '0 auto' }}>
        {logoutControl}
        <div className="card">
          <div className="section-subtitle">No campaigns are available for reporting.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page" style={{ maxWidth: '1100px', margin: '0 auto' }}>
      {logoutControl}
      <div className="card">
        <div className="section-title">{campaignBrandLabel}</div>
        <div className="section-subtitle">
          {campaignScopeLabel}
          {' | '}
          {campaignDateRange.startDate ? formatDateLabel(campaignDateRange.startDate) : 'N/A'} -{' '}
          {campaignDateRange.endDate ? formatDateLabel(campaignDateRange.endDate) : 'N/A'}
        </div>
        <div className="grid grid-3" style={{ marginTop: '20px' }}>
          <div className="card compact">
            <div className="kpi-label">Total Views</div>
            <div className="kpi-value">{formatNumber(scopedCampaignTotals.deliveredViews)}</div>
          </div>
          <div className="card compact">
            <div className="kpi-label">Engagements</div>
            <div className="kpi-value">{formatNumber(scopedCampaignTotals.deliveredEngagements)}</div>
          </div>
          <div className="card compact">
            <div className="kpi-label">Guaranteed Views</div>
            <div className="kpi-value">{formatNumber(scopedCampaignTotals.guaranteedViews)}</div>
          </div>
        </div>
        <div style={{ marginTop: '24px' }}>
          <div className="section-title">Guaranteed vs Delivered</div>
          <div className="section-subtitle">Campaign performance at a glance.</div>
          <div className="progress-track" style={{ marginTop: '10px' }}>
            <div className="progress-fill" style={{ width: `${deliveryPercent}%` }} />
          </div>
          <div className="filter-bar" style={{ marginTop: '12px' }}>
            <span className="filter-chip">Delivery: {deliveryPercent}%</span>
            <span className="filter-chip">Engagement rate: {blendedEngagementRate.toFixed(1)}%</span>
            <span className="filter-chip">Pacing: {pacingLabel}</span>
          </div>
        </div>
        <div style={{ marginTop: '24px' }}>
          <div className="section-title">Top Content</div>
          <div className="section-subtitle">Leading posts across selected campaign assignments.</div>
          <table className="data-table" style={{ marginTop: '12px' }}>
            <thead>
              <tr>
                <th>Post</th>
                <th>Platform</th>
                <th>Views</th>
                <th>Eng. Rate</th>
              </tr>
            </thead>
            <tbody>
              {topContent.length ? (
                topContent.map((post) => (
                  <tr key={post.id}>
                    <td>{post.title}</td>
                    <td>{post.platform}</td>
                    <td>{formatNumber(post.views)}</td>
                    <td>{post.engagementRate.toFixed(1)}%</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="muted">
                    No campaign-assigned top-content data is available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="muted" style={{ marginTop: '16px', textAlign: 'center' }}>
        Confidential | Generated {new Date().toLocaleDateString('en-US')} | Read-only view
      </div>
    </div>
  )
}
