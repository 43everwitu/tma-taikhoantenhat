'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import { renderTemplate } from '@/lib/messages'
import { formatPrice } from '@/lib/utils'
import { Clock, CheckCircle2, XCircle, PartyPopper, BookOpen } from '@/lib/icons'
import { MascotBadge } from '@/components/MascotBadge'
import { t } from '@/i18n/vi'

interface OrderStatus {
  id: string
  status: 'pending' | 'paid' | 'delivered' | 'expired' | 'cancelled'
  totalPrice: number
  paymentCode: string
  qrUrl: string
  bankName: string | null
  expiresAt: string
  productName: string
  quantity: number
  accounts?: string[]
  usageInstructions?: string | null
}

export default function PaymentPage() {
  const params = useParams<{ orderId: string }>()
  const orderId = params.orderId

  const { data, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get<OrderStatus>(`/orders/${orderId}/status`),
    refetchInterval: (q) => {
      const s = q.state.data?.data?.status
      return s === 'pending' || s === 'paid' ? 5000 : false
    },
  })

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])

  const [statusMsg, setStatusMsg] = useState<string>('')

  const orderData = data?.data
  useEffect(() => {
    const status = orderData?.status
    if (!status) return
    const orderCode = orderData.id ?? ''
    const productName = orderData.productName ?? ''
    const total = typeof orderData.totalPrice === 'number'
      ? new Intl.NumberFormat('vi-VN').format(orderData.totalPrice)
      : ''
    if (status === 'paid' || status === 'delivered') {
      renderTemplate('web.order_success', { orderCode, productName, total }).then(setStatusMsg)
    } else if (status === 'expired') {
      renderTemplate('web.payment_expired', { orderCode }).then(setStatusMsg)
    } else if (status === 'cancelled') {
      renderTemplate('web.payment_failed', { orderCode, reason: 'Đơn đã bị hủy' }).then(setStatusMsg)
    }
  }, [orderData?.status, orderData?.id, orderData?.productName, orderData?.totalPrice])

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="clay-pill">Đang tải đơn hàng...</div>
      </main>
    )
  }

  const order = data?.data
  if (!order) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="clay-card p-6 text-center">
          <p className="mb-4">Không tìm thấy đơn hàng.</p>
          <Link href="/san-pham" className="clay-btn clay-btn--ink">Về danh sách sản phẩm</Link>
        </div>
      </main>
    )
  }

  const expiresMs = new Date(order.expiresAt).getTime() - now
  const minLeft = Math.max(0, Math.floor(expiresMs / 60000))
  const secLeft = Math.max(0, Math.floor((expiresMs % 60000) / 1000))

  return (
    <main className="min-h-screen">
      <header className="border-b border-clay-oat bg-clay-cream/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <Link href="/" className="text-2xl clay-display flex items-center gap-2">
            <MascotBadge size={32} />
            {t.appName}
          </Link>
          <Link href="/san-pham" className="clay-btn">Sản phẩm</Link>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="clay-card p-8">
          <span className="clay-pill">Đơn hàng #{order.id}</span>
          <h1 className="clay-display text-3xl mt-4">{order.productName}</h1>
          <p className="text-clay-charcoal mt-1">Số lượng: {order.quantity}</p>

          {order.status === 'pending' && (
            <>
              <div className="mt-6 flex flex-col items-center">
                <img
                  src={order.qrUrl}
                  alt="Mã QR thanh toán"
                  className="w-full max-w-xs sm:max-w-sm h-auto rounded-2xl border border-clay-oat bg-white"
                />
                <div className="text-center mt-5">
                  <div className="text-clay-charcoal text-sm">Số tiền cần chuyển</div>
                  <div className="clay-display text-4xl mt-1">{formatPrice(order.totalPrice)}</div>
                  {order.bankName && (
                    <div className="text-clay-charcoal text-sm mt-3">Ngân hàng: <b>{order.bankName}</b></div>
                  )}
                  <div className="text-clay-charcoal text-sm mt-4">Nội dung CK (bắt buộc)</div>
                  <div className="font-mono text-lg mt-1 px-4 py-2 bg-clay-oat-light rounded-xl inline-block">
                    {order.paymentCode}
                  </div>
                </div>
              </div>
              <div className="clay-card-dashed mt-6 p-4 text-sm text-clay-charcoal flex items-start gap-2">
                <Clock size={16} className="mt-0.5 shrink-0" />
                <span>Còn lại <b>{minLeft}p {secLeft}s</b>. Hệ thống tự động kiểm tra mỗi 15 giây — không cần bấm xác nhận. Hàng sẽ hiện ngay tại đây sau khi nhận được tiền.</span>
              </div>
            </>
          )}

          {order.status === 'paid' && (
            <div className="clay-card-dashed mt-6 p-5 flex items-start gap-2">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--color-matcha-600)' }} />
              <span>{statusMsg || 'Đã nhận thanh toán — admin đang chuẩn bị hàng. Vui lòng chờ trong giây lát.'}</span>
            </div>
          )}

          {order.status === 'delivered' && order.accounts && (
            <div className="mt-6">
              {statusMsg && <p className="mb-3 text-clay-charcoal">{statusMsg}</p>}
              <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
                <PartyPopper size={20} />Đã giao hàng
              </h2>
              <pre className="bg-clay-ink text-white p-5 rounded-2xl whitespace-pre-wrap text-sm font-mono overflow-x-auto">
{order.accounts.map((a, i) => `${i + 1}. ${a}`).join('\n')}
              </pre>
              {order.usageInstructions && (
                <div className="clay-card-dashed mt-5 p-5">
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <BookOpen size={16} />Hướng dẫn sử dụng
                  </h3>
                  <div className="text-sm whitespace-pre-wrap">{order.usageInstructions}</div>
                </div>
              )}
            </div>
          )}

          {(order.status === 'expired' || order.status === 'cancelled') && (
            <div className="clay-card-dashed mt-6 p-5 flex items-start gap-2">
              <XCircle size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--color-pomegranate-400)' }} />
              <div>
                <span>{statusMsg || `Đơn hàng đã ${order.status === 'expired' ? 'hết hạn' : 'bị hủy'}. Vui lòng đặt lại nếu cần.`}</span>
                <div className="mt-4">
                  <Link href="/san-pham" className="clay-btn clay-btn--ink">Xem sản phẩm</Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
