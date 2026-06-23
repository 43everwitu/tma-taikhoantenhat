'use client'

import { useEffect, useRef, useState } from 'react'
import { formatPrice } from '@/lib/utils'
import { Icon } from './Icon'

export interface VariantInputField {
  label: string
  placeholder?: string | null
  type: 'text' | 'email' | 'password' | 'tel' | 'url' | 'number' | 'textarea'
  required: boolean
}

// Stable key for storing a field's value. Labels are optional, so empty-label
// fields fall back to a positional key that won't collide. The `__field_` prefix
// is recognised server-side (delivery message) to render the value without a
// label caption.
export function variantFieldKey(f: { label?: string | null }, idx: number): string {
  const l = (f.label ?? '').trim()
  return l.length > 0 ? l : `__field_${idx}`
}

export interface Variant {
  id: string
  name: string
  description: string
  price: number
  salePrice?: number
  discountLabel?: string
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

function stockLabel(v: Variant) {
  if (v.isBackorder) return '∞'
  if (v.stock <= 0) return 'Hết'
  return `Còn ${v.stock}`
}

function stockTone(v: Variant): 'in' | 'out' {
  if (v.isBackorder) return 'in'
  return v.stock <= 0 ? 'out' : 'in'
}

export function VariantPicker({ variants, selectedId, onSelect, inputValues, onInputChange }: Props) {
  const selected = variants.find((v) => v.id === selectedId) ?? null
  const priceNode = (v: Variant) => {
    const hasDiscount = typeof v.salePrice === 'number' && v.salePrice < v.price
    return (
      <span className="v-price">
        {hasDiscount ? formatPrice(v.salePrice!) : formatPrice(v.price)}
        {hasDiscount && <span className="ml-1 opacity-50 line-through">{formatPrice(v.price)}</span>}
      </span>
    )
  }

  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(id: string) {
    onSelect(id)
    setOpen(false)
  }

  return (
    <div className="space-y-2">
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="miniapp-variant-select"
        >
          <span className="v-select-body">
            <span className="v-name">{selected ? selected.name : 'Chọn biến thể'}</span>
            {selected && (
              <span className="v-meta">
                {priceNode(selected)}
                <span className={`v-stock v-stock--${stockTone(selected)}`}>{stockLabel(selected)}</span>
              </span>
            )}
          </span>
          <Icon name="chevronRight" size={16} className={`v-chevron shrink-0${open ? ' rotate-90' : ''}`} />
        </button>

        {open && (
          <ul role="listbox" className="miniapp-variant-list" aria-label="Biến thể">
            {variants.map((v) => {
              const out = v.stock <= 0 && !v.isBackorder
              const isSelected = selectedId === v.id
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={out}
                    disabled={out}
                    onClick={() => pick(v.id)}
                    className={`miniapp-variant-row ${isSelected ? 'is-selected' : ''} ${out ? 'is-out' : ''}`}
                  >
                    <span className="v-name">{v.name}</span>
                    <span className="v-meta">
                      {priceNode(v)}
                      <span className={`v-stock v-stock--${stockTone(v)}`}>{stockLabel(v)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {selected?.description && (
        <div
          className="rich-text opacity-80"
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

            return fields.map((f, idx) => {
              const key = variantFieldKey(f, idx)
              const hasLabel = (f.label ?? '').trim().length > 0
              return (
                <div key={`${key}-${idx}`}>
                  {(hasLabel || f.required) && (
                    <label className="block text-xs opacity-70 mb-1">
                      {f.label}{f.required && <span className="text-red-500"> *</span>}
                    </label>
                  )}
                  {f.type === 'textarea' ? (
                    <textarea
                      value={inputValues[key] ?? ''}
                      onChange={(e) => onInputChange({ ...inputValues, [key]: e.target.value })}
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
                      value={inputValues[key] ?? ''}
                      onChange={(e) => onInputChange({ ...inputValues, [key]: e.target.value })}
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
              )
            })
          })()}
        </div>
      )}
    </div>
  )
}
