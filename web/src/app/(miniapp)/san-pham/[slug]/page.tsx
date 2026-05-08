'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { apiFetch } from '@/lib/miniappApi'
import { useCart } from '@/lib/cart'
import { MiniAppShell } from '../../components/MiniAppShell'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

interface ProductBase {
  id: string; slug: string; name: string; emoji: string; imageUrl?: string;
  price: number; stock: number; contactOnly: boolean; contactUrl?: string;
}
interface ProductDetail extends ProductBase { longDescription: string; description: string }

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const cart = useCart()

  const { data: p, isLoading } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => apiFetch<ProductDetail>(`/products/${slug}`),
  })

  if (isLoading) return <MiniAppShell><p className="opacity-60">…</p></MiniAppShell>
  if (!p) return <MiniAppShell><p>Không tìm thấy.</p></MiniAppShell>

  return (
    <MiniAppShell title={p.name}>
      <div className="rounded-xl overflow-hidden mb-3" style={{ background: 'var(--tg-bg-2)' }}>
        <div className="aspect-square relative">
          {p.imageUrl
            ? <Image src={p.imageUrl} alt={p.name} fill sizes="100vw" />
            : <div className="absolute inset-0 flex items-center justify-center text-7xl">{p.emoji || '📦'}</div>}
        </div>
      </div>

      <p className="text-xl font-semibold">{formatPrice(p.price)}</p>
      <p className="text-sm opacity-70 mb-3">
        {p.stock > 0 ? t.product.inStock.replace('{n}', String(p.stock)) : t.product.outOfStock}
      </p>
      {p.description && <p className="mb-3 whitespace-pre-line">{p.description}</p>}
      {p.longDescription && (
        <details className="mb-4">
          <summary className="cursor-pointer">Chi tiết</summary>
          <div className="mt-2 whitespace-pre-line text-sm opacity-90">{p.longDescription}</div>
        </details>
      )}

      <div className="grid grid-cols-2 gap-2 fixed bottom-16 left-0 right-0 px-4">
        <button
          onClick={() => { cart.add({ id: p.id, slug: p.slug, name: p.name, price: p.price, emoji: p.emoji, imageUrl: p.imageUrl }) }}
          disabled={p.stock <= 0 || p.contactOnly}
          className="rounded-lg py-3 font-medium"
          style={{ background: 'var(--tg-bg-2)' }}
        >
          {t.product.addToCart}
        </button>
        <button
          onClick={() => {
            cart.add({ id: p.id, slug: p.slug, name: p.name, price: p.price, emoji: p.emoji, imageUrl: p.imageUrl })
            router.push('/dat-hang')
          }}
          disabled={p.stock <= 0 || p.contactOnly}
          className="rounded-lg py-3 font-medium"
          style={{ background: 'var(--tg-button)', color: 'var(--tg-button-text)' }}
        >
          {t.product.buyNow}
        </button>
      </div>
    </MiniAppShell>
  )
}
