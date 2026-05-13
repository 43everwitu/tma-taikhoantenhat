'use client'

import { formatPrice } from '@/lib/utils'

export interface VariantInputField {
  label: string
  placeholder?: string | null
  type: 'text' | 'email' | 'password' | 'tel' | 'url' | 'number' | 'textarea'
  required: boolean
}

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
  inputFields?: VariantInputField[] | null
  imageUrl?: string
  isBackorder?: boolean
}

interface Props {
  variants: Variant[]
  selectedId: string | null
  onSelect: (id: string) => void
  inputValues: Record<string, string>
  onInputChange: (values: Record<string, string>) => void
}

export function VariantPicker({ variants, selectedId, onSelect, inputValues, onInputChange }: Props) {
  const selected = variants.find((v) => v.id === selectedId) ?? null

  return (
    <div className="space-y-2">
      <div className="miniapp-variant-grid">
        {variants.map((v) => {
          const out = v.stock <= 0 && !v.isBackorder
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
                  {v.isBackorder ? '∞' : (out ? 'Hết' : `Còn ${v.stock}`)}
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
        <div className="space-y-2">
          {(() => {
            const fields: VariantInputField[] =
              selected.inputFields && selected.inputFields.length > 0
                ? selected.inputFields
                : [{
                    label: selected.inputLabel || 'Thông tin',
                    placeholder: selected.inputPlaceholder || '',
                    type: (selected.inputType as VariantInputField['type']) || 'text',
                    required: true,
                  }]

            return fields.map((f, idx) => (
              <div key={`${f.label}-${idx}`}>
                <label className="block text-xs opacity-70 mb-1">
                  {f.label}{f.required && <span className="text-red-500"> *</span>}
                </label>
                {f.type === 'textarea' ? (
                  <textarea
                    value={inputValues[f.label] ?? ''}
                    onChange={(e) => onInputChange({ ...inputValues, [f.label]: e.target.value })}
                    placeholder={f.placeholder ?? ''}
                    rows={3}
                    className="w-full rounded-xl px-3 py-2 text-sm"
                    style={{
                      background: 'var(--tg-bg-2, #fff)',
                      border: '1px solid color-mix(in srgb, var(--brand-ink) 14%, transparent)',
                    }}
                    minLength={f.required ? 1 : 0}
                    maxLength={500}
                    required={f.required}
                  />
                ) : (
                  <input
                    type={f.type}
                    value={inputValues[f.label] ?? ''}
                    onChange={(e) => onInputChange({ ...inputValues, [f.label]: e.target.value })}
                    placeholder={f.placeholder ?? ''}
                    className="w-full rounded-xl px-3 py-2 text-sm"
                    style={{
                      background: 'var(--tg-bg-2, #fff)',
                      border: '1px solid color-mix(in srgb, var(--brand-ink) 14%, transparent)',
                    }}
                    minLength={f.required ? 1 : 0}
                    maxLength={200}
                    required={f.required}
                  />
                )}
              </div>
            ))
          })()}
        </div>
      )}
    </div>
  )
}
