'use client'

import Link from 'next/link'
import { ReactNode } from 'react'
import { t } from '@/i18n/vi'

export function MiniAppShell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div
      className="min-h-screen pb-20"
      style={{ background: 'var(--tg-bg, #fff)', color: 'var(--tg-text, #000)' }}
    >
      {title && (
        <header
          className="sticky top-0 z-10 px-4 py-3 text-base font-semibold"
          style={{ background: 'var(--tg-bg-2, #f4f4f4)' }}
        >
          {title}
        </header>
      )}
      <main className="px-4 py-3">{children}</main>
      <nav
        className="fixed bottom-0 left-0 right-0 grid grid-cols-3 border-t text-sm"
        style={{ background: 'var(--tg-bg-2, #f4f4f4)' }}
      >
        <Link href="/" className="py-3 text-center">{t.nav.home}</Link>
        <Link href="/gio-hang" className="py-3 text-center">{t.nav.cart}</Link>
        <Link href="/don-hang" className="py-3 text-center">{t.nav.orders}</Link>
      </nav>
    </div>
  )
}
