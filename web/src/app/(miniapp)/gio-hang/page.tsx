'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useCart } from '@/lib/cart'
import { MiniAppShell } from '../components/MiniAppShell'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'
import { Icon } from '../components/Icon'

export default function CartPage() {
  const cart = useCart()
  const empty = cart.items.length === 0

  return (
    <MiniAppShell title={t.cart.title} hasBottombar={!empty}>
      {empty && (
        <div className="text-center py-16">
          <div className="mb-3 inline-flex p-4 rounded-full" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}>
            <Icon name="cart" size={40} strokeWidth={1.25} />
          </div>
          <p className="opacity-60 text-sm mb-4">{t.cart.empty}</p>
          <Link href="/" className="miniapp-btn miniapp-btn--primary inline-flex" style={{ width: 'auto', padding: '.625rem 1.25rem' }}>
            Tiếp tục mua sắm
          </Link>
        </div>
      )}
      {!empty && (
        <ul className="space-y-2 mb-4">
          {cart.items.map((it) => (
            <li key={it.lineKey} className="rounded-2xl p-3 flex gap-3 items-center" style={{ background: 'var(--tg-bg-2)' }}>
              <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0" style={{ position: 'relative', background: 'var(--brand-gold-soft)' }}>
                {it.imageUrl
                  ? <Image src={it.imageUrl} alt={it.name} fill sizes="64px" style={{ objectFit: 'cover' }} />
                  : <div className="absolute inset-0 grid place-items-center" style={{ color: 'var(--brand-gold-deep)' }}>
                      <Icon name="package" size={24} strokeWidth={1.5} />
                    </div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium line-clamp-2">{it.name}</p>
                {it.variantName && (
                  <p className="text-xs opacity-60 mt-0.5">{it.variantName}</p>
                )}
                {it.inputValue && (
                  <p className="text-xs opacity-50 mt-0.5 inline-flex items-center gap-1">
                    <Icon name="check" size={12} /> Đã ghi nhận thông tin
                  </p>
                )}
                <p className="text-sm font-bold mt-0.5">{formatPrice(it.price * it.quantity)}</p>
                <div className="mt-2 flex items-center gap-1">
                  <button
                    onClick={() => cart.setQuantity(it.lineKey, it.quantity - 1)}
                    className="w-7 h-7 grid place-items-center rounded-full text-base"
                    style={{ background: 'var(--tg-bg)' }}
                    aria-label={t.cart.decrease}
                  ><Icon name="minus" size={14} /></button>
                  <span className="w-7 text-center text-sm font-semibold">{it.quantity}</span>
                  <button
                    onClick={() => cart.setQuantity(it.lineKey, it.quantity + 1)}
                    className="w-7 h-7 grid place-items-center rounded-full text-base"
                    style={{ background: 'var(--tg-bg)' }}
                    aria-label={t.cart.increase}
                  ><Icon name="plus" size={14} /></button>
                  <button
                    onClick={() => cart.remove(it.lineKey)}
                    className="ml-auto text-xs opacity-60 px-2"
                    aria-label={t.cart.remove}
                  ><span className="inline-flex items-center gap-1"><Icon name="trash" size={12} />{t.cart.remove}</span></button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!empty && (
        <div className="miniapp-bottombar" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
          <div className="self-center">
            <div className="text-xs opacity-60">{t.cart.total}</div>
            <div className="text-lg font-bold leading-tight">{formatPrice(cart.total)}</div>
          </div>
          <Link href="/dat-hang" className="miniapp-btn miniapp-btn--primary">
            {t.cart.checkout} →
          </Link>
        </div>
      )}
    </MiniAppShell>
  )
}
