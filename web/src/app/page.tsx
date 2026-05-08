'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatPrice } from '@/lib/utils'
import { ShoppingCart, Send, PartyPopper, Zap, BookOpen, Lock } from '@/lib/icons'
import { ProductImage } from '@/components/ProductImage'
import { MascotBadge } from '@/components/MascotBadge'
import { UserMenu } from '@/components/UserMenu'
import { useShopStream } from '@/lib/useShopStream'
import type { ComponentType } from 'react'

function SwatchCard({
  Icon,
  title,
  children,
  bg,
  fg = 'var(--color-clay-ink)',
  iconBg = '#fff',
}: {
  Icon: ComponentType<{ size?: number; className?: string }>
  title: string
  children: React.ReactNode
  bg: string
  fg?: string
  iconBg?: string
}) {
  return (
    <div className="clay-swatch-card p-7" style={{ background: bg, color: fg }}>
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-6 border border-clay-oat"
        style={{ background: iconBg, color: 'var(--color-clay-ink)' }}
      >
        <Icon size={22} />
      </div>
      <h3
        className="clay-display mb-3"
        style={{ fontSize: '32px', letterSpacing: '-0.02em', lineHeight: 1.05 }}
      >
        {title}
      </h3>
      <p className="text-[17px] leading-[1.55]" style={{ color: fg, opacity: 0.86 }}>
        {children}
      </p>
    </div>
  )
}

interface Product {
  id: string
  name: string
  slug: string
  emoji: string
  imageUrl?: string
  price: number
  stock: number
  description: string
  promotion?: { label: string; discount: number } | null
}

export default function HomePage() {
  useShopStream()
  const { data, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.get<Product[]>('/products'),
  })
  const products = data?.data ?? []

  return (
    <main className="min-h-screen">
      <header className="border-b border-clay-oat bg-clay-cream/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-5 flex items-center justify-between">
          <Link href="/" className="text-xl sm:text-2xl clay-display flex items-center gap-2">
            <MascotBadge size={32} />
            Auto-chan
          </Link>
          <nav className="flex gap-3">
            <Link href="/san-pham" className="clay-btn clay-btn--lemon flex items-center gap-1.5">
              <ShoppingCart size={16} /><span className="hidden sm:inline">Sản phẩm</span>
            </Link>
            <UserMenu />
          </nav>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 lg:pt-20 pb-12 sm:pb-16">
        <span className="clay-pill flex items-center gap-1.5 w-fit">
          <PartyPopper size={14} />Giao tự động sau khi chuyển khoản
        </span>
        <h1 className="clay-display mt-6 max-w-4xl leading-[1.05]" style={{ fontSize: 'clamp(40px, 8vw, 80px)' }}>
          Tài khoản số chính hãng,<br/>
          <span style={{color: 'var(--color-matcha-600)'}}>giao trong 60 giây</span>.
        </h1>
        <p className="text-base sm:text-lg text-clay-charcoal max-w-2xl mt-6">
          Quét VietQR — chuyển khoản — nhận tài khoản &amp; hướng dẫn sử dụng tự động qua web hoặc Telegram. Không cần xác nhận thủ công.
        </p>
        <div className="flex flex-wrap gap-3 mt-8">
          <Link href="/san-pham" className="clay-btn clay-btn--ink flex items-center gap-2">
            Xem sản phẩm <span aria-hidden>→</span>
          </Link>
          <Link href="/lien-ket" className="clay-btn clay-btn--ube flex items-center gap-1.5">
            <Send size={16} />Liên kết Telegram
          </Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="flex items-end justify-between gap-6 mb-10 flex-wrap">
          <div>
            <span className="clay-kicker">— Tại sao Auto-chan</span>
            <h2 className="clay-display mt-3" style={{ fontSize: 'clamp(32px, 5vw, 44px)', letterSpacing: '-0.025em', lineHeight: 1.05 }}>
              Mua tài khoản,<br/>
              <span style={{ color: 'var(--color-matcha-600)' }}>giao như đặt cà phê.</span>
            </h2>
          </div>
          <p className="max-w-sm text-[17px] leading-[1.55] text-clay-charcoal">
            Ba điều khiến trải nghiệm mua hàng tại Auto-chan khác phần còn lại — tự động, đầy đủ, an toàn.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <SwatchCard
            Icon={Zap}
            title="Giao tự động"
            bg="var(--color-matcha-300)"
          >
            Bot dò giao dịch MB Bank mỗi 15 giây — khớp mã <code className="font-mono text-[14px] bg-white/50 px-1.5 py-0.5 rounded border border-clay-oat">PNS</code> là tài khoản tới ngay.
          </SwatchCard>
          <SwatchCard
            Icon={BookOpen}
            title="Hướng dẫn sẵn sàng"
            bg="var(--color-lemon-400)"
          >
            Mỗi đơn đính kèm hướng dẫn đăng nhập, đổi mật khẩu, lưu ý bảo mật. Không phải mò mẫm.
          </SwatchCard>
          <SwatchCard
            Icon={Lock}
            title="An toàn tuyệt đối"
            bg="var(--color-ube-300)"
            fg="var(--color-ube-800)"
          >
            Thanh toán qua VietQR chuẩn NAPAS. Không lưu thông tin thẻ. Mỗi đơn một mã riêng.
          </SwatchCard>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="flex items-baseline justify-between mb-8">
          <h2 className="clay-display text-3xl">Sản phẩm nổi bật</h2>
          <Link href="/san-pham" className="text-clay-charcoal hover:text-clay-ink underline underline-offset-4">Xem tất cả →</Link>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="clay-card p-5 h-64 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.slice(0, 6).map(product => (
              <Link key={product.id} href={`/san-pham/${product.slug}`} className="clay-card p-5 block hover:-rotate-1 hover:shadow-[var(--shadow-clay-hover)] transition-transform">
                <ProductImage
                  imageUrl={product.imageUrl}
                  emoji={product.emoji}
                  alt={product.name}
                  className="w-full aspect-square rounded-2xl mb-3"
                  emojiSize={72}
                />
                <h3 className="text-lg font-semibold">{product.name}</h3>
                <p className="text-clay-charcoal text-sm mt-1 line-clamp-2">{product.description}</p>
                <div className="flex items-center justify-between mt-4">
                  <span className="text-2xl clay-display">{formatPrice(product.price)}</span>
                  <span className="clay-pill">{product.stock > 0 ? `Còn ${product.stock}` : 'Hết hàng'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-clay-oat py-8 text-center text-clay-charcoal text-sm">
        <p>© 2026 Auto-chan · Hỗ trợ: <a href="https://t.me/peanut1010" className="underline">@peanut1010</a></p>
      </footer>
    </main>
  )
}
