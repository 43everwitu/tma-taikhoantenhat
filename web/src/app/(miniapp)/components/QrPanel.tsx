'use client'

import { useState } from 'react'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

export function QrPanel({ qrUrl, paymentCode, amount, bankName }: {
  qrUrl: string; paymentCode: string; amount: number; bankName: string
}) {
  const [copied, setCopied] = useState<'code' | 'amount' | null>(null)

  function copy(text: string, key: 'code' | 'amount') {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <div className="miniapp-qr">
      <p className="text-xs uppercase tracking-wider opacity-60 mb-1">{bankName}</p>
      <p className="text-sm font-medium mb-3">{t.order.qrTitle}</p>
      <div className="miniapp-qr-code">
        <Image src={qrUrl} alt="VietQR" width={220} height={220} unoptimized />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-left">
        <button
          type="button"
          onClick={() => copy(String(amount), 'amount')}
          className="rounded-xl p-2.5 border text-left"
          style={{ borderColor: 'color-mix(in srgb, var(--brand-ink) 10%, transparent)' }}
        >
          <div className="text-[10px] uppercase opacity-60 tracking-wider">Số tiền</div>
          <div className="font-bold text-sm">{formatPrice(amount)}</div>
          <div className="text-[10px] opacity-50 mt-0.5">{copied === 'amount' ? '✓ Đã chép' : 'Bấm để chép'}</div>
        </button>
        <button
          type="button"
          onClick={() => copy(paymentCode, 'code')}
          className="rounded-xl p-2.5 border text-left"
          style={{ borderColor: 'color-mix(in srgb, var(--brand-ink) 10%, transparent)' }}
        >
          <div className="text-[10px] uppercase opacity-60 tracking-wider">{t.order.paymentCode}</div>
          <div className="font-mono font-bold text-sm">{paymentCode}</div>
          <div className="text-[10px] opacity-50 mt-0.5">{copied === 'code' ? '✓ Đã chép' : 'Bấm để chép'}</div>
        </button>
      </div>

      <p className="mt-3 text-[11px] opacity-60 leading-relaxed">
        Quét QR hoặc chuyển khoản đúng số tiền + nội dung. Hệ thống tự động giao key trong 1–2 phút.
      </p>
    </div>
  )
}
