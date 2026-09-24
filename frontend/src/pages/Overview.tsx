import { Link, useLocation } from 'react-router-dom'
import { CalendarHeat, DailyChart, StrataBand } from '../components/charts'
import Portrait from '../components/Portrait'
import type { AltStats, CalendarRow, DailyRow, OreRow, Summary, User } from '../lib/api'
import { delta, int, isk, isoDay, m3, pct, short, weekday } from '../lib/format'
import { useRange, useStats } from '../lib/hooks'

function Delta({ current, previous, label }: { current: number; previous: number; label: string }) {
  const d = delta(current, previous)
  if (d === null) return <span className="delta">nothing in the {label} before</span>
  const up = d >= 0
  return (
    <span className="delta">
      <span className={up ? 'up' : 'down'}>
        {up ? '▲' : '▼'} {pct(Math.abs(d))}
      </span>{' '}
      vs the {label} before
    </span>
  )
}

function periodName(preset: string, days: number) {
  if (preset === 'all') return 'all time'
  if (preset === '1y') return 'the last year'
  return `the last ${days} days`
}

export function SyncNotice({ user }: { user: User }) {
  const broken = user.characters.filter((c) => !c.token_valid)
  if (!broken.length) return null
  return (
    <div className="notice" role="alert">
      <p>
        {broken.length === 1 ? `${broken[0].name} has` : `${broken.length} alts have`} lost ESI access, so new mining isn't
        being recorded for {broken.length === 1 ? 'them' : 'those alts'}.
      </p>
      <Link className="btn btn-quiet btn-small" to="/alts">
        Review alts
      </Link>
    </div>
  )
}

