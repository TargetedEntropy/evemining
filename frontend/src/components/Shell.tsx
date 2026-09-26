import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { api, type User } from '../lib/api'
import { day, dayYear } from '../lib/format'
import { PRESETS, useRange } from '../lib/hooks'
import Portrait from './Portrait'

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/alts', label: 'Alts' },
  { to: '/ores', label: 'Ores' },
  { to: '/systems', label: 'Systems' },
  { to: '/refining', label: 'Refining' },
  { to: '/structures', label: 'Structures' },
]

export function Glyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <rect x="1" y="3" width="20" height="4" rx="2" fill="var(--c-asteroid)" />
      <rect x="1" y="9" width="13" height="4" rx="2" fill="var(--c-moon)" />
      <rect x="1" y="15" width="16" height="4" rx="2" fill="var(--c-ice)" />
    </svg>
  )
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

function AccountMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const qc = useQueryClient()
  const primary = user.characters.find((c) => c.character_id === user.primary_character_id) ?? user.characters[0]

  const toggleTheme = () => {
    const root = document.documentElement
    const current =
      root.dataset.theme ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    const next = current === 'light' ? 'dark' : 'light'
    root.dataset.theme = next
    try {
      localStorage.setItem('strata-theme', next)
    } catch {
      /* storage unavailable */
    }
  }

  const logout = async () => {
    await api.logout()
    qc.setQueryData(['me'], null)
  }

  return (
    <div className="account" ref={ref}>
      <button className="account-button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        {primary && <Portrait id={primary.character_id} name={primary.name} />}
        <span className="who">{primary?.name}</span>
      </button>
      {open && (
        <div className="menu" role="menu" onClick={() => setOpen(false)}>
          <Link to="/alts" role="menuitem">
            Manage alts
          </Link>
          <Link to="/settings" role="menuitem">
            Valuation settings
          </Link>
          {user.is_admin && (
            <Link to="/admin" role="menuitem">
              Admin
            </Link>
          )}
          <button role="menuitem" onClick={toggleTheme}>
            Switch light / dark
          </button>
          <hr />
          <button role="menuitem" onClick={logout}>
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

function AltFilter({ user }: { user: User }) {
  const range = useRange()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const total = user.characters.length
  const selected = new Set(range.alts)
  const label = selected.size ? `${selected.size} of ${total} alts` : `All ${total} alts`

  const toggle = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    range.setAlts(next.size === total ? [] : [...next])
  }

  return (
    <div className="filter-pop" ref={ref}>
      <button className={`chip${selected.size ? ' on' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div className="menu alt-picker" role="dialog" aria-label="Filter alts">
          <div className="picker-actions">
            <button className="linkish" onClick={() => range.setAlts([])}>
              Show all
            </button>
            <span className="muted" style={{ fontSize: 13 }}>
              {selected.size || total} selected
            </span>
          </div>
          {user.characters.map((c) => (
            <label key={c.character_id}>
              <input
                type="checkbox"
                checked={selected.size === 0 || selected.has(c.character_id)}
                onChange={() =>
                  selected.size === 0
                    ? range.setAlts(user.characters.filter((x) => x.character_id !== c.character_id).map((x) => x.character_id))
                    : toggle(c.character_id)
                }
              />
              <Portrait id={c.character_id} name={c.name} />
              <span>{c.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function Filters({ user }: { user: User }) {
  const range = useRange()
  return (
    <div className="filters">
      <div className="wrap">
        <div className="segmented" role="group" aria-label="Time range">
          {PRESETS.map((p) => (
            <button key={p.id} aria-pressed={range.preset === p.id} onClick={() => range.setPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {range.preset !== 'all' && (
          <span className="range-label">
            {day(range.start)} to {dayYear(range.end)}
          </span>
        )}
        <div className="segmented" role="group" aria-label="Measure" style={{ marginLeft: 'auto' }}>
          <button aria-pressed={range.measure === 'value'} onClick={() => range.setMeasure('value')}>
            ISK
          </button>
          <button aria-pressed={range.measure === 'm3'} onClick={() => range.setMeasure('m3')}>
            m³
          </button>
        </div>
        {user.characters.length > 1 && <AltFilter user={user} />}
      </div>
    </div>
  )
}

export default function Shell({ user }: { user: User }) {
  const { pathname } = useLocation()
  const showFilters = !['/settings', '/admin', '/structures'].includes(pathname)
  // Keep the range when moving between data pages.
  const { search } = useLocation()

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <Link to={{ pathname: '/', search }} className="wordmark" aria-label="Strata home">
            <Glyph />
            <span>Strata</span>
          </Link>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={{ pathname: n.to, search: n.to === '/structures' || pathname === '/structures' ? '' : search }} end={n.end}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <AccountMenu user={user} />
        </div>
      </header>
      {showFilters && <Filters user={user} />}
      <main>
        <div className="wrap">
          <Outlet />
        </div>
      </main>
      <footer className="site">
        <div className="wrap">
          <span>Ledgers sync about every 30 minutes. Prices are Jita 4-4, refreshed hourly.</span>
          <span>EVE Online and all related materials are property of CCP hf.</span>
        </div>
      </footer>
    </>
  )
}
