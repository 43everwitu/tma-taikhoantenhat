'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { api, getCustomerToken } from '@/lib/api'
import { formatPrice } from '@/lib/utils'
import { BookOpen, ArrowLeft, ShoppingCart, Send } from '@/lib/icons'
import { ProductImage } from '@/components/ProductImage'
import { MascotBadge } from '@/components/MascotBadge'
import { RichText } from '@/components/RichText'
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
  longDescription?: string
  usageInstructions?: string
  promotion?: {
    label: string
    discount: number
  } | null
}

interface Order {
  id: string
}

export default function ProductDetailPage() {
  useShopStream()
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [quantity, setQuantity] = useState(1)
  const [ordering, setOrdering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => api.get<Product>(`/products/${slug}`),
    enabled: !!slug,
  })

  const product = data?.data

  const hasToken = typeof window !== 'undefined' && !!getCustomerToken()

  async function handleBuy() {
    if (!product) return
    setOrdering(true)
    setError(null)

    try {
      const res = await api.post<Order>('/orders', {
        productId: product.id,
        quantity,
      })
      router.push(`/thanh-toan/${res.data.id}`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Có lỗi xảy ra, vui lòng thử lại'
      setError(message)
    } finally {
      setOrdering(false)
    }
  }

  if (isLoading) {
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
        <main className="max-w-4xl mx-auto px-6 pb-16">
          <div className="clay-card p-8 mt-10 animate-pulse">
            <div className="h-8 bg-clay-oat rounded w-1/3 mb-4" />
            <div className="h-16 w-16 bg-clay-oat rounded-xl mb-6" />
            <div className="h-6 bg-clay-oat rounded w-2/3 mb-3" />
            <div className="h-4 bg-clay-oat rounded w-full mb-2" />
            <div className="h-4 bg-clay-oat rounded w-3/4 mb-6" />
            <div className="h-12 bg-clay-oat rounded w-1/3" />
          </div>
        </main>
      </>
    )
  }

  if (!product) {
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
        <main className="max-w-4xl mx-auto px-6 pb-16 text-center pt-20">
          <p className="text-clay-charcoal text-lg mb-4">Không tìm thấy sản phẩm.</p>
          <Link href="/san-pham" className="clay-btn clay-btn--ink flex items-center gap-1.5 w-fit mx-auto">
            <ArrowLeft size={16} />Quay lại danh sách
          </Link>
        </main>
      </>
    )
  }

  const maxQty = Math.min(product.stock, 10)

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
            <Link href="/lien-ket" className="clay-btn flex items-center gap-1.5"><Send size={16} /><span className="hidden sm:inline">Liên kết Telegram</span></Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pb-16">
        <Link href="/san-pham" className="text-clay-charcoal hover:text-clay-ink text-sm mt-6 inline-flex items-center gap-1 underline underline-offset-4">
          <ArrowLeft size={14} />Quay lại danh sách
        </Link>

        <div className="clay-card p-8 mt-6">
          {/* Header: image/icon + title side by side on md+ */}
          <div className="flex flex-col md:flex-row md:items-start gap-6 mb-6">
            <div className="shrink-0">
              <ProductImage
                imageUrl={product.imageUrl}
                emoji={product.emoji}
                alt={product.name}
                className="w-40 h-40 rounded-2xl"
                emojiSize={96}
              />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="clay-display text-3xl">{product.name}</h1>
                {product.promotion && (
                  <span className="clay-pill" style={{background: 'var(--color-pomegranate-400)', color: '#fff', borderColor: 'var(--color-pomegranate-400)'}}>
                    {product.promotion.label}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-3 mb-3">
                <span className="clay-display text-4xl">{formatPrice(product.price)}</span>
                <span className="text-clay-charcoal">/ sản phẩm</span>
              </div>
              <span className="clay-pill">{product.stock > 0 ? `Còn ${product.stock}` : 'Hết hàng'}</span>
            </div>
          </div>

          {/* Description */}
          {(product.longDescription || product.description) && (
            <div className="mb-6">
              <h2 className="font-semibold mb-2">Mô tả</h2>
              <RichText
                html={product.longDescription || product.description}
                className="text-clay-charcoal"
              />
            </div>
          )}

          {/* Usage instructions preview */}
          {product.usageInstructions && (
            <div className="clay-card-dashed p-5 mt-6">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <BookOpen size={16} />Bạn sẽ nhận được hướng dẫn sử dụng
              </h4>
              <p className="text-clay-charcoal text-sm">Chi tiết hướng dẫn được gửi tự động qua Telegram và hiển thị tại đây sau khi thanh toán thành công.</p>
            </div>
          )}

          {product.stock > 0 && (
            <>
              {/* Quantity selector */}
              <div className="mt-8 mb-6">
                <h2 className="font-semibold mb-3">Số lượng</h2>
                <div className="flex flex-wrap gap-2 mb-3">
                  {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      onClick={() => setQuantity(n)}
                      className={`clay-input w-10 h-10 text-sm font-medium text-center cursor-pointer ${quantity === n ? 'border-clay-ink bg-clay-ink text-white' : ''}`}
                      style={quantity === n ? {background: 'var(--color-clay-ink)', color: '#fff', borderColor: 'var(--color-clay-ink)'} : {}}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-clay-charcoal">
                  Tổng: <span className="font-semibold text-clay-ink">{formatPrice(product.price * quantity)}</span>
                </p>
              </div>

              {/* Buy button or link telegram message */}
              {hasToken ? (
                <div>
                  <button
                    onClick={handleBuy}
                    disabled={ordering}
                    className="clay-btn clay-btn--ink w-full text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {ordering ? 'Đang xử lý...' : `Mua ngay — ${formatPrice(product.price * quantity)}`}
                  </button>
                  {error && (
                    <p className="text-sm mt-3" style={{color: 'var(--color-pomegranate-400)'}}>{error}</p>
                  )}
                </div>
              ) : (
                <div className="clay-card-dashed p-5 mt-2" style={{borderColor: 'var(--color-lemon-500)', background: 'color-mix(in srgb, var(--color-lemon-400) 20%, white)'}}>
                  <p className="font-medium mb-3">
                    Bạn cần liên kết Telegram để mua hàng
                  </p>
                  <Link
                    href="/lien-ket"
                    className="clay-btn clay-btn--ink flex items-center gap-1.5 w-fit"
                  >
                    <Send size={16} />Liên kết Telegram
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-clay-oat py-8 text-center text-clay-charcoal text-sm mt-8">
        <p>© 2026 Auto-chan · Hỗ trợ: <a href="https://t.me/peanut1010" className="underline">@peanut1010</a></p>
      </footer>
    </>
  )
}
