'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Admin {
  id: number
  username: string
  displayName: string
  role: string
}

export function EditAdminModal({
  admin,
  isSuper,
  onClose,
  onSaved,
}: {
  admin: Admin
  isSuper: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [displayName, setDisplayName] = useState(admin.displayName)
  const [role, setRole] = useState(admin.role)
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {}
      if (displayName !== admin.displayName) body.displayName = displayName
      if (isSuper && role !== admin.role) body.role = role
      if (password.length >= 6) body.password = password
      if (Object.keys(body).length === 0) return { data: { changes: 0 } as unknown }
      return api.patch(`/admin/admins/${admin.id}`, body)
    },
    onSuccess: onSaved,
    onError: (e) => setErr(e instanceof Error ? e.message : 'Lỗi'),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
        <h2 className="text-lg font-semibold">Sửa @{admin.username}</h2>
        <label className="block text-xs font-medium opacity-70">Tên hiển thị</label>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="clay-input w-full text-sm" />
        {isSuper && (
          <>
            <label className="block text-xs font-medium opacity-70">Vai trò</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="clay-input w-full text-sm">
              <option value="manager">manager</option>
              <option value="admin">admin</option>
              <option value="super_admin">super_admin</option>
            </select>
          </>
        )}
        <label className="block text-xs font-medium opacity-70">Mật khẩu mới (để trống = giữ nguyên)</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="≥ 6 ký tự" className="clay-input w-full text-sm" />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="clay-btn text-sm">Huỷ</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="clay-btn clay-btn--lemon text-sm"
          >
            {mutation.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}
