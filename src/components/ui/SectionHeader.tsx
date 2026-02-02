import type { ReactNode } from 'react'

interface SectionHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

export const SectionHeader = ({ title, subtitle, actions }: SectionHeaderProps) => {
  return (
    <div className="section-header">
      <div>
        <div className="section-title">{title}</div>
        {subtitle ? <div className="section-subtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div>{actions}</div> : null}
    </div>
  )
}
