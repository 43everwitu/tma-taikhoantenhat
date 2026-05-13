'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export interface FilterValue {
  sort: 'default' | 'price_asc' | 'price_desc' | 'newest' | 'name_asc' | 'name_desc'
  priceMin: number | ''
  priceMax: number | ''
}

interface Props {
  value: FilterValue
  onChange: (v: FilterValue) => void
}

const SORTS: { k: FilterValue['sort']; label: string }[] = [
  { k: 'default', label: 'Mặc định' },
  { k: 'price_asc', label: 'Giá ↑' },
  { k: 'price_desc', label: 'Giá ↓' },
  { k: 'newest', label: 'Mới nhất' },
  { k: 'name_asc', label: 'A → Z' },
  { k: 'name_desc', label: 'Z → A' },
]

const PRICE_PRESETS: { label: string; min: number | ''; max: number | '' }[] = [
  { label: 'Tất cả', min: '', max: '' },
  { label: '< 100K', min: '', max: 100_000 },
  { label: '100K – 500K', min: 100_000, max: 500_000 },
  { label: '500K – 1M', min: 500_000, max: 1_000_000 },
  { label: '> 1M', min: 1_000_000, max: '' },
]

function formatVndShort(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${n}`
}

function priceLabel(min: FilterValue['priceMin'], max: FilterValue['priceMax']) {
  if (min === '' && max === '') return null
  if (min !== '' && max !== '') return `${formatVndShort(min)} – ${formatVndShort(max)}`
  if (min !== '') return `≥ ${formatVndShort(min)}`
  return `≤ ${formatVndShort(max as number)}`
}

export function FilterBar({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const sortLabel = value.sort !== 'default' ? SORTS.find((s) => s.k === value.sort)?.label : null
  const pLabel = priceLabel(value.priceMin, value.priceMax)
  const activeCount = (sortLabel ? 1 : 0) + (pLabel ? 1 : 0)

  function clearSort() { onChange({ ...value, sort: 'default' }) }
  function clearPrice() { onChange({ ...value, priceMin: '', priceMax: '' }) }
  function reset() { onChange({ sort: 'default', priceMin: '', priceMax: '' }); setOpen(false) }

  return (
    <div ref={wrapRef} className="relative">
      <div className="miniapp-filterbar">
        {sortLabel && (
          <span className="miniapp-filterbar-chip">
            {sortLabel}
            <button type="button" onClick={clearSort} aria-label="Bỏ sắp xếp">
              <Icon name="close" size={12} />
            </button>
          </span>
        )}
        {pLabel && (
          <span className="miniapp-filterbar-chip">
            {pLabel}
            <button type="button" onClick={clearPrice} aria-label="Bỏ khoảng giá">
              <Icon name="close" size={12} />
            </button>
          </span>
        )}
        <span className="miniapp-filterbar-spacer" />
        <button
          type="button"
          className="miniapp-filterbar-btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Bộ lọc"
        >
          <Icon name="filter" size={14} />
          <span>Lọc</span>
          {activeCount > 0 && <span className="miniapp-filterbar-btn-count">{activeCount}</span>}
        </button>
      </div>

      {open && (
        <div className="miniapp-filter-panel" role="dialog" aria-label="Bộ lọc">
          <div>
            <h4>Sắp xếp</h4>
            <div className="miniapp-chip-row" style={{ marginTop: 0 }}>
              {SORTS.map((s) => (
                <button
                  key={s.k}
                  type="button"
                  className="miniapp-chip"
                  aria-pressed={value.sort === s.k}
                  onClick={() => onChange({ ...value, sort: s.k })}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4>Khoảng giá</h4>
            <div className="miniapp-chip-row" style={{ marginTop: 0 }}>
              {PRICE_PRESETS.map((p) => {
                const active = value.priceMin === p.min && value.priceMax === p.max
                return (
                  <button
                    key={p.label}
                    type="button"
                    className="miniapp-chip"
                    aria-pressed={active}
                    onClick={() => onChange({ ...value, priceMin: p.min, priceMax: p.max })}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
            <div className="price-inputs">
              <input
                type="number"
                inputMode="numeric"
                placeholder="Từ"
                step={10000}
                min={0}
                value={value.priceMin}
                onChange={(e) => onChange({ ...value, priceMin: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
              />
              <span className="opacity-60 text-xs">–</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="Đến"
                step={10000}
                min={0}
                value={value.priceMax}
                onChange={(e) => onChange({ ...value, priceMax: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
              />
              <span className="opacity-60 text-xs">đ</span>
            </div>
          </div>
          <div className="miniapp-filter-panel-actions">
            <button type="button" onClick={reset}>Đặt lại</button>
            <button type="button" onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>
      )}
    </div>
  )
}
