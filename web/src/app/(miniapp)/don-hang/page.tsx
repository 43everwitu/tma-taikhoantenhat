'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../components/MiniAppShell'
import { Icon } from '../components/Icon'
import { formatDate, formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

type OrderStatus = 'pending' | 'paid' | 'delivered' | 'cancelled' | 'expired'
interface OrderRow {
  id: number
  status: OrderStatus
  total_price: number
  created_at: string
  product_name?: string
  quantity?: number
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: t.order.waiting, paid: t.order.paid, delivered: t.order.delivered,
  cancelled: t.order.cancelled, expired: t.order.expired,
}

export default function MyOrdersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['orders', 'my'],
    queryFn: () => apiFetch<OrderRow[]>('/orders/my'),
  })

  return (
    <MiniAppShell title={t.nav.orders}>
      {isLoading && <p className="opacity-60 text-sm">Đang tải…</p>}
      {data && data.length === 0 && (
        <div className="text-center py-16">
          <div className="mb-3 inline-flex p-4 rounded-full" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}>
            <Icon name="inbox" size={40} strokeWidth={1.25} />
          </div>
          <p className="opacity-60 text-sm mb-4">Chưa có đơn hàng nào.</p>
          <Link href="/" className="miniapp-btn miniapp-btn--primary inline-flex" style={{ width: 'auto', padding: '.625rem 1.25rem' }}>
            Bắt đầu mua sắm
          </Link>
        </div>
      )}
      {data && data.length > 0 && (
        <ul className="space-y-2">
          {data.map((o) => (
            <li key={o.id}>
              <Link
                href={`/don-hang/${o.id}`}
                className="block rounded-2xl p-3.5"
                style={{ background: 'var(--tg-bg-2)' }}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold line-clamp-1 flex-1">
                    {o.product_name || `Đơn #${o.id}`}
                  </p>
                  <span className={`miniapp-status miniapp-status--${o.status}`}>
                    {STATUS_LABEL[o.status]}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs opacity-70">
                  <span>#{o.id} · {formatDate(o.created_at)}</span>
                  <span className="font-semibold" style={{ color: 'var(--brand-ink)' }}>
                    {formatPrice(o.total_price)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MiniAppShell>
  )
}
