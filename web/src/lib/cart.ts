'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'taikhoantenhat:cart:v1'

export interface CartItem {
  id: string; slug: string; name: string; emoji: string;
  imageUrl?: string; price: number; quantity: number;
}

interface Stored { items: Omit<CartItem, 'quantity'>[] | CartItem[] }

function read(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Stored
    return (parsed.items as CartItem[]).map((it) => ({ ...it, quantity: it.quantity || 1 }))
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

  const add = useCallback((p: Omit<CartItem, 'quantity'>) => {
    const cur = read()
    const existing = cur.find((it) => it.id === p.id)
    if (existing) existing.quantity += 1
    else cur.push({ ...p, quantity: 1 })
    write(cur)
  }, [])
  const setQuantity = useCallback((id: string, q: number) => {
    const cur = read().map((it) => it.id === id ? { ...it, quantity: Math.max(0, q) } : it).filter((it) => it.quantity > 0)
    write(cur)
  }, [])
  const remove = useCallback((id: string) => {
    write(read().filter((it) => it.id !== id))
  }, [])
  const clear = useCallback(() => write([]), [])

  const total = items.reduce((s, it) => s + it.price * it.quantity, 0)

  return { items, add, setQuantity, remove, clear, total }
}
