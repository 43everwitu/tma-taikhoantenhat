'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useCart } from '@/lib/cart'
import { MiniAppShell } from '../components/MiniAppShell'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'
import { Icon } from '../components/Icon'
import { MiniAppProductImage } from '../components/MiniAppProductImage'

export default function CartPage() {
  const cart = useCart()
  const [confirmRemove, setConfirmRemove] = useState<{ lineKey: string; name: string } | null>(null)
  const empty = cart.items.length === 0

  function requestRemove(lineKey: string, name: string) {
    setConfirmRemove({ lineKey, name })
  }

  function decreaseQuantity(lineKey: string, name: string, quantity: number) {
    if (quantity <= 1) {
      requestRemove(lineKey, name)
      return
    }
    cart.setQuantity(lineKey, quantity - 1)
  }

  function confirmRemoveItem() {
    if (!confirmRemove) return
    cart.remove(confirmRemove.lineKey)
    setConfirmRemove(null)
  }

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
                <MiniAppProductImage src={it.imageUrl} alt={it.name} iconSize={24} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium line-clamp-2">{it.name}</p>
                {it.variantName && (
                  <p className="text-xs opacity-60 mt-0.5">{it.variantName}</p>
                )}
                {it.inputValue && (() => {
                  let parsed: Record<string, string> | null = null
                  try { parsed = JSON.parse(it.inputValue) } catch {}
                  if (!parsed || typeof parsed !== 'object') {
                    return (
                      <p className="text-xs opacity-50 mt-0.5 inline-flex items-center gap-1">
                        <Icon name="check" size={12} /> Đã ghi nhận thông tin
                      </p>
                    )
                  }
                  const entries = Object.entries(parsed).filter(([, v]) => v && v.length > 0)
                  if (entries.length === 0) return null
                  return (
                    <ul className="text-xs opacity-70 mt-0.5 space-y-0.5">
                      {entries.map(([label, val]) => {
                        const isSecret = /password|pass|mật khẩu|m[aậ]t kh[aẩ]u/i.test(label)
                        return (
                          <li key={label}><b>{label}:</b> {isSecret ? '••••••' : val}</li>
                        )
                      })}
                    </ul>
                  )
                })()}
                <p className="text-sm font-bold mt-0.5">{formatPrice(it.price * it.quantity)}</p>
                <div className="mt-2 flex items-center gap-1">
                  <button
                    onClick={() => decreaseQuantity(it.lineKey, it.name, it.quantity)}
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
                    onClick={() => requestRemove(it.lineKey, it.name)}
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

      {confirmRemove && (
        <div className="miniapp-sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="cart-remove-title" onClick={() => setConfirmRemove(null)}>
          <div className="miniapp-sheet-panel" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="miniapp-sheet">
              <div className="flex items-start gap-3">
                <div className="shrink-0 rounded-full p-2" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}>
                  <Icon name="trash" size={20} />
                </div>
                <div className="min-w-0">
                  <h2 id="cart-remove-title" className="font-semibold text-base">Bỏ sản phẩm khỏi giỏ?</h2>
                  <p className="mt-1 text-sm opacity-70">
                    Bạn có muốn bỏ &quot;{confirmRemove.name}&quot; khỏi giỏ hàng không?
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-3">
                <button
                  type="button"
                  className="miniapp-btn miniapp-btn--ghost"
                  onClick={() => setConfirmRemove(null)}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  className="miniapp-btn miniapp-btn--primary"
                  onClick={confirmRemoveItem}
                >
                  Xóa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </MiniAppShell>
  )
}
