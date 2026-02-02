import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '../components/ui/Badge'
import { SectionHeader } from '../components/ui/SectionHeader'
import { ageDistribution, genderDistribution, topChannels, topGeos, topPosts } from '../data/mock'
import { formatNumber, formatPercent } from '../utils/format'

export const Channel = () => {
  const channel = topChannels[0]

  return (
    <>
      <SectionHeader
        title={`${channel.name} (${channel.platform})`}
        subtitle="Per-channel drilldown with audience insights."
        actions={<Badge tone="success" label={channel.status} />}
      />

      <div className="grid grid-3">
        <div className="card">
          <div className="kpi-label">Total Views</div>
          <div className="kpi-value">{formatNumber(channel.views)}</div>
          <div className="kpi-trend">+14.8% vs portfolio average</div>
        </div>
        <div className="card">
          <div className="kpi-label">Engagement Rate</div>
          <div className="kpi-value">{formatPercent(channel.engagementRate)}</div>
          <div className="kpi-trend">+1.2 pts above average</div>
        </div>
        <div className="card">
          <div className="kpi-label">Followers</div>
          <div className="kpi-value">{formatNumber(channel.followers)}</div>
          <div className="kpi-trend">+38K in last 30 days</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <SectionHeader title="Views over time" subtitle="Weekly channel performance." />
          <div style={{ height: '260px', marginTop: '16px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ageDistribution}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [`${value}%`, 'Share']}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                  }}
                />
                <Bar dataKey="value" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <SectionHeader title="Top posts" subtitle="Ranked by views and engagement rate." />
          <table className="data-table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Platform</th>
                <th>Views</th>
                <th>Eng. Rate</th>
                <th>Campaign</th>
              </tr>
            </thead>
            <tbody>
              {topPosts.map((post) => (
                <tr key={post.id}>
                  <td>{post.title}</td>
                  <td>{post.platform}</td>
                  <td>{formatNumber(post.views)}</td>
                  <td>{formatPercent(post.engagementRate)}</td>
                  <td>{post.campaignTag ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card">
          <SectionHeader title="Age Distribution" subtitle="Audience age bands." />
          <div className="filter-bar">
            {ageDistribution.map((item) => (
              <span key={item.label} className="filter-chip">
                {item.label}: {item.value}%
              </span>
            ))}
          </div>
        </div>
        <div className="card">
          <SectionHeader title="Gender" subtitle="Audience gender split." />
          <div className="filter-bar">
            {genderDistribution.map((item) => (
              <span key={item.label} className="filter-chip">
                {item.label}: {item.value}%
              </span>
            ))}
          </div>
        </div>
        <div className="card">
          <SectionHeader title="Top Geos" subtitle="Top countries/cities." />
          <div className="filter-bar">
            {topGeos.map((item) => (
              <span key={item.label} className="filter-chip">
                {item.label}: {item.value}%
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
