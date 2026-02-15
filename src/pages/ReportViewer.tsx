import { useEffect, useMemo, useState } from 'react'
import { useYouTubeSummary } from '../hooks/useYouTubeSummary'
import { fetchCampaigns } from '../utils/campaigns'
import { formatNumber } from '../utils/format'
import { mapCampaignForReport, type ReportCampaign } from '../utils/reportCampaigns'

export const ReportViewer = () => {
  const [campaigns, setCampaigns] = useState<ReportCampaign[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { summary: youtubeSummary } = useYouTubeSummary()

  useEffect(() => {
    let cancelled = false

    const loadCampaigns = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetchCampaigns()
        if (cancelled) return
        setCampaigns(response.campaigns.map((campaign) => mapCampaignForReport(campaign)))
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

  const selectedCampaign = useMemo(() => {
    if (!campaigns.length) return null
    const queryCampaign = new URLSearchParams(window.location.search).get('campaign')
    if (!queryCampaign) return campaigns[0]
    return campaigns.find((campaign) => campaign.name === queryCampaign) ?? campaigns[0]
  }, [campaigns])

  const formatDateLabel = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date)
  }

  const deliveryPercent =
    selectedCampaign && selectedCampaign.guaranteedViews > 0
      ? Math.min(100, Math.round((selectedCampaign.deliveredViews / selectedCampaign.guaranteedViews) * 100))
      : 0

  const topContent = youtubeSummary.topPosts
    .filter((post) => !selectedCampaign || post.campaignTag === selectedCampaign.name)
    .slice(0, 3)

  if (isLoading) {
    return (
      <div className="page" style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <div className="card">
          <div className="section-subtitle">Loading report...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page" style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <div className="card">
          <div className="section-subtitle" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        </div>
      </div>
    )
  }

  if (!selectedCampaign) {
    return (
      <div className="page" style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <div className="card">
          <div className="section-subtitle">No campaigns are available for reporting.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page" style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div className="card">
        <div className="section-title">{selectedCampaign.brand}</div>
        <div className="section-subtitle">
          {selectedCampaign.name} | {formatDateLabel(selectedCampaign.startDate)} -{' '}
          {formatDateLabel(selectedCampaign.endDate)}
        </div>
        <div className="grid grid-3" style={{ marginTop: '20px' }}>
          <div className="card compact">
            <div className="kpi-label">Total Views</div>
            <div className="kpi-value">{formatNumber(selectedCampaign.deliveredViews)}</div>
          </div>
          <div className="card compact">
            <div className="kpi-label">Engagements</div>
            <div className="kpi-value">{formatNumber(selectedCampaign.deliveredEngagements)}</div>
          </div>
          <div className="card compact">
            <div className="kpi-label">Guaranteed Views</div>
            <div className="kpi-value">{formatNumber(selectedCampaign.guaranteedViews)}</div>
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
            <span className="filter-chip">Engagement rate: {selectedCampaign.engagementRate.toFixed(1)}%</span>
            <span className="filter-chip">Pacing: {selectedCampaign.pacing}</span>
          </div>
        </div>
        <div style={{ marginTop: '24px' }}>
          <div className="section-title">Top Content</div>
          <div className="section-subtitle">Leading posts across platforms.</div>
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
                    No live top-content data is available.
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
