'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from '@/lib/icons'
import {
  filterAdminStockProductOptions,
  type AdminStockFilterOption,
  type AdminStockFilterProduct,
} from '@/lib/adminStockProductFilter'

export interface ProductVariantFilterValue {
  productId: string
  variantId: string
}

interface ProductVariantFilterComboboxProps {
  products: AdminStockFilterProduct[]
  value: ProductVariantFilterValue
  loading?: boolean
  onChange: (value: ProductVariantFilterValue) => void
}

type FilterChoice =
  | { key: 'all'; kind: 'all'; productId: ''; variantId: ''; productName: 'Tất cả sản phẩm'; variantName: '' }
  | AdminStockFilterOption

const ALL_PRODUCTS_CHOICE: FilterChoice = {
  key: 'all',
  kind: 'all',
  productId: '',
  variantId: '',
  productName: 'Tất cả sản phẩm',
  variantName: '',
}

export function ProductVariantFilterCombobox({
  products,
  value,
  loading = false,
  onChange,
}: ProductVariantFilterComboboxProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const selectedProduct = products.find((product) => product.id === value.productId)
  const selectedVariant = selectedProduct?.variantOptions?.find((variant) => variant.id === value.variantId)
  const selectedLabel = selectedProduct
    ? selectedVariant
      ? `${selectedProduct.name} · ${selectedVariant.name}`
      : selectedProduct.name
    : ''

  const results = useMemo(
    () => filterAdminStockProductOptions(products, query, 80),
    [products, query],
  )
  const choices = useMemo<FilterChoice[]>(
    () => query.trim() ? results : [ALL_PRODUCTS_CHOICE, ...results],
    [query, results],
  )
  const safeActiveIndex = Math.min(activeIndex, Math.max(choices.length - 1, 0))

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [])

  function selectChoice(choice: FilterChoice) {
    onChange({
      productId: choice.productId,
      variantId: choice.kind === 'variant' ? choice.variantId : '',
    })
    setQuery(
      choice.kind === 'variant'
        ? `${choice.productName} · ${choice.variantName}`
        : choice.kind === 'product'
          ? choice.productName
          : '',
    )
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => Math.min(current + 1, Math.max(choices.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Enter' && open && choices[safeActiveIndex]) {
      event.preventDefault()
      selectChoice(choices[safeActiveIndex])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setQuery(selectedLabel)
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-clay-silver"
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && choices[safeActiveIndex] ? `${listboxId}-${safeActiveIndex}` : undefined}
        value={open ? query : selectedLabel}
        disabled={loading}
        onFocus={(event) => {
          if (!open) setQuery(selectedLabel)
          setOpen(true)
          event.currentTarget.select()
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
        placeholder={loading ? 'Đang tải sản phẩm...' : 'Tìm sản phẩm hoặc biến thể'}
        className="clay-input w-full min-w-0 pl-9 pr-20 text-sm disabled:opacity-50"
      />
      {value.productId && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange({ productId: '', variantId: '' })
            setQuery('')
            setOpen(true)
          }}
          className="absolute right-10 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-clay-charcoal/60 hover:text-clay-charcoal"
          title="Xóa lọc sản phẩm"
          aria-label="Xóa lọc sản phẩm"
        >
          <X size={15} />
        </button>
      )}
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const nextOpen = !open
          if (nextOpen) setQuery(selectedLabel)
          setOpen(nextOpen)
          if (nextOpen) requestAnimationFrame(() => inputRef.current?.focus())
        }}
        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-clay-charcoal/60 hover:text-clay-charcoal"
        title={open ? 'Đóng danh sách' : 'Mở danh sách'}
        aria-label={open ? 'Đóng danh sách sản phẩm' : 'Mở danh sách sản phẩm'}
      >
        <ChevronDown size={16} className={open ? 'rotate-180' : ''} />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-40 mt-2 max-h-80 w-full min-w-[280px] overflow-y-auto rounded-lg border border-clay-oat bg-white py-1 shadow-xl"
        >
          {loading ? (
            <p className="px-3 py-3 text-sm text-clay-silver">Đang tải sản phẩm...</p>
          ) : choices.length === 0 ? (
            <p className="px-3 py-3 text-sm text-clay-silver">Không tìm thấy sản phẩm hoặc biến thể.</p>
          ) : (
            choices.map((choice, index) => {
              const selected = choice.productId === value.productId
                && (choice.kind !== 'variant' || choice.variantId === value.variantId)
                && (choice.kind !== 'product' || !value.variantId)
              const active = index === safeActiveIndex
              return (
                <button
                  key={choice.key}
                  id={`${listboxId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectChoice(choice)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                    active ? 'bg-clay-cream' : 'bg-white hover:bg-clay-cream/70'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-clay-charcoal">
                        {choice.productName}
                      </span>
                      {choice.kind !== 'all' && (
                        <span className="clay-pill shrink-0 px-2 py-0.5 text-[10px]">
                          {choice.kind === 'variant' ? 'Biến thể' : 'Sản phẩm'}
                        </span>
                      )}
                    </span>
                    {choice.kind === 'variant' && (
                      <span className="mt-0.5 block truncate text-xs text-clay-charcoal/70">
                        {choice.variantName}
                      </span>
                    )}
                    {choice.kind === 'product' && (
                      <span className="mt-0.5 block truncate text-xs text-clay-silver">
                        {[choice.category, choice.slug, `#${choice.productId}`].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  {selected && <Check size={16} className="shrink-0 text-clay-ink" />}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
