import { NavLink, useNavigate } from 'react-router-dom'
import {
  Briefcase,
  Cast,
  Eye,
  FileText,
  Building,
  Target,
  Settings2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Role } from '../../types/dashboard'

interface SidebarProps {
  role: Role
}

type SidebarLink = {
  to: string
  label: string
  Icon: LucideIcon
}

const baseLinks: SidebarLink[] = [
  { to: '/portfolio', label: 'Portfolio', Icon: Briefcase },
  { to: '/channels', label: 'Channels', Icon: Cast },
  { to: '/campaigns', label: 'Campaigns', Icon: Target },
  { to: '/organizations', label: 'Organizations', Icon: Building },
  { to: '/reports', label: 'Reports', Icon: FileText },
]
const settingsLink: SidebarLink = { to: '/settings', label: 'Settings', Icon: Settings2 }
const brandLinks: SidebarLink[] = [{ to: '/report-view', label: 'Report Viewer', Icon: Eye }]

export const Sidebar = ({ role }: SidebarProps) => {
  const navigate = useNavigate()
  const links =
    role === 'brand'
      ? brandLinks
      : role === 'admin'
        ? [...baseLinks, settingsLink]
        : baseLinks

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-title">Fixated Dashboard</div>
        <div className="brand-sub">Performance Dashboard</div>
      </div>
      <nav className="nav-group">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <span className="nav-link-icon">
              <link.Icon size={18} strokeWidth={1.5} aria-hidden="true" />
            </span>
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="card compact">
        <div className="section-title">Quick Actions</div>
        <div className="section-subtitle">Two-click access</div>
        <div className="filter-bar" style={{ marginTop: '12px' }}>
          {role === 'brand' ? (
            <button className="primary-button" onClick={() => navigate('/report-view')}>
              Open Shared Report
            </button>
          ) : (
            <>
              <button className="primary-button" onClick={() => navigate('/reports')}>
                Export Brand Report
              </button>
              <button className="ghost-button" onClick={() => navigate('/campaigns')}>
                View Campaign ROI
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
