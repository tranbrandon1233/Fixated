import { reportConfig } from '../data/mock'

export const ReportViewer = () => {
  return (
    <div className="page" style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div className="card">
        <div className="section-title">{reportConfig.brand}</div>
        <div className="section-subtitle">
          {reportConfig.campaign} • {reportConfig.range}
        </div>
        <div className="grid grid-3" style={{ marginTop: '20px' }}>
          <div className="card compact">
            <div className="kpi-label">Total Views</div>
            <div className="kpi-value">33.6M</div>
          </div>
          <div className="card compact">
            <div className="kpi-label">Engagements</div>
            <div className="kpi-value">1.58M</div>
          </div>
          <div className="card compact">
            <div className="kpi-label">Posts Published</div>
            <div className="kpi-value">214</div>
          </div>
        </div>
        <div style={{ marginTop: '24px' }}>
          <div className="section-title">Guaranteed vs Delivered</div>
          <div className="section-subtitle">Campaign performance at a glance.</div>
          <div className="progress-track" style={{ marginTop: '10px' }}>
            <div className="progress-fill" style={{ width: '67%' }} />
          </div>
          <div className="filter-bar" style={{ marginTop: '12px' }}>
            <span className="filter-chip">Delivery: 67%</span>
            <span className="filter-chip">Engagement rate: 4.7%</span>
            <span className="filter-chip">Over-delivery: +0%</span>
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
              <tr>
                <td>Championship walk-off moment</td>
                <td>TikTok</td>
                <td>18.9M</td>
                <td>7.1%</td>
              </tr>
              <tr>
                <td>Locker room celebration</td>
                <td>Instagram</td>
                <td>14.2M</td>
                <td>6.5%</td>
              </tr>
              <tr>
                <td>Mic'd up highlight reel</td>
                <td>YouTube</td>
                <td>11.8M</td>
                <td>4.2%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="muted" style={{ marginTop: '16px', textAlign: 'center' }}>
        Confidential • Generated Feb 2, 2026 • Read-only view
      </div>
    </div>
  )
}
