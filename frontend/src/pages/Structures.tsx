import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RegionPicker, SystemPicker } from '../components/Pickers'
import Sec from '../components/Sec'
import { api, structuresApi, type PlaceRow, type User } from '../lib/api'
import { ago, pct, typeIcon } from '../lib/format'

const SKILLS = [
  { id: '1.4472', label: 'Max skills, 4% implant' },
  { id: '1.3915', label: 'Max skills' },
  { id: '1.3064', label: 'Level IV skills' },
  { id: '1', label: 'Structure only' },
]

const SERVICES = [
  { id: 'reprocessing', label: 'Reprocessing' },
  { id: 'market', label: 'Market' },
  { id: 'manufacturing', label: 'Manufacturing' },
  { id: 'any', label: 'Anything' },
]

const SORTS = [
  { id: 'best', label: 'Best' },
  { id: 'jumps', label: 'Closest' },
  { id: 'yield', label: 'Yield' },
  { id: 'tax', label: 'Tax' },
]

const RIG = ['no rig', 'T1 rig', 'T2 rig']

function StatusNote({ r }: { r: PlaceRow }) {
  const s = r.reprocessing.status
  const text =
    s === 'confirmed'
      ? 'Reprocessing confirmed'
      : s === 'likely'
        ? 'Refinery, reprocessing likely'
        : s === 'possible'
          ? 'Could fit reprocessing, unconfirmed'
          : s === 'npc'
            ? 'NPC reprocessing plant'
            : s === 'none'
              ? 'Reported: no reprocessing'
              : ''
  return text ? <small>{text}</small> : null
}

function Access({ r, access, checking, checkers }: { r: PlaceRow; access?: Record<string, boolean>; checking: boolean; checkers: { character_id: number; name: string }[] }) {
  if (r.kind === 'station') return <span className="muted">Open to all</span>
  if (!checkers.length) return <span className="muted">Not checked</span>
  if (!access) return <span className="muted">{checking ? 'Checking' : 'Not checked'}</span>
  const ok = checkers.filter((c) => access[c.character_id])
  if (ok.length)
    return (
      <span className="status">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="var(--good)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {ok.length === checkers.length ? 'You can dock' : `${ok[0].name} can dock`}
      </span>
    )
  return (
    <span className="status bad">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      Access denied
    </span>
  )
}

