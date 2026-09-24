import type { OreClass } from './api'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const compact2 = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** 1.09B, 8.34M, 412K — two decimals only where the number is short enough to afford it. */
export function short(n: number): string {
  if (!isFinite(n)) return '–'
  const abs = Math.abs(n)
  if (abs < 1000) return whole.format(n)
  return (abs >= 1e6 ? compact2 : compact).format(n)
}

export const int = (n: number) => whole.format(n)
export const isk = (n: number) => `${short(n)} ISK`
export const m3 = (n: number) => `${short(n)} m³`
export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`

export function delta(current: number, previous: number): number | null {
  if (!previous) return null
  return (current - previous) / previous
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayYearFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

export const parseDay = (s: string) => new Date(`${s}T00:00:00Z`)
export const day = (s: string) => dayFmt.format(parseDay(s))
export const dayYear = (s: string) => dayYearFmt.format(parseDay(s))
export const weekday = (s: string) => weekdayFmt.format(parseDay(s))
export const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export function ago(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

export function daysSince(s: string | null): number | null {
  if (!s) return null
  return Math.round((Date.now() - parseDay(s).getTime()) / 86400000)
}

export const CLASS_LABEL: Record<OreClass, string> = {
  asteroid: 'Asteroid ore',
  moon: 'Moon ore',
  ice: 'Ice',
  gas: 'Gas',
  other: 'Other',
}

export const CLASS_ORDER: OreClass[] = ['asteroid', 'moon', 'ice', 'gas', 'other']

/** Security as the game displays it: one decimal, and anything just above 0 shows as 0.1. */
export function secRounded(sec: number): number {
  if (sec > 0 && sec < 0.05) return 0.1
  return Math.round(sec * 10) / 10
}

export function securityBand(sec: number | null): string {
  if (sec === null) return 'Unknown'
  const r = secRounded(sec)
  if (r >= 0.5) return 'High-sec'
  if (r > 0) return 'Low-sec'
  return 'Null-sec'
}

export const portrait = (id: number, size = 64) => `https://images.evetech.net/characters/${id}/portrait?size=${size}`
export const typeIcon = (id: number, size = 32) => `https://images.evetech.net/types/${id}/icon?size=${size}`
