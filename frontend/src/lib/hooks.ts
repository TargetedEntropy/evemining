import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError, type User } from './api'
import { isoDay } from './format'

export function useMe() {
  return useQuery<User | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.me()
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 60_000,
  })
}

export const PRESETS = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: '1y', label: 'Year', days: 365 },
  { id: 'all', label: 'All time', days: 3650 },
] as const

export type PresetId = (typeof PRESETS)[number]['id']
export type Measure = 'value' | 'm3'

/** Range and alt filter live in the URL so any view can be bookmarked or shared between tabs. */
export function useRange() {
  const [params, setParams] = useSearchParams()
  const preset = (PRESETS.find((p) => p.id === params.get('range'))?.id ?? '30d') as PresetId
  const alts = useMemo(
    () =>
      (params.get('alts') ?? '')
        .split(',')
        .map(Number)
        .filter((n) => n > 0),
    [params],
  )

  return useMemo(() => {
    const days = PRESETS.find((p) => p.id === preset)!.days
    const end = new Date()
    const start = new Date(end.getTime() - (days - 1) * 86400000)
    const qs = new URLSearchParams({ start: isoDay(start), end: isoDay(end) })
    if (alts.length) qs.set('characters', alts.join(','))

    const update = (key: string, value: string | null) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          if (value) next.set(key, value)
          else next.delete(key)
          return next
        },
        { replace: true },
      )

    return {
      preset,
      days,
      measure: (params.get('by') === 'm3' ? 'm3' : 'value') as Measure,
      setMeasure: (m: Measure) => update('by', m === 'value' ? null : m),
      start: isoDay(start),
      end: isoDay(end),
      alts,
      qs: qs.toString(),
      setPreset: (id: PresetId) => update('range', id === '30d' ? null : id),
      setAlts: (ids: number[]) => update('alts', ids.length ? ids.join(',') : null),
    }
  }, [preset, alts, params, setParams])
}

export function useStats<T>(kind: string, override?: { qs?: string }) {
  const range = useRange()
  const qs = override?.qs ?? range.qs
  return useQuery<T>({
    queryKey: ['stats', kind, qs],
    queryFn: () => api.stats<T>(kind, qs),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  })
}
