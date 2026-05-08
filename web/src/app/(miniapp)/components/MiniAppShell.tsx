'use client'

import Link from 'next/link'
import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { t } from '@/i18n/vi'

export function MiniAppShell({
  children,
  title,
  subtitle,
  showHeader = true,
  hasBottombar = false,
}: {
  children: ReactNode
  title?: string
  subtitle?: string
  showHeader?: boolean
  hasBottombar?: boolean
}) {
  const pathname = usePathname()
  const navItems: { href: string; label: string; icon: string; match: (p: string) => boolean }[] = [
    { href: '/',         label: t.nav.home,    icon: '🏠', match: (p) => p === '/' },
    { href: '/gio-hang', label: t.nav.cart,    icon: '🛒', match: (p) => p.startsWith('/gio-hang') },
    { href: '/don-hang', label: t.nav.orders,  icon: '📋', match: (p) => p.startsWith('/don-hang') },
  ]
  return (
    <div className="miniapp-root">
      {showHeader && (
        <header className="miniapp-header px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/" className="miniapp-brand">
              <span className="miniapp-brand-mark">T</span>
              <span>{title ?? t.appName}</span>
            </Link>
            <Link href="/gio-hang" className="text-xl" aria-label={t.nav.cart}>🛒</Link>
          </div>
          {subtitle && (
            <p className="text-xs opacity-60 mt-0.5 ml-10">{subtitle}</p>
          )}
        </header>
      )}
      <main className={`px-4 pt-3 ${hasBottombar ? 'pb-32' : 'pb-24'}`}>{children}</main>
      <nav className="miniapp-bottomnav">
        {navItems.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            aria-current={it.match(pathname) ? 'page' : undefined}
          >
            <span className="miniapp-bottomnav-icon">{it.icon}</span>
            {it.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
