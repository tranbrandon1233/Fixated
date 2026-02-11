import { useMemo, useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { ProgressBar } from '../components/ui/ProgressBar'
import { SectionHeader } from '../components/ui/SectionHeader'
import { campaigns } from '../data/mock'
import type { CampaignSummary } from '../types/dashboard'
import { formatNumber, formatPercent } from '../utils/format'

const statusTone = (status: string) => {
  if (status === 'Overdelivering') return 'success'
  if (status === 'At Risk') return 'danger'
  if (status === 'Active') return 'warning'
  return 'default'
}

export const Campaigns = () => {
  const [campaignList, setCampaignList] = useState<CampaignSummary[]>(campaigns)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftBrand, setDraftBrand] = useState('')
  const [draftStart, setDraftStart] = useState('')
  const [draftEnd, setDraftEnd] = useState('')
  const [draftGuaranteedViews, setDraftGuaranteedViews] = useState('')
  const [draftGuaranteedEngagements, setDraftGuaranteedEngagements] = useState('')

  const resetDraft = () => {
    setDraftName('')
    setDraftBrand('')
    setDraftStart('')
    setDraftEnd('')
    setDraftGuaranteedViews('')
    setDraftGuaranteedEngagements('')
  }

  const canSubmit = useMemo(() => {
    if (
      !draftName.trim() ||
      !draftBrand.trim() ||
      !draftStart ||
      !draftEnd ||
      !draftGuaranteedViews ||
      !draftGuaranteedEngagements
    ) {
      return false
    }
    const start = new Date(draftStart)
    const end = new Date(draftEnd)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false
    return start <= end
  }, [
    draftBrand,
    draftEnd,
    draftGuaranteedEngagements,
    draftGuaranteedViews,
    draftName,
    draftStart,
  ])

  const formatCampaignDate = (value: string) => {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const handleCreate = () => {
    if (!canSubmit) return
    const newCampaign: CampaignSummary = {
      id: `camp-${campaignList.length + 1}`,
      name: draftName.trim(),
      brand: draftBrand.trim(),
      status: 'Draft',
      startDate: draftStart,
      endDate: draftEnd,
      guaranteedViews: Number(draftGuaranteedViews),
      deliveredViews: 0,
      guaranteedEngagements: Number(draftGuaranteedEngagements),
      deliveredEngagements: 0,
      pacing: 'Not started',
      distribution: {
        ono: 0,
        clipper: 0,
      },
    }
    setCampaignList([newCampaign, ...campaignList])
    setIsCreateOpen(false)
    resetDraft()
  }

  return (
    <>
      <SectionHeader
        title="Campaign ROI Tracking"
        subtitle="Delivery vs guarantee with pacing and ROI metrics."
        actions={
          <button className="primary-button" onClick={() => setIsCreateOpen(true)}>
            Create campaign
          </button>
        }
      />

      {isCreateOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="section-title">Create campaign</div>
            <div className="section-subtitle">Add key details for tracking and reporting.</div>
            <div className="grid grid-2" style={{ marginTop: '16px' }}>
              <div className="form-field">
                <label className="section-subtitle">Campaign name</label>
                <input
                  className="input"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="PowerPlay Q2"
                />
              </div>
              <div className="form-field">
                <label className="section-subtitle">Brand</label>
                <input
                  className="input"
                  value={draftBrand}
                  onChange={(event) => setDraftBrand(event.target.value)}
                  placeholder="Vertex Energy"
                />
              </div>
              <div className="form-field">
                <label className="section-subtitle">Start date</label>
                <input
                  className="input"
                  value={draftStart}
                  onChange={(event) => setDraftStart(event.target.value)}
                  type="date"
                />
              </div>
              <div className="form-field">
                <label className="section-subtitle">End date</label>
                <input
                  className="input"
                  value={draftEnd}
                  onChange={(event) => setDraftEnd(event.target.value)}
                  type="date"
                />
              </div>
              <div className="form-field">
                <label className="section-subtitle">Guaranteed views</label>
                <input
                  className="input"
                  value={draftGuaranteedViews}
                  onChange={(event) => setDraftGuaranteedViews(event.target.value)}
                  type="number"
                  min={0}
                  step={1}
                  placeholder="50000000"
                />
              </div>
              <div className="form-field">
                <label className="section-subtitle">Guaranteed engagements</label>
                <input
                  className="input"
                  value={draftGuaranteedEngagements}
                  onChange={(event) => setDraftGuaranteedEngagements(event.target.value)}
                  type="number"
                  min={0}
                  step={1}
                  placeholder="2300000"
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" onClick={handleCreate} disabled={!canSubmit}>
                Create campaign
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-3">
        {campaignList.map((campaign) => {
          const deliveryPercent = (campaign.deliveredViews / campaign.guaranteedViews) * 100
          const engagementRate = campaign.deliveredViews
            ? (campaign.deliveredEngagements / campaign.deliveredViews) * 100
            : 0

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
                {formatCampaignDate(campaign.startDate)} - {formatCampaignDate(campaign.endDate)}
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
