'use client'

import { ReactNode } from 'react'

export interface Column<T> {
  /** Header label shown in the table head AND as the row-label in card view. */
  header: string
  /** Render the cell. Receives the row + index. */
  cell: (row: T, index: number) => ReactNode
  /** Optional: extra classes for the <th>/<td> on table view. */
  className?: string
  /** Optional: hide this column on the card list (e.g. avatar already in header). */
  hideOnCard?: boolean
  /** Optional: when true, render this column as the card's header line. */
  primary?: boolean
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  loading?: boolean
  emptyText?: string
  /** Optional render of action buttons in the card footer. */
  cardActions?: (row: T) => ReactNode
}

export function ResponsiveTable<T>({
  rows, columns, rowKey, loading, emptyText = 'Không có dữ liệu', cardActions,
}: Props<T>) {
  if (loading) {
    return (
      <div className="clay-card p-6 space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 bg-clay-oat-light rounded animate-pulse" />
        ))}
      </div>
    )
  }
  if (rows.length === 0) {
    return <div className="clay-card p-12 text-center text-clay-silver">{emptyText}</div>
  }

  return (
    <>
      {/* Table on md+ */}
      <div className="hidden md:block clay-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-clay-oat-light border-b border-clay-oat">
              <tr>
                {columns.map((col, i) => (
                  <th key={i} className={`text-left text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4 ${col.className || ''}`}>
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rowKey(row)} className="border-b border-clay-oat-light hover:bg-clay-oat-light/40 align-top">
                  {columns.map((col, cIdx) => (
                    <td key={cIdx} className={`py-3 px-4 ${col.className || ''}`}>
                      {col.cell(row, rIdx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Card list on <md */}
      <ul className="md:hidden clay-card-list">
        {rows.map((row, rIdx) => {
          const primary = columns.find(c => c.primary)
          const others = columns.filter(c => !c.primary && !c.hideOnCard)
          return (
            <li key={rowKey(row)} className="clay-card-list-item">
              {primary && (
                <div className="font-semibold mb-2">{primary.cell(row, rIdx)}</div>
              )}
              <dl className="space-y-1.5 text-sm">
                {others.map((col, cIdx) => (
                  <div key={cIdx} className="flex items-baseline gap-2">
                    <dt className="clay-row-label">{col.header}</dt>
                    <dd className="flex-1 min-w-0">{col.cell(row, rIdx)}</dd>
                  </div>
                ))}
              </dl>
              {cardActions && (
                <div className="mt-3 pt-3 border-t border-clay-oat-light flex flex-wrap gap-2">
                  {cardActions(row)}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
