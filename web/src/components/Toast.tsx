'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Tone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  tone: Tone
}

interface ToastApi {
  toast: (message: string, tone?: Tone) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastCtx = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast() outside ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const idRef = useRef(0)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const remove = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id))
  }, [])

  const push = useCallback((message: string, tone: Tone = 'info') => {
    const id = ++idRef.current
    setItems((xs) => [...xs, { id, message, tone }])
    setTimeout(() => remove(id), 3500)
  }, [remove])

  const api: ToastApi = {
    toast: push,
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
    info: (m) => push(m, 'info'),
  }

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {mounted && createPortal(
        <div
          aria-live="polite"
          className="fixed top-4 right-4 z-[1000] flex flex-col gap-2 pointer-events-none"
        >
          {items.map((it) => (
            <div
              key={it.id}
              role="status"
              className={`pointer-events-auto rounded-lg shadow-lg px-4 py-2.5 text-sm min-w-[200px] max-w-[360px] backdrop-blur-sm border ${toneClass(it.tone)}`}
            >
              {it.message}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

function toneClass(tone: Tone) {
  switch (tone) {
    case 'success': return 'bg-green-50 border-green-200 text-green-900'
    case 'error': return 'bg-red-50 border-red-200 text-red-900'
    default: return 'bg-white border-gray-200 text-gray-900'
  }
}
