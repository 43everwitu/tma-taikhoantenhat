'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { adminAuth, setAdminToken } from '@/lib/api'
import { t } from '@/i18n/vi'

type Stage = 'password' | '2fa'

export default function AdminLoginPage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState('')

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setIsPending(true)
    try {
      const res = await adminAuth.login(username, password)
      const d = res.data
      if (d.token) {
        setAdminToken(d.token)
        router.replace('/admin/dashboard')
      } else if (d.requires2fa && d.challengeToken) {
        setChallengeToken(d.challengeToken)
        setStage('2fa')
      } else if (d.requiresEnroll && d.enrollToken) {
        // Hand the enroll token to the profile page so the admin can set 2FA up.
        setAdminToken(d.enrollToken)
        router.replace('/admin/profile?enroll=1')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại')
    } finally {
      setIsPending(false)
    }
  }

  async function submit2FA(e: React.FormEvent) {
    e.preventDefault()
    if (!challengeToken) return
    setError('')
    setIsPending(true)
    try {
      const res = await adminAuth.verify2fa(challengeToken, code)
      setAdminToken(res.data.token)
      router.replace('/admin/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mã không đúng')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-clay-cream">
      <form
        onSubmit={stage === 'password' ? submitPassword : submit2FA}
        className="clay-card p-8 w-full max-w-md"
      >
        <h1 className="clay-display text-3xl mb-1">Đăng nhập Admin</h1>
        <p className="text-clay-charcoal mb-6">Quản lý cửa hàng {t.appName}</p>

        {stage === 'password' && (
          <>
            <label className="block text-sm font-medium text-clay-charcoal mb-1">Tên đăng nhập</label>
            <input
              type="text"
              className="clay-input w-full mb-4"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
            />

            <label className="block text-sm font-medium text-clay-charcoal mb-1">Mật khẩu</label>
            <input
              type="password"
              className="clay-input w-full mb-6"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </>
        )}

        {stage === '2fa' && (
          <>
            <p className="text-sm text-clay-charcoal mb-3">
              Nhập mã 6 chữ số từ ứng dụng xác thực, hoặc mã dự phòng dạng <code className="font-mono">XXXX-XXXX</code>.
            </p>
            <label className="block text-sm font-medium text-clay-charcoal mb-1">Mã xác thực</label>
            <input
              type="text"
              inputMode="text"
              className="clay-input w-full mb-6 font-mono text-lg tracking-widest"
              value={code}
              onChange={e => setCode(e.target.value)}
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </>
        )}

        {error && (
          <div className="text-sm mb-4" style={{ color: 'var(--color-pomegranate-400)' }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="clay-btn clay-btn--ink w-full"
        >
          {isPending ? 'Đang xử lý...' : stage === 'password' ? 'Đăng nhập' : 'Xác nhận'}
        </button>

        {stage === '2fa' && (
          <button
            type="button"
            onClick={() => { setStage('password'); setCode(''); setChallengeToken(null); setError('') }}
            className="text-xs text-clay-charcoal mt-3 w-full text-center hover:underline"
          >
            ← Quay lại
          </button>
        )}
      </form>
    </main>
  )
}
