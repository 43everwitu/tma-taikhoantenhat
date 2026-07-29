'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ImageUploader } from './ImageUploader'

interface MediaItem {
  url: string
  dir: string
  name: string
  size: number
  updatedAt?: string
  mtimeMs?: number
}

type MediaSort = 'newest' | 'oldest' | 'az' | 'za' | 'size_desc' | 'size_asc'

interface Props {
  onPick: (url: string) => void
  onClose: () => void
}

export function MediaLibrary({ onPick, onClose }: Props) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<MediaSort>('newest')
  const { data, refetch } = useQuery({
    queryKey: ['admin', 'uploads', q, sort],
    queryFn: () => {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      params.set('sort', sort)
      return api.get<MediaItem[]>(`/admin/uploads?${params.toString()}`)
    },
  })
  const items = data?.data ?? []

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  function formatDate(value?: string) {
    if (!value) return ''
    return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-4xl p-5 space-y-3 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Thư viện media</h2>
          <button onClick={onClose} className="opacity-60 text-xl leading-none">×</button>
        </div>

        <ImageUploader
          multiple
          onUploaded={(url, urls = [url]) => {
            refetch()
            if (urls.length === 1) onPick(url)
          }}
        />

        <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo tên file..."
            className="clay-input text-sm w-full"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as MediaSort)}
            className="clay-input text-sm w-full"
          >
            <option value="newest">Mới nhất trước</option>
            <option value="oldest">Cũ nhất trước</option>
            <option value="az">Tên A-Z</option>
            <option value="za">Tên Z-A</option>
            <option value="size_desc">Size lớn trước</option>
            <option value="size_asc">Size nhỏ trước</option>
          </select>
        </div>

        <p className="text-xs text-clay-silver">Hiển thị {items.length} ảnh</p>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {items.map((it) => (
            <button
              key={it.url}
              type="button"
              onClick={() => onPick(it.url)}
              className="group overflow-hidden rounded-lg border border-gray-200 hover:border-yellow-400 transition-colors text-left bg-white"
              title={`${it.name} · ${formatBytes(it.size)}`}
            >
              <span className="block aspect-square overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.url} alt={it.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
              </span>
              <span className="block p-1.5 space-y-0.5">
                <span className="block text-[11px] font-medium truncate" title={it.name}>{it.name}</span>
                <span className="block text-[10px] text-clay-silver truncate">
                  {formatBytes(it.size)}{it.updatedAt ? ` · ${formatDate(it.updatedAt)}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>

        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-clay-oat p-8 text-center text-sm text-clay-silver">
            Không tìm thấy media phù hợp.
          </div>
        )}
      </div>
    </div>
  )
}
