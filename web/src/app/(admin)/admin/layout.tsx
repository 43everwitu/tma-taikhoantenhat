'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getAdminToken } from '@/lib/api'
import { AdminSidebar } from '@/components/AdminSidebar'
import { Menu } from '@/lib/icons'
import { MascotBadge } from '@/components/MascotBadge'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (pathname === '/admin/login') {
      setReady(true)
      return
    }
    if (!getAdminToken()) {
      router.replace('/admin/login')
    } else {
      setReady(true)
    }
  }, [pathname, router])

  if (pathname === '/admin/login') {
    return <>{children}</>
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-clay-cream">
        <div className="text-clay-charcoal">Đang tải...</div>
      </div>
    )
  }

  return (
    <div className="lg:flex min-h-screen bg-clay-cream">
      <AdminSidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* Mobile top bar (hidden on lg+) */}
      <header className="lg:hidden sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-clay-oat px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Mở menu"
          className="clay-btn p-2"
        >
          <Menu size={18} />
        </button>
        <div className="clay-display text-lg">
          <span className="flex items-center gap-2"><MascotBadge size={28} />Auto-chan <span style={{ color: 'var(--color-ube-800)' }}>Admin</span></span>
        </div>
        <div className="w-10" aria-hidden /> {/* spacer to balance the menu button */}
      </header>

      <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-auto">{children}</main>
    </div>
  )
}
