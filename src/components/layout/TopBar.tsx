import type { Role } from '../../types/dashboard'

interface TopBarProps {
  title: string
  role: Role
  roleLabel: string
  roleOptions: Role[]
  themeMode: 'light' | 'dark'
  onRoleChange: (role: Role) => void
  onToggleTheme: () => void
}

export const TopBar = ({
  title,
  role,
  roleLabel,
  roleOptions,
  themeMode,
  onRoleChange,
  onToggleTheme,
}: TopBarProps) => {
  return (
    <header className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="filter-bar">
        <span className="filter-chip">Data refreshed 2 hrs ago</span>
        <button className="ghost-button" onClick={onToggleTheme}>
          Theme: {themeMode === 'dark' ? 'Dark' : 'Light'}
        </button>
        <label className="filter-chip">
          Role:
          <select
            value={role}
            onChange={(event) => onRoleChange(event.target.value as Role)}
            style={{
              marginLeft: '8px',
              border: 'none',
              background: 'transparent',
            }}
          >
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {option === 'admin' ? 'Admin' : option === 'brand' ? 'Brand Viewer' : 'Internal'}
              </option>
            ))}
          </select>
        </label>
        <span className="filter-chip">{roleLabel}</span>
      </div>
    </header>
  )
}
