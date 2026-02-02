import { Badge } from '../components/ui/Badge'
import { ProgressBar } from '../components/ui/ProgressBar'
import { SectionHeader } from '../components/ui/SectionHeader'
import { campaigns } from '../data/mock'
import { formatNumber, formatPercent } from '../utils/format'

const statusTone = (status: string) => {
  if (status === 'Overdelivering') return 'success'
  if (status === 'AtRisk') return 'danger'
  if (status === 'Active') return 'warning'
  return 'default'
}

export const Campaigns = () => {
  return (
    <>
      <SectionHeader
        title="Campaign ROI Tracking"
        subtitle="Delivery vs guarantee with pacing and ROI metrics."
        actions={<button className="primary-button">Create campaign</button>}
      />

      <div className="grid grid-3">
        {campaigns.map((campaign) => {
          const deliveryPercent = (campaign.deliveredViews / campaign.guaranteedViews) * 100
          const engagementRate =
            (campaign.deliveredEngagements / campaign.deliveredViews) * 100

          return (
            <div key={campaign.id} className="card">
              <div className="split">
                <div>
                  <div className="section-title">{campaign.name}</div>
                  <div className="section-subtitle">{campaign.brand}</div>
                </div>
                <Badge tone={statusTone(campaign.status)} label={campaign.status} />
              </div>
              <div className="muted" style={{ marginTop: '8px' }}>
                {campaign.startDate} - {campaign.endDate}
              </div>
              <div style={{ marginTop: '16px' }}>
                <div className="split">
                  <span className="muted">Views delivered</span>
                  <strong>{formatNumber(campaign.deliveredViews)}</strong>
                </div>
                <div className="split">
                  <span className="muted">Guaranteed</span>
                  <strong>{formatNumber(campaign.guaranteedViews)}</strong>
                </div>
                <div style={{ marginTop: '10px' }}>
                  <ProgressBar value={deliveryPercent} />
                </div>
                <div className="split" style={{ marginTop: '8px' }}>
                  <span className="muted">Delivery</span>
                  <span>{formatPercent(deliveryPercent)}</span>
                </div>
              </div>
              <div className="grid grid-2" style={{ marginTop: '16px' }}>
                <div className="card compact">
                  <div className="kpi-label">Engagement rate</div>
                  <div className="kpi-value">{formatPercent(engagementRate)}</div>
                </div>
                <div className="card compact">
                  <div className="kpi-label">Pacing</div>
                  <div className="kpi-value">{campaign.pacing}</div>
                </div>
              </div>
              <div style={{ marginTop: '16px' }}>
                <div className="section-subtitle">Distribution source</div>
                <div className="split" style={{ marginTop: '6px' }}>
                  <span className="muted">ONO channels</span>
                  <span>{campaign.distribution.ono}%</span>
                </div>
                <div className="split">
                  <span className="muted">Clipper network</span>
                  <span>{campaign.distribution.clipper}%</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
