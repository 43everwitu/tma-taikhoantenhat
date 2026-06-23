import type { Metadata } from 'next'
import { AuthBoundary } from './components/AuthBoundary'

export const metadata: Metadata = {
  title: 'Taikhoantenhat',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
}

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  return <AuthBoundary>{children}</AuthBoundary>
}
