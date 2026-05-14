'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { SearchBox } from './SearchBox'
import { Icon } from './Icon'

export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const pathname = usePathname()

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  useEffect(() => { if (!open) setQ('') }, [open])
  useEffect(() => { if (open) onClose() }, [pathname])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-auto mt-16 max-w-xl px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-2xl shadow-xl p-3" style={{ background: 'var(--tg-bg, #fff)' }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold flex-1">Tìm kiếm</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              className="w-8 h-8 grid place-items-center rounded-full hover:bg-black/5"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <SearchBox value={q} onChange={setQ} autoFocus placeholder="Tìm sản phẩm…" />
        </div>
      </div>
    </div>
  )
}
