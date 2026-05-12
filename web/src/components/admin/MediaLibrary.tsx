'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ImageUploader } from './ImageUploader'

interface MediaItem { url: string; dir: string; name: string; size: number }

interface Props {
  onPick: (url: string) => void
  onClose: () => void
}

export function MediaLibrary({ onPick, onClose }: Props) {
  const { data, refetch } = useQuery({
    queryKey: ['admin', 'uploads'],
    queryFn: () => api.get<MediaItem[]>('/admin/uploads'),
  })
  const items = data?.data ?? []

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-3xl p-5 space-y-3 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Thư viện media</h2>
          <button onClick={onClose} className="opacity-60 text-xl leading-none">×</button>
        </div>

        <ImageUploader onUploaded={(url) => { refetch(); onPick(url) }} />

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {items.map((it) => (
            <button
              key={it.url}
              type="button"
              onClick={() => onPick(it.url)}
              className="aspect-square overflow-hidden rounded-lg border border-gray-200 hover:border-yellow-400 transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url} alt={it.name} className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
