'use client'

import { StockManager } from './StockManager'

export function StockManagerModal({ productId, onClose }: { productId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl w-full max-w-6xl p-5 my-6"
      >
        <StockManager key={productId} productId={productId} onClose={onClose} />
      </div>
    </div>
  )
}
