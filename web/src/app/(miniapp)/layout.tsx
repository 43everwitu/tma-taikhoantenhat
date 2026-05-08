import type { Metadata } from 'next'
import { AuthBoundary } from './components/AuthBoundary'

export const metadata: Metadata = {
  title: 'Taikhoantenhat',
  description: 'Cửa hàng Telegram Mini App',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
}

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  return <AuthBoundary>{children}</AuthBoundary>
}
