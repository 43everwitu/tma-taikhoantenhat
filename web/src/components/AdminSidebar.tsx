'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { clearAdminToken } from '@/lib/api'
import { BarChart3, Receipt, Package, Boxes, Megaphone, Settings, LogOut, Users, Wallet, X, MessageSquare } from '@/lib/icons'
import { MascotBadge } from '@/components/MascotBadge'
import { t } from '@/i18n/vi'

const NAV = [
  { href: '/admin/dashboard', label: 'Tổng quan', icon: BarChart3 },
  { href: '/admin/orders', label: 'Đơn hàng', icon: Receipt },
  { href: '/admin/products', label: 'Sản phẩm', icon: Package },
  { href: '/admin/stock', label: 'Kho', icon: Boxes },
  { href: '/admin/users', label: 'Người dùng', icon: Users },
  { href: '/admin/topups', label: 'Nạp tiền', icon: Wallet },
  { href: '/admin/announcements', label: 'Thông báo', icon: Megaphone },
  { href: '/admin/messages', label: 'Tin nhắn', icon: MessageSquare },
  { href: '/admin/settings', label: 'Cài đặt', icon: Settings },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function AdminSidebar({ open, onClose }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  // Close drawer on navigation (mobile) — desktop stays static so this is a no-op there.
  useEffect(() => { onClose() }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // ESC closes drawer
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function handleLogout() {
    clearAdminToken()
    router.replace('/admin/login')
  }

  return (
    <>
      {open && <div className="clay-drawer-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside className={`clay-drawer-panel ${open ? 'open' : ''} lg:w-64 p-5 flex flex-col flex-shrink-0`}>
        <div className="flex items-center justify-between mb-8">
          <div className="clay-display text-2xl">
            <span className="flex items-center gap-2"><MascotBadge size={28} />{t.appName} <span style={{ color: 'var(--color-ube-800)' }}>Admin</span></span>
          </div>
          <button onClick={onClose} className="clay-btn p-2 lg:hidden" aria-label="Đóng menu">
            <X size={16} />
          </button>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {NAV.map(item => {
            const active = pathname === item.href || pathname?.startsWith(item.href + '/')
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center px-3 py-2 rounded-xl text-sm font-medium transition ${
                  active ? 'bg-clay-ink text-white' : 'text-clay-charcoal hover:bg-clay-oat-light'
                }`}
              >
                <Icon size={18} className="mr-2 shrink-0" />{item.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-clay-oat pt-4 mt-4">
          <button
            onClick={handleLogout}
            className="clay-btn w-full text-sm flex items-center justify-center gap-2"
          >
            <LogOut size={16} />Đăng xuất
          </button>
        </div>
      </aside>
    </>
  )
}
