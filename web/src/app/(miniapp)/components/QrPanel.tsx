'use client'

import { useState } from 'react'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'
import { getWebApp, isTmaVersionAtLeast } from '@/lib/telegram'
import { Icon } from './Icon'

type CopyKey = 'account' | 'code' | 'amount' | null

export function QrPanel({ orderId, qrUrl, paymentCode, amount, bankName, accountNumber, accountName }: {
  orderId: string
  qrUrl: string
  paymentCode: string
  amount: number
  bankName: string
  accountNumber?: string
  accountName?: string
}) {
  const [copied, setCopied] = useState<CopyKey>(null)
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null)

  function copy(text: string, key: Exclude<CopyKey, null>) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  async function downloadQr() {
    setDownloadMsg(null)
    const fileName = `QR-${paymentCode}.png`
    const wa = getWebApp()
    const nativeDownloadSupported = Boolean(
      wa?.downloadFile
      && isTmaVersionAtLeast(wa, '8.0')
    )

    if (nativeDownloadSupported && wa && typeof window !== 'undefined') {
      const url = new URL(`/api/v1/orders/${orderId}/qr-download`, window.location.origin)
      if (url.protocol === 'https:') {
        wa.downloadFile?.({ url: url.href, file_name: fileName }, (accepted) => {
          setDownloadMsg(accepted ? 'Telegram đang tải QR.' : 'Bạn đã huỷ tải QR.')
        })
        return
      }
    }

    if (wa) {
      setDownloadMsg('Telegram cần phiên bản mới hơn để tải QR trực tiếp.')
      return
    }

    // Browser-only fallback for local testing outside Telegram.
    try {
      const res = await fetch(qrUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
      return
    } catch {}
  }

  return (
    <div className="miniapp-qr text-center">
      <p className="text-xs uppercase tracking-wider opacity-60">{bankName}</p>
      <p className="text-sm font-medium mb-3">{t.order.qrTitle}</p>

      <div className="miniapp-qr-code mx-auto">
        <Image src={qrUrl} alt="VietQR" width={236} height={236} priority unoptimized />
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={downloadQr}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold"
          style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}
        >
          <Icon name="download" size={14} />
          {t.order.downloadQr}
        </button>
        {downloadMsg && (
          <p className="mt-1.5 text-[11px] opacity-60">{downloadMsg}</p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-left">
        <div
          className="rounded-xl p-2.5 border"
          style={{ borderColor: 'color-mix(in srgb, var(--brand-ink) 10%, transparent)' }}
        >
          <div className="text-[10px] uppercase opacity-60 tracking-wider">{t.order.accountName}</div>
          <div className="font-semibold text-sm truncate">{accountName || '—'}</div>
        </div>

        <div
          className="rounded-xl p-2.5 border"
          style={{ borderColor: 'color-mix(in srgb, var(--brand-ink) 10%, transparent)' }}
        >
          <div className="text-[10px] uppercase opacity-60 tracking-wider">Số tiền</div>
          <div className="font-bold text-sm">{formatPrice(amount)}</div>
        </div>

        <button
          type="button"
          onClick={() => accountNumber && copy(accountNumber, 'account')}
          disabled={!accountNumber}
          className="rounded-xl p-2.5 border text-left disabled:opacity-60"
          style={{ borderColor: 'color-mix(in srgb, var(--brand-ink) 10%, transparent)' }}
        >
          <div className="text-[10px] uppercase opacity-60 tracking-wider">{t.order.accountNumber}</div>
          <div className="font-mono font-bold text-sm truncate">{accountNumber || '—'}</div>
          <div className="text-[10px] opacity-50 mt-0.5">
            {copied === 'account' ? `✓ ${t.order.copied}` : t.order.copyHint}
          </div>
        </button>

        <button
          type="button"
          onClick={() => copy(paymentCode, 'code')}
          className="rounded-xl p-2.5 border text-left"
          style={{ borderColor: 'color-mix(in srgb, var(--brand-ink) 10%, transparent)' }}
        >
          <div className="text-[10px] uppercase opacity-60 tracking-wider">{t.order.paymentCode}</div>
          <div className="font-mono font-bold text-sm truncate">{paymentCode}</div>
          <div className="text-[10px] opacity-50 mt-0.5">
            {copied === 'code' ? `✓ ${t.order.copied}` : t.order.copyHint}
          </div>
        </button>
      </div>

      <p className="mt-3 text-[11px] opacity-60 leading-relaxed">
        Quét QR hoặc chuyển khoản đúng số tiền + nội dung. Hệ thống tự động giao key trong 1–2 phút.
      </p>
    </div>
  )
}
