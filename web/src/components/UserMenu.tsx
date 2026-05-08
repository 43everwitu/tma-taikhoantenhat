'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api, clearCustomerToken, getCustomerToken } from '@/lib/api'
import { formatPrice } from '@/lib/utils'
import { Send, Wallet, Receipt, LogOut, Lock } from '@/lib/icons'

interface Me {
  telegramId: number
  username: string | null
  fullName: string
  balance: number
  createdAt: string
}

function hasToken() {
  return !!getCustomerToken()
}

export function UserMenu() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tokenPresent, setTokenPresent] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Snapshot token presence on mount + keep in sync via storage event so
  // logging in/out in another tab updates this header without reload.
  useEffect(() => {
    setTokenPresent(hasToken())
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'customerToken' || e.key === null) setTokenPresent(hasToken())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Click-outside closes the dropdown
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const { data, isError } = useQuery({
    queryKey: ['customer', 'me'],
    queryFn: () => api.get<Me>('/me'),
    enabled: tokenPresent,
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  // Token rejected (expired/invalid) → clear so the link button reappears.
  useEffect(() => {
    if (isError && tokenPresent) {
      clearCustomerToken()
      setTokenPresent(false)
    }
  }, [isError, tokenPresent])

  function handleLogout() {
    clearCustomerToken()
    setTokenPresent(false)
    setOpen(false)
    router.push('/')
  }

  if (!tokenPresent) {
    return (
      <div className="flex gap-2">
        <Link href="/dang-nhap" className="clay-btn flex items-center gap-1.5">
          <Lock size={16} />Đăng nhập
        </Link>
        <Link href="/lien-ket" className="clay-btn clay-btn--ube hidden sm:flex items-center gap-1.5">
          <Send size={16} />Liên kết Telegram
        </Link>
      </div>
    )
  }

  const me = data?.data
  const initial = (me?.fullName || me?.username || 'U').trim().charAt(0).toUpperCase()

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="clay-btn flex items-center gap-2 pr-3"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-semibold"
          style={{ background: 'var(--color-clay-ink)' }}
        >
          {initial}
        </span>
        <span className="hidden sm:inline-flex flex-col items-start leading-tight">
          <span className="text-xs text-clay-charcoal">Số dư</span>
          <span className="text-sm font-semibold">
            {me ? formatPrice(me.balance) : '...'}
          </span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-72 max-w-[20rem] bg-white rounded-2xl border border-clay-oat shadow-lg overflow-hidden z-50"
        >
          <div className="px-4 py-3 border-b border-clay-oat-light bg-clay-oat-light/40">
            <div className="font-semibold truncate">{me?.fullName || 'Khách'}</div>
            <div className="text-xs text-clay-silver truncate">
              {me?.username ? `@${me.username}` : `ID ${me?.telegramId ?? '—'}`}
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <Wallet size={14} className="text-clay-charcoal" />
              <span className="text-xl clay-display">
                {me ? formatPrice(me.balance) : '—'}
              </span>
            </div>
          </div>

          <div className="py-1">
            <MenuLink href="/tai-khoan" icon={<Wallet size={16} />} onClose={() => setOpen(false)}>
              Tài khoản & nạp ví
            </MenuLink>
            <MenuLink href="/tai-khoan?tab=orders" icon={<Receipt size={16} />} onClose={() => setOpen(false)}>
              Đơn hàng của tôi
            </MenuLink>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-clay-oat-light/60 text-pomegranate-700"
              style={{ color: 'var(--color-pomegranate-700)' }}
              role="menuitem"
            >
              <LogOut size={16} />Đăng xuất
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuLink({
  href,
  icon,
  children,
  onClose,
}: {
  href: string
  icon: React.ReactNode
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-clay-oat-light/60"
      role="menuitem"
    >
      {icon}{children}
    </Link>
  )
}
