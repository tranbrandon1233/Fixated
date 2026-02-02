interface ProgressBarProps {
  value: number
}

export const ProgressBar = ({ value }: ProgressBarProps) => {
  const safeValue = Math.min(100, Math.max(0, value))
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${safeValue}%` }} />
    </div>
  )
}
