'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { Lock, ArrowLeft } from '@/lib/icons'
import { MascotBadge } from '@/components/MascotBadge'
import { t } from '@/i18n/vi'

type Step = 'request' | 'reset' | 'done'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('request')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await api.post('/auth/customer/forgot', { email })
      setInfo('Nếu email tồn tại trong hệ thống, mã đặt lại đã được gửi qua Telegram.')
      setStep('reset')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gửi mã')
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await api.post('/auth/customer/reset', { email, code, newPassword })
      setStep('done')
      setTimeout(() => router.push('/dang-nhap'), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đặt lại thất bại')
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
            {t.appName}
          </Link>
          <Link href="/dang-nhap" className="clay-btn flex items-center gap-1.5"><ArrowLeft size={14} />Đăng nhập</Link>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-clay-oat-light flex items-center justify-center mx-auto mb-4">
            <Lock size={32} className="text-clay-charcoal" />
          </div>
          <h1 className="clay-display text-2xl sm:text-3xl">Quên mật khẩu</h1>
          <p className="text-clay-charcoal mt-2">Mã sẽ gửi qua bot Telegram đã liên kết</p>
        </div>

        <div className="clay-card p-6 sm:p-8">
          {step === 'request' && (
            <form onSubmit={handleRequest} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-clay-charcoal mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="clay-input w-full"
                  required
                  autoComplete="email"
                />
              </div>
              {error && <p className="text-sm" style={{ color: 'var(--color-pomegranate-700)' }}>{error}</p>}
              <button type="submit" disabled={loading} className="clay-btn clay-btn--ink w-full disabled:opacity-50">
                {loading ? 'Đang gửi...' : 'Gửi mã đặt lại'}
              </button>
            </form>
          )}

          {step === 'reset' && (
            <form onSubmit={handleReset} className="space-y-4">
              {info && <p className="text-sm clay-card-dashed p-3" style={{ color: 'var(--color-clay-charcoal)' }}>{info}</p>}
              <div>
                <label className="block text-sm font-medium text-clay-charcoal mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="clay-input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-clay-charcoal mb-2">Mã 6 số (Telegram)</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="clay-input w-full text-center text-2xl font-mono tracking-widest"
                  required
                  maxLength={6}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-clay-charcoal mb-2">Mật khẩu mới (≥ 8 ký tự)</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="clay-input w-full"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-sm" style={{ color: 'var(--color-pomegranate-700)' }}>{error}</p>}
              <button type="submit" disabled={loading} className="clay-btn clay-btn--ink w-full disabled:opacity-50">
                {loading ? 'Đang đặt lại...' : 'Đặt lại mật khẩu'}
              </button>
              <button type="button" onClick={() => setStep('request')} className="clay-btn w-full text-sm">
                Gửi lại mã
              </button>
            </form>
          )}

          {step === 'done' && (
            <div className="text-center">
              <p className="text-clay-charcoal">✅ Đặt lại thành công. Đang chuyển tới trang đăng nhập...</p>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
