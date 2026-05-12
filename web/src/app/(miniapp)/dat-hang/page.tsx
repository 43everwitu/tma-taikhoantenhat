'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/lib/cart'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../components/MiniAppShell'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

interface CreateOrderResp {
  order: { id: number; status: string; expiresAt: string }
  payment: { qrUrl: string; paymentCode: string; bankName: string; amount: number }
}

export default function CheckoutPage() {
  const cart = useCart()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function placeOrder() {
    setBusy(true); setErr(null)
    try {
      let lastOrderId: number | null = null
      for (const it of cart.items) {
        const resp = await apiFetch<CreateOrderResp>('/orders', {
          method: 'POST',
          body: JSON.stringify({
            productId: Number(it.productId),
            quantity: it.quantity,
            bankIndex: 0,
            variantId: it.variantId ? Number(it.variantId) : undefined,
            inputValue: it.inputValue ?? undefined,
          }),
        })
        lastOrderId = resp.order.id
      }
      cart.clear()
      if (lastOrderId) router.push(`/don-hang/${lastOrderId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lỗi không xác định')
    } finally {
      setBusy(false)
    }
  }

  const empty = cart.items.length === 0

  return (
    <MiniAppShell title={t.checkout.title} hasBottombar={!empty}>
      {empty && (
        <div className="text-center py-16">
          <div className="text-6xl mb-3">🧾</div>
          <p className="opacity-60 text-sm">{t.cart.empty}</p>
        </div>
      )}
      {!empty && (
        <>
          <p className="text-xs uppercase tracking-wider opacity-60 mb-2">Đơn hàng của bạn</p>
          <ul className="space-y-2 mb-4">
            {cart.items.map((it) => (
              <li key={it.lineKey} className="rounded-2xl p-3 flex justify-between gap-2" style={{ background: 'var(--tg-bg-2)' }}>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{it.name}</p>
                  {it.variantName && (
                    <p className="text-xs opacity-60 mt-0.5">{it.variantName}</p>
                  )}
                  {it.inputValue && (
                    <p className="text-xs opacity-50 mt-0.5">Đã ghi nhận thông tin</p>
                  )}
                  <p className="text-xs opacity-60">{formatPrice(it.price)} × {it.quantity}</p>
                </div>
                <span className="text-sm font-semibold whitespace-nowrap">{formatPrice(it.price * it.quantity)}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-2xl p-3 mb-4 text-sm" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}>
            <p className="font-medium mb-1">💡 Thanh toán bằng VietQR</p>
            <p className="opacity-80 leading-relaxed">Quét mã QR ở trang sau, chuyển đúng số tiền và nội dung để hệ thống tự động giao key.</p>
          </div>

          {err && (
            <div className="rounded-xl p-3 mb-3 text-sm" style={{ background: '#fee2e2', color: '#991b1b' }}>
              {err}
            </div>
          )}

          <div className="miniapp-bottombar" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
            <div className="self-center">
              <div className="text-xs opacity-60">{t.cart.total}</div>
              <div className="text-lg font-bold leading-tight">{formatPrice(cart.total)}</div>
            </div>
            <button
              type="button"
              onClick={placeOrder}
              disabled={busy}
              className="miniapp-btn miniapp-btn--primary"
            >
              {busy ? t.checkout.creating : `${t.checkout.confirm} →`}
            </button>
          </div>
        </>
      )}
    </MiniAppShell>
  )
}
