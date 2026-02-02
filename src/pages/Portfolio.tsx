import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { MetricCard } from '../components/ui/MetricCard'
import { SectionHeader } from '../components/ui/SectionHeader'
import { portfolioKpis, portfolioSeries, topChannels } from '../data/mock'
import { formatNumber, formatPercent, formatThousands } from '../utils/format'

export const Portfolio = () => {
  return (
    <>
      <SectionHeader
        title="All Channels Performance"
        subtitle="Unified portfolio view with campaign-ready insights."
        actions={<button className="primary-button">Export brand report</button>}
      />

      <div className="grid grid-4">
        {portfolioKpis.map((kpi) => (
          <MetricCard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      <div className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Combined Views Over Time</div>
            <div className="section-subtitle">Daily performance with engagement overlay.</div>
          </div>
          <div className="filter-bar">
            <span className="filter-chip">Daily</span>
            <span className="filter-chip">Weekly</span>
            <span className="filter-chip">Monthly</span>
          </div>
        </div>
        <div style={{ height: '280px', marginTop: '16px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={portfolioSeries}>
              <defs>
                <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} />
              <Tooltip
                formatter={(value: number) => [`${value}M`, 'Views']}
                labelStyle={{ color: 'var(--muted)' }}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                }}
              />
              <Area type="monotone" dataKey="views" stroke="var(--primary)" fill="url(#viewsFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <SectionHeader
            title="Top Contributing Channels"
            subtitle="Channels driving the latest performance spike."
          />
          <table className="data-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Platform</th>
                <th>Views</th>
                <th>Eng. Rate</th>
              </tr>
            </thead>
            <tbody>
              {topChannels.map((channel) => (
                <tr key={channel.id}>
                  <td>{channel.name}</td>
                  <td>{channel.platform}</td>
                  <td>{formatNumber(channel.views)}</td>
                  <td>{formatPercent(channel.engagementRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <SectionHeader
            title="Filters"
            subtitle="Use filters to isolate platform, group, or campaign."
          />
          <div className="filter-bar">
            <span className="filter-chip">All platforms</span>
            <span className="filter-chip">All channel groups</span>
            <span className="filter-chip">Jan 1 - Feb 2</span>
            <span className="filter-chip">Campaign: All</span>
          </div>
          <div style={{ marginTop: '18px' }}>
            <div className="split">
              <div>
                <div className="section-title">Portfolio totals</div>
                <div className="section-subtitle">Selected range totals</div>
              </div>
              <div className="pill success">+9.2% lift</div>
            </div>
            <div className="grid grid-2" style={{ marginTop: '16px' }}>
              <div className="card compact">
                <div className="kpi-label">Views</div>
                <div className="kpi-value">{formatNumber(428_600_000)}</div>
              </div>
              <div className="card compact">
                <div className="kpi-label">Engagements</div>
                <div className="kpi-value">{formatNumber(18_900_000)}</div>
              </div>
              <div className="card compact">
                <div className="kpi-label">Posts</div>
                <div className="kpi-value">{formatThousands(3_642)}</div>
              </div>
              <div className="card compact">
                <div className="kpi-label">Watch Time</div>
                <div className="kpi-value">9.4M hrs</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
