import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-inter' })
const jbm = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jbm' })

export const metadata: Metadata = {
  title: {
    default: 'Taikhoantenhat',
    template: '%s · Taikhoantenhat',
  },
  description: 'Cửa hàng tài khoản số chính chủ — mua trong Telegram, giao key tự động, bảo hành dài hạn.',
  applicationName: 'Taikhoantenhat',
  openGraph: {
    title: 'Taikhoantenhat',
    description: 'Cửa hàng tài khoản số chính chủ — mua trong Telegram, giao key tự động.',
    type: 'website',
    locale: 'vi_VN',
  },
}

export const viewport: Viewport = {
  themeColor: '#ffc200',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} ${jbm.variable}`} suppressHydrationWarning>
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js?57" async />
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
