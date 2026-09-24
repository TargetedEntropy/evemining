import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Sparkline } from '../components/charts'
import Portrait from '../components/Portrait'
import SortTable, { type Column } from '../components/SortTable'
import { api, type AltStats, type User } from '../lib/api'
import { ago, day, daysSince, isk, m3, pct } from '../lib/format'
import { useRange, useStats } from '../lib/hooks'

function Status({ alt }: { alt: AltStats }) {
  if (!alt.token_valid)
    return (
      <span className="status bad">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 3.2v3.4M6 8.2v.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Needs login
      </span>
    )
  if (alt.last_error)
    return (
      <span className="status" title={alt.last_error}>
        Retrying, synced {ago(alt.last_synced_at)}
      </span>
    )
  return (
    <span className="status">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="var(--good)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {alt.last_synced_at ? `Synced ${ago(alt.last_synced_at)}` : 'First sync running'}
    </span>
  )
}

export default function Alts({ user }: { user: User }) {
  const range = useRange()
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const alts = useStats<AltStats[]>('characters')
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const addedId = Number(params.get('added') || params.get('updated') || 0)
  const added = user.characters.find((c) => c.character_id === addedId)
  const rows = alts.data ?? []
  const total = rows.reduce((s, r) => s + r[range.measure], 0)
  const maxV = Math.max(1, ...rows.map((r) => r[range.measure]))

  const act = async (id: number, fn: () => Promise<unknown>) => {
    setBusy(id)
    setError(null)
    try {
      const result = await fn()
      if (result && typeof result === 'object' && 'characters' in result) qc.setQueryData(['me'], result)
      await qc.invalidateQueries({ queryKey: ['stats'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work')
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<AltStats>[] = [
    {
      key: 'name',
      label: 'Alt',
      sort: (r) => r.name,
      render: (r) => (
        <div className="cell-main">
          <Portrait id={r.character_id} name={r.name} large />
          <div className="stack">
            <span>
              {r.name}
              {r.character_id === user.primary_character_id && <span className="muted"> (main)</span>}
            </span>
            <small>{[r.corporation_name, r.alliance_name].filter(Boolean).join(', ') || ' '}</small>
          </div>
        </div>
      ),
    },
    { key: 'status', label: 'ESI', render: (r) => <Status alt={r} />, className: 'hide-sm' },
    {
      key: 'value',
      label: range.measure === 'value' ? 'Value' : 'Volume',
      align: 'r',
      sort: (r) => r[range.measure],
      render: (r) => (
        <div className="share">
          <span title={total ? `${pct(r[range.measure] / total)} of the total` : undefined}>
            {range.measure === 'value' ? isk(r.value) : m3(r.m3)}
          </span>
          <div className="bar-track hide-sm" aria-hidden="true">
            <div className="bar-fill" style={{ width: `${(r[range.measure] / maxV) * 100}%` }} />
          </div>
        </div>
      ),
      foot: range.measure === 'value' ? isk(total) : m3(total),
    },
    {
      key: 'last',
      label: 'Last mined',
      align: 'r',
      sort: (r) => -(daysSince(r.last_mined) ?? 1e9),
      render: (r) => {
        const d = daysSince(r.last_mined)
        return (
          <>
            {r.last_mined ? <span title={day(r.last_mined)}>{d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`}</span> : <span className="muted">Never</span>}
            <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>
              {r.active_days} mining {r.active_days === 1 ? 'day' : 'days'}
            </span>
          </>
        )
      },
    },
    { key: 'ore', label: 'Main ore', className: 'hide-sm', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.top_ore ?? '–'}</span> },
    { key: 'trend', label: 'Trend', className: 'hide-sm', render: (r) => <Sparkline values={r.daily} width={72} /> },
    {
      key: 'actions',
      label: <span className="visually-hidden">Actions</span>,
      align: 'r',
      render: (r) => (
        <div className="row-actions">
          {!r.token_valid ? (
            <a className="btn btn-primary btn-small" href="/auth/login">
              Log in again
            </a>
          ) : (
            <button className="btn btn-quiet btn-small hide-sm" disabled={busy === r.character_id} onClick={() => act(r.character_id, () => api.syncCharacter(r.character_id))}>
              Sync
            </button>
          )}
          {r.character_id !== user.primary_character_id && (
            <button className="linkish hide-sm" disabled={busy === r.character_id} onClick={() => act(r.character_id, () => api.setPrimary(r.character_id))}>
              Make main
            </button>
          )}
          {user.characters.length > 1 && (
            <button
              className="linkish"
              disabled={busy === r.character_id}
              onClick={() => {
                if (confirm(`Remove ${r.name}? Their mining history is deleted from Strata.`)) act(r.character_id, () => api.removeCharacter(r.character_id))
              }}
            >
              Remove
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <div className="section-head" style={{ marginBottom: 32 }}>
        <div>
          <h1 className="page-title">Alts</h1>
          <p className="page-lede" style={{ margin: 0 }}>
            Every character linked to your account. Strata reads each one's mining ledger and keeps it past ESI's 30-day
            limit.
          </p>
        </div>
        <a className="btn btn-primary" href="/auth/login">
          Add an alt
        </a>
      </div>

      {added && (
        <div className="notice" role="status">
          <p>
            <b>{added.name}</b> is linked. EVE's login remembers your account, so the next alt takes two clicks.
          </p>
          <a className="btn btn-primary btn-small" href="/auth/login">
            Add another
          </a>
          <button className="linkish" onClick={() => setParams({}, { replace: true })}>
            Done
          </button>
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}

      {alts.data ? (
        <SortTable caption="Alts" rows={rows} columns={columns} rowKey={(r) => r.character_id} initialSort="value" />
      ) : (
        <div className="skeleton" style={{ height: 320 }} />
      )}
    </>
  )
}
