'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api, setCustomerToken, getCustomerToken } from '@/lib/api'
import { Send, Lock, Hash } from '@/lib/icons'
import { MascotBadge } from '@/components/MascotBadge'

export default function CustomerLoginPage() {
  const router = useRouter()

  // Already logged in → bounce
  useEffect(() => {
    if (getCustomerToken()) router.replace('/tai-khoan')
  }, [router])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{ token: string }>('/auth/customer/login', { email, password })
      setCustomerToken(res.data.token)
      router.replace('/tai-khoan')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại')
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

      <main className="max-w-xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-clay-oat-light flex items-center justify-center mx-auto mb-4">
            <Lock size={32} className="text-clay-charcoal" />
          </div>
          <h1 className="clay-display text-2xl sm:text-3xl">Đăng nhập</h1>
          <p className="text-clay-charcoal mt-2">Đăng nhập bằng email + mật khẩu</p>
        </div>

        {/* First-time customer guidance */}
        <div className="clay-card p-5 mb-5" style={{ background: 'var(--color-lemon-100)', borderColor: 'var(--color-lemon-400)' }}>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-white border border-clay-oat flex items-center justify-center flex-shrink-0">
              <Send size={16} />
            </div>
            <div className="flex-1 text-sm">
              <p className="font-semibold mb-1">Lần đầu sử dụng?</p>
              <p className="text-clay-charcoal leading-relaxed">
                Bắt buộc <Link href="/lien-ket" className="font-medium underline underline-offset-2 hover:text-clay-ink">liên kết Telegram</Link> trước.
                Sau khi liên kết, vào trang <strong>Tài khoản</strong> để đặt email + mật khẩu — lần sau bạn có thể đăng nhập trực tiếp tại đây.
              </p>
              <Link
                href="/lien-ket"
                className="clay-btn clay-btn--ink text-sm mt-3 inline-flex items-center gap-1.5"
              >
                <Send size={14} />Liên kết Telegram
              </Link>
            </div>
          </div>
        </div>

        {/* 3-step flow */}
        <ol className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-6 text-center text-xs">
          <li className="clay-card p-3">
            <div className="w-7 h-7 rounded-full bg-clay-ink text-white text-xs font-semibold flex items-center justify-center mx-auto mb-1.5">1</div>
            <div className="font-medium">Liên kết Telegram</div>
            <div className="text-clay-silver mt-1">Nhập Telegram ID + mã xác nhận từ bot</div>
          </li>
          <li className="clay-card p-3">
            <div className="w-7 h-7 rounded-full bg-clay-ink text-white text-xs font-semibold flex items-center justify-center mx-auto mb-1.5">2</div>
            <div className="font-medium">Đặt email + mật khẩu</div>
            <div className="text-clay-silver mt-1">Trong trang Tài khoản → Email + mật khẩu</div>
          </li>
          <li className="clay-card p-3">
            <div className="w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center mx-auto mb-1.5" style={{ background: 'var(--color-matcha-300)' }}>3</div>
            <div className="font-medium">Đăng nhập web</div>
            <div className="text-clay-silver mt-1">Bằng email + mật khẩu (form bên dưới)</div>
          </li>
        </ol>

        <div className="clay-card p-6 sm:p-8">
          <h2 className="font-semibold text-lg mb-1">Đăng nhập bằng email</h2>
          <p className="text-xs text-clay-charcoal mb-4">
            Đã liên kết Telegram + đã đặt mật khẩu? Đăng nhập tại đây.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-clay-charcoal mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ban@example.com"
                className="clay-input w-full"
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-clay-charcoal mb-2">Mật khẩu</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="clay-input w-full"
                required
                autoComplete="current-password"
                minLength={8}
              />
            </div>

            {error && (
              <p className="text-sm" style={{ color: 'var(--color-pomegranate-700)' }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="clay-btn clay-btn--ink w-full disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Lock size={16} />{loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>

            <div className="flex items-center justify-between text-sm pt-2">
              <Link href="/quen-mat-khau" className="text-clay-charcoal hover:text-clay-ink underline underline-offset-4">
                Quên mật khẩu?
              </Link>
              <Link href="/lien-ket" className="text-clay-charcoal hover:text-clay-ink underline underline-offset-4 inline-flex items-center gap-1">
                <Send size={14} />Liên kết Telegram
              </Link>
            </div>
          </form>
        </div>
      </main>
    </>
  )
}
