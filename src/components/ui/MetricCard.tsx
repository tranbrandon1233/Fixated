import type { KPI } from '../../types/dashboard'

interface MetricCardProps {
  kpi: KPI
}

export const MetricCard = ({ kpi }: MetricCardProps) => {
  return (
    <div className="card">
      <div className="kpi">
        <div className="kpi-label">{kpi.label}</div>
        <div className="kpi-value">{kpi.value}</div>
        {kpi.trend ? <div className="kpi-trend">{kpi.trend}</div> : null}
      </div>
    </div>
  )
}
