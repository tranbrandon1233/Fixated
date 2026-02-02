import { SectionHeader } from '../components/ui/SectionHeader'
import { reportConfig } from '../data/mock'

export const ReportBuilder = () => {
  return (
    <>
      <SectionHeader
        title="Brand Report Builder"
        subtitle="Configure a polished, client-ready report."
        actions={<button className="primary-button">Export PDF</button>}
      />

      <div className="grid grid-2">
        <div className="card">
          <div className="section-title">Report configuration</div>
          <div className="section-subtitle">Select scope and visibility options.</div>
          <div className="grid" style={{ marginTop: '16px' }}>
            <label className="filter-chip">Brand: {reportConfig.brand}</label>
            <label className="filter-chip">Campaign: {reportConfig.campaign}</label>
            <label className="filter-chip">Date range: {reportConfig.range}</label>
            <label className="filter-chip">Channels: {reportConfig.channels}</label>
            <label className="filter-chip">Platforms: {reportConfig.platforms}</label>
            <label className="filter-chip">Metrics: {reportConfig.metrics}</label>
            <label className="filter-chip">
              Show CPM/CPV: {reportConfig.showCPM ? 'Yes' : 'No'}
            </label>
            <label className="filter-chip">
              Show guarantee vs delivered: {reportConfig.showGuarantee ? 'Yes' : 'No'}
            </label>
          </div>
          <div className="filter-bar" style={{ marginTop: '16px' }}>
            <button className="ghost-button">Clean PDF</button>
            <button className="ghost-button">Deck-style PDF</button>
            <button className="ghost-button">Shareable link</button>
            <button className="ghost-button">CSV export</button>
          </div>
        </div>
        <div className="card">
          <div className="section-title">Live preview</div>
          <div className="section-subtitle">Auto-updates with your selections.</div>
          <div className="report-preview" style={{ marginTop: '16px' }}>
            <div className="section-title">PowerPlay Q1</div>
            <div className="muted">Vertex Energy • Jan 1 - Feb 2, 2026</div>
            <div className="grid grid-2" style={{ marginTop: '16px' }}>
              <div className="card compact">
                <div className="kpi-label">Total Views</div>
                <div className="kpi-value">33.6M</div>
              </div>
              <div className="card compact">
                <div className="kpi-label">Engagements</div>
                <div className="kpi-value">1.58M</div>
              </div>
            </div>
            <div className="section-subtitle" style={{ marginTop: '16px' }}>
              Guarantee vs Delivered
            </div>
            <div className="progress-track" style={{ marginTop: '8px' }}>
              <div className="progress-fill" style={{ width: '67%' }} />
            </div>
            <div className="filter-bar" style={{ marginTop: '12px' }}>
              <span className="filter-chip">Delivery: 67%</span>
              <span className="filter-chip">CPV: $0.04</span>
              <span className="filter-chip">CPM: $6.80</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <SectionHeader
          title="Report pages"
          subtitle="Cover, Executive Summary, Performance, Audience, Top Content, Campaign ROI."
        />
        <div className="grid grid-3" style={{ marginTop: '16px' }}>
          {['Cover', 'Executive Summary', 'Performance', 'Audience', 'Top Content', 'Campaign ROI'].map(
            (label) => (
              <div key={label} className="card compact">
                <div className="section-title">{label}</div>
                <div className="section-subtitle">Included</div>
              </div>
            ),
          )}
        </div>
      </div>
    </>
  )
}
