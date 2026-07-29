'use client'

import { useState } from 'react'
import { getAdminToken, handleAdminUnauthorized } from '@/lib/api'

interface Props {
  onUploaded: (url: string, urls?: string[]) => void
  multiple?: boolean
}

export function ImageUploader({ onUploaded, multiple = false }: Props) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  async function uploadFiles(inputFiles: File[]) {
    const files = multiple ? inputFiles : inputFiles.slice(0, 1)
    if (files.length === 0) return
    setBusy(true); setErr(null)
    try {
      const fd = new FormData()
      if (files.length === 1) {
        fd.append('file', files[0])
      } else {
        for (const file of files) fd.append('files', file)
      }
      const res = await fetch('/api/v1/admin/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAdminToken()}` },
        body: fd,
      })
      const j = await res.json()
      if (res.status === 401) {
        handleAdminUnauthorized()
      }
      if (!j.success) throw new Error(j.error?.message || 'Upload failed')
      const urls = Array.isArray(j.data.items)
        ? j.data.items.map((item: { url: string }) => item.url)
        : [j.data.url]
      onUploaded(j.data.url, urls)
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
          uploadFiles(files)
        }}
      >
        <input
          type="file"
          accept="image/*"
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            uploadFiles(files)
            e.currentTarget.value = ''
          }}
        />
        {busy ? 'Đang tải lên…' : `Kéo thả hoặc click để tải ${multiple ? 'nhiều ảnh' : 'ảnh'} lên`}
      </label>
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  )
}
