'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCart } from '@/lib/cart'
import { apiFetch } from '@/lib/miniappApi'
import { formatCartInputLines } from '@/lib/formatCartInput'
import { MiniAppShell } from '../components/MiniAppShell'
import { Icon } from '../components/Icon'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'
import { DiscountCodeMeta, type DiscountMetaMode } from '../components/DiscountCodeMeta'

interface CreateOrderResp {
  order: { id: number; status: string; expiresAt: string }
  payment: {
    qrUrl: string
    paymentCode: string
    bankName: string
    accountNumber?: string
    accountName?: string
    amount: number
    discountCode?: string | null
    discountAmount?: number
  }
}

interface GlobalDiscount {
  code: string
  type: 'percent' | 'fixed'
  amount: number
  maxDiscount: number | null
  minOrder: number
  label: string
  title?: string
  appMetaMode?: DiscountMetaMode
  appMetaText?: string
  appMessage?: string
}

export default function CheckoutPage() {
  const cart = useCart()
  const router = useRouter()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [discountCode, setDiscountCode] = useState('')
  const [applied, setApplied] = useState<{ code: string; discount: number; source?: 'manual' | 'global' | null } | null>(null)
  const [applyMsg, setApplyMsg] = useState<string | null>(null)
  const [copiedGlobalCode, setCopiedGlobalCode] = useState(false)
  const [showManualDiscount, setShowManualDiscount] = useState(false)
  const globalDiscount = useQuery({
    queryKey: ['discounts', 'global'],
    queryFn: () => apiFetch<GlobalDiscount | null>('/discounts/global'),
    staleTime: 60_000,
  })

  function computeGlobalDiscount() {
    const d = globalDiscount.data
    if (!d || cart.items.length === 0) return null
    const discount = cart.items.reduce((sum, it) => {
      const subtotal = it.price * it.quantity
      if (subtotal <= 0 || subtotal < (d.minOrder || 0)) return sum
      let lineDiscount = d.type === 'percent' ? Math.floor(subtotal * d.amount / 100) : d.amount
      if (d.maxDiscount != null) lineDiscount = Math.min(lineDiscount, d.maxDiscount)
      return sum + Math.min(lineDiscount, subtotal)
    }, 0)
    return discount > 0 ? { code: d.code, discount, source: 'global' as const } : null
  }

  async function applyDiscount() {
    setApplyMsg(null)
    if (!discountCode.trim()) return
    try {
      const resp = await apiFetch<{ discount: number; total: number; code: string | null; source?: 'manual' | 'global' | null }>('/discounts/preview', {
        method: 'POST',
        body: JSON.stringify({ code: discountCode.trim(), subtotal: cart.total }),
      })
      setApplied(resp.code ? { code: resp.code, discount: resp.discount, source: resp.source } : null)
      setApplyMsg(`✅ Áp dụng ${resp.code}: giảm ${resp.discount.toLocaleString('vi-VN')}đ`)
    } catch (e) {
      setApplied(null)
      setApplyMsg(`❌ ${e instanceof Error ? e.message : 'Mã không hợp lệ'}`)
    }
  }

  async function copyGlobalDiscountCode(code: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(code)
      setCopiedGlobalCode(true)
      setTimeout(() => setCopiedGlobalCode(false), 1500)
    } catch {
      // No-op: clipboard can fail on unsupported clients.
    }
  }

  async function placeOrder() {
    setBusy(true); setErr(null)
    try {
      // Apply discount only to the FIRST order in the batch so we never
      // double-count: cart with N items still uses one redemption.
      let useDiscount = applied?.source === 'manual' ? applied.code : null
      const items = cart.items.map((it) => {
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
        return { body, item: it }
      })
      const responses = await apiFetch<CreateOrderResp[]>('/orders/batch', {
        method: 'POST',
        body: JSON.stringify({ items: items.map((x) => x.body) }),
      })
      let lastOrderId: number | null = null
      responses.forEach((resp, index) => {
        const it = items[index].item
        const orderId = String(resp.order.id)
        qc.setQueryData(['order', orderId], {
          id: orderId,
          status: resp.order.status,
          totalPrice: resp.payment.amount,
          paymentCode: resp.payment.paymentCode,
          qrUrl: resp.payment.qrUrl,
          bankName: resp.payment.bankName,
          accountNumber: resp.payment.accountNumber,
          accountName: resp.payment.accountName,
          expiresAt: resp.order.expiresAt,
          productName: it.name,
          quantity: it.quantity,
          discountCode: resp.payment.discountCode,
          discountAmount: resp.payment.discountAmount ?? 0,
        })
        if (typeof window !== 'undefined') {
          const img = new window.Image()
          img.src = resp.payment.qrUrl
        }
        lastOrderId = resp.order.id
      })
      cart.clear()
      if (lastOrderId) router.push(`/don-hang/${lastOrderId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lỗi không xác định')
    } finally {
      setBusy(false)
    }
  }

  const autoGlobal = computeGlobalDiscount()
  const effectiveDiscount = applied?.discount ?? autoGlobal?.discount ?? 0
  const effectiveDiscountCode = applied?.code ?? autoGlobal?.code ?? null
  const grandTotal = Math.max(0, cart.total - effectiveDiscount)
  const globalAutoActive = !!autoGlobal && !applied

  const empty = cart.items.length === 0

  return (
    <MiniAppShell title={t.checkout.title} hasBottombar={!empty}>
      {empty && (
        <div className="text-center py-16">
          <div className="mb-3 inline-flex p-4 rounded-full" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}>
            <Icon name="cart" size={40} strokeWidth={1.25} />
          </div>
          <p className="opacity-60 text-sm mb-4">{t.cart.empty}</p>
          <Link href="/" className="miniapp-btn miniapp-btn--primary inline-flex" style={{ width: 'auto', padding: '.625rem 1.25rem' }}>
            Tiếp tục mua sắm
          </Link>
        </div>
      )}
      {!empty && (
        <>
          <p className="text-xs uppercase tracking-wider opacity-60 mb-2">Đơn hàng của bạn</p>
          <ul className="space-y-2 mb-4">
            {cart.items.map((it) => {
              const inputLines = formatCartInputLines(it.inputValue)
              return (
              <li key={it.lineKey} className="rounded-2xl p-3 flex justify-between gap-2" style={{ background: 'var(--tg-bg-2)' }}>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{it.name}</p>
                  {it.variantName && (
                    <p className="text-xs opacity-60 mt-0.5">{it.variantName}</p>
                  )}
                  {inputLines.length > 0 && (
                    <ul className="text-xs opacity-70 mt-1 space-y-0.5">
                      {inputLines.map((line, idx) => {
                        const isSecret = line.label ? /password|pass|mật khẩu|m[aậ]t kh[aẩ]u/i.test(line.label) : false
                        return (
                          <li key={idx}>
                            {line.label ? <><b>{line.label}:</b> </> : null}
                            {isSecret ? '••••••' : line.value}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <p className="text-xs opacity-60 mt-1">{formatPrice(it.price)} × {it.quantity}</p>
                </div>
                <span className="text-sm font-semibold whitespace-nowrap">{formatPrice(it.price * it.quantity)}</span>
              </li>
              )
            })}
          </ul>

          {globalAutoActive && (
            <div className="rounded-xl p-3 mb-3 text-sm" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug">
                    {globalDiscount.data?.title || 'Đã tự áp dụng mã giảm giá'}
                  </p>
                  <DiscountCodeMeta
                    code={autoGlobal!.code}
                    label={globalDiscount.data?.label}
                    mode={globalDiscount.data?.appMetaMode}
                    text={globalDiscount.data?.appMetaText}
                    copied={copiedGlobalCode}
                    onCopy={() => copyGlobalDiscountCode(autoGlobal!.code)}
                  />
                  {globalDiscount.data?.appMessage && (
                    <p className="text-xs opacity-75 mt-1 leading-relaxed">{globalDiscount.data.appMessage}</p>
                  )}
                  {!showManualDiscount && (
                    <button
                      type="button"
                      onClick={() => setShowManualDiscount(true)}
                      className="text-xs mt-2 underline opacity-70"
                    >
                      Có mã khác?
                    </button>
                  )}
                </div>
                <span className="font-semibold whitespace-nowrap">−{formatPrice(autoGlobal!.discount)}</span>
              </div>
            </div>
          )}

          {(!globalAutoActive || showManualDiscount) && !applied && (
            <div className="rounded-2xl p-3 mb-3" style={{ background: 'var(--tg-bg-2)' }}>
              <p className="text-xs font-medium mb-2">{globalAutoActive ? 'Mã giảm giá khác' : 'Mã giảm giá'}</p>
              <div className="flex gap-2">
                <input
                  value={discountCode}
                  onChange={(e) => { setDiscountCode(e.target.value.toUpperCase()); setApplied(null); setApplyMsg(null) }}
                  placeholder="VD: SUMMER10"
                  className="flex-1 rounded-xl px-3 py-2 text-sm font-mono placeholder:normal-case placeholder:opacity-60"
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
          )}

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
              {effectiveDiscountCode && <div className="text-[11px] opacity-60">Đã giảm: {effectiveDiscountCode}</div>}
            </div>
            <button
              type="button"
              onClick={placeOrder}
              disabled={busy}
              className="miniapp-btn miniapp-btn--primary inline-flex items-center justify-center gap-2"
            >
              {busy && <span className="miniapp-qr-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} aria-hidden />}
              {busy ? t.checkout.creating : `${t.checkout.confirm} →`}
            </button>
          </div>
        </>
      )}
    </MiniAppShell>
  )
}
