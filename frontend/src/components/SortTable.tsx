import { useState, type ReactNode } from 'react'

export interface Column<T> {
  key: string
  label: ReactNode
  align?: 'r'
  className?: string
  sort?: (row: T) => number | string
  render: (row: T) => ReactNode
  foot?: ReactNode
}

export default function SortTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  caption,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  initialSort?: string
  caption: string
}) {
  const [sortKey, setSortKey] = useState(initialSort)
  const [desc, setDesc] = useState(true)
  const col = columns.find((c) => c.key === sortKey)
  const sorted = col?.sort
    ? [...rows].sort((a, b) => {
        const va = col.sort!(a)
        const vb = col.sort!(b)
        const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)
        return desc ? -cmp : cmp
      })
    : rows
  const hasFoot = columns.some((c) => c.foot !== undefined)

  return (
    <div className="table-wrap">
      <table className="data">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={[c.align, c.className].filter(Boolean).join(' ') || undefined}
                aria-sort={sortKey === c.key ? (desc ? 'descending' : 'ascending') : undefined}
              >
                {c.sort ? (
                  <button
                    onClick={() => {
                      if (sortKey === c.key) setDesc(!desc)
                      else {
                        setSortKey(c.key)
                        setDesc(typeof c.sort!(rows[0] ?? ({} as T)) !== 'string')
                      }
                    }}
                  >
                    {c.label}
                    {sortKey === c.key ? (desc ? ' ↓' : ' ↑') : ''}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.key} className={[c.align, c.className].filter(Boolean).join(' ') || undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {hasFoot && (
          <tfoot>
            <tr>
              {columns.map((c) => (
                <td key={c.key} className={[c.align, c.className].filter(Boolean).join(' ') || undefined}>
                  {c.foot}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
