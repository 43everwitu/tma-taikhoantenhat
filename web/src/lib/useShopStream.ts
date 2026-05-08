'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1'

interface ShopEvent {
  type: string
  productId?: number
  slug?: string
  action?: string
  active?: boolean
  totalAvailable?: number
}

/**
 * Subscribes to the backend SSE stream and invalidates relevant
 * react-query caches when product/stock/category events arrive.
 *
 * Auto-reconnects (EventSource handles that natively). Cleans up on
 * unmount. Safe to mount on multiple pages — each call opens its own
 * connection (cheap; backend allows many concurrent streams).
 */
export function useShopStream() {
  const qc = useQueryClient()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (typeof EventSource === 'undefined') return

    const es = new EventSource(`${API_BASE}/events`)

    es.onmessage = (e) => {
      let event: ShopEvent | null = null
      try { event = JSON.parse(e.data) } catch { return }
      if (!event?.type) return

      if (event.type.startsWith('product')) {
        qc.invalidateQueries({ queryKey: ['products'] })
        // Invalidate the slug-keyed product detail too. We can be precise
        // when slug is in the event, otherwise just invalidate all.
        if (event.slug) {
          qc.invalidateQueries({ queryKey: ['product', event.slug] })
        } else {
          qc.invalidateQueries({ queryKey: ['product'] })
        }
        qc.invalidateQueries({ queryKey: ['categories'] })
      } else if (event.type === 'stock.change') {
        qc.invalidateQueries({ queryKey: ['products'] })
        qc.invalidateQueries({ queryKey: ['product'] })
      }
    }

    // Browser auto-reconnects on error after a backoff. Only log once.
    let warned = false
    es.onerror = () => {
      if (!warned) {
        console.warn('Shop event stream disconnected — auto-reconnecting…')
        warned = true
      }
    }

    return () => es.close()
  }, [qc])
}
