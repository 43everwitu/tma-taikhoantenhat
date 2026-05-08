'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatPrice } from '@/lib/utils'
import { Package, Search, ShoppingCart } from '@/lib/icons'
import { ProductImage } from '@/components/ProductImage'
import { MascotBadge } from '@/components/MascotBadge'
import { UserMenu } from '@/components/UserMenu'
import { useShopStream } from '@/lib/useShopStream'

interface Product {
  id: string
  name: string
  slug: string
  emoji: string
  imageUrl?: string
  price: number
  stock: number
  description: string
  categoryId: string
  promotion?: {
    label: string
    discount: number
  } | null
}

interface Category {
  id: string
  name: string
  slug: string
  emoji?: string
}

export default function ProductCatalogPage() {
  useShopStream()
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [sortBy, setSortBy] = useState('default')

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const params = new URLSearchParams()
  if (debouncedSearch) params.set('q', debouncedSearch)
  if (selectedCategory) params.set('category', selectedCategory)
  if (sortBy && sortBy !== 'default') params.set('sort', sortBy)
  const url = `/products${params.toString() ? '?' + params.toString() : ''}`

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['products', debouncedSearch, selectedCategory, sortBy],
    queryFn: () => api.get<Product[]>(url),
  })

  const { data: catsData } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories'),
  })

  const products = productsData?.data ?? []
  const categories = catsData?.data ?? []

  const hasActiveFilter = debouncedSearch || selectedCategory

  return (
    <>
      <header className="border-b border-clay-oat bg-clay-cream/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-5 flex items-center justify-between">
          <Link href="/" className="text-xl sm:text-2xl clay-display flex items-center gap-2">
            <MascotBadge size={32} />
            Auto-chan
          </Link>
          <nav className="flex gap-3">
            <Link href="/san-pham" className="clay-btn clay-btn--ink flex items-center gap-1.5"><ShoppingCart size={16} /><span className="hidden sm:inline">Sản phẩm</span></Link>
            <UserMenu />
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pb-16">
        <h1 className="clay-display text-4xl mt-10 mb-8">Tất cả sản phẩm</h1>

        {/* Search + Filter + Sort */}
        <div className="clay-card p-5 mb-6 space-y-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-clay-silver" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm sản phẩm..."
              className="clay-input w-full pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategory('')}
                className={selectedCategory === '' ? 'clay-pill' : 'clay-pill opacity-60 hover:opacity-100'}
                style={selectedCategory === '' ? { background: 'var(--color-clay-ink)', color: '#fff' } : undefined}
              >
                Tất cả
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.slug}
                  onClick={() => setSelectedCategory(cat.slug)}
                  className={selectedCategory === cat.slug ? 'clay-pill' : 'clay-pill opacity-60 hover:opacity-100'}
                  style={selectedCategory === cat.slug ? { background: 'var(--color-clay-ink)', color: '#fff' } : undefined}
                >
                  {cat.name}
                </button>
              ))}
            </div>
            <div className="ml-auto">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="clay-input text-sm"
              >
                <option value="default">Sắp xếp mặc định</option>
                <option value="price_asc">Giá: Thấp → Cao</option>
                <option value="price_desc">Giá: Cao → Thấp</option>
                <option value="newest">Mới nhất</option>
              </select>
            </div>
          </div>
        </div>

        {/* Products grid */}
        {productsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="clay-card p-6 animate-pulse">
                <div className="h-12 w-12 bg-clay-oat rounded-lg mb-4" />
                <div className="h-5 bg-clay-oat rounded w-3/4 mb-2" />
                <div className="h-4 bg-clay-oat rounded w-1/2 mb-4" />
                <div className="h-8 bg-clay-oat rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16">
            <Package size={32} className="text-clay-silver mx-auto mb-2" />
            {hasActiveFilter ? (
              <p className="text-clay-charcoal text-lg">
                Không tìm thấy sản phẩm phù hợp
                {debouncedSearch ? ` với "${debouncedSearch}"` : ''}.
              </p>
            ) : (
              <p className="text-clay-charcoal text-lg">Không tìm thấy sản phẩm nào.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product) => (
              <Link
                key={product.id}
                href={`/san-pham/${product.slug}`}
                className="clay-card p-5 block hover:-rotate-1 hover:shadow-[var(--shadow-clay-hover)] transition-transform"
              >
                <ProductImage
                  imageUrl={product.imageUrl}
                  emoji={product.emoji}
                  alt={product.name}
                  className="w-full aspect-square rounded-2xl mb-3"
                  emojiSize={88}
                />
                <h3 className="text-lg font-semibold">{product.name}</h3>
                <p className="text-clay-charcoal text-sm mt-1 line-clamp-2">{product.description}</p>
                <div className="flex items-center justify-between mt-4">
                  <span className="text-2xl clay-display">{formatPrice(product.price)}</span>
                  <span className="clay-pill">{product.stock > 0 ? `Còn ${product.stock}` : 'Hết hàng'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-clay-oat py-8 text-center text-clay-charcoal text-sm">
        <p>© 2026 Auto-chan · Hỗ trợ: <a href="https://t.me/peanut1010" className="underline">@peanut1010</a></p>
      </footer>
    </>
  )
}
