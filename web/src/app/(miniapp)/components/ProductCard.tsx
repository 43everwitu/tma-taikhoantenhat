'use client'

import Link from 'next/link'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'

export interface ProductSummary {
  id: string; slug: string; name: string; emoji: string;
  imageUrl?: string; price: number; stock: number;
}

export function ProductCard({ p }: { p: ProductSummary }) {
  return (
    <Link
      href={`/san-pham/${p.slug}`}
      className="block rounded-xl overflow-hidden"
      style={{ background: 'var(--tg-bg-2)' }}
    >
      <div className="aspect-square relative">
        {p.imageUrl ? (
          <Image src={p.imageUrl} alt={p.name} fill sizes="(max-width: 768px) 50vw, 200px" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-5xl">{p.emoji || '📦'}</div>
        )}
      </div>
      <div className="p-2">
        <p className="text-sm font-medium line-clamp-2">{p.name}</p>
        <p className="text-sm font-semibold mt-1">{formatPrice(p.price)}</p>
        <p className="text-xs opacity-70">{p.stock > 0 ? `Còn ${p.stock}` : 'Hết hàng'}</p>
      </div>
    </Link>
  )
}
