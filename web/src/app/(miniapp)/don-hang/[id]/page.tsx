'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { extractUrls, linkifyText, renderLabeledText, shortenUrl } from '@/lib/renderLabeledText'
import { RichText } from '@/components/RichText'
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
  isBackorder?: boolean
  backorderWaitMode?: 'business_hours' | 'after_hours'
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
          {order.isBackorder ? (
            order.backorderWaitMode === 'after_hours' ? (
              <>
                <p className="text-sm font-medium">Đơn hàng sẽ được xử lý lúc 9:00 sáng.</p>
                <p className="text-xs opacity-80 mt-1">Shop sẽ thông báo ngay khi đơn hoàn thành.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Thanh toán đã được ghi nhận.</p>
                <p className="text-xs opacity-80 mt-1">
                  Shop sẽ xử lý đơn hàng và thông báo khi hoàn thành. Thời gian dự kiến: 30-60 phút, hoặc theo mô tả sản phẩm.
                </p>
                <p className="text-xs opacity-80 mt-2">
                  Cần hỗ trợ? Liên hệ{' '}
                  <a href="https://t.me/taikhoantenhat" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
                    @taikhoantenhat
                  </a>
                </p>
              </>
            )
          ) : (
            <>
              <p className="text-sm font-medium">Đang xử lý đơn hàng…</p>
              <p className="text-xs opacity-80 mt-1">Key sẽ giao trong giây lát.</p>
            </>
          )}
        </div>
      )}

      {order.status === 'delivered' && order.accounts && order.accounts.length > 0 && (
        <section className="mt-1">
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
