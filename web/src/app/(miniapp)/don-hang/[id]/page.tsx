'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { extractUrls, renderLabeledText, shortenUrl } from '@/lib/renderLabeledText'
import { getBackorderPaidMessage } from '@/lib/backorderWaitMessage'
import { RichText } from '@/components/RichText'
import { MiniAppShell } from '../../components/MiniAppShell'
import { QrPanel } from '../../components/QrPanel'
import { Icon } from '../../components/Icon'
import { StatusBadge } from '../../components/StatusBadge'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

type KeyLifecycleStatus = 'active' | 'expiring_soon' | 'expired'
interface KeyLifecycle {
  status: KeyLifecycleStatus
  statusLabel: string
  startDate: string
  expiryDate: string
  remainingDays: number
  durationDays: number
  progressPercent: number
  renewalReminderSent: boolean
  renewUrl: string | null
  orderUrl: string
}

interface OrderStatus {
  id: string
  status: 'pending' | 'paid' | 'delivered' | 'cancelled' | 'expired'
  totalPrice: number; paymentCode: string; qrUrl: string; bankName: string; expiresAt: string
  accountNumber?: string; accountName?: string
  productName: string; variantName?: string | null; quantity: number
  isBackorder?: boolean
  backorderWaitMode?: 'business_hours' | 'after_hours'
  keyLifecycle?: KeyLifecycle | null
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
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <span className="miniapp-qr-spinner" aria-hidden />
          <p className="opacity-60 text-sm">Đang tải đơn hàng…</p>
        </div>
      </MiniAppShell>
    )
  }
  const backorderPaidMessage = order.isBackorder ? getBackorderPaidMessage() : ''

  return (
    <MiniAppShell title={`${t.order.title} #${order.id}`}>
      <OrderSummaryCard
        order={order}
        hasDeliveredKeys={order.status === 'delivered' && !!order.accounts?.length}
      />

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
          {order.isBackorder ? (
            <>
              <p className="text-sm font-medium">Thanh toán đã được ghi nhận.</p>
              <p className="text-xs opacity-80 mt-1">{backorderPaidMessage}</p>
              <p className="text-xs opacity-80 mt-2">
                Cần hỗ trợ? Liên hệ{' '}
                <a href="https://t.me/taikhoantenhat" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
                  Telegram
                </a>
                {' · '}
                <a href="https://m.me/taikhoantenhat3" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
                  Messenger
                </a>
                {' · '}
                <a href="https://zalo.me/0896551786" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
                  Zalo
                </a>
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Đang xử lý đơn hàng…</p>
              <p className="text-xs opacity-80 mt-1">Key sẽ giao trong giây lát.</p>
            </>
          )}
        </div>
      )}

      {order.status === 'delivered' && order.accounts && order.accounts.length > 0 && (
        <section id="delivered-keys" className="mt-1 scroll-mt-24">
          <div className="miniapp-section-title text-base">
            <span>🔑 {t.order.keysTitle}</span>
          </div>
          <ul className="space-y-2">
            {order.accounts.map((k, i) => (
              <KeyRow key={i} value={k} />
            ))}
          </ul>
          {order.usageInstructions && (
            <div className="mt-4 rounded-2xl p-4 miniapp-order-usage">
              <p className="font-semibold text-base mb-2">📘 Hướng dẫn sử dụng</p>
              <RichText html={order.usageInstructions} className="text-base leading-relaxed" />
            </div>
          )}
        </section>
      )}
    </MiniAppShell>
  )
}

function OrderSummaryCard({
  order,
  hasDeliveredKeys,
}: {
  order: OrderStatus
  hasDeliveredKeys: boolean
}) {
  const lifecycle = order.status === 'delivered' ? order.keyLifecycle : null
  const remainingText = lifecycle
    ? lifecycle.status === 'expired'
      ? `Quá hạn ${Math.abs(lifecycle.remainingDays)} ngày`
      : `Còn ${lifecycle.remainingDays} ngày`
    : ''
  const productMeta = order.variantName
    ? `${order.variantName} - Số lượng: ${order.quantity}`
    : `Số lượng: ${order.quantity}`
  const ctaLabel = lifecycle?.renewalReminderSent ? 'Gia hạn ngay' : 'Mua lại'

  return (
    <section className="rounded-2xl p-4 mb-3" style={{ background: 'var(--tg-bg-2)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-base font-semibold leading-tight line-clamp-2">{order.productName}</p>
          <p className="text-xs opacity-60 mt-0.5">{productMeta}</p>
        </div>
        {lifecycle ? (
          <span className={`miniapp-status miniapp-status--${lifecycle.status === 'active' ? 'key-active' : lifecycle.status === 'expiring_soon' ? 'key-soon' : 'key-expired'}`}>
            {lifecycle.statusLabel}
          </span>
        ) : (
          <StatusBadge status={order.status} />
        )}
      </div>

      <div className="flex items-baseline justify-between border-t pt-3" style={{ borderColor: 'color-mix(in srgb, var(--brand-ink) 8%, transparent)' }}>
        <span className="text-xs opacity-60">Tổng thanh toán</span>
        <span className="text-xl font-bold">{formatPrice(order.totalPrice)}</span>
      </div>

      {lifecycle && (
        <div className="border-t mt-3 pt-3" style={{ borderColor: 'color-mix(in srgb, var(--brand-ink) 8%, transparent)' }}>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--brand-ink) 12%, transparent)' }} aria-label={remainingText}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, lifecycle.progressPercent))}%`,
                background: lifecycle.status === 'expired'
                  ? '#fc7981'
                  : lifecycle.status === 'expiring_soon'
                    ? 'var(--brand-gold)'
                    : '#078a52',
              }}
            />
          </div>
          <div className={`grid gap-2 mt-4 ${hasDeliveredKeys ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {lifecycle.renewUrl ? (
              <Link href={lifecycle.renewUrl} className="miniapp-btn miniapp-btn--primary justify-center text-sm">
                {ctaLabel}
              </Link>
            ) : (
              <span className="miniapp-btn justify-center text-sm opacity-60">Liên hệ hỗ trợ</span>
            )}
            {hasDeliveredKeys && (
              <a href="#delivered-keys" className="miniapp-btn miniapp-btn--ghost justify-center text-sm">
                Xem đơn
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  )
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
      <div className="miniapp-key-body">{renderLabeledText(value)}</div>
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
