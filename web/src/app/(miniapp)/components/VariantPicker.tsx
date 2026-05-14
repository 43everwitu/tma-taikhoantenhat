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
          <span className="v-name">{selected ? selected.name : 'Chọn biến thể'}</span>
          {selected && (
            <span className="v-meta">
              <span className="v-price">{formatPrice(selected.price)}</span>
              <span className={`v-stock v-stock--${stockTone(selected)}`}>{stockLabel(selected)}</span>
            </span>
          )}
          <Icon name="chevronRight" size={16} className={open ? 'rotate-90' : ''} />
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
                      <span className="v-price">{formatPrice(v.price)}</span>
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
          className="rich-text text-xs opacity-80"
          dangerouslySetInnerHTML={{ __html: selected.description }}
        />
      )}
      {selected?.requiresInput && (
        <div className="miniapp-variant-input-card">
          <div className="miniapp-variant-input-header">
            <Icon name="info" size={14} />
            <span>Thông tin cần cung cấp</span>
          </div>
          <div className="space-y-2 mt-2">
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
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--brand-ink)' }}>
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
                        background: '#fff',
                        border: '1px solid color-mix(in srgb, var(--brand-gold) 50%, transparent)',
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
                        background: '#fff',
                        border: '1px solid color-mix(in srgb, var(--brand-gold) 50%, transparent)',
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
        </div>
      )}
    </div>
  )
}
