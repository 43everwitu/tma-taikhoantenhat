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
          body: JSON.stringify({ productId: Number(it.id), quantity: it.quantity, bankIndex: 0 }),
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

  return (
    <MiniAppShell title={t.checkout.title}>
      {cart.items.length === 0 && <p className="opacity-60">{t.cart.empty}</p>}
      {cart.items.length > 0 && (
        <>
          <ul className="space-y-2 mb-4">
            {cart.items.map((it) => (
              <li key={it.id} className="rounded-lg p-3 flex justify-between" style={{ background: 'var(--tg-bg-2)' }}>
                <span>{it.name} × {it.quantity}</span>
                <span>{formatPrice(it.price * it.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between mb-3">
            <span className="opacity-70">{t.cart.total}</span>
            <span className="text-lg font-semibold">{formatPrice(cart.total)}</span>
          </div>
          {err && <p className="text-red-500 text-sm mb-2">{err}</p>}
          <button
            onClick={placeOrder}
            disabled={busy}
            className="w-full rounded-lg py-3 font-medium"
            style={{ background: 'var(--tg-button)', color: 'var(--tg-button-text)' }}
          >
            {busy ? t.checkout.creating : t.checkout.confirm}
          </button>
        </>
      )}
    </MiniAppShell>
  )
}
