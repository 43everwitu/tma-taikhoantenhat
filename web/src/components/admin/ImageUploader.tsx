'use client'

import { useState } from 'react'
import { getAdminToken } from '@/lib/api'

interface Props {
  onUploaded: (url: string) => void
  multiple?: boolean
}

export function ImageUploader({ onUploaded, multiple = false }: Props) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  async function uploadFile(file: File) {
    setBusy(true); setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/v1/admin/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        body: fd,
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error?.message || 'Upload failed')
      onUploaded(j.data.url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lỗi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label
        className={`block border-2 border-dashed rounded-xl p-4 text-center text-sm cursor-pointer transition-colors ${dragging ? 'bg-yellow-50 border-yellow-400' : 'border-gray-300 hover:border-gray-400'}`}
        onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault(); setDragging(false)
          const files = Array.from(e.dataTransfer.files)
          for (const f of files) uploadFile(f)
        }}
      >
        <input
          type="file"
          accept="image/*"
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            for (const f of files) uploadFile(f)
          }}
        />
        {busy ? 'Đang tải lên…' : 'Kéo thả hoặc click để tải ảnh lên'}
      </label>
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  )
}
