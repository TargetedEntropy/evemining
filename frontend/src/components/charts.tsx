import { max } from 'd3-array'
import { scaleBand, scaleLinear, scaleQuantile } from 'd3-scale'
import { line } from 'd3-shape'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CalendarRow, DailyRow, OreClass, OreRow } from '../lib/api'
import { CLASS_LABEL, CLASS_ORDER, isoDay, isk, m3, parseDay, pct, short, weekday } from '../lib/format'
import type { Measure } from '../lib/hooks'

export const classColor = (c: OreClass) => `var(--c-${c})`
const fmt = (measure: Measure, n: number) => (measure === 'value' ? isk(n) : m3(n))

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(ref.current)
    setWidth(ref.current.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

interface Tip {
  x: number
  y: number
  content: ReactNode
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null
  const flip = tip.x > width - 230
  return (
    <div
      className="tooltip"
      role="status"
      style={{ left: flip ? undefined : tip.x + 14, right: flip ? width - tip.x + 14 : undefined, top: tip.y }}
    >
      {tip.content}
    </div>
  )
}

/* ─────────── Strata band: what the range was made of ─────────── */

export function StrataBand({ ores, measure }: { ores: OreRow[]; measure: Measure }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)

  const segments = useMemo(() => {
    const sorted = [...ores]
      .filter((o) => o[measure] > 0)
      .sort((a, b) => CLASS_ORDER.indexOf(a.ore_class) - CLASS_ORDER.indexOf(b.ore_class) || b[measure] - a[measure])
    const total = sorted.reduce((s, o) => s + o[measure], 0)
    // Slivers under 1.2% fold into one "other <class>" sliver so every visible segment can be hovered.
    const out: { key: string; name: string; cls: OreClass; v: number; share: number; m3: number; value: number }[] = []
    for (const cls of CLASS_ORDER) {
      const inClass = sorted.filter((o) => o.ore_class === cls)
      const small = inClass.filter((o) => o[measure] / total < 0.012)
      for (const o of inClass) {
        if (small.includes(o)) continue
        out.push({ key: String(o.type_id), name: o.type_name ?? `Type ${o.type_id}`, cls, v: o[measure], share: o[measure] / total, m3: o.m3, value: o.value })
      }
      if (small.length) {
        const v = small.reduce((s, o) => s + o[measure], 0)
        out.push({
          key: `other-${cls}`,
          name: `${small.length} other ${CLASS_LABEL[cls].toLowerCase()} types`,
          cls,
          v,
          share: v / total,
          m3: small.reduce((s, o) => s + o.m3, 0),
          value: small.reduce((s, o) => s + o.value, 0),
        })
      }
    }
    return { out, total }
  }, [ores, measure])

  const byClass = CLASS_ORDER.map((cls) => ({
    cls,
    v: segments.out.filter((s) => s.cls === cls).reduce((s, x) => s + x.v, 0),
  })).filter((c) => c.v > 0)

  return (
    <div className="strata">
      <div className="chart" ref={ref}>
        <div className="strata-band" onMouseLeave={() => setTip(null)}>
          {segments.out.map((s, i) => {
            const px = s.share * width
            const fits = px > s.name.length * 6.6 + 22
            return (
              <button
                key={s.key}
                className="strata-seg"
                data-light={s.cls === 'ice' || s.cls === 'gas'}
                style={{ flexGrow: s.v, flexBasis: 0, ['--seg' as string]: classColor(s.cls), ['--i' as string]: i }}
                aria-label={`${s.name}: ${fmt(measure, s.v)}, ${pct(s.share, 1)}`}
                onMouseMove={(e) => {
                  const box = ref.current!.getBoundingClientRect()
                  setTip({
                    x: e.clientX - box.left,
                    y: 64,
                    content: (
                      <>
                        <h4>{s.name}</h4>
                        <div className="row">
                          <span className="dot" style={{ ['--sw' as string]: classColor(s.cls) }} />
                          {CLASS_LABEL[s.cls]}
                          <span className="v">{pct(s.share, 1)}</span>
                        </div>
                        <div className="row">
                          Volume<span className="v">{m3(s.m3)}</span>
                        </div>
                        <div className="row">
                          Value<span className="v">{isk(s.value)}</span>
                        </div>
                      </>
                    ),
                  })
                }}
                onFocus={(e) => {
                  const box = ref.current!.getBoundingClientRect()
                  const r = e.currentTarget.getBoundingClientRect()
                  setTip({ x: r.left - box.left + r.width / 2, y: 64, content: <h4>{`${s.name} · ${pct(s.share, 1)}`}</h4> })
                }}
                onBlur={() => setTip(null)}
              >
                {fits && <span>{s.name}</span>}
              </button>
            )
          })}
        </div>
        <Tooltip tip={tip} width={width} />
      </div>
      <div className="strata-scale">
        <ul className="legend">
          {byClass.map((c) => (
            <li key={c.cls}>
              <span className="swatch" style={{ ['--sw' as string]: classColor(c.cls) }} />
              {CLASS_LABEL[c.cls]} <span className="muted">{pct(c.v / segments.total)}</span>
            </li>
          ))}
        </ul>
        <span className="num">{fmt(measure, segments.total)}</span>
      </div>
    </div>
  )
}

