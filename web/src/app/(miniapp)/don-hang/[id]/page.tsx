'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../../components/MiniAppShell'
import { QrPanel } from '../../components/QrPanel'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

interface OrderStatus {
  id: string; status: 'pending' | 'paid' | 'delivered' | 'cancelled' | 'expired';
  totalPrice: number; paymentCode: string; qrUrl: string; bankName: string; expiresAt: string;
  productName: string; quantity: number; accounts?: string[]; usageInstructions?: string | null;
}

const STATUS_LABEL: Record<OrderStatus['status'], string> = {
  pending: t.order.waiting, paid: t.order.paid, delivered: t.order.delivered,
  cancelled: t.order.cancelled, expired: t.order.expired,
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const { data: order } = useQuery({
    queryKey: ['order', id],
    queryFn: () => apiFetch<OrderStatus>(`/orders/${id}/status`),
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'pending' || s === 'paid' ? 5000 : false
    },
  })

  useEffect(() => {
    const es = new EventSource('/api/v1/events')
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        const matches = (msg.orderId != null && String(msg.orderId) === id)
        if (matches && (msg.type === 'order.status' || msg.type === 'order.delivered')) {
          qc.invalidateQueries({ queryKey: ['order', id] })
        }
      } catch {}
    }
    return () => es.close()
  }, [id, qc])

  if (!order) {
    return <MiniAppShell title={t.order.title}><p className="opacity-60">…</p></MiniAppShell>
  }

  return (
    <MiniAppShell title={`${t.order.title} #${order.id}`}>
      <p className="mb-2"><strong>{order.productName}</strong> × {order.quantity}</p>
      <p className="mb-3">{formatPrice(order.totalPrice)}</p>
      <p className="mb-3 text-sm">Trạng thái: <strong>{STATUS_LABEL[order.status]}</strong></p>

      {order.status === 'pending' && (
        <QrPanel qrUrl={order.qrUrl} paymentCode={order.paymentCode}
          amount={order.totalPrice} bankName={order.bankName} />
      )}

      {order.status === 'delivered' && order.accounts && order.accounts.length > 0 && (
        <section className="mt-4">
          <h2 className="text-sm font-semibold mb-2 opacity-70">{t.order.keysTitle}</h2>
          <ul className="space-y-2">
            {order.accounts.map((k, i) => (
              <li key={i} className="rounded-md px-3 py-2 font-mono text-sm select-all"
                  style={{ background: 'var(--tg-bg-2)' }}>{k}</li>
            ))}
          </ul>
          {order.usageInstructions && (
            <div className="mt-3 text-sm whitespace-pre-line opacity-90">{order.usageInstructions}</div>
          )}
        </section>
      )}
    </MiniAppShell>
  )
}
