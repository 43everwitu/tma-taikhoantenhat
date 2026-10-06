'use client'

import { ReactNode, Ref } from 'react'

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
  /** Optional: bind a ref to the row's wrapping element (used by audit
   *  highlight). Returns the ref callback for the given row's id. */
  rowRef?: (id: string | number) => Ref<HTMLElement>
  selectable?: boolean
  selectedIds?: Set<string | number>
  onToggleRow?: (id: string | number, checked: boolean) => void
  onToggleAll?: (checked: boolean) => void
  isRowSelectable?: (row: T) => boolean
}

export function ResponsiveTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  emptyText = 'Không có dữ liệu',
  cardActions,
  rowRef,
  selectable = false,
  selectedIds = new Set(),
  onToggleRow,
  onToggleAll,
  isRowSelectable,
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

  const canSelect = (row: T) => !isRowSelectable || isRowSelectable(row)
  const selectableRows = rows.filter(canSelect)
  const allSelected = selectableRows.length > 0 && selectableRows.every((row) => selectedIds.has(rowKey(row)))

  return (
    <>
      {/* Table on md+ */}
      <div className="hidden md:block clay-card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-clay-oat-light border-b border-clay-oat">
              <tr>
                {selectable && (
                  <th className="text-left py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      disabled={selectableRows.length === 0}
                      onChange={(e) => onToggleAll?.(e.target.checked)}
                      aria-label="Chọn tất cả"
                      className="h-4 w-4"
                    />
                  </th>
                )}
                {columns.map((col, i) => (
                  <th key={i} className={`text-left text-xs uppercase tracking-wider text-clay-charcoal py-3 px-4 ${col.className || ''}`}>
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => {
                const k = rowKey(row)
                const rowSelectable = canSelect(row)
                const selected = selectedIds.has(k)
                return (
                  <tr
                    key={k}
                    ref={rowRef ? (rowRef(k) as Ref<HTMLTableRowElement>) : undefined}
                    className={`border-b border-clay-oat-light hover:bg-clay-oat-light/40 align-top ${selected ? 'bg-clay-oat-light/60' : ''}`}
                  >
                    {selectable && (
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!rowSelectable}
                          onChange={(e) => onToggleRow?.(k, e.target.checked)}
                          aria-label={`Chọn dòng ${String(k)}`}
                          className="h-4 w-4"
                        />
                      </td>
                    )}
                    {columns.map((col, cIdx) => (
                      <td key={cIdx} className={`py-3 px-4 ${col.className || ''}`}>
                        {col.cell(row, rIdx)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Card list on <md */}
      <ul className="md:hidden clay-card-list">
        {rows.map((row, rIdx) => {
          const primary = columns.find(c => c.primary)
          const others = columns.filter(c => !c.primary && !c.hideOnCard)
          const k = rowKey(row)
          const rowSelectable = canSelect(row)
          const selected = selectedIds.has(k)
          return (
            <li
              key={k}
              ref={rowRef ? (rowRef(k) as Ref<HTMLLIElement>) : undefined}
              className={`clay-card-list-item ${selected ? 'ring-2 ring-clay-ink/20' : ''}`}
            >
              {(primary || selectable) && (
                <div className="font-semibold mb-2 flex items-start gap-2">
                  {selectable && (
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!rowSelectable}
                      onChange={(e) => onToggleRow?.(k, e.target.checked)}
                      aria-label={`Chọn dòng ${String(k)}`}
                      className="h-4 w-4 mt-0.5"
                    />
                  )}
                  {primary && <div className="min-w-0 flex-1">{primary.cell(row, rIdx)}</div>}
                </div>
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
