'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../../components/MiniAppShell'
import { QrPanel } from '../../components/QrPanel'
import { Icon } from '../../components/Icon'
import { StatusBadge } from '../../components/StatusBadge'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

interface OrderStatus {
  id: string
  status: 'pending' | 'paid' | 'delivered' | 'cancelled' | 'expired'
  totalPrice: number; paymentCode: string; qrUrl: string; bankName: string; expiresAt: string
  productName: string; quantity: number
  accounts?: string[]; usageInstructions?: string | null
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
        const matches = msg.orderId != null && String(msg.orderId) === id
        if (matches && (msg.type === 'order.status' || msg.type === 'order.delivered')) {
          qc.invalidateQueries({ queryKey: ['order', id] })
        }
      } catch {}
    }
    return () => es.close()
  }, [id, qc])

  if (!order) {
    return (
      <MiniAppShell title={t.order.title}>
        <p className="opacity-60 text-sm">Đang tải…</p>
      </MiniAppShell>
    )
  }

  return (
    <MiniAppShell title={`${t.order.title} #${order.id}`}>
      <div className="rounded-2xl p-4 mb-3" style={{ background: 'var(--tg-bg-2)' }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-base font-semibold leading-tight line-clamp-2">{order.productName}</p>
            <p className="text-xs opacity-60 mt-0.5">Số lượng: {order.quantity}</p>
          </div>
          <StatusBadge status={order.status} />
        </div>
        <div className="flex items-baseline justify-between border-t pt-3" style={{ borderColor: 'color-mix(in srgb, var(--brand-ink) 8%, transparent)' }}>
          <span className="text-xs opacity-60">Tổng thanh toán</span>
          <span className="text-xl font-bold">{formatPrice(order.totalPrice)}</span>
        </div>
      </div>

      {order.status === 'pending' && (
        <QrPanel
          qrUrl={order.qrUrl}
          paymentCode={order.paymentCode}
          amount={order.totalPrice}
          bankName={order.bankName}
        />
      )}

      {order.status === 'paid' && (
        <div className="rounded-2xl p-4 text-center" style={{ background: '#dbeafe', color: '#1e40af' }}>
          <div className="mb-2 inline-flex p-2.5 rounded-full" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}>
            <Icon name="clock" size={22} strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium">Đang xử lý đơn hàng…</p>
          <p className="text-xs opacity-80 mt-1">Key sẽ giao trong giây lát.</p>
        </div>
      )}

      {order.status === 'delivered' && order.accounts && order.accounts.length > 0 && (
        <section className="mt-1">
          <div className="miniapp-section-title">
            <span>🔑 {t.order.keysTitle}</span>
          </div>
          <ul className="space-y-2">
            {order.accounts.map((k, i) => (
              <li key={i} className="miniapp-key">{k}</li>
            ))}
          </ul>
          {order.usageInstructions && (
            <div className="mt-3 rounded-xl p-3 text-sm whitespace-pre-line" style={{ background: 'var(--tg-bg-2)' }}>
              <p className="font-medium mb-1">📘 Hướng dẫn sử dụng</p>
              <p className="opacity-85">{order.usageInstructions}</p>
            </div>
          )}
        </section>
      )}
    </MiniAppShell>
  )
}
