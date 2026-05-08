'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../components/MiniAppShell'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

interface OrderRow { id: number; status: string; total_price: number; created_at: string; product_name?: string }

export default function MyOrdersPage() {
  const { data } = useQuery({
    queryKey: ['orders', 'my'],
    queryFn: () => apiFetch<OrderRow[]>('/orders/my'),
  })
  return (
    <MiniAppShell title={t.nav.orders}>
      {!data && <p className="opacity-60">…</p>}
      {data && data.length === 0 && <p className="opacity-60">Chưa có đơn hàng.</p>}
      {data && data.length > 0 && (
        <ul className="space-y-2">
          {data.map((o) => (
            <li key={o.id}>
              <Link href={`/don-hang/${o.id}`} className="block rounded-lg p-3" style={{ background: 'var(--tg-bg-2)' }}>
                <p className="text-sm">#{o.id} — {o.product_name || ''}</p>
                <p className="text-xs opacity-70">{formatPrice(o.total_price)} · {o.status}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MiniAppShell>
  )
}
