import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type User } from '../lib/api'

const YIELD_PRESETS = [
  { label: 'NPC station, max skills, 4% implant', value: 0.724 },
  { label: 'Our default', value: 0.85 },
  { label: 'Tatara, T2 rig, null-sec, max skills', value: 0.906 },
]

export default function Settings({ user }: { user: User }) {
  const qc = useQueryClient()
  const [yieldPct, setYieldPct] = useState(Math.round(user.reprocess_yield * 1000) / 10)
  const [basis, setBasis] = useState(user.price_basis)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirty = yieldPct / 100 !== user.reprocess_yield || basis !== user.price_basis

  const save = async () => {
    setSaving(true)
    const next = await api.saveSettings({ reprocess_yield: yieldPct / 100, price_basis: basis })
    qc.setQueryData(['me'], next)
    await qc.invalidateQueries({ queryKey: ['stats'] })
    setSaving(false)
    setSaved(true)
  }

  const deleteAccount = async () => {
    if (!confirm('Delete your Strata account, every linked alt, and all recorded mining history? This cannot be undone.')) return
    await api.deleteAccount()
    await api.logout().catch(() => undefined)
    qc.setQueryData(['me'], null)
  }

  return (
    <>
      <h1 className="page-title">Valuation settings</h1>
      <p className="page-lede">These decide how Strata turns units of ore into ISK. They apply to every page and every range.</p>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="yield">Reprocessing yield</label>
          <p>The share of minerals you actually get back when you refine. It depends on skills, implant, structure, rigs, and security.</p>
          <div className="slider-row">
            <input
              id="yield"
              type="range"
              min={50}
              max={95}
              step={0.1}
              value={yieldPct}
              onChange={(e) => {
                setYieldPct(Number(e.target.value))
                setSaved(false)
              }}
            />
            <output htmlFor="yield">{yieldPct.toFixed(1)}%</output>
          </div>
          <div className="presets">
            {YIELD_PRESETS.map((p) => (
              <button
                key={p.value}
                className="chip"
                aria-pressed={Math.abs(yieldPct - p.value * 100) < 0.05}
                onClick={() => {
                  setYieldPct(p.value * 100)
                  setSaved(false)
                }}
              >
                {(p.value * 100).toFixed(1)}%, {p.label.charAt(0).toLowerCase() + p.label.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <fieldset className="field">
          <legend>Jita price</legend>
          <p>Buy is what you get selling instantly into buy orders. Sell is what you'd get listing and waiting.</p>
          <div className="segmented" role="radiogroup" style={{ display: 'inline-flex' }}>
            {(['buy', 'sell'] as const).map((b) => (
              <button
                key={b}
                role="radio"
                aria-checked={basis === b}
                aria-pressed={basis === b}
                onClick={() => {
                  setBasis(b)
                  setSaved(false)
                }}
              >
                {b === 'buy' ? 'Buy orders (instant)' : 'Sell orders (listed)'}
              </button>
            ))}
          </div>
        </fieldset>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving' : 'Save settings'}
          </button>
          {saved && !dirty && <span className="sub">Settings saved. Every page now uses them.</span>}
        </div>

        <div className="field danger-zone">
          <label>Delete account</label>
          <p>Removes your account, all {user.characters.length} linked alts, and every day of recorded mining. ESI access tokens are discarded.</p>
          <button className="btn btn-danger" onClick={deleteAccount}>
            Delete account
          </button>
        </div>
      </div>
    </>
  )
}