function Details({ r, mult, user, onReported }: { r: PlaceRow; mult: number; user: User; onReported: () => void }) {
  const qc = useQueryClient()
  const rp = r.reprocessing
  const [hasRepro, setHasRepro] = useState<string>('')
  const [rig, setRig] = useState<string>('')
  const [tax, setTax] = useState<string>('')
  const [msg, setMsg] = useState<string | null>(null)
  const exact = Math.abs(rp.yield_min - rp.yield_max) < 1e-6
  const yours = rp.yield_max * mult

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (tax !== '' && !(Number(tax) >= 0 && Number(tax) <= 100)) {
      setMsg('Tax is a percentage between 0 and 100.')
      return
    }
    try {
      await structuresApi.report(r.id, {
        has_reprocessing: hasRepro === '' ? null : hasRepro === 'yes',
        rig_tier: rig === '' ? null : Number(rig),
        tax: tax === '' ? null : Number(tax) / 100,
      })
      setMsg('Report saved. Thanks, everyone searching nearby now sees it.')
      onReported()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Report failed')
    }
  }

  const useYield = async () => {
    const next = await api.saveSettings({ reprocess_yield: Math.round(yours * 1000) / 1000, price_basis: user.price_basis })
    qc.setQueryData(['me'], next)
    await qc.invalidateQueries({ queryKey: ['stats'] })
    setMsg(`Valuations now use ${pct(yours, 1)}.`)
  }

  return (
    <div className="place-details">
      <div>
        <h3>How the yield is worked out</h3>
        {r.kind === 'station' ? (
          <p className="sub">
            NPC station base efficiency is {pct(rp.yield_max, 0)} and tax {pct(rp.tax ?? 0, 1)}, both from the static data export.
            Standings with {r.owner_name ?? 'the owner'} lower the tax in game.
          </p>
        ) : (
          <dl className="calc">
            <dt>Rig</dt>
            <dd>{rp.rig_tier === null ? 'Unknown, so a range from no rig to T2' : `${RIG[rp.rig_tier]}, reported`}</dd>
            <dt>Security</dt>
            <dd>
              <Sec sec={r.security} /> {r.security >= 0.45 ? 'high-sec, rig ×1.00' : r.security > 0 ? 'low-sec, rig ×1.06' : 'null-sec, rig ×1.12'}
            </dd>
            <dt>Hull</dt>
            <dd>
              {r.type_name}
              {r.group_name === 'Refinery' || (r.type_name ?? '').includes('Fortizar') ? ', refining bonus from the SDE' : ', no refining bonus'}
            </dd>
            <dt>Your skills</dt>
            <dd>×{mult.toFixed(4)}</dd>
            <dt>Tax</dt>
            <dd>{rp.tax === null ? 'Unknown. ESI does not publish structure taxes.' : `${pct(rp.tax, 1)}, reported`}</dd>
          </dl>
        )}
        {r.report && (
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            Last report by {r.report.reporter ?? 'a pilot'}, {ago(r.report.reported_at)}. {r.report.reports} {r.report.reports === 1 ? 'report' : 'reports'} in total.
          </p>
        )}
        {(exact || r.kind === 'station') && (
          <button className="btn btn-quiet btn-small" style={{ marginTop: 12 }} onClick={useYield}>
            Use {pct(yours, 1)} for my valuations
          </button>
        )}
      </div>
      {r.kind === 'structure' && (
        <form onSubmit={submit} className="report-form">
          <h3>Report what you see in game</h3>
          <p className="sub">ESI can't see services, rigs, or tax. Reports from pilots fill that in for everyone.</p>
          <label>
            Reprocessing
            <select value={hasRepro} onChange={(e) => setHasRepro(e.target.value)}>
              <option value="">Not sure</option>
              <option value="yes">Online</option>
              <option value="no">Not available</option>
            </select>
          </label>
          <label>
            Rig
            <select value={rig} onChange={(e) => setRig(e.target.value)}>
              <option value="">Not sure</option>
              <option value="0">No reprocessing rig</option>
              <option value="1">T1 rig</option>
              <option value="2">T2 rig</option>
            </select>
          </label>
          <label>
            Tax
            <span className="input-suffix">
              <input inputMode="decimal" placeholder="Not sure" value={tax} onChange={(e) => setTax(e.target.value.replace(/[^0-9.]/g, ''))} />
              <span>%</span>
            </span>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-primary btn-small" type="submit" disabled={hasRepro === '' && rig === '' && tax === ''}>
              Save report
            </button>
            {msg && <span className="sub" style={{ fontSize: 13 }}>{msg}</span>}
          </div>
        </form>
      )}
      {r.kind === 'station' && msg && <p className="sub">{msg}</p>}
    </div>
  )
}

