import { Link } from 'react-router-dom'
import SortTable, { type Column } from '../components/SortTable'
import type { MineralRow, Summary, User } from '../lib/api'
import { int, isk, pct, short, typeIcon } from '../lib/format'
import { useStats } from '../lib/hooks'

export default function Refining({ user }: { user: User }) {
  const minerals = useStats<MineralRow[]>('minerals')
  const summary = useStats<Summary>('summary')
  const rows = minerals.data ?? []
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0)
  const t = summary.data?.totals
  const gain = t && t.value ? t.refined / t.value - 1 : null

  const columns: Column<MineralRow>[] = [
    {
      key: 'name',
      label: 'Material',
      sort: (r) => r.name ?? '',
      render: (r) => (
        <div className="cell-main">
          <img className="type-icon" src={typeIcon(r.type_id)} alt="" loading="lazy" />
          <span>{r.name ?? r.type_id}</span>
        </div>
      ),
    },
    { key: 'qty', label: 'Quantity', align: 'r', sort: (r) => r.quantity, render: (r) => int(r.quantity) },
    { key: 'unit', label: 'Jita price', align: 'r', className: 'hide-sm', sort: (r) => (r.value ?? 0) / (r.quantity || 1), render: (r) => (r.value ? `${short(r.value / r.quantity)} ISK` : '–') },
    {
      key: 'value',
      label: 'Value',
      align: 'r',
      sort: (r) => r.value ?? 0,
      render: (r) => (
        <div className="share">
          <span>{r.value ? isk(r.value) : '–'}</span>
          <span className="muted hide-sm" style={{ minWidth: 36 }}>
            {total && r.value ? pct(r.value / total) : ''}
          </span>
        </div>
      ),
      foot: isk(total),
    },
  ]

  return (
    <>
      <h1 className="page-title">Refining</h1>
      <p className="page-lede">
        What this range's ore becomes after reprocessing at {pct(user.reprocess_yield, 1)} yield, priced at Jita{' '}
        {user.price_basis}.{' '}
        {gain !== null &&
          (gain >= 0
            ? `Refining is worth ${pct(gain, 1)} more than selling the ore as mined.`
            : `Selling the ore as mined is worth ${pct(-gain, 1)} more than refining it.`)}{' '}
        <Link to="/settings" className="linkish">
          Change yield
        </Link>
      </p>
      {minerals.data ? (
        rows.length ? (
          <SortTable caption="Refined materials" rows={rows} columns={columns} rowKey={(r) => r.type_id} initialSort="value" />
        ) : (
          <div className="empty">
            <h2>Nothing to refine in this range</h2>
            <p>Gas doesn't reprocess, and ranges without mining have nothing to show.</p>
          </div>
        )
      ) : (
        <div className="skeleton" style={{ height: 320 }} />
      )}
    </>
  )
}
