'use client'

import { useSearchParams } from 'next/navigation'

/**
 * Reads ?highlight=<id> from the URL and returns it as a string.
 * Callers compare against their row id (also stringified).
 */
export function useHighlightId(): string | null {
  const params = useSearchParams()
  return params.get('highlight')
}

/**
 * Binds to a row element when ?highlight matches; scrolls it into view
 * smoothly and toggles the .highlight-pulse class for ~2.5s.
 *
 * Usage:
 *   const refFor = useHighlightedRowRef(highlightId)
 *   rows.map(r => <tr ref={refFor(r.id)} ...>...</tr>)
 */
export function useHighlightedRowRef(highlightId: string | null) {
  return (id: number | string) => (el: HTMLElement | null) => {
    if (!el || highlightId == null) return
    if (String(highlightId) !== String(id)) return
    // Defer to next tick so the row's final position is settled.
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('highlight-pulse')
      setTimeout(() => el.classList.remove('highlight-pulse'), 2500)
    })
  }
}
