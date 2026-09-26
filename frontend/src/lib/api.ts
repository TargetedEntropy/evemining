export type OreClass = 'asteroid' | 'moon' | 'ice' | 'gas' | 'other'

export interface Character {
  character_id: number
  name: string
  corporation_id: number | null
  corporation_name: string | null
  alliance_id: number | null
  alliance_name: string | null
  token_valid: boolean
  last_synced_at: string | null
  last_error: string | null
  created_at: string
}

export interface User {
  id: number
  is_admin: boolean
  primary_character_id: number | null
  reprocess_yield: number
  price_basis: 'buy' | 'sell'
  characters: Character[]
}

export interface Totals {
  units: number
  m3: number
  value: number
  value_then: number
  refined: number
  active_days: number
  active_characters: number
  systems: number
}

export interface Summary {
  start: string
  end: string
  days: number
  totals: Totals
  previous: Totals
  by_class: { ore_class: OreClass; m3: number; value: number; refined: number }[]
  best_day: { date: string; m3: number; value: number; characters: number } | null
  character_count: number
  price_basis: 'buy' | 'sell'
  reprocess_yield: number
}

export interface DailyRow {
  date: string
  ore_class: OreClass
  units: number
  m3: number
  value: number
  characters: number
}

export interface AltStats {
  character_id: number
  name: string
  corporation_name: string | null
  alliance_name: string | null
  token_valid: boolean
  last_synced_at: string | null
  last_error: string | null
  units: number
  m3: number
  value: number
  refined: number
  active_days: number
  last_mined: string | null
  top_ore: string | null
  daily: number[]
}

export interface OreRow {
  type_id: number
  type_name: string | null
  ore_class: OreClass
  moon_rarity: number | null
  units: number
  m3: number
  value: number
  value_then: number
  refined: number
  characters: number
}

export interface SystemRow {
  system_id: number
  name: string | null
  security: number | null
  region: string | null
  m3: number
  value: number
  active_days: number
  characters: number
  last_mined: string
}

export interface MineralRow {
  type_id: number
  name: string | null
  quantity: number
  value: number | null
}

export interface CalendarRow {
  date: string
  m3: number
  value: number
  characters: number
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, typeof detail === 'string' ? detail : 'Request failed')
  }
  return res.json()
}

export const api = {
  me: () => request<User>('/api/auth/me'),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  stats: <T>(kind: string, qs: string) => request<T>(`/api/stats/${kind}?${qs}`),
  setPrimary: (id: number) => request<User>(`/api/characters/${id}/primary`, { method: 'POST' }),
  syncCharacter: (id: number) => request<{ queued: boolean }>(`/api/characters/${id}/sync`, { method: 'POST' }),
  removeCharacter: (id: number) => request<User>(`/api/characters/${id}`, { method: 'DELETE' }),
  saveSettings: (body: { reprocess_yield: number; price_basis: string }) =>
    request<User>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  deleteAccount: () => request<{ ok: boolean }>('/api/account', { method: 'DELETE' }),
  adminOverview: () => request<AdminOverview>('/api/admin/overview'),
  adminToggle: (id: number) => request<{ is_admin: boolean }>(`/api/admin/users/${id}/toggle-admin`, { method: 'POST' }),
  adminDelete: (id: number) => request<{ ok: boolean }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
}

export interface AdminOverview {
  ledger_rows: number
  invalid_tokens: number
  users: {
    id: number
    is_admin: boolean
    created_at: string
    primary: string | null
    characters: { character_id: number; name: string; token_valid: boolean; last_synced_at: string | null }[]
  }[]
  audit: { timestamp: string; admin: string | null; action: string; target_id: number; details: string }[]
}

// ───────────── Structure finder ─────────────

export type SystemTuple = [id: number, name: string, security: number, regionId: number]

export interface RegionRow {
  region_id: number
  name: string
  systems: number
  structures: number
  avg_security: number
}

export type ReprocessingStatus = 'confirmed' | 'likely' | 'possible' | 'npc' | 'none' | 'impossible' | 'unknown'

export interface PlaceRow {
  kind: 'structure' | 'station'
  id: number
  name: string | null
  type_id: number | null
  type_name: string | null
  group_name: string | null
  owner_id: number | null
  owner_name: string | null
  system_id: number
  system_name: string
  security: number
  region: string | null
  jumps: number | null
  has_market: boolean | null
  has_manufacturing: boolean | null
  reprocessing: {
    status: ReprocessingStatus
    yield_min: number
    yield_max: number
    rig_tier: number | null
    tax: number | null
    tax_source: 'sde' | 'report' | null
  }
  report: { reported_at: string; reporter: string | null; reports: number } | null
  net_yield_max: number
}

export interface SearchResult {
  systems_searched: number
  total: number
  counts: { structures: number; stations: number }
  results: PlaceRow[]
}

export interface StructureStatus {
  listed: number
  resolved: number
  last_resolved_at: string | null
  checkers: { character_id: number; name: string }[]
}

export const structuresApi = {
  systems: () => request<SystemTuple[]>('/api/universe/systems'),
  regions: () => request<RegionRow[]>('/api/universe/regions'),
  status: () => request<StructureStatus>('/api/structures/status'),
  search: (qs: string) => request<SearchResult>(`/api/structures/search?${qs}`),
  access: (ids: number[]) =>
    request<Record<string, Record<string, boolean>>>('/api/structures/access', {
      method: 'POST',
      body: JSON.stringify({ structure_ids: ids }),
    }),
  report: (id: number, body: { has_reprocessing?: boolean | null; rig_tier?: number | null; tax?: number | null }) =>
    request<{ ok: boolean }>(`/api/structures/${id}/reports`, { method: 'POST', body: JSON.stringify(body) }),
}
