import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { RegionRow, SystemTuple } from '../lib/api'
import Sec from './Sec'

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close()
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, close])
  return ref
}

/** Autocomplete over every gate-connected system. Prefix matches rank above substring matches. */
export function SystemPicker({
  systems,
  regionNames,
  value,
  onChange,
}: {
  systems: SystemTuple[]
  regionNames: Map<number, string>
  value: number | null
  onChange: (id: number) => void
}) {
  const selected = useMemo(() => systems.find((s) => s[0] === value) ?? null, [systems, value])
  const [query, setQuery] = useState(selected?.[1] ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const ref = useOutside(open, () => {
    setOpen(false)
    setQuery(selected?.[1] ?? '')
  })

  useEffect(() => setQuery(selected?.[1] ?? ''), [selected])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const prefix: SystemTuple[] = []
    const inner: SystemTuple[] = []
    for (const s of systems) {
      const n = s[1].toLowerCase()
      if (n.startsWith(q)) prefix.push(s)
      else if (n.includes(q)) inner.push(s)
    }
    // Exact match first, then the shortest prefix matches: "osmon" should not lose to "Osmomonne".
    prefix.sort((a, b) => a[1].length - b[1].length || a[1].localeCompare(b[1]))
    return [...prefix, ...inner].slice(0, 8)
  }, [systems, query])

  const pick = (s: SystemTuple) => {
    onChange(s[0])
    setQuery(s[1])
    setOpen(false)
  }

  return (
    <div className="combo" ref={ref}>
      <input
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active][0]}` : undefined}
        aria-autocomplete="list"
        aria-label="Starting system"
        placeholder="Type a system, e.g. Osmon"
        value={query}
        spellCheck={false}
        autoComplete="off"
        onFocus={(e) => {
          e.currentTarget.select()
          setOpen(true)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && matches[active]) {
            e.preventDefault()
            pick(matches[active])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {selected && !open && (
        <span className="combo-meta" aria-hidden="true">
          <Sec sec={selected[2]} /> {regionNames.get(selected[3])}
        </span>
      )}
      {open && matches.length > 0 && (
        <ul className="menu combo-list" role="listbox" id={listId}>
          {matches.map((s, i) => (
            <li
              key={s[0]}
              id={`${listId}-${s[0]}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s)
              }}
            >
              <span className="combo-sec">
                <Sec sec={s[2]} />
              </span>
              <span className="combo-name">{s[1]}</span>
              <span className="muted">{regionNames.get(s[3])}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function bandOf(avg: number) {
  if (avg >= 0.45) return 'Mostly high-sec'
  if (avg > 0.05) return 'Mixed and low-sec'
  return 'Null-sec'
}

/** Multi-select for regions, with a filter box and structure counts. */
export function RegionPicker({
  regions,
  value,
  onChange,
}: {
  regions: RegionRow[]
  value: number[]
  onChange: (ids: number[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const ref = useOutside(open, () => setOpen(false))
  const selected = new Set(value)
  const byId = new Map(regions.map((r) => [r.region_id, r]))
  const q = filter.trim().toLowerCase()
  const visible = regions.filter((r) => !q || r.name.toLowerCase().includes(q))
  const groups = ['Mostly high-sec', 'Mixed and low-sec', 'Null-sec']
    .map((g) => ({ g, rows: visible.filter((r) => bandOf(r.avg_security) === g) }))
    .filter((x) => x.rows.length)

  const toggle = (id: number) => onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id])

  return (
    <div className="region-picker" ref={ref}>
      <div className="chips">
        {value.map((id) => (
          <span className="token" key={id}>
            {byId.get(id)?.name ?? id}
            <button aria-label={`Remove ${byId.get(id)?.name}`} onClick={() => toggle(id)}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
        <button className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>
          {value.length ? 'Add region' : 'Choose regions'}
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="menu region-menu" role="dialog" aria-label="Choose regions">
          <input
            className="region-filter"
            placeholder="Filter regions"
            value={filter}
            autoFocus
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          />
          <div className="region-scroll">
            {groups.map(({ g, rows }) => (
              <fieldset key={g}>
                <legend>{g}</legend>
                {rows.map((r) => (
                  <label key={r.region_id}>
                    <input type="checkbox" checked={selected.has(r.region_id)} onChange={() => toggle(r.region_id)} />
                    <span>{r.name}</span>
                    <span className="muted num">{r.structures ? `${r.structures} public` : ''}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            {!groups.length && <p className="muted" style={{ padding: '8px 10px', margin: 0 }}>No region matches “{filter}”.</p>}
          </div>
          <div className="picker-actions" style={{ borderTop: '1px solid var(--rule)', borderBottom: 0, marginTop: 4, paddingTop: 8 }}>
            <button className="linkish" onClick={() => onChange([])}>
              Clear
            </button>
            <button className="btn btn-quiet btn-small" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
