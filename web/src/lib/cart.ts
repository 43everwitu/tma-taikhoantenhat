'use client'

import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'taikhoantenhat:cart:v1'
const EMPTY_ITEMS: CartItem[] = []
let cachedRaw: string | null | undefined
let cachedItems: CartItem[] = EMPTY_ITEMS

export interface CartItem {
  id: string;
  lineKey: string;
  productId: string;
  variantId?: string | null;
  variantName?: string | null;
  inputValue?: string | null;
  isBackorder?: boolean;
  slug: string;
  name: string;
  emoji: string;
  imageUrl?: string;
  price: number;
  quantity: number;
}

interface Stored { items: CartItem[] }

function lineKeyOf(productId: string, variantId?: string | null): string {
  return `${productId}:${variantId ?? ''}`
}

function migrateLine(it: Partial<CartItem>): CartItem {
  const productId = it.productId ?? it.id ?? ''
  return {
    id: productId,
    productId,
    lineKey: it.lineKey ?? lineKeyOf(productId, it.variantId ?? null),
    variantId: it.variantId ?? null,
    variantName: it.variantName ?? null,
    inputValue: it.inputValue ?? null,
    isBackorder: !!it.isBackorder,
    slug: it.slug ?? '',
    name: it.name ?? '',
    emoji: it.emoji ?? '',
    imageUrl: it.imageUrl,
    price: it.price ?? 0,
    quantity: it.quantity ?? 1,
  }
}

function read(): CartItem[] {
  if (typeof window === 'undefined') return EMPTY_ITEMS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === cachedRaw) return cachedItems
    cachedRaw = raw
    if (!raw) {
      cachedItems = EMPTY_ITEMS
      return cachedItems
    }
    const parsed = JSON.parse(raw) as Stored
    cachedItems = (parsed.items as Partial<CartItem>[]).map(migrateLine).filter((it) => it.quantity > 0)
    return cachedItems
  } catch {
    cachedItems = EMPTY_ITEMS
    return cachedItems
  }
}

function write(items: CartItem[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ items }))
  window.dispatchEvent(new CustomEvent('cart:updated'))
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) onStoreChange()
  }
  window.addEventListener('cart:updated', onStoreChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener('cart:updated', onStoreChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function useCart() {
  const items = useSyncExternalStore(subscribe, read, () => EMPTY_ITEMS)

  type AddArg = Omit<CartItem, 'quantity' | 'lineKey' | 'id'> & { quantity?: number }

  const add = useCallback((p: AddArg) => {
    const cur = read()
    const key = lineKeyOf(p.productId, p.variantId ?? null)
    const existing = cur.find((it) => it.lineKey === key)
    if (existing) {
      existing.quantity += p.quantity ?? 1
      existing.inputValue = p.inputValue ?? existing.inputValue
    } else {
      cur.push(migrateLine({ ...p, lineKey: key, quantity: p.quantity ?? 1 }))
    }
    write(cur)
  }, [])

  const setQuantity = useCallback((lineKey: string, q: number) => {
    const cur = read().map((it) => it.lineKey === lineKey ? { ...it, quantity: Math.max(0, q) } : it).filter((it) => it.quantity > 0)
    write(cur)
  }, [])

  const remove = useCallback((lineKey: string) => {
    write(read().filter((it) => it.lineKey !== lineKey))
  }, [])

  const clear = useCallback(() => write([]), [])

  const count = items.reduce((s, it) => s + it.quantity, 0)
  const total = items.reduce((s, it) => s + it.price * it.quantity, 0)

  return { items, add, setQuantity, remove, clear, count, total, lineKeyOf }
}

export { lineKeyOf }
