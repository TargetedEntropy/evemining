import { useState } from 'react'
import { portrait } from '../lib/format'

export default function Portrait({ id, name, large }: { id: number; name: string; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  const cls = `portrait${large ? ' lg' : ''}`
  if (failed) {
    const initials = name
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
    return (
      <span className={cls} aria-hidden="true">
        {initials}
      </span>
    )
  }
  return <img className={cls} src={portrait(id, 64)} alt="" loading="lazy" onError={() => setFailed(true)} />
}