export default function Structures({ user }: { user: User }) {
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        for (const [k, v] of Object.entries(patch)) v === null || v === '' ? n.delete(k) : n.set(k, v)
        n.delete('granted')
        n.delete('error')
        return n
      },
      { replace: true },
    )

  const mode = params.get('mode') === 'regions' ? 'regions' : 'near'
  const origin = Number(params.get('origin')) || null
  const jumps = Math.min(40, Math.max(0, Number(params.get('jumps') ?? 10)))
  const route = params.get('route') === 'highsec' ? 'highsec' : 'shortest'
  const regionIds = (params.get('regions') ?? '').split(',').map(Number).filter(Boolean)
  const service = SERVICES.some((s) => s.id === params.get('service')) ? params.get('service')! : 'reprocessing'
  const stations = params.get('stations') !== '0'
  const unconfirmed = params.get('unconfirmed') === '1'
  const sort = SORTS.some((s) => s.id === params.get('sort')) ? params.get('sort')! : 'best'
  const skills = SKILLS.some((s) => s.id === params.get('skills')) ? params.get('skills')! : '1.4472'
  const mult = Number(skills)
  const [jumpDraft, setJumpDraft] = useState(jumps)
  useEffect(() => setJumpDraft(jumps), [jumps])

  const status = useQuery({ queryKey: ['structure-status'], queryFn: structuresApi.status })
  const systems = useQuery({ queryKey: ['systems'], queryFn: structuresApi.systems, staleTime: Infinity })
  const regions = useQuery({ queryKey: ['regions'], queryFn: structuresApi.regions, staleTime: 3600_000 })
  const regionNames = useMemo(() => new Map((regions.data ?? []).map((r) => [r.region_id, r.name])), [regions.data])
  const systemName = systems.data?.find((s) => s[0] === origin)?.[1]

  const ready = mode === 'near' ? origin !== null : regionIds.length > 0
  const qs = new URLSearchParams({ service, stations: String(stations), unconfirmed: String(unconfirmed), sort })
  if (mode === 'near' && origin) {
    qs.set('origin', String(origin))
    qs.set('jumps', String(jumps))
    qs.set('route', route)
  } else qs.set('regions', regionIds.join(','))

  const results = useQuery({
    queryKey: ['structure-search', qs.toString()],
    queryFn: () => structuresApi.search(qs.toString()),
    enabled: ready,
    placeholderData: (prev) => prev,
  })

  const checkers = status.data?.checkers ?? []
  const structureIds = (results.data?.results ?? []).filter((r) => r.kind === 'structure').slice(0, 60).map((r) => r.id)
  const access = useQuery({
    queryKey: ['structure-access', structureIds.join(',')],
    queryFn: () => structuresApi.access(structureIds),
    enabled: checkers.length > 0 && structureIds.length > 0,
    staleTime: 600_000,
  })

  const [open, setOpen] = useState<number | null>(null)
  const [shown, setShown] = useState(25)
  useEffect(() => setShown(25), [qs.toString()])
  const granted = params.get('granted')
  const error = params.get('error')
  const rows = results.data?.results ?? []

  return (
    <>
      <h1 className="page-title">Structures</h1>
      <p className="page-lede">
        Find somewhere to refine, trade, or build. Public Upwell structures come from ESI, NPC stations from the static data, and
        every place is ranked by what you keep after tax.
      </p>

      {error && <div className="error-banner">{error}</div>}
      {granted && checkers.length > 0 && (
        <div className="notice" role="status">
          <p>
            Structure lookup is on for {checkers.map((c) => c.name).join(', ')}. Public structures are being read from ESI now; results
            fill in over the next minute.
          </p>
        </div>
      )}
      {status.data && checkers.length === 0 && (
        <div className="notice">
          <p>
            Grant structure lookup on one alt so Strata can check where you're allowed to dock.
            {status.data.resolved === 0 && ' Until someone does, only NPC stations can be listed.'}
          </p>
          <a className="btn btn-primary btn-small" href="/auth/login?grant=structures">
            Grant structure lookup
          </a>
        </div>
      )}

      <section className="finder" aria-label="Search">
        <div className="finder-row">
          <div className="segmented" role="group" aria-label="Search by">
            <button aria-pressed={mode === 'near'} onClick={() => set({ mode: null })}>
              Near a system
            </button>
            <button aria-pressed={mode === 'regions'} onClick={() => set({ mode: 'regions' })}>
              In regions
            </button>
          </div>
        </div>

        {mode === 'near' ? (
          <div className="finder-row near">
            <div className="field-inline grow">
              <span className="label">From</span>
              {systems.data ? (
                <SystemPicker systems={systems.data} regionNames={regionNames} value={origin} onChange={(id) => set({ origin: String(id) })} />
              ) : (
                <div className="skeleton" style={{ height: 38, flex: 1 }} />
              )}
            </div>
            <div className="field-inline">
              <label className="label" htmlFor="jumps">
                Within
              </label>
              <input
                id="jumps"
                type="range"
                min={0}
                max={30}
                value={jumpDraft}
                onChange={(e) => setJumpDraft(Number(e.target.value))}
                onPointerUp={() => set({ jumps: String(jumpDraft) })}
                onKeyUp={() => set({ jumps: String(jumpDraft) })}
              />
              <output htmlFor="jumps" className="jumps-out">
                {jumpDraft} {jumpDraft === 1 ? 'jump' : 'jumps'}
              </output>
            </div>
            <div className="segmented" role="group" aria-label="Route">
              <button aria-pressed={route === 'shortest'} onClick={() => set({ route: null })}>
                Shortest
              </button>
              <button aria-pressed={route === 'highsec'} onClick={() => set({ route: 'highsec' })}>
                High-sec only
              </button>
            </div>
          </div>
        ) : (
          <div className="finder-row">
            {regions.data ? (
              <RegionPicker regions={regions.data} value={regionIds} onChange={(ids) => set({ regions: ids.join(',') })} />
            ) : (
              <div className="skeleton" style={{ height: 34, width: 200 }} />
            )}
          </div>
        )}

        <div className="finder-row secondary">
          <div className="segmented" role="group" aria-label="Service">
            {SERVICES.map((s) => (
              <button key={s.id} aria-pressed={service === s.id} onClick={() => set({ service: s.id === 'reprocessing' ? null : s.id })}>
                {s.label}
              </button>
            ))}
          </div>
          {(service === 'reprocessing' || service === 'any') && (
            <label className="check">
              <input type="checkbox" checked={stations} onChange={(e) => set({ stations: e.target.checked ? null : '0' })} />
              NPC stations
            </label>
          )}
          {service === 'reprocessing' && (
            <label className="check">
              <input type="checkbox" checked={unconfirmed} onChange={(e) => set({ unconfirmed: e.target.checked ? '1' : null })} />
              Unconfirmed citadels and engineering complexes
            </label>
          )}
          <label className="check" style={{ marginLeft: 'auto' }}>
            Your skills
            <select value={skills} onChange={(e) => set({ skills: e.target.value === '1.4472' ? null : e.target.value })}>
              {SKILLS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {!ready ? (
        <div className="empty">
          <h2>{mode === 'near' ? 'Where are you hauling from?' : 'Pick the regions to search'}</h2>
          <p>
            {mode === 'near'
              ? 'Type the system your miners work in. Strata counts jumps along the stargate map from the static data.'
              : 'Choose one or more regions. Every public structure and NPC station in them will be ranked.'}
          </p>
        </div>
      ) : results.data ? (
        <section className="section" style={{ marginTop: 40 }}>
          <div className="section-head">
            <div>
              <h2>
                {results.data.total} {results.data.total === 1 ? 'place' : 'places'}
                {mode === 'near' && systemName ? ` within ${jumps} ${jumps === 1 ? 'jump' : 'jumps'} of ${systemName}` : ` in ${regionIds.length} ${regionIds.length === 1 ? 'region' : 'regions'}`}
              </h2>
              <p>
                {results.data.counts.structures} public structures and {results.data.counts.stations} NPC stations across {results.data.systems_searched} systems.
                {results.data.total > rows.length && ` Showing the top ${rows.length}.`} Yields include your skills (×{mult.toFixed(4)}).
              </p>
            </div>
            <div className="segmented" role="group" aria-label="Sort">
              {SORTS.filter((s) => mode === 'near' || s.id !== 'jumps').map((s) => (
                <button key={s.id} aria-pressed={sort === s.id} onClick={() => set({ sort: s.id === 'best' ? null : s.id })}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {rows.length ? (
            <div className="table-wrap">
              <table className="data places" aria-busy={results.isFetching}>
                <caption className="visually-hidden">Matching structures and stations</caption>
                <thead>
                  <tr>
                    <th>Place</th>
                    <th className="hide-sm">System</th>
                    {service !== 'market' && service !== 'manufacturing' && (
                      <>
                        <th className="r hide-sm">Yield</th>
                        <th className="r hide-sm">Tax</th>
                        <th className="r">You keep</th>
                      </>
                    )}
                    <th className="hide-sm">Docking</th>
                    <th className="hide-sm">
                      <span className="visually-hidden">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((r) => {
                    const rp = r.reprocessing
                    const isOpen = open === r.id
                    const exact = Math.abs(rp.yield_min - rp.yield_max) < 1e-6
                    return (
                      <Fragment key={`${r.kind}-${r.id}`}>
                        <tr className={isOpen ? 'open' : undefined}>
                          <td>
                            <div className="cell-main">
                              {r.type_id ? <img className="type-icon" src={typeIcon(r.type_id)} alt="" loading="lazy" /> : <span className="type-icon" />}
                              <div className="stack">
                                <button className="place-name" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                                  {r.name ?? `Structure ${r.id}`}
                                </button>
                                <small>
                                  {r.type_name}
                                  {r.owner_name ? `, ${r.owner_name}` : ''}
                                </small>
                                {service === 'reprocessing' && <StatusNote r={r} />}
                                <small className="show-sm">
                                  <Sec sec={r.security} /> {r.system_name}
                                  {r.jumps === null ? '' : r.jumps === 0 ? ', in system' : `, ${r.jumps} ${r.jumps === 1 ? 'jump' : 'jumps'}`}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td className="hide-sm">
                            <div className="stack" style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ whiteSpace: 'nowrap' }}>
                                <Sec sec={r.security} /> {r.system_name}
                              </span>
                              <small className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                                {r.jumps === null ? r.region : r.jumps === 0 ? 'In system' : `${r.jumps} ${r.jumps === 1 ? 'jump' : 'jumps'}`}
                              </small>
                            </div>
                          </td>
                          {service !== 'market' && service !== 'manufacturing' && (
                            <>
                              <td className="r hide-sm">
                                {rp.status === 'none' || rp.status === 'impossible' ? (
                                  <span className="muted">–</span>
                                ) : (
                                  <>
                                    {exact ? pct(rp.yield_max * mult, 1) : `up to ${pct(rp.yield_max * mult, 1)}`}
                                    {!exact && <small className="muted cell-sub">from {pct(rp.yield_min * mult, 1)}</small>}
                                  </>
                                )}
                              </td>
                              <td className="r hide-sm">
                                {rp.tax === null ? (
                                  <span className="muted">Unknown</span>
                                ) : (
                                  <>
                                    {pct(rp.tax, 1)}
                                    {rp.tax_source === 'sde' && <small className="muted cell-sub">before standings</small>}
                                  </>
                                )}
                              </td>
                              <td className="r keep">
                                {rp.status === 'none' || rp.status === 'impossible'
                                  ? '–'
                                  : `${exact && rp.tax !== null ? '' : 'up to '}${pct(r.net_yield_max * mult, 1)}`}
                              </td>
                            </>
                          )}
                          <td className="hide-sm">
                            <Access r={r} access={access.data?.[String(r.id)]} checking={access.isFetching} checkers={checkers} />
                          </td>
                          <td className="r hide-sm">
                            <button className="linkish" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                              {isOpen ? 'Close' : r.kind === 'structure' ? 'Details and report' : 'Details'}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="details-row">
                            <td colSpan={7}>
                              <Details
                                r={r}
                                mult={mult}
                                user={user}
                                onReported={() => qc.invalidateQueries({ queryKey: ['structure-search'] })}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
              {rows.length > shown && (
                <div className="more-row">
                  <button className="btn btn-quiet" onClick={() => setShown(shown + 25)}>
                    Show {Math.min(25, rows.length - shown)} more
                  </button>
                  <span className="muted">
                    {shown} of {rows.length} shown
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="empty">
              <h2>Nothing matches</h2>
              <p>
                {mode === 'near' ? 'Widen the jump range, allow low-sec routes, ' : 'Add more regions, '}
                {service === 'reprocessing' && !unconfirmed ? 'or include unconfirmed citadels and engineering complexes.' : 'or try another service.'}
              </p>
            </div>
          )}
        </section>
      ) : (
        <div className="skeleton" style={{ height: 320, marginTop: 40 }} />
      )}
    </>
  )
}
