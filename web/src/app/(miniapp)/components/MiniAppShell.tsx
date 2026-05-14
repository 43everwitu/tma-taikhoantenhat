'use client'

import Link from 'next/link'
import { ReactNode, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { useTelegramBackButton } from '@/lib/useTelegramBackButton'
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
  const router = useRouter()
  const onBack = useCallback(() => { router.back() }, [router])
  useTelegramBackButton(pathname !== '/', onBack)
  const shopInfo = useQuery({
    queryKey: ['shop', 'info'],
    queryFn: () => apiFetch<{ supportUrl?: string }>('/shop/info'),
    staleTime: 5 * 60_000,
  })
  const supportUrl = shopInfo.data?.supportUrl?.trim() || ''
  return (
    <div className="miniapp-root">
      {showHeader && (
        <header className="miniapp-header">
          <div className="miniapp-container px-4 py-3 flex items-center justify-between">
            <Link href="/" className="miniapp-brand">
              <span className="miniapp-brand-mark">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/favicon.png" alt="" width={32} height={32} />
              </span>
              <span className="line-clamp-2">{title ?? t.appName}</span>
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
              <Link
                href="/san-pham?focus=1"
                className="miniapp-topnav-link"
                aria-label="Tìm kiếm"
              >
                <Icon name="search" size={18} />
                Tìm kiếm
              </Link>
              {supportUrl && (
                <a
                  href={supportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="miniapp-topnav-link"
                >
                  <Icon name="support" size={18} />
                  Hỗ trợ
                </a>
              )}
            </nav>

            <div className="md:hidden flex items-center gap-2">
              <Link
                href="/san-pham?focus=1"
                aria-label="Tìm kiếm"
                className="inline-flex items-center justify-center w-9 h-9 rounded-full"
                style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}
              >
                <Icon name="search" size={18} />
              </Link>
              {supportUrl && (
                <a
                  href={supportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Hỗ trợ"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-full"
                  style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}
                >
                  <Icon name="support" size={18} />
                </a>
              )}
              <Link
                href="/gio-hang"
                aria-label={t.nav.cart}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full"
                style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)' }}
              >
                <Icon name="cart" size={18} />
              </Link>
            </div>
          </div>
          {subtitle && (
            <div className="miniapp-container px-4">
              <p className="text-xs opacity-60 mt-0.5 ml-10">{subtitle}</p>
            </div>
          )}
        </header>
      )}

      <main className={`miniapp-container px-4 pt-3 ${hasBottombar ? 'pb-48' : 'pb-24'} md:pb-12`}>
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
