import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-inter' })
const jbm = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jbm' })

export const metadata: Metadata = {
  title: 'Taikhoantenhat',
  description: 'Cửa hàng số Telegram',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} ${jbm.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Script
          src="https://telegram.org/js/telegram-web-app.js?57"
          strategy="beforeInteractive"
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
