'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { templates, type MessageTemplate } from '@/lib/api'
import { Save, RotateCcw, Eye } from '@/lib/icons'

export default function AdminMessagesPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'messages'],
    queryFn: () => templates.list(),
  })

  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [varValues, setVarValues] = useState<Record<string, string>>({})
  const [showSaved, setShowSaved] = useState(false)

  const list = useMemo(() => data?.data ?? [], [data])
  const active = useMemo(() => list.find((t) => t.key === activeKey) ?? null, [list, activeKey])

  function pick(t: MessageTemplate) {
    setActiveKey(t.key)
    setDraft(t.body)
    setPreview(null)
    setShowSaved(false)
    setVarValues(Object.fromEntries(t.variables.map((v) => [v, `<${v}>`])))
  }

  function flashSaved() {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 3000)
  }

  const updateMut = useMutation({
    mutationFn: () => templates.update(active!.key, draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'messages'] })
      flashSaved()
    },
  })
  const resetMut = useMutation({
    mutationFn: () => templates.reset(active!.key),
    onSuccess: async () => {
      const refreshed = await qc.fetchQuery({
        queryKey: ['admin', 'messages'],
        queryFn: () => templates.list(),
      })
      const fresh = refreshed.data.find((t) => t.key === active!.key)
      if (fresh) {
        setDraft(fresh.body)
        flashSaved()
      }
    },
  })

  async function runPreview() {
    if (!active) return
    const r = await templates.preview(active.key, varValues)
    setPreview(r.data.text)
  }

  if (isLoading) return <div className="p-6">Đang tải...</div>

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 p-4">
      <aside className="clay-card p-3 max-h-[80vh] overflow-y-auto">
        {(['bot', 'web'] as const).map((ch) => {
          const items = list.filter((t) => t.channel === ch)
          if (items.length === 0) return null
          return (
            <div key={ch} className="mb-4">
              <h3 className="text-xs uppercase tracking-wider text-clay-charcoal px-2 mb-2">{ch}</h3>
              <ul className="space-y-1">
                {items.map((t) => (
                  <li key={t.key}>
                    <button
                      onClick={() => pick(t)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${activeKey === t.key ? 'bg-clay-ink text-white' : 'hover:bg-clay-cream'}`}
                    >
                      <div className="font-medium">{t.label}</div>
                      <div className="text-xs opacity-70">{t.key}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </aside>

      <main className="clay-card p-5">
        {!active ? (
          <p className="text-clay-charcoal">Chọn một mẫu tin nhắn ở bên trái để chỉnh sửa.</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="clay-display text-xl">{active.label}</h2>
                <p className="text-xs text-clay-charcoal">key: <code>{active.key}</code> · channel: {active.channel}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => updateMut.mutate()}
                  disabled={updateMut.isPending || draft === active.body}
                  className="clay-btn clay-btn--ink flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save size={16} />Lưu
                </button>
                <button
                  onClick={() => { if (confirm('Khôi phục về nội dung mặc định? Thay đổi hiện tại sẽ mất.')) resetMut.mutate() }}
                  className="clay-btn flex items-center gap-1.5"
                  disabled={resetMut.isPending}
                >
                  <RotateCcw size={16} />Mặc định
                </button>
              </div>
            </div>

            {showSaved && (
              <p className="text-xs text-emerald-600 mb-2">✓ Đã lưu</p>
            )}
            {updateMut.isError && (
              <p className="text-xs text-red-600 mb-2">Lưu thất bại: {(updateMut.error as Error).message}</p>
            )}

            <p className="text-sm mb-2">
              Biến có sẵn:{' '}
              {active.variables.length === 0
                ? <span className="text-clay-charcoal text-xs">(không có)</span>
                : active.variables.map((v) => <code key={v} className="clay-pill mr-1 text-xs">{`{{${v}}}`}</code>)}
            </p>

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
              className="clay-input w-full font-mono text-sm"
              spellCheck={false}
            />

            <div className="mt-4 clay-card-dashed p-4">
              <h3 className="font-semibold mb-2 flex items-center gap-1.5"><Eye size={16} />Xem thử</h3>
              {active.variables.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                  {active.variables.map((v) => (
                    <label key={v} className="text-sm">
                      <span className="block text-xs text-clay-charcoal mb-1">{v}</span>
                      <input
                        value={varValues[v] ?? ''}
                        onChange={(e) => setVarValues({ ...varValues, [v]: e.target.value })}
                        className="clay-input w-full"
                      />
                    </label>
                  ))}
                </div>
              )}
              <button onClick={runPreview} className="clay-btn">Render preview</button>
              {preview !== null && (
                <pre className="mt-3 p-3 bg-clay-cream rounded-lg whitespace-pre-wrap text-sm overflow-x-auto">{preview}</pre>
              )}
            </div>

            <p className="text-xs text-clay-charcoal mt-3">Cập nhật lần cuối: {new Date(active.updated_at).toLocaleString('vi-VN')}</p>
          </>
        )}
      </main>
    </div>
  )
}
