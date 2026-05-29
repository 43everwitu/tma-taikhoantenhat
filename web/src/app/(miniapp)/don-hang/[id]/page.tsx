'use client'

import { useEffect, useState } from 'react'
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
  accountNumber?: string; accountName?: string
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
          orderId={order.id}
          qrUrl={order.qrUrl}
          paymentCode={order.paymentCode}
          amount={order.totalPrice}
          bankName={order.bankName}
          accountNumber={order.accountNumber}
          accountName={order.accountName}
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
              <KeyRow key={i} value={k} />
            ))}
          </ul>
          {order.usageInstructions && (
            <div className="mt-3 rounded-xl p-3 text-sm whitespace-pre-line" style={{ background: 'var(--tg-bg-2)' }}>
              <p className="font-medium mb-1">📘 Hướng dẫn sử dụng</p>
              <p className="opacity-85">{linkifyText(order.usageInstructions)}</p>
            </div>
          )}
        </section>
      )}
    </MiniAppShell>
  )
}

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g

function linkifyText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let m: RegExpExecArray | null
  let idx = 0
  URL_REGEX.lastIndex = 0
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index))
    const href = m[0]
    parts.push(
      <a key={`u-${idx++}`} href={href} target="_blank" rel="noopener noreferrer">{href}</a>
    )
    lastIndex = m.index + href.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function extractUrls(text: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  URL_REGEX.lastIndex = 0
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (!out.includes(m[0])) out.push(m[0])
  }
  return out
}

function shortenUrl(u: string): string {
  try {
    const url = new URL(u)
    const host = url.hostname.replace(/^www\./, '')
    const path = url.pathname.length > 24 ? url.pathname.slice(0, 22) + '…' : url.pathname
    return host + (path === '/' ? '' : path)
  } catch {
    return u
  }
}

function KeyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const urls = extractUrls(value)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  return (
    <li className="miniapp-key-card">
      <button
        type="button"
        onClick={copy}
        data-copied={copied ? 'true' : 'false'}
        aria-label={copied ? 'Đã sao chép' : 'Sao chép'}
        className="miniapp-key-copy-btn"
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
      <div>{linkifyText(value)}</div>
      {urls.length > 0 && (
        <div className="miniapp-key-links">
          {urls.map((u, i) => (
            <a key={`l-${i}`} href={u} target="_blank" rel="noopener noreferrer" className="miniapp-key-link">
              <Icon name="arrowRight" size={12} />
              {shortenUrl(u)}
            </a>
          ))}
        </div>
      )}
    </li>
  )
}
