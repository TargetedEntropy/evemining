import { Glyph } from '../components/Shell'

// A core log: one bed per ore, thickness and reach loosely echoing a real week of mining.
const CORE: { c: string; ore: string; m3: string; w: number; h: number }[] = [
  { c: 'asteroid', ore: 'Veldspar', m3: '412K m³', w: 92, h: 30 },
  { c: 'asteroid', ore: 'Scordite', m3: '268K m³', w: 74, h: 22 },
  { c: 'moon', ore: 'Zeolites', m3: '190K m³', w: 81, h: 18 },
  { c: 'asteroid', ore: 'Pyroxeres', m3: '151K m³', w: 63, h: 14 },
  { c: 'ice', ore: 'Clear Icicle', m3: '138K m³', w: 100, h: 26 },
  { c: 'moon', ore: 'Sylvite', m3: '96K m³', w: 58, h: 12 },
  { c: 'asteroid', ore: 'Kernite', m3: '84K m³', w: 69, h: 16 },
  { c: 'gas', ore: 'Fullerite-C50', m3: '22K m³', w: 38, h: 8 },
  { c: 'ice', ore: 'White Glaze', m3: '61K m³', w: 86, h: 20 },
]

export default function Landing() {
  const error = new URLSearchParams(window.location.search).get('login_error')

  return (
    <div className="landing">
      <header className="topbar">
        <div className="wrap">
          <span className="wordmark keep">
            <Glyph />
            <span>Strata</span>
          </span>
        </div>
      </header>

      <main style={{ padding: 0 }}>
        <div className="wrap">
          <section className="landing-hero">
            <div>
              <h1>Every alt's ore in one ledger.</h1>
              <p className="lede">
                Link the characters you mine with and Strata keeps their mining ledgers, well past ESI's 30 days. See what
                the whole fleet pulled, what it's worth at Jita, and whether refining pays.
              </p>
              {error && <p className="error-banner">{error}</p>}
              <a className="btn btn-primary sso-button" href="/auth/login">
                Log in with EVE Online
              </a>
              <p className="fineprint">
                Strata asks for one permission: reading your mining ledger. No wallet, assets, or mail. Add your alts after
                the first login.
              </p>
            </div>
            <div className="core" aria-hidden="true">
              {CORE.map((l, i) => (
                <div className="core-layer" key={l.ore} style={{ height: Math.max(l.h, 20) }}>
                  <div className="bed" style={{ ['--w' as string]: `${l.w}%`, height: l.h, ['--l' as string]: `var(--c-${l.c})`, ['--i' as string]: i }} />
                  <small>
                    <b>{l.ore}</b>
                    {l.m3}
                  </small>
                </div>
              ))}
            </div>
          </section>

          <section className="landing-points">
            <div>
              <h3>All your alts, one total</h3>
              <p>Add five characters or twenty. Totals, rankings, and daily output roll up across every one of them.</p>
            </div>
            <div>
              <h3>History that doesn't expire</h3>
              <p>ESI forgets after 30 days. Strata syncs every half hour and keeps every day, so a year from now you can still see this week.</p>
            </div>
            <div>
              <h3>What it's actually worth</h3>
              <p>Ore priced at Jita buy or sell, and as refined minerals at your own reprocessing yield. Ice, moon ore, and gas included.</p>
            </div>
          </section>
        </div>
      </main>

      <footer className="site">
        <div className="wrap">
          <span>Built for miners with too many alts.</span>
          <span>EVE Online and all related materials are property of CCP hf.</span>
        </div>
      </footer>
    </div>
  )
}
