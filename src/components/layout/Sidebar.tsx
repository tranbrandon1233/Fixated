import { NavLink } from 'react-router-dom'
import type { Role } from '../../types/dashboard'

interface SidebarProps {
  role: Role
}

const baseLinks = [
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/channels', label: 'Channels' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/reports', label: 'Reports' },
  { to: '/settings', label: 'Settings' },
]

export const Sidebar = ({ role }: SidebarProps) => {
  const links =
    role === 'brand'
      ? [
          { to: '/reports', label: 'Reports' },
          { to: '/settings', label: 'Settings' },
        ]
      : baseLinks

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-title">ONO / LNO</div>
        <div className="brand-sub">Performance Dashboard</div>
      </div>
      <nav className="nav-group">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <span className="dot" />
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="card compact">
        <div className="section-title">Quick Actions</div>
        <div className="section-subtitle">Two-click access</div>
        <div className="filter-bar" style={{ marginTop: '12px' }}>
          <button className="primary-button">Export Brand Report</button>
          <button className="ghost-button">View Campaign ROI</button>
        </div>
      </div>
    </aside>
  )
}