export default function Overview({ user }: { user: User }) {
  const range = useRange()
  const { search } = useLocation()
  const measure = range.measure
  const summary = useStats<Summary>('summary')
  const daily = useStats<DailyRow[]>('daily')
  const ores = useStats<OreRow[]>('ores')
  const alts = useStats<AltStats[]>('characters')
  const yearStart = isoDay(new Date(Date.now() - 370 * 86400000))
  const calQs = new URLSearchParams({ start: yearStart, end: range.end, ...(range.alts.length ? { characters: range.alts.join(',') } : {}) })
  const calendar = useStats<CalendarRow[]>('calendar', { qs: calQs.toString() })

  const s = summary.data
  const t = s?.totals
  const period = periodName(range.preset, range.days)
  const prevLabel = range.preset === 'all' ? 'period' : `${range.days} days`

  if (s && t && t.units === 0 && range.preset !== 'all' && summary.data?.previous.units === 0) {
    const neverSynced = user.characters.every((c) => !c.last_synced_at)
    return (
      <>
        <SyncNotice user={user} />
        <div className="empty">
          <h2>{neverSynced ? 'Reading your mining ledgers' : `No mining in ${period}`}</h2>
          <p>
            {neverSynced
              ? 'Strata is fetching the last 30 days of mining for each alt from ESI. This usually takes under a minute; refresh shortly.'
              : 'ESI only reports mining once a character has actually mined. Try a longer range, or add the alts that do your mining.'}
          </p>
          <Link className="btn btn-primary" to={{ pathname: '/', search: '?range=all' }}>
            Show all time
          </Link>{' '}
          <a className="btn btn-quiet" href="/auth/login">
            Add an alt
          </a>
        </div>
      </>
    )
  }

  const refineGain = t && t.value ? t.refined / t.value - 1 : 0
  const altRows = alts.data ?? []
  const topAlts = altRows.slice(0, 10)
  const topAltMax = Math.max(1, ...topAlts.map((a) => a[measure]))
  const topOre = ores.data?.[0]

  return (
    <>
      <SyncNotice user={user} />
      <section className="hero" aria-label="Totals">
        <div>
          <p className="hero-line">
            {t ? `${t.active_characters} of ${s!.character_count} alts mined, over ${period}` : ' '}
          </p>
          <p className="hero-figure">
            {t ? (
              <>
                {short(measure === 'value' ? t.value : t.m3)}
                <span className="unit">{measure === 'value' ? 'ISK' : 'm³'}</span>
              </>
            ) : (
              <span className="skeleton" style={{ display: 'inline-block', width: '5ch', height: '0.9em' }} />
            )}
          </p>
        </div>
        {t && s && (
          <dl className="hero-side">
            <div className="fact">
              <dt>{measure === 'value' ? 'Volume' : `Value at Jita ${s.price_basis}`}</dt>
              <dd>{measure === 'value' ? m3(t.m3) : isk(t.value)}</dd>
              <Delta current={measure === 'value' ? t.m3 : t.value} previous={measure === 'value' ? s.previous.m3 : s.previous.value} label={prevLabel} />
            </div>
            <div className="fact">
              <dt>{measure === 'value' ? 'Value change' : 'Units'}</dt>
              <dd>{measure === 'value' ? pct(delta(t.value, s.previous.value) ?? 0) : short(t.units)}</dd>
              {measure === 'value' ? (
                <span className="delta">vs the {prevLabel} before</span>
              ) : (
                <span className="delta">{int(t.units)} units of ore</span>
              )}
            </div>
            <div className="fact">
              <dt>If refined at {pct(s.reprocess_yield, 1)}</dt>
              <dd>{isk(t.refined)}</dd>
              <span className="delta">
                <span className={refineGain >= 0 ? 'up' : 'down'}>
                  {refineGain >= 0 ? '+' : '−'}
                  {pct(Math.abs(refineGain), 1)}
                </span>{' '}
                {refineGain >= 0 ? 'more than selling the ore' : 'less than selling the ore'}
              </span>
            </div>
            <div className="fact">
              <dt>Mining days</dt>
              <dd>
                {t.active_days} <span className="muted" style={{ fontSize: '0.6em' }}>of {range.preset === 'all' ? '—' : s.days}</span>
              </dd>
              <span className="delta">
                {t.systems} {t.systems === 1 ? 'system' : 'systems'}
              </span>
            </div>
          </dl>
        )}
      </section>

      {ores.data && <StrataBand ores={ores.data} measure={measure} />}

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Output over time</h2>
            <p>Everything your alts mined, stacked by ore class. Hover a column for the breakdown.</p>
          </div>
        </div>
        {daily.data ? (
          <DailyChart rows={daily.data} start={range.start} end={range.end} measure={measure} />
        ) : (
          <div className="skeleton" style={{ height: 260 }} />
        )}
      </section>

      <section className="section split">
        <div>
          <div className="section-head">
            <div>
              <h2>Alts by output</h2>
              <p>Ranked by {measure === 'value' ? 'ISK value' : 'volume'} over {period}.</p>
            </div>
            {altRows.length > topAlts.length && (
              <Link className="linkish" to={{ pathname: '/alts', search }}>
                All {altRows.length} alts
              </Link>
            )}
          </div>
          <ol className="ranked">
            {topAlts.map((a) => (
              <li key={a.character_id}>
                <Portrait id={a.character_id} name={a.name} />
                <div className="name">
                  <b>{a.name}</b>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(a[measure] / topAltMax) * 100}%` }} />
                  </div>
                </div>
                <span className="v hide-sm muted">{t && t[measure] ? pct(a[measure] / t[measure]) : '–'}</span>
                <span className="v">{measure === 'value' ? isk(a.value) : m3(a.m3)}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <div className="section-head">
            <div>
              <h2>Worth knowing</h2>
              <p>Over {period}.</p>
            </div>
          </div>
          {t && s && (
            <dl className="facts-list">
              {s.best_day && (
                <div>
                  <dt>Best day</dt>
                  <dd>{isk(s.best_day.value)}</dd>
                  <span className="note">
                    {weekday(s.best_day.date)}, {s.best_day.characters} alts, {m3(s.best_day.m3)}
                  </span>
                </div>
              )}
              <div>
                <dt>Average mining day</dt>
                <dd>{isk(t.active_days ? t.value / t.active_days : 0)}</dd>
                <span className="note">{m3(t.active_days ? t.m3 / t.active_days : 0)} across all alts</span>
              </div>
              <div>
                <dt>Per alt, per mining day</dt>
                <dd>{m3(altRows.reduce((sum, a) => sum + a.active_days, 0) ? t.m3 / altRows.reduce((sum, a) => sum + a.active_days, 0) : 0)}</dd>
                <span className="note">Roughly what one alt pulls on a day it undocks to mine</span>
              </div>
              {topOre && (
                <div>
                  <dt>Most valuable ore</dt>
                  <dd>{topOre.type_name}</dd>
                  <span className="note">
                    {isk(topOre.value)}, {pct(topOre.value / (t.value || 1))} of the total
                  </span>
                </div>
              )}
              {Math.abs(t.value - t.value_then) > t.value * 0.001 && (
                <div>
                  <dt>Price move since mining</dt>
                  <dd>{`${t.value >= t.value_then ? '+' : '−'}${isk(Math.abs(t.value - t.value_then))}`}</dd>
                  <span className="note">Today's Jita {s.price_basis} value against the price on the day each ore was mined</span>
                </div>
              )}
            </dl>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>The past year</h2>
            <p>Each square is a day, shaded by {measure === 'value' ? 'ISK value' : 'volume'} mined across the selected alts.</p>
          </div>
        </div>
        {calendar.data ? <CalendarHeat rows={calendar.data} end={range.end} measure={measure} /> : <div className="skeleton" style={{ height: 140 }} />}
      </section>
    </>
  )
}
