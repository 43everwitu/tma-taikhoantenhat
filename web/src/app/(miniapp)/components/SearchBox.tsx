'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { Icon } from './Icon'
import { MiniAppProductImage } from './MiniAppProductImage'
import { getProductDisplayPrice } from '@/lib/productPriceDisplay'
import {
  buildAllProductsSearchHref,
  buildSmartSearchPath,
  isSmartSearchQuery,
  type SmartSearchResponse,
} from '@/lib/smartProductSearch'
import { t } from '@/i18n/vi'

interface Preview {
  id: string
  slug: string
  name: string
  price: number
  priceMin?: number
  priceMax?: number
  salePrice?: number
  salePriceMin?: number
  salePriceMax?: number
  imageUrl?: string
  matchLabel?: string
}

interface Props {
  value: string
  onChange: (q: string) => void
  placeholder?: string
  autoFocus?: boolean
  category?: string
}

export function SearchBox({ value, onChange, placeholder, autoFocus, category }: Props) {
  const [debounced, setDebounced] = useState(value)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 200)
    return () => clearTimeout(t)
  }, [value])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const { data, isFetching, isError } = useQuery({
    queryKey: ['products', 'smart-search-preview', debounced, category || ''],
    queryFn: () => apiFetch<SmartSearchResponse<Preview>>(
      buildSmartSearchPath(debounced, { category, limit: 5, suggestionLimit: 3 }),
    ),
    enabled: isSmartSearchQuery(debounced),
  })
  const results = data?.results ?? []
  const suggestions = data?.suggestions ?? []
  const hasMatches = results.length > 0 || suggestions.length > 0

  function renderItems(items: Preview[]) {
    return (
      <ul>
        {items.map((p) => {
          const displayPrice = getProductDisplayPrice(p)
          return (
            <li key={p.id}>
              <Link
                href={`/san-pham/${p.slug}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 p-2 hover:bg-black/5"
              >
                <div
                  className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0"
                  style={{ background: 'var(--brand-gold-soft)', position: 'relative' }}
                >
                  <MiniAppProductImage src={p.imageUrl} alt={p.name} iconSize={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm line-clamp-1">{p.name}</p>
                  {p.matchLabel && (
                    <p className="text-[11px] opacity-55 line-clamp-1">{p.matchLabel}</p>
                  )}
                  <p className="text-xs opacity-70">{displayPrice.current}</p>
                  {displayPrice.hasDiscount && (
                    <p className="text-[11px] opacity-45 line-through">{displayPrice.original}</p>
                  )}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="miniapp-search">
        <span className="opacity-60 flex"><Icon name="search" size={18} /></span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? t.catalog.searchPlaceholder}
          autoComplete="off"
        />
      </div>

      {open && isSmartSearchQuery(debounced) && (
        <div
          className="absolute left-0 right-0 mt-1 rounded-xl shadow-lg z-30 max-h-96 overflow-y-auto"
          style={{
            background: 'var(--tg-bg-2, #fff)',
            border: '1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent)',
          }}
        >
          {isFetching && !data && (
            <p className="px-3 py-4 text-sm opacity-60" aria-live="polite">
              {t.catalog.searchLoading}
            </p>
          )}
          {isError && (
            <p className="px-3 py-4 text-sm opacity-60">{t.errors.network}</p>
          )}
          {!isFetching && !isError && !hasMatches && (
            <p className="px-3 py-4 text-sm opacity-60">{t.catalog.searchNoResults}</p>
          )}
          {results.length > 0 && (
            <section>
              <h3 className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase opacity-55">
                {t.catalog.searchResults}
              </h3>
              {renderItems(results)}
            </section>
          )}
          {suggestions.length > 0 && (
            <section style={{ borderTop: '1px solid color-mix(in srgb, var(--brand-ink) 8%, transparent)' }}>
              <h3 className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase opacity-55">
                {t.catalog.searchSuggestions}
              </h3>
              {renderItems(suggestions)}
            </section>
          )}
          <Link
            href={buildAllProductsSearchHref(debounced)}
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-semibold"
            style={{
              color: 'var(--brand-ink)',
              borderTop: '1px solid color-mix(in srgb, var(--brand-ink) 8%, transparent)',
            }}
          >
            {t.catalog.searchViewAll}
            <Icon name="chevronRight" size={15} />
          </Link>
        </div>
      )}
    </div>
  )
}
