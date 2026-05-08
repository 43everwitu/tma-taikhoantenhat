'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { AnnouncementBar } from '@/components/AnnouncementBar'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30000,
        retry: 1,
      },
    },
  }))

  const pathname = usePathname()
  const showBar = !pathname?.startsWith('/admin') &&
                  !pathname?.startsWith('/danh-muc') &&
                  !pathname?.startsWith('/san-pham') &&
                  !pathname?.startsWith('/gio-hang') &&
                  !pathname?.startsWith('/dat-hang') &&
                  !pathname?.startsWith('/don-hang') &&
                  pathname !== '/'

  return (
    <QueryClientProvider client={queryClient}>
      {showBar && <AnnouncementBar />}
      {children}
    </QueryClientProvider>
  )
}
