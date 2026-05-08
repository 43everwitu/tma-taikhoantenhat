'use client'

import Link from 'next/link'
import { useCart } from '@/lib/cart'
import { MiniAppShell } from '../components/MiniAppShell'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

export default function CartPage() {
  const cart = useCart()

  return (
    <MiniAppShell title={t.cart.title}>
      {cart.items.length === 0 && <p className="opacity-60">{t.cart.empty}</p>}
      {cart.items.length > 0 && (
        <>
          <ul className="space-y-2 mb-4">
            {cart.items.map((it) => (
              <li key={it.id} className="rounded-lg p-3 flex gap-3 items-center" style={{ background: 'var(--tg-bg-2)' }}>
                <div className="text-3xl">{it.emoji || '📦'}</div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{it.name}</p>
                  <p className="text-xs opacity-70">{formatPrice(it.price)}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <button onClick={() => cart.setQuantity(it.id, it.quantity - 1)} className="px-2 rounded" style={{ background: 'var(--tg-bg)' }}>−</button>
                    <span className="w-8 text-center">{it.quantity}</span>
                    <button onClick={() => cart.setQuantity(it.id, it.quantity + 1)} className="px-2 rounded" style={{ background: 'var(--tg-bg)' }}>+</button>
                    <button onClick={() => cart.remove(it.id)} className="ml-auto text-xs opacity-70">{t.cart.remove}</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between mb-3">
            <span className="opacity-70">{t.cart.total}</span>
            <span className="text-lg font-semibold">{formatPrice(cart.total)}</span>
          </div>
          <Link
            href="/dat-hang"
            className="block text-center rounded-lg py-3 font-medium"
            style={{ background: 'var(--tg-button)', color: 'var(--tg-button-text)' }}
          >
            {t.cart.checkout}
          </Link>
        </>
      )}
    </MiniAppShell>
  )
}
