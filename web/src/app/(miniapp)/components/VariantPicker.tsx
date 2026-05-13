'use client'

import { formatPrice } from '@/lib/utils'

export interface Variant {
  id: string
  name: string
  description: string
  price: number
  stock: number
  requiresInput: boolean
  inputLabel: string | null
  inputPlaceholder: string | null
  inputType?: string
  imageUrl?: string
}

interface Props {
  variants: Variant[]
  selectedId: string | null
  onSelect: (id: string) => void
  inputValue: string
  onInputChange: (v: string) => void
}

export function VariantPicker({ variants, selectedId, onSelect, inputValue, onInputChange }: Props) {
  const selected = variants.find((v) => v.id === selectedId) ?? null

  return (
    <div className="space-y-2">
      <div className="miniapp-variant-grid">
        {variants.map((v) => {
          const out = v.stock <= 0
          return (
            <button
              key={v.id}
              type="button"
              className="miniapp-variant-tile"
              aria-pressed={selectedId === v.id}
              aria-disabled={out}
              disabled={out}
              onClick={() => onSelect(v.id)}
            >
              <span className="v-name">{v.name}</span>
              <span className="v-meta">
                <span className="v-price">{formatPrice(v.price)}</span>
                <span className={`v-stock ${out ? 'v-stock--out' : 'v-stock--in'}`}>
                  {out ? 'Hết' : `Còn ${v.stock}`}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {selected?.description && (
        <div
          className="rich-text text-xs opacity-80"
          dangerouslySetInnerHTML={{ __html: selected.description }}
        />
      )}
      {selected?.requiresInput && (
        <div>
          <label className="block text-xs opacity-70 mb-1">{selected.inputLabel || 'Thông tin'}</label>
          {selected.inputType === 'textarea' ? (
            <textarea
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder={selected.inputPlaceholder || ''}
              rows={3}
              className="w-full rounded-xl px-3 py-2 text-sm"
              style={{
                background: 'var(--tg-bg-2, #fff)',
                border: '1px solid color-mix(in srgb, var(--brand-ink) 14%, transparent)',
              }}
              minLength={3}
              maxLength={500}
              required
            />
          ) : (
            <input
              type={selected.inputType || 'text'}
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder={selected.inputPlaceholder || ''}
              className="w-full rounded-xl px-3 py-2 text-sm"
              style={{
                background: 'var(--tg-bg-2, #fff)',
                border: '1px solid color-mix(in srgb, var(--brand-ink) 14%, transparent)',
              }}
              minLength={3}
              maxLength={200}
              required
            />
          )}
        </div>
      )}
    </div>
  )
}
