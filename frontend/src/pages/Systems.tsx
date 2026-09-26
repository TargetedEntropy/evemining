import Sec from '../components/Sec'
import SortTable, { type Column } from '../components/SortTable'
import type { SystemRow } from '../lib/api'
import { day, isk, m3, pct, securityBand } from '../lib/format'
import { useStats } from '../lib/hooks'

export default function Systems() {
  const systems = useStats<SystemRow[]>('systems')
  const rows = systems.data ?? []
  const totalValue = rows.reduce((s, r) => s + r.value, 0)

  const bands = ['High-sec', 'Low-sec', 'Null-sec']
    .map((b) => ({ band: b, value: rows.filter((r) => securityBand(r.security) === b).reduce((s, r) => s + r.value, 0) }))
    .filter((b) => b.value > 0)

  const columns: Column<SystemRow>[] = [
    {
      key: 'name',
      label: 'System',
      sort: (r) => r.name ?? '',
      render: (r) => (
        <div className="stack" style={{ display: 'flex', flexDirection: 'column' }}>
          <span>
            <Sec sec={r.security} /> {r.name ?? r.system_id}
          </span>
          <small className="muted" style={{ fontSize: 12.5 }}>
            {r.region}, {securityBand(r.security).toLowerCase()}
          </small>
        </div>
      ),
    },
    { key: 'm3', label: 'Volume', align: 'r', sort: (r) => r.m3, render: (r) => m3(r.m3) },
    {
      key: 'value',
      label: 'Value',
      align: 'r',
      sort: (r) => r.value,
      render: (r) => (
        <div className="share">
          <span>{isk(r.value)}</span>
          <span className="muted hide-sm" style={{ minWidth: 36 }}>
            {totalValue ? pct(r.value / totalValue) : ''}
          </span>
        </div>
      ),
    },
    { key: 'days', label: 'Mining days', align: 'r', className: 'hide-sm', sort: (r) => r.active_days, render: (r) => r.active_days },
    { key: 'alts', label: 'Alts', align: 'r', className: 'hide-sm', sort: (r) => r.characters, render: (r) => r.characters },
    { key: 'last', label: 'Last mined', align: 'r', sort: (r) => r.last_mined, render: (r) => day(r.last_mined) },
  ]

  return (
    <>
      <h1 className="page-title">Systems</h1>
      <p className="page-lede">
        Where the mining happened.
        {bands.length > 1 &&
          ` ${bands
            .sort((a, b) => b.value - a.value)
            .map((b, i) => (i === 0 ? `${pct(b.value / totalValue)} of the value came from ${b.band.toLowerCase()}` : `${pct(b.value / totalValue)} from ${b.band.toLowerCase()}`))
            .join(', ')}.`}
      </p>
      {systems.data ? (
        rows.length ? (
          <SortTable caption="Systems mined in" rows={rows} columns={columns} rowKey={(r) => r.system_id} initialSort="value" />
        ) : (
          <div className="empty">
            <h2>No mining in this range</h2>
            <p>Pick a longer range above.</p>
          </div>
        )
      ) : (
        <div className="skeleton" style={{ height: 320 }} />
      )}
    </>
  )
}
