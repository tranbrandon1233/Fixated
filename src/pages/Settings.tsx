import { SectionHeader } from '../components/ui/SectionHeader'

export const Settings = () => {
  return (
    <>
      <SectionHeader
        title="Account Connections"
        subtitle="Connect owned and operated accounts to unlock analytics."
        actions={<button className="primary-button">Connect Account</button>}
      />
      <div className="grid grid-2">
        <div className="card">
          <div className="section-title">Connected platforms</div>
          <div className="section-subtitle">OAuth tokens encrypted at rest.</div>
          <div className="filter-bar" style={{ marginTop: '16px' }}>
            <span className="filter-chip">YouTube • 3 accounts</span>
            <span className="filter-chip">Instagram • 5 accounts</span>
            <span className="filter-chip">TikTok • 4 accounts</span>
            <span className="filter-chip">X • 2 accounts</span>
          </div>
        </div>
        <div className="card">
          <div className="section-title">Access & roles</div>
          <div className="section-subtitle">Row-level access and brand viewers.</div>
          <div className="filter-bar" style={{ marginTop: '16px' }}>
            <span className="filter-chip">Admin: 4 users</span>
            <span className="filter-chip">Internal: 18 users</span>
            <span className="filter-chip">Brand viewers: 6 users</span>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="section-title">Data refresh</div>
        <div className="section-subtitle">Daily refresh with hourly campaign pacing updates.</div>
        <div className="filter-bar" style={{ marginTop: '16px' }}>
          <button className="ghost-button">Refresh now</button>
          <span className="filter-chip">Last refresh: 2 hours ago</span>
        </div>
      </div>
    </>
  )
}
