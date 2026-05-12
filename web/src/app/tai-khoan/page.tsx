'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, clearCustomerToken, getCustomerToken } from '@/lib/api'
import { formatPrice, formatDate } from '@/lib/utils'
import { ShoppingCart, Wallet, Receipt, LogOut, Copy, Send, Lock } from '@/lib/icons'
import { UserMenu } from '@/components/UserMenu'
import { MascotBadge } from '@/components/MascotBadge'
import { t } from '@/i18n/vi'

interface Me {
  telegramId: number
  username: string | null
  fullName: string
  balance: number
  createdAt: string
  email?: string | null
  hasPassword?: boolean
}

interface Order {
  id: number
  product_name: string
  quantity: number
  total_price: number
  status: string
  payment_code: string | null
  created_at: string
}

interface Topup {
  id: number
  amount: number
  memo: string
  status: string
  requested_at: string
  matched_at: string | null
  expires_at: string | null
}

interface TopupCreated {
  id: number
  memo: string
  amount: number
  qrUrl: string
  expiresAt: string
}

const QUICK_AMOUNTS = [50_000, 100_000, 200_000, 500_000]
const STATUS_LABEL: Record<string, string> = {
  pending: '⏳ Chờ',
  paid: '💵 Đã trả',
  delivered: '✅ Đã giao',
  cancelled: '❌ Hủy',
  expired: '⏰ Hết hạn',
  refunded: '↩️ Hoàn tiền',
  matched: '✅ Đã cộng',
}

export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountPageInner />
    </Suspense>
  )
}

function AccountPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'wallet' | 'orders'>(
    (searchParams.get('tab') as 'wallet' | 'orders') === 'orders' ? 'orders' : 'wallet'
  )
  const [amountStr, setAmountStr] = useState('')
  const [activeTopup, setActiveTopup] = useState<TopupCreated | null>(null)

  // Redirect to /lien-ket if no token
  useEffect(() => {
    if (!getCustomerToken()) router.replace('/lien-ket')
  }, [router])

  const { data: meRes, isError: meError } = useQuery({
    queryKey: ['customer', 'me'],
    queryFn: () => api.get<Me>('/me'),
    retry: false,
  })

  // Token rejected → bounce to link page
  useEffect(() => {
    if (meError) {
      clearCustomerToken()
      router.replace('/lien-ket')
    }
  }, [meError, router])

  const { data: ordersRes } = useQuery({
    queryKey: ['customer', 'orders'],
    queryFn: () => api.get<Order[]>('/orders/my'),
    enabled: tab === 'orders',
  })

  const { data: topupsRes } = useQuery({
    queryKey: ['customer', 'topups'],
    queryFn: () => api.get<Topup[]>('/topups'),
    refetchInterval: tab === 'wallet' && activeTopup ? 5000 : false,
  })

  const topupMutation = useMutation({
    mutationFn: (amount: number) => api.post<TopupCreated>('/topups', { amount }),
    onSuccess: (res) => {
      setActiveTopup(res.data)
      queryClient.invalidateQueries({ queryKey: ['customer', 'topups'] })
      queryClient.invalidateQueries({ queryKey: ['customer', 'me'] })
    },
  })

  function submitTopup(e: React.FormEvent) {
    e.preventDefault()
    const n = parseInt(amountStr.replace(/\D/g, ''))
    if (!Number.isFinite(n) || n < 10000) {
      alert('Số tiền tối thiểu 10.000đ')
      return
    }
    topupMutation.mutate(n)
  }

  function handleLogout() {
    clearCustomerToken()
    router.push('/')
  }

  const me = meRes?.data
  const orders = ordersRes?.data ?? []
  const topups = topupsRes?.data ?? []

  const [pwdEmail, setPwdEmail] = useState('')
  const [pwdValue, setPwdValue] = useState('')
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Prefill the email field once me loads
  useEffect(() => {
    if (me?.email && !pwdEmail) setPwdEmail(me.email)
  }, [me?.email, pwdEmail])

  const pwdMutation = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api.post('/auth/customer/set-password', body),
    onSuccess: () => {
      setPwdMsg({ ok: true, text: 'Đã lưu. Lần sau bạn có thể đăng nhập bằng email + mật khẩu.' })
      setPwdValue('')
      queryClient.invalidateQueries({ queryKey: ['customer', 'me'] })
    },
    onError: (err: unknown) => {
      setPwdMsg({ ok: false, text: err instanceof Error ? err.message : 'Lưu thất bại' })
    },
  })

  return (
    <>
      <header className="border-b border-clay-oat bg-clay-cream/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-5 flex items-center justify-between">
          <Link href="/" className="text-xl sm:text-2xl clay-display flex items-center gap-2">
            <MascotBadge size={32} />
            {t.appName}
          </Link>
          <nav className="flex gap-3">
            <Link href="/san-pham" className="clay-btn flex items-center gap-1.5">
              <ShoppingCart size={16} /><span className="hidden sm:inline">Sản phẩm</span>
            </Link>
            <UserMenu />
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Profile card */}
        <div className="clay-card p-6 mb-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl text-white font-semibold flex-shrink-0"
            style={{ background: 'var(--color-clay-ink)' }}
          >
            {(me?.fullName || me?.username || 'U').trim().charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="clay-display text-2xl truncate">{me?.fullName || 'Khách'}</h1>
            <div className="text-sm text-clay-charcoal mt-0.5">
              {me?.username ? `@${me.username}` : me ? `ID ${me.telegramId}` : '...'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-clay-charcoal">Số dư ví</div>
            <div className="clay-display text-3xl mt-1">{me ? formatPrice(me.balance) : '—'}</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setTab('wallet')}
            className="clay-pill cursor-pointer"
            style={tab === 'wallet'
              ? { background: 'var(--color-clay-ink)', color: '#fff', borderColor: 'var(--color-clay-ink)' }
              : {}}
          >
            <Wallet size={14} className="mr-1" />Nạp ví
          </button>
          <button
            onClick={() => setTab('orders')}
            className="clay-pill cursor-pointer"
            style={tab === 'orders'
              ? { background: 'var(--color-clay-ink)', color: '#fff', borderColor: 'var(--color-clay-ink)' }
              : {}}
          >
            <Receipt size={14} className="mr-1" />Đơn hàng
          </button>
          <button onClick={handleLogout} className="clay-pill cursor-pointer ml-auto" style={{ color: 'var(--color-pomegranate-700)' }}>
            <LogOut size={14} className="mr-1" />Đăng xuất
          </button>
        </div>

        {tab === 'wallet' && (
          <div className="space-y-6">
            {/* Top-up form */}
            <div className="clay-card p-6">
              <h2 className="font-semibold text-lg mb-3">Nạp số dư</h2>
              <p className="text-sm text-clay-charcoal mb-4">
                Quét VietQR và chuyển khoản. Số dư sẽ được cộng tự động trong vòng 60 giây.
              </p>
              <form onSubmit={submitTopup} className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {QUICK_AMOUNTS.map(a => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAmountStr(String(a))}
                      className="clay-btn text-sm py-1.5 px-3"
                    >
                      {formatPrice(a)}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value.replace(/\D/g, ''))}
                    placeholder="Nhập số tiền (tối thiểu 10.000đ)"
                    className="clay-input flex-1"
                  />
                  <button
                    type="submit"
                    disabled={topupMutation.isPending}
                    className="clay-btn clay-btn--ink flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Send size={14} />
                    {topupMutation.isPending ? 'Đang tạo...' : 'Tạo QR'}
                  </button>
                </div>
                {topupMutation.isError && (
                  <p className="text-sm" style={{ color: 'var(--color-pomegranate-700)' }}>
                    {topupMutation.error instanceof Error ? topupMutation.error.message : 'Tạo QR thất bại'}
                  </p>
                )}
              </form>
            </div>

            {/* Active QR */}
            {activeTopup && (
              <div className="clay-card p-6">
                <div className="flex flex-col sm:flex-row gap-6 items-center">
                  <img
                    src={activeTopup.qrUrl}
                    alt="VietQR"
                    className="w-44 h-44 sm:w-56 sm:h-56 rounded-xl border border-clay-oat"
                  />
                  <div className="flex-1 space-y-2">
                    <h3 className="font-semibold text-lg">Quét QR để nạp</h3>
                    <div className="flex items-baseline gap-2">
                      <span className="text-clay-charcoal text-sm">Số tiền:</span>
                      <span className="clay-display text-2xl">{formatPrice(activeTopup.amount)}</span>
                    </div>
                    <div>
                      <div className="text-clay-charcoal text-sm mb-1">Nội dung CK:</div>
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-sm bg-clay-oat-light px-2 py-1 rounded">
                          {activeTopup.memo}
                        </code>
                        <button
                          onClick={() => navigator.clipboard.writeText(activeTopup.memo)}
                          className="clay-btn text-xs py-1 px-2 flex items-center gap-1"
                          title="Copy"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-clay-silver">
                      ⚠️ KHÔNG đổi nội dung CK. Số dư cộng tự động sau khi MB Bank xác nhận giao dịch.
                    </p>
                    <button
                      onClick={() => setActiveTopup(null)}
                      className="clay-btn text-xs py-1 px-3 mt-2"
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Topup history */}
            <div className="clay-card p-0 overflow-hidden">
              <div className="px-6 py-4 border-b border-clay-oat-light">
                <h3 className="font-semibold">Lịch sử nạp</h3>
              </div>
              {topups.length === 0 ? (
                <p className="text-clay-silver text-sm text-center py-8">Chưa có giao dịch nạp.</p>
              ) : (
                <ul className="divide-y divide-clay-oat-light">
                  {topups.map(t => (
                    <li key={t.id} className="px-6 py-3 flex items-center justify-between text-sm">
                      <div>
                        <div className="font-medium">{formatPrice(t.amount)}</div>
                        <div className="text-xs text-clay-silver font-mono">{t.memo}</div>
                      </div>
                      <div className="text-right">
                        <div>{STATUS_LABEL[t.status] || t.status}</div>
                        <div className="text-xs text-clay-silver">{formatDate(t.requested_at)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === 'wallet' && (
          <div className="clay-card p-6 mt-6">
            <h2 className="font-semibold text-lg mb-1 flex items-center gap-2">
              <Lock size={18} />Email + mật khẩu để đăng nhập web
            </h2>
            <p className="text-sm text-clay-charcoal mb-4">
              {me?.hasPassword
                ? 'Bạn đã đặt mật khẩu. Có thể đổi tại đây hoặc dùng "Quên mật khẩu" trên trang đăng nhập.'
                : 'Sau khi đặt, lần sau bạn có thể đăng nhập bằng email + mật khẩu (không cần liên kết lại Telegram).'}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!pwdEmail || pwdValue.length < 8) {
                  setPwdMsg({ ok: false, text: 'Mật khẩu cần tối thiểu 8 ký tự.' })
                  return
                }
                pwdMutation.mutate({ email: pwdEmail, password: pwdValue })
              }}
              className="space-y-3"
            >
              <input
                type="email"
                value={pwdEmail}
                onChange={(e) => setPwdEmail(e.target.value)}
                placeholder="Email"
                className="clay-input w-full text-sm"
                required
                autoComplete="email"
              />
              <input
                type="password"
                value={pwdValue}
                onChange={(e) => setPwdValue(e.target.value)}
                placeholder={me?.hasPassword ? 'Mật khẩu mới (≥ 8 ký tự)' : 'Mật khẩu (≥ 8 ký tự)'}
                className="clay-input w-full text-sm"
                required
                minLength={8}
                autoComplete="new-password"
              />
              {pwdMsg && (
                <p className="text-sm" style={{ color: pwdMsg.ok ? 'var(--color-matcha-600)' : 'var(--color-pomegranate-700)' }}>
                  {pwdMsg.text}
                </p>
              )}
              <button
                type="submit"
                disabled={pwdMutation.isPending}
                className="clay-btn clay-btn--ink text-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                <Lock size={14} />{pwdMutation.isPending ? 'Đang lưu...' : me?.hasPassword ? 'Đổi mật khẩu' : 'Đặt mật khẩu'}
              </button>
            </form>
          </div>
        )}

        {tab === 'orders' && (
          <div className="clay-card p-0 overflow-hidden">
            <div className="px-6 py-4 border-b border-clay-oat-light">
              <h3 className="font-semibold">Đơn hàng của tôi</h3>
            </div>
            {orders.length === 0 ? (
              <p className="text-clay-silver text-sm text-center py-8">Chưa có đơn hàng nào.</p>
            ) : (
              <ul className="divide-y divide-clay-oat-light">
                {orders.map(o => (
                  <li key={o.id} className="px-6 py-3 flex items-center justify-between gap-4 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">#{o.id} · {o.product_name}</div>
                      <div className="text-xs text-clay-silver mt-0.5">
                        SL {o.quantity} · {formatDate(o.created_at)}
                        {o.payment_code && o.status === 'pending' && (
                          <span className="ml-2 font-mono">· {o.payment_code}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-medium">{formatPrice(o.total_price)}</div>
                      <div className="text-xs">{STATUS_LABEL[o.status] || o.status}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-clay-oat py-8 text-center text-clay-charcoal text-sm">
        <p>© 2026 {t.appName} · Hỗ trợ: <a href="https://t.me/peanut1010" className="underline">@peanut1010</a></p>
      </footer>
    </>
  )
}
