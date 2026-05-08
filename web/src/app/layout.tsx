import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-inter' })
const jbm = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jbm' })

export const metadata: Metadata = {
  title: 'Auto-chan — Shop tự động cho onii-chan',
  description: 'Cửa hàng tự động Auto-chan. Mua sản phẩm số, thanh toán bằng QR, nhận sản phẩm tức thì.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} ${jbm.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
