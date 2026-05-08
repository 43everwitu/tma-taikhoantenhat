'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, setCustomerToken, getCustomerToken } from '@/lib/api'
import Link from 'next/link'
import { Send, PartyPopper, ArrowLeft, Hash } from '@/lib/icons'
import { MascotBadge } from '@/components/MascotBadge'

type Step = 'enter-id' | 'enter-code' | 'success'

export default function LinkTelegramPage() {
  const router = useRouter()
  // Already linked → bounce to account page
  useEffect(() => {
    if (getCustomerToken()) router.replace('/tai-khoan')
  }, [router])

  const [step, setStep] = useState<Step>('enter-id')
  const [telegramId, setTelegramId] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function parseTelegramId(): number | null {
    const trimmed = telegramId.trim().replace(/^#/, '')
    if (!/^\d{5,}$/.test(trimmed)) return null
    const n = Number(trimmed)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  }

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    const tgid = parseTelegramId()
    if (tgid === null) {
      setError('Telegram ID phải là số (≥ 5 chữ số). Gửi /myid cho bot để lấy ID.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await api.post('/auth/link-telegram', { telegramId: tgid })
      setStep('enter-code')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Có lỗi xảy ra, vui lòng thử lại'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    const tgid = parseTelegramId()
    if (tgid === null) {
      setError('Telegram ID không hợp lệ.')
      return
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Mã xác nhận phải là 6 chữ số.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await api.post<{ token: string }>('/auth/verify-code', {
        telegramId: tgid,
        code: code.trim(),
      })
      setCustomerToken(res.data.token)
      setStep('success')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Mã xác nhận không đúng'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <header className="border-b border-clay-oat bg-clay-cream/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-5 flex items-center justify-between">
          <Link href="/" className="text-2xl clay-display flex items-center gap-2">
            <MascotBadge size={32} />
            Taikhoantenhat
          </Link>
          <Link href="/san-pham" className="clay-btn">Sản phẩm</Link>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-clay-oat-light flex items-center justify-center mx-auto mb-4">
            <Send size={32} className="text-clay-charcoal" />
          </div>
          <h1 className="clay-display text-2xl sm:text-3xl">Liên kết Telegram</h1>
          <p className="text-clay-charcoal mt-2">Liên kết tài khoản Telegram để mua hàng trên web</p>
        </div>

        <div className="clay-card p-6 sm:p-8">
          {/* Step 1: Enter Telegram ID */}
          {step === 'enter-id' && (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-clay-charcoal mb-2">
                  Telegram ID của bạn
                </label>
                <div className="relative">
                  <Hash size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-clay-silver" />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d*"
                    value={telegramId}
                    onChange={(e) => setTelegramId(e.target.value.replace(/\D/g, ''))}
                    placeholder="Ví dụ: 123456789"
                    className="clay-input w-full pl-9"
                    required
                  />
                </div>
                <p className="text-xs text-clay-silver mt-2">
                  Bạn có thể lấy Telegram ID bằng cách gửi lệnh /start cho bot @userinfobot
                </p>
              </div>

              {error && (
                <p className="text-sm" style={{ color: 'var(--color-pomegranate-700)' }}>{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="clay-btn clay-btn--ink w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Send size={16} />{loading ? 'Đang gửi mã...' : 'Gửi mã xác nhận'}
              </button>
            </form>
          )}

          {/* Step 2: Enter verification code */}
          {step === 'enter-code' && (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div className="clay-card-dashed p-3">
                <p className="text-sm text-clay-charcoal">
                  Mã xác nhận đã được gửi qua Telegram. Vui lòng kiểm tra tin nhắn từ bot.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-clay-charcoal mb-2">
                  Nhập mã xác nhận (6 số)
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  className="clay-input w-full text-center text-2xl font-mono tracking-widest"
                  required
                />
              </div>

              {error && (
                <p className="text-sm" style={{ color: 'var(--color-pomegranate-700)' }}>{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="clay-btn clay-btn--ink w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Đang xác nhận...' : 'Xác nhận'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep('enter-id')
                  setCode('')
                  setError(null)
                }}
                className="clay-btn w-full flex items-center justify-center gap-1.5"
              >
                <ArrowLeft size={16} />Quay lại
              </button>
            </form>
          )}

          {/* Step 3: Success */}
          {step === 'success' && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto" style={{ background: 'var(--color-matcha-300)' }}>
                <PartyPopper size={32} />
              </div>
              <h2 className="clay-display text-xl">Liên kết thành công!</h2>
              <p className="text-clay-charcoal">
                Tài khoản Telegram của bạn đã được liên kết. Bây giờ bạn có thể mua hàng trên web.
              </p>
              <Link
                href="/san-pham"
                className="clay-btn clay-btn--ink flex items-center justify-center gap-2 w-full"
              >
                Bắt đầu mua sắm →
              </Link>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-clay-oat py-8 text-center text-clay-charcoal text-sm">
        <p>© 2026 Taikhoantenhat · Hỗ trợ: <a href="https://t.me/peanut1010" className="underline">@peanut1010</a></p>
      </footer>
    </>
  )
}
