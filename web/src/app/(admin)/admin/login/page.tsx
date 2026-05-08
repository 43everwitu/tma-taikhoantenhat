'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, setAdminToken } from '@/lib/api'

export default function AdminLoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsPending(true)

    try {
      const res = await api.post<{ token: string }>('/auth/login', { username, password })
      setAdminToken(res.data.token)
      router.replace('/admin/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-clay-cream">
      <form onSubmit={handleSubmit} className="clay-card p-8 w-full max-w-md">
        <h1 className="clay-display text-3xl mb-1">Đăng nhập Admin</h1>
        <p className="text-clay-charcoal mb-6">Quản lý cửa hàng Auto-chan</p>

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

        {error && (
          <div className="text-sm mb-4" style={{ color: 'var(--color-pomegranate-400)' }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="clay-btn clay-btn--ink w-full"
        >
          {isPending ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
      </form>
    </main>
  )
}
