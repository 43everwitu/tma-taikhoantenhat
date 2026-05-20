'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, twoFactor } from '@/lib/api'
import { useHighlightId, useHighlightedRowRef } from '@/lib/useHighlightedRow'
import { EditAdminModal } from './EditModal'

interface Admin {
  id: number
  username: string
  displayName: string
  role: string
  isActive: boolean
  lastLoginAt: string | null
  permissions: string[]
  twoFactor: { enabled: boolean; required: boolean; backupCount: number }
}

export default function AdminsPage() {
  const qc = useQueryClient()
  const highlightId = useHighlightId()
  const refFor = useHighlightedRowRef(highlightId)
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'admins'],
    queryFn: () => api.get<Admin[]>('/admin/admins'),
  })
  const admins = data?.data ?? []
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Admin | null>(null)

  // Fetch current admin role to gate 2FA force/reset buttons (super_admin only).
  const meQuery = useQuery({
    queryKey: ['admin', 'me'],
    queryFn: () => api.get<{ role: string }>('/admin/me'),
  })
  const isSuper = meQuery.data?.data.role === 'super_admin'

  const toggle2faRequired = useMutation({
    mutationFn: ({ id, required }: { id: number; required: boolean }) => twoFactor.adminSet(id, { required }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'admins'] }),
  })
  const reset2fa = useMutation({
    mutationFn: (id: number) => twoFactor.adminSet(id, { reset: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'admins'] }),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="clay-display text-3xl">Quản trị viên</h1>
        <button onClick={() => setCreateOpen(true)} className="clay-btn clay-btn--lemon text-sm">+ Tạo mới</button>
      </div>

      <div className="space-y-2">
        {isLoading && <p className="text-sm opacity-60">Đang tải…</p>}
        {admins.map((a) => {
          const tf = a.twoFactor
          const tfBadge = tf.enabled
            ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">2FA ✓</span>
            : tf.required
              ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">2FA bắt buộc — chưa bật</span>
              : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-700">2FA tắt</span>
          return (
            <div key={a.id} ref={refFor(a.id)} className="rounded-xl bg-white border border-clay-oat p-3 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm flex items-center gap-2">
                  {a.displayName} <span className="opacity-60 font-normal">@{a.username}</span>
                  {tfBadge}
                </p>
                <p className="text-xs opacity-60">
                  {a.role} · {a.isActive ? 'Hoạt động' : 'Đã khoá'} · {a.permissions.length} quyền
                  {tf.enabled && ` · ${tf.backupCount} mã dự phòng`}
                </p>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {isSuper && (
                  <>
                    <button
                      onClick={() => toggle2faRequired.mutate({ id: a.id, required: !tf.required })}
                      disabled={toggle2faRequired.isPending || a.role === 'super_admin'}
                      title={a.role === 'super_admin' ? 'super_admin luôn yêu cầu 2FA' : tf.required ? 'Bỏ yêu cầu 2FA' : 'Bắt buộc 2FA'}
                      className="clay-btn text-xs disabled:opacity-50"
                    >
                      {tf.required ? 'Bỏ bắt buộc' : 'Bắt buộc 2FA'}
                    </button>
                    {tf.enabled && (
                      <button
                        onClick={() => { if (confirm(`Reset 2FA cho ${a.username}? Họ sẽ phải cài lại khi đăng nhập.`)) reset2fa.mutate(a.id) }}
                        disabled={reset2fa.isPending}
                        className="clay-btn text-xs"
                      >
                        Reset 2FA
                      </button>
                    )}
                  </>
                )}
                <button onClick={() => setEditing(a)} className="clay-btn text-xs">Sửa</button>
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
            </div>
          )
        })}
      </div>

      {editing && (
        <EditAdminModal
          admin={editing}
          isSuper={isSuper}
          onClose={() => setEditing(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['admin', 'admins'] }); setEditing(null) }}
        />
      )}

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
