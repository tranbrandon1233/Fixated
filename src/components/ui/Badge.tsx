interface BadgeProps {
  tone?: 'default' | 'success' | 'warning' | 'danger'
  label: string
}

export const Badge = ({ tone = 'default', label }: BadgeProps) => {
  const className = ['pill', tone !== 'default' ? tone : ''].filter(Boolean).join(' ')
  return <span className={className}>{label}</span>
}
