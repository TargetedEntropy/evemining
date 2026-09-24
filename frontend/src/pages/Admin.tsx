import { useQuery, useQueryClient } from '@tanstack/react-query'
import SortTable, { type Column } from '../components/SortTable'
import { ago, dayYear, int } from '../lib/format'
import { api, type AdminOverview, type User } from '../lib/api'

type Row = AdminOverview['users'][number]

export default function Admin({ user }: { user: User }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['admin'], queryFn: api.adminOverview })
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] })

  const columns: Column<Row>[] = [
    {
      key: 'primary',
      label: 'Account',
      sort: (r) => r.primary ?? '',
      render: (r) => (
        <div className="stack" style={{ display: 'flex', flexDirection: 'column' }}>
          <span>
            {r.primary ?? `User ${r.id}`}
            {r.is_admin && <span className="muted"> (admin)</span>}
          </span>
          <small className="muted">Joined {dayYear(r.created_at.slice(0, 10))}</small>
        </div>
      ),
    },
    { key: 'alts', label: 'Alts', align: 'r', sort: (r) => r.characters.length, render: (r) => r.characters.length },
    {
      key: 'broken',
      label: 'Needs login',
      align: 'r',
      sort: (r) => r.characters.filter((c) => !c.token_valid).length,
      render: (r) => r.characters.filter((c) => !c.token_valid).length || <span className="muted">0</span>,
    },
    {
      key: 'sync',
      label: 'Latest sync',
      align: 'r',
      render: (r) => {
        const latest = r.characters.map((c) => c.last_synced_at).filter(Boolean).sort().pop() ?? null
        return ago(latest)
      },
    },
    {
      key: 'actions',
      label: <span className="visually-hidden">Actions</span>,
      align: 'r',
      render: (r) =>
        r.id === user.id ? (
          <span className="muted">You</span>
        ) : (
          <div className="row-actions">
            <button className="btn btn-quiet btn-small" onClick={() => api.adminToggle(r.id).then(refresh)}>
              {r.is_admin ? 'Remove admin' : 'Make admin'}
            </button>
            <button
              className="btn btn-danger btn-small"
              onClick={() => confirm(`Delete ${r.primary ?? 'this account'} and all its data?`) && api.adminDelete(r.id).then(refresh)}
            >
              Delete
            </button>
          </div>
        ),
    },
  ]

  if (!data) return <div className="skeleton" style={{ height: 320 }} />

  return (
    <>
      <h1 className="page-title">Admin</h1>
      <p className="page-lede">
        {data.users.length} accounts, {data.users.reduce((s, u) => s + u.characters.length, 0)} alts, {int(data.ledger_rows)} ledger rows.{' '}
        {data.invalid_tokens > 0 && `${data.invalid_tokens} alts need to log in again.`}
      </p>
      <SortTable caption="Accounts" rows={data.users} columns={columns} rowKey={(r) => r.id} initialSort="alts" />

      <section className="section">
        <div className="section-head">
          <h2>Admin actions</h2>
        </div>
        {data.audit.length ? (
          <ul className="facts-list" style={{ listStyle: 'none', padding: 0 }}>
            {data.audit.map((a, i) => (
              <li key={i} style={{ padding: '10px 0', borderTop: '1px solid var(--rule)' }}>
                <b>{a.admin}</b> {a.details} <span className="muted">(user {a.target_id}, {ago(a.timestamp)})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sub">No admin actions yet.</p>
        )}
      </section>
    </>
  )
}
