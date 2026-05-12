const KEY = 'miniapp:recently-viewed'
const MAX = 12

function safeParse(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function getRecentlyViewedIds(): string[] {
  return safeParse()
}

export function pushRecentlyViewed(id: string): void {
  if (typeof window === 'undefined' || !id) return
  try {
    const existing = safeParse().filter((x) => x !== id)
    existing.unshift(id)
    const trimmed = existing.slice(0, MAX)
    window.localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    // localStorage quota / disabled — silent
  }
}

export function clearRecentlyViewed(): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(KEY) } catch {}
}