/* ─────────── Daily output, stacked by ore class ─────────── */

type Bucket = { key: string; label: string; start: string; byClass: Partial<Record<OreClass, number>>; total: number; characters: number }

function bucketize(rows: DailyRow[], start: string, end: string, measure: Measure): { buckets: Bucket[]; unit: 'day' | 'week' | 'month' } {
  const days = Math.round((parseDay(end).getTime() - parseDay(start).getTime()) / 86400000) + 1
  const unit = days <= 120 ? 'day' : days <= 400 ? 'week' : 'month'
  const keyOf = (d: string) => {
    if (unit === 'day') return d
    const dt = parseDay(d)
    if (unit === 'month') return d.slice(0, 7)
    const monday = new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 86400000)
    return isoDay(monday)
  }
  const map = new Map<string, Bucket>()
  // For "all time", start the axis at the first month with data rather than ten years ago.
  const firstData = rows.length ? rows[0].date : end
  let cursor = parseDay(unit === 'month' ? firstData : start)
  while (cursor <= parseDay(end)) {
    const k = keyOf(isoDay(cursor))
    if (!map.has(k)) map.set(k, { key: k, label: k, start: k.length === 7 ? `${k}-01` : k, byClass: {}, total: 0, characters: 0 })
    cursor = new Date(cursor.getTime() + 86400000)
  }
  for (const r of rows) {
    const b = map.get(keyOf(r.date))
    if (!b) continue
    b.byClass[r.ore_class] = (b.byClass[r.ore_class] ?? 0) + r[measure]
    b.total += r[measure]
    b.characters = Math.max(b.characters, r.characters)
  }
  return { buckets: [...map.values()], unit }
}

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })
const monthYearFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayMonthFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function DailyChart({ rows, start, end, measure }: { rows: DailyRow[]; start: string; end: string; measure: Measure }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const height = 260
  const m = { top: 12, right: 0, bottom: 28, left: 56 }
  const { buckets, unit } = useMemo(() => bucketize(rows, start, end, measure), [rows, start, end, measure])
  const classes = CLASS_ORDER.filter((c) => buckets.some((b) => b.byClass[c]))

  const x = scaleBand<string>()
    .domain(buckets.map((b) => b.key))
    .range([m.left, Math.max(m.left + 1, width - m.right)])
    .paddingInner(0.28)
    .paddingOuter(0.1)
  const y = scaleLinear()
    .domain([0, max(buckets, (b) => b.total) || 1])
    .nice(4)
    .range([height - m.bottom, m.top])
  const bw = Math.min(24, x.bandwidth())
  const ticks = y.ticks(4)
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(width / 70))))

  const label = (b: Bucket, long = false) => {
    const d = parseDay(b.start)
    if (unit === 'month') return long ? monthYearFmt.format(d) : monthFmt.format(d)
    if (unit === 'week') return long ? `Week of ${weekday(b.start)}` : dayMonthFmt.format(d)
    return long ? weekday(b.start) : dayMonthFmt.format(d)
  }

  const hovered = hover !== null ? buckets[hover] : null

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${measure === 'value' ? 'Value' : 'Volume'} mined per ${unit}, stacked by ore class`}>
          <g className="grid">
            {ticks.map((t) => (
              <line key={t} x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} />
            ))}
          </g>
          {ticks.map((t) => (
            <text key={t} className="tick" x={m.left - 10} y={y(t)} dy="0.32em" textAnchor="end">
              {short(t)}
            </text>
          ))}
          {hovered && (
            <rect className="hover-band" x={x(hovered.key)! - (x.step() - x.bandwidth()) / 2} width={x.step()} y={m.top} height={height - m.top - m.bottom} />
          )}
          {buckets.map((b) => {
            let acc = 0
            const cx = x(b.key)! + (x.bandwidth() - bw) / 2
            const present = classes.filter((c) => b.byClass[c])
            return (
              <g key={b.key}>
                {present.map((c, i) => {
                  const v = b.byClass[c]!
                  const y0 = y(acc)
                  acc += v
                  const y1 = y(acc)
                  const top = i === present.length - 1
                  const h = Math.max(0, y0 - y1 - (i > 0 ? 2 : 0))
                  const yTop = y1
                  const r = top ? Math.min(4, h, bw / 2) : 0
                  return (
                    <path
                      key={c}
                      fill={classColor(c)}
                      d={`M${cx},${yTop + h} V${yTop + r} Q${cx},${yTop} ${cx + r},${yTop} H${cx + bw - r} Q${cx + bw},${yTop} ${cx + bw},${yTop + r} V${yTop + h} Z`}
                    />
                  )
                })}
              </g>
            )
          })}
          <line className="baseline" x1={m.left} x2={width - m.right} y1={y(0)} y2={y(0)} />
          {buckets.map((b, i) =>
            i % labelEvery === 0 ? (
              <text key={b.key} className="tick" x={x(b.key)! + x.bandwidth() / 2} y={height - 8} textAnchor="middle">
                {label(b)}
              </text>
            ) : null,
          )}
          {/* hit targets: full-height columns */}
          {buckets.map((b, i) => (
            <rect
              key={b.key}
              x={x(b.key)! - (x.step() - x.bandwidth()) / 2}
              width={x.step()}
              y={m.top}
              height={height - m.top - m.bottom}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
      )}
      {hovered && (
        <Tooltip
          width={width}
          tip={{
            x: x(hovered.key)! + x.bandwidth() / 2,
            y: 8,
            content: (
              <>
                <h4>{label(hovered, true)}</h4>
                {hovered.total === 0 && <div className="muted">No mining</div>}
                {classes
                  .filter((c) => hovered.byClass[c])
                  .reverse()
                  .map((c) => (
                    <div className="row" key={c}>
                      <span className="swatch" style={{ ['--sw' as string]: classColor(c) }} />
                      {CLASS_LABEL[c]}
                      <span className="v">{fmt(measure, hovered.byClass[c]!)}</span>
                    </div>
                  ))}
                {hovered.total > 0 && (
                  <div className="row total">
                    Total<span className="v">{fmt(measure, hovered.total)}</span>
                  </div>
                )}
              </>
            ),
          }}
        />
      )}
      {classes.length > 1 && (
        <ul className="legend" style={{ marginTop: 14 }}>
          {classes.map((c) => (
            <li key={c}>
              <span className="swatch" style={{ ['--sw' as string]: classColor(c) }} />
              {CLASS_LABEL[c]}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ─────────── A year of activity ─────────── */

export function CalendarHeat({ rows, end, measure }: { rows: CalendarRow[]; end: string; measure: Measure }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const [ref, width] = useWidth<HTMLDivElement>()
  const scroller = useRef<HTMLDivElement>(null)
  // On narrow screens start at the recent end of the year, not eleven months ago.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth
  }, [rows])
  const cell = 13
  const gap = 3
  const endDate = parseDay(end)
  // Grid ends on the week containing `end`; 53 columns, Monday-first rows.
  const endOffset = (endDate.getUTCDay() + 6) % 7
  const first = new Date(endDate.getTime() - (52 * 7 + endOffset) * 86400000)
  const byDate = new Map(rows.map((r) => [r.date, r]))
  const values = rows.map((r) => r[measure]).filter((v) => v > 0)
  const q = scaleQuantile<number>().domain(values.length ? values : [1]).range([1, 2, 3, 4])

  const cells: { d: string; col: number; row: number; r?: CalendarRow }[] = []
  for (let i = 0; i < 53 * 7; i++) {
    const dt = new Date(first.getTime() + i * 86400000)
    if (dt > endDate) break
    const d = isoDay(dt)
    cells.push({ d, col: Math.floor(i / 7), row: i % 7, r: byDate.get(d) })
  }
  const months = cells.filter((c) => c.row === 0 && parseDay(c.d).getUTCDate() <= 7)
  const left = 28
  const svgW = left + 53 * (cell + gap)
  const svgH = 18 + 7 * (cell + gap)
  const activeDays = rows.filter((r) => r.m3 > 0).length

  // longest streak of consecutive mining days
  let best = 0
  let run = 0
  for (const c of cells) {
    run = c.r && c.r.m3 > 0 ? run + 1 : 0
    best = Math.max(best, run)
  }

  return (
    <div className="chart" ref={ref}>
      <div className="calendar" ref={scroller} onMouseLeave={() => setTip(null)}>
        <svg width={svgW} height={svgH} role="img" aria-label={`Mining activity for the past year: ${activeDays} active days`}>
          {months.map((c) => (
            <text key={c.d} className="tick" x={left + c.col * (cell + gap)} y={10}>
              {monthFmt.format(parseDay(c.d))}
            </text>
          ))}
          {['Mon', 'Wed', 'Fri'].map((l, i) => (
            <text key={l} className="tick" x={0} y={18 + (i * 2) * (cell + gap) + cell - 2}>
              {l}
            </text>
          ))}
          {cells.map((c) => {
            const v = c.r?.[measure] ?? 0
            return (
              <rect
                key={c.d}
                className="cell"
                x={left + c.col * (cell + gap)}
                y={18 + c.row * (cell + gap)}
                width={cell}
                height={cell}
                rx={2}
                fill={`var(--seq-${v > 0 ? q(v) : 0})`}
                onMouseEnter={() =>
                  setTip({
                    x: left + c.col * (cell + gap) - (scroller.current?.scrollLeft ?? 0),
                    y: 18 + c.row * (cell + gap) + 20,
                    content: (
                      <>
                        <h4>{weekday(c.d)}</h4>
                        {c.r ? (
                          <>
                            <div className="row">
                              Value<span className="v">{isk(c.r.value)}</span>
                            </div>
                            <div className="row">
                              Volume<span className="v">{m3(c.r.m3)}</span>
                            </div>
                            <div className="row">
                              Alts mining<span className="v">{c.r.characters}</span>
                            </div>
                          </>
                        ) : (
                          <div className="muted">No mining</div>
                        )}
                      </>
                    ),
                  })
                }
              />
            )
          })}
        </svg>
      </div>
      <Tooltip tip={tip} width={width} />
      <div className="calendar-foot">
        <span>
          {activeDays} active days in the past year. Longest run: {best} {best === 1 ? 'day' : 'days'}.
        </span>
        <span className="scale-key" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ background: `var(--seq-${i})` }} />
          ))}
          More
        </span>
      </div>
    </div>
  )
}

/* ─────────── Sparkline ─────────── */

export function Sparkline({ values, width = 96, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null
  const top = max(values) || 1
  const xs = scaleLinear().domain([0, values.length - 1]).range([1, width - 1])
  const ys = scaleLinear().domain([0, top]).range([height - 1, 2])
  const d = line<number>()
    .x((_, i) => xs(i))
    .y((v) => ys(v))(values)
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: 'block' }}>
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke="var(--rule)" />
      <path d={d ?? ''} fill="none" stroke="var(--c-asteroid)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
