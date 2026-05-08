'use client'

import Image from 'next/image'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

export function QrPanel({ qrUrl, paymentCode, amount, bankName }: {
  qrUrl: string; paymentCode: string; amount: number; bankName: string
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--tg-bg-2)' }}>
      <p className="text-center text-sm opacity-70 mb-2">{t.order.qrTitle} ({bankName})</p>
      <div className="flex justify-center">
        <Image src={qrUrl} alt="VietQR" width={240} height={240} unoptimized />
      </div>
      <div className="mt-3 text-center">
        <p className="text-sm opacity-70">{t.order.paymentCode}</p>
        <p className="font-mono text-lg select-all">{paymentCode}</p>
        <p className="text-xs mt-1 opacity-70">{formatPrice(amount)}</p>
      </div>
    </div>
  )
}
