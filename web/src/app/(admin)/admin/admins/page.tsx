'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Admin {
  id: number
  username: string
  displayName: string
  role: string
  isActive: boolean
  lastLoginAt: string | null
  permissions: string[]
}

export default function AdminsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'admins'],
    queryFn: () => api.get<Admin[]>('/admin/admins'),
  })
  const admins = data?.data ?? []
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="clay-display text-3xl">Quản trị viên</h1>
        <button onClick={() => setCreateOpen(true)} className="clay-btn clay-btn--lemon text-sm">+ Tạo mới</button>
      </div>

      <div className="space-y-2">
        {isLoading && <p className="text-sm opacity-60">Đang tải…</p>}
        {admins.map((a) => (
          <div key={a.id} className="rounded-xl bg-white border border-clay-oat p-3 flex items-center gap-3">
            <div className="flex-1">
              <p className="font-medium text-sm">{a.displayName} <span className="opacity-60 font-normal">@{a.username}</span></p>
              <p className="text-xs opacity-60">{a.role} · {a.isActive ? 'Hoạt động' : 'Đã khoá'} · {a.permissions.length} quyền</p>
            </div>
            <button
              onClick={() => {
                if (!confirm(`${a.isActive ? 'Khoá' : 'Mở khoá'} ${a.username}?`)) return
                api.patch(`/admin/admins/${a.id}`, { isActive: !a.isActive }).then(() => qc.invalidateQueries({ queryKey: ['admin', 'admins'] }))
              }}
              className="clay-btn text-xs"
            >
              {a.isActive ? 'Khoá' : 'Mở'}
            </button>
          </div>
        ))}
      </div>

      {createOpen && <CreateModal onClose={() => setCreateOpen(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ['admin', 'admins'] }); setCreateOpen(false) }} />}
    </div>
  )
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ username: '', password: '', displayName: '', role: 'manager' as 'manager' | 'admin' | 'super_admin' })
  const [err, setErr] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => api.post('/admin/admins', form),
    onSuccess: onCreated,
    onError: (e) => setErr(e instanceof Error ? e.message : 'Lỗi'),
  })
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
        <h2 className="text-lg font-semibold">Tạo quản trị mới</h2>
        <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Tên đăng nhập" className="clay-input w-full text-sm" />
        <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mật khẩu" className="clay-input w-full text-sm" />
        <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Tên hiển thị" className="clay-input w-full text-sm" />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })} className="clay-input w-full text-sm">
          <option value="manager">manager (không có quyền xem doanh thu / settings)</option>
          <option value="admin">admin</option>
          <option value="super_admin">super_admin (toàn quyền)</option>
        </select>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="clay-btn text-sm">Huỷ</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.username || !form.password} className="clay-btn clay-btn--lemon text-sm">
            {mutation.isPending ? 'Đang tạo…' : 'Tạo'}
          </button>
        </div>
      </div>
    </div>
  )
}
