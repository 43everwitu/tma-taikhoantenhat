'use client'

import Link from 'next/link'
import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Icon } from './Icon'
import type { MiniappIconName } from '@/lib/miniappIcons'
import { t } from '@/i18n/vi'

type NavItem = { href: string; label: string; icon: MiniappIconName; match: (p: string) => boolean }

const NAV: NavItem[] = [
  { href: '/',         label: t.nav.home,   icon: 'home',   match: (p) => p === '/' },
  { href: '/gio-hang', label: t.nav.cart,   icon: 'cart',   match: (p) => p.startsWith('/gio-hang') },
  { href: '/don-hang', label: t.nav.orders, icon: 'orders', match: (p) => p.startsWith('/don-hang') },
]

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
  return (
    <div className="miniapp-root">
      {showHeader && (
        <header className="miniapp-header">
          <div className="miniapp-container px-4 py-3 flex items-center justify-between">
            <Link href="/" className="miniapp-brand">
              <span className="miniapp-brand-mark">T</span>
              <span>{title ?? t.appName}</span>
            </Link>

            <nav className="miniapp-topnav-actions">
              {NAV.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className="miniapp-topnav-link"
                  aria-current={it.match(pathname) ? 'page' : undefined}
                >
                  <Icon name={it.icon} size={18} />
                  {it.label}
                </Link>
              ))}
            </nav>

            <Link
              href="/gio-hang"
              aria-label={t.nav.cart}
              className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-full"
              style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}
            >
              <Icon name="cart" size={18} />
            </Link>
          </div>
          {subtitle && (
            <div className="miniapp-container px-4">
              <p className="text-xs opacity-60 mt-0.5 ml-10">{subtitle}</p>
            </div>
          )}
        </header>
      )}

      <main className={`miniapp-container px-4 pt-3 ${hasBottombar ? 'pb-32' : 'pb-24'} md:pb-12`}>
        {children}
      </main>

      <nav className="miniapp-bottomnav">
        {NAV.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            aria-current={it.match(pathname) ? 'page' : undefined}
          >
            <Icon name={it.icon} size={22} />
            {it.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
