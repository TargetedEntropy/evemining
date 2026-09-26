import { secRounded } from '../lib/format'

// The in-game security colours. Players read these instantly, so they are used as-is
// on the number itself; the band name next to it carries the meaning without colour.
const SEC_COLORS = ['#f00000', '#d73000', '#f04800', '#f06000', '#d77700', '#effd00', '#8ffd00', '#00ff00', '#00ff9d', '#00ffd8', '#2ffeff']

export default function Sec({ sec }: { sec: number | null }) {
  if (sec === null) return <span className="muted">?</span>
  const r = secRounded(sec)
  const color = SEC_COLORS[Math.max(0, Math.min(10, Math.round(r * 10)))]
  return (
    <span className="sec" style={{ color: `color-mix(in srgb, ${color} 78%, var(--ink))` }}>
      {r.toFixed(1)}
    </span>
  )
}

