'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'taikhoantenhat:cart:v1'

export interface CartItem {
  id: string;
  lineKey: string;
  productId: string;
  variantId?: string | null;
  variantName?: string | null;
  inputValue?: string | null;
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
    slug: it.slug ?? '',
    name: it.name ?? '',
    emoji: it.emoji ?? '',
    imageUrl: it.imageUrl,
    price: it.price ?? 0,
    quantity: it.quantity ?? 1,
  }
}

function read(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Stored
    return (parsed.items as Partial<CartItem>[]).map(migrateLine).filter((it) => it.quantity > 0)
  } catch { return [] }
}

function write(items: CartItem[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ items }))
  window.dispatchEvent(new CustomEvent('cart:updated'))
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([])
  useEffect(() => {
    setItems(read())
    const onUpdate = () => setItems(read())
    window.addEventListener('cart:updated', onUpdate)
    return () => window.removeEventListener('cart:updated', onUpdate)
  }, [])

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

  const total = items.reduce((s, it) => s + it.price * it.quantity, 0)

  return { items, add, setQuantity, remove, clear, total, lineKeyOf }
}

export { lineKeyOf }
