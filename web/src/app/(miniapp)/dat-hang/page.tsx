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
  const [discountCode, setDiscountCode] = useState('')
  const [applied, setApplied] = useState<{ code: string; discount: number } | null>(null)
  const [applyMsg, setApplyMsg] = useState<string | null>(null)

  async function applyDiscount() {
    setApplyMsg(null)
    if (!discountCode.trim()) return
    try {
      const resp = await apiFetch<{ discount: number; total: number; code: string }>('/discounts/preview', {
        method: 'POST',
        body: JSON.stringify({ code: discountCode.trim(), subtotal: cart.total }),
      })
      setApplied({ code: resp.code, discount: resp.discount })
      setApplyMsg(`✅ Áp dụng: giảm ${resp.discount.toLocaleString('vi-VN')}đ`)
    } catch (e) {
      setApplied(null)
      setApplyMsg(`❌ ${e instanceof Error ? e.message : 'Mã không hợp lệ'}`)
    }
  }

  async function placeOrder() {
    setBusy(true); setErr(null)
    try {
      let lastOrderId: number | null = null
      // Apply discount only to the FIRST order in the batch so we never
      // double-count: cart with N items still uses one redemption.
      let useDiscount = applied?.code ?? null
      for (const it of cart.items) {
        const body: Record<string, unknown> = {
          productId: Number(it.productId),
          quantity: it.quantity,
          bankIndex: 0,
          variantId: it.variantId ? Number(it.variantId) : undefined,
          inputValue: it.inputValue ?? undefined,
        }
        if (useDiscount) {
          body.discountCode = useDiscount
          useDiscount = null
        }
        const resp = await apiFetch<CreateOrderResp>('/orders', {
          method: 'POST',
          body: JSON.stringify(body),
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

  const grandTotal = Math.max(0, cart.total - (applied?.discount ?? 0))

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

          <div className="rounded-2xl p-3 mb-3" style={{ background: 'var(--tg-bg-2)' }}>
            <p className="text-xs font-medium mb-2">Mã giảm giá</p>
            <div className="flex gap-2">
              <input
                value={discountCode}
                onChange={(e) => { setDiscountCode(e.target.value.toUpperCase()); setApplied(null); setApplyMsg(null) }}
                placeholder="VD: SUMMER10"
                className="flex-1 rounded-xl px-3 py-2 text-sm font-mono uppercase"
                style={{ background: 'var(--tg-bg, #fff)', border: '1px solid color-mix(in srgb, var(--brand-ink) 14%, transparent)' }}
              />
              <button
                type="button"
                onClick={applyDiscount}
                disabled={!discountCode.trim()}
                className="px-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: 'var(--brand-gold)', color: 'var(--brand-ink)' }}
              >Áp dụng</button>
            </div>
            {applyMsg && <p className="text-xs mt-2 opacity-80">{applyMsg}</p>}
          </div>

          {applied && (
            <div className="rounded-xl p-3 mb-3 text-sm flex items-center justify-between" style={{ background: '#dcfce7', color: '#166534' }}>
              <span>Mã <code className="font-mono font-bold">{applied.code}</code></span>
              <span>−{formatPrice(applied.discount)}</span>
            </div>
          )}

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
              <div className="text-lg font-bold leading-tight">{formatPrice(grandTotal)}</div>
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
