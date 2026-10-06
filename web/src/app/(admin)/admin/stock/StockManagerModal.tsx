'use client'

import { StockManager } from './StockManager'
import { X } from '@/lib/icons'

export function StockManagerModal({ productId, onClose }: { productId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-6xl p-5 my-6"
      >
        <button
          onClick={onClose}
          className="clay-btn p-2 fixed top-4 right-4 z-50"
          aria-label="Đóng"
        >
          <X size={16} />
        </button>
        <StockManager key={productId} productId={productId} onClose={onClose} />
      </div>
    </div>
  )
}
