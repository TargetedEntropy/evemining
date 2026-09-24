import { useState } from 'react'
import { classColor } from '../components/charts'
import SortTable, { type Column } from '../components/SortTable'
import type { OreRow } from '../lib/api'
import { CLASS_LABEL, int, isk, m3, pct, short, typeIcon } from '../lib/format'
import { useStats } from '../lib/hooks'

function OreIcon({ id }: { id: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="type-icon" aria-hidden="true" />
  return <img className="type-icon" src={typeIcon(id)} alt="" loading="lazy" onError={() => setFailed(true)} />
}

export default function Ores() {
  const ores = useStats<OreRow[]>('ores')
  const rows = ores.data ?? []
  const sum = (k: keyof OreRow) => rows.reduce((s, r) => s + (r[k] as number), 0)
  const totalValue = sum('value')

  const columns: Column<OreRow>[] = [
    {
      key: 'name',
      label: 'Ore',
      sort: (r) => r.type_name ?? '',
      render: (r) => (
        <div className="cell-main">
          <OreIcon id={r.type_id} />
          <div className="stack">
            <span>{r.type_name ?? `Type ${r.type_id}`}</span>
            <small style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="dot" style={{ ['--sw' as string]: classColor(r.ore_class) }} />
              {CLASS_LABEL[r.ore_class]}
              {r.moon_rarity ? `, R${r.moon_rarity}` : ''}
            </small>
          </div>
        </div>
      ),
      foot: `${rows.length} ore types`,
    },
    { key: 'units', label: 'Units', align: 'r', className: 'hide-sm', sort: (r) => r.units, render: (r) => int(r.units), foot: short(sum('units')) },
    { key: 'm3', label: 'Volume', align: 'r', sort: (r) => r.m3, render: (r) => m3(r.m3), foot: m3(sum('m3')) },
    {
      key: 'value',
      label: 'Ore value',
      align: 'r',
      sort: (r) => r.value,
      render: (r) => (
        <>
          {isk(r.value)}
          <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
            {totalValue ? pct(r.value / totalValue, 1) : ''}
          </span>
        </>
      ),
      foot: isk(totalValue),
    },
    {
      key: 'refined',
      label: 'Refined value',
      align: 'r',
      sort: (r) => r.refined,
      render: (r) => {
        const gain = r.value ? r.refined / r.value - 1 : 0
        return (
          <>
            {isk(r.refined)}
            {Math.abs(gain) >= 0.005 && (
              <span className={gain > 0 ? 'better' : 'muted'} style={{ display: 'block', fontSize: 12.5 }}>
                {gain > 0 ? `Refine, +${pct(gain, 1)}` : `Sell ore, ${pct(-gain, 1)} better`}
              </span>
            )}
          </>
        )
      },
      foot: isk(sum('refined')),
    },
    {
      key: 'then',
      label: 'Since mined',
      align: 'r',
      className: 'hide-sm',
      sort: (r) => (r.value_then ? r.value / r.value_then - 1 : 0),
      render: (r) => {
        if (!r.value_then) return <span className="muted">–</span>
        const d = r.value / r.value_then - 1
        if (Math.abs(d) < 0.005) return <span className="muted">Flat</span>
        return <span style={{ color: d > 0 ? 'var(--good)' : 'var(--bad)' }}>{`${d > 0 ? '▲' : '▼'} ${pct(Math.abs(d), 1)}`}</span>
      },
    },
    { key: 'alts', label: 'Alts', align: 'r', className: 'hide-sm', sort: (r) => r.characters, render: (r) => r.characters },
  ]

  return (
    <>
      <h1 className="page-title">Ores</h1>
      <p className="page-lede">
        Every ore type your alts pulled in this range, valued at Jita today and as refined minerals at your yield. Where
        refining pays more, the refined column says so.
      </p>
      {ores.data ? (
        rows.length ? (
          <SortTable caption="Ores mined" rows={rows} columns={columns} rowKey={(r) => r.type_id} initialSort="value" />
        ) : (
          <div className="empty">
            <h2>No ore in this range</h2>
            <p>Pick a longer range above, or check the alt filter.</p>
          </div>
        )
      ) : (
        <div className="skeleton" style={{ height: 320 }} />
      )}
    </>
  )
}
