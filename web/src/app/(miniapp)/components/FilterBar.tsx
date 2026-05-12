'use client'

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

export function FilterBar({ value, onChange }: Props) {
  return (
    <div className="space-y-2 mt-2">
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
      <div className="flex gap-2 items-center text-xs">
        <span className="opacity-60">Giá</span>
        <input
          type="number"
          placeholder="từ"
          value={value.priceMin}
          onChange={(e) => onChange({ ...value, priceMin: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
          className="rounded-lg px-2 py-1 text-xs w-24"
          style={{ background: 'var(--tg-bg-2, #fff)', border: '1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent)' }}
        />
        <span className="opacity-60">–</span>
        <input
          type="number"
          placeholder="đến"
          value={value.priceMax}
          onChange={(e) => onChange({ ...value, priceMax: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
          className="rounded-lg px-2 py-1 text-xs w-24"
          style={{ background: 'var(--tg-bg-2, #fff)', border: '1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent)' }}
        />
        <span className="opacity-60">đ</span>
        {(value.priceMin !== '' || value.priceMax !== '' || value.sort !== 'default') && (
          <button
            type="button"
            className="ml-auto text-xs opacity-70 underline"
            onClick={() => onChange({ sort: 'default', priceMin: '', priceMax: '' })}
          >Reset</button>
        )}
      </div>
    </div>
  )
}
