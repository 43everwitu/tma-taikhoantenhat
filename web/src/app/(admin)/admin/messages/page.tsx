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
  const toggleMut = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => templates.toggle(key, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'messages'] }),
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

  const CHANNEL_META: Record<MessageTemplate['channel'], { label: string; tone: string }> = {
    bot: { label: 'Bot — gửi tới khách', tone: 'bg-sky-100 text-sky-800 border-sky-200' },
    admin: { label: 'Admin — gửi tới quản trị', tone: 'bg-amber-100 text-amber-800 border-amber-200' },
    group: { label: 'Group — kênh đơn hàng', tone: 'bg-violet-100 text-violet-800 border-violet-200' },
    web: { label: 'Web — thông báo website', tone: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  }

  function renderRow(t: MessageTemplate) {
    return (
      <li key={t.key} className="flex items-stretch gap-2">
        <button
          onClick={() => pick(t)}
          className={`flex-1 min-w-0 text-left px-3 py-2 rounded-lg text-sm transition ${activeKey === t.key ? 'bg-clay-ink text-white' : 'hover:bg-clay-cream'}`}
        >
          <div className="font-medium truncate">{t.label}</div>
          <div className="text-[11px] opacity-60 font-mono truncate">{t.key}</div>
        </button>
        <div className="w-14 shrink-0 flex items-center justify-end">
          {t.core ? (
            <span
              title="Template bắt buộc — không thể tắt"
              className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-1 rounded bg-amber-200 text-amber-900 leading-none whitespace-nowrap"
            >
              Khoá
            </span>
          ) : (
            <button
              type="button"
              aria-label={t.enabled ? 'Tắt' : 'Bật'}
              title={t.enabled ? 'Đang bật — bấm để tắt' : 'Đang tắt — bấm để bật'}
              onClick={(e) => { e.stopPropagation(); toggleMut.mutate({ key: t.key, enabled: !t.enabled }) }}
              disabled={toggleMut.isPending}
              className={`w-full h-7 rounded-md text-[11px] font-bold transition ${t.enabled ? 'bg-emerald-500 text-white' : 'bg-zinc-300 text-zinc-700'} disabled:opacity-60`}
            >
              {t.enabled ? 'ON' : 'OFF'}
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 p-4">
      <aside className="clay-card p-0 max-h-[85vh] overflow-y-auto">
        {(['bot', 'admin', 'group', 'web'] as const).map((ch) => {
          const items = list.filter((t) => t.channel === ch)
          if (items.length === 0) return null
          const core = items.filter((t) => t.core)
          const optional = items.filter((t) => !t.core)
          const meta = CHANNEL_META[ch]
          return (
            <section key={ch} className="border-b border-clay-cream last:border-b-0">
              <header
                className={`sticky top-0 z-10 px-3 py-2 text-xs font-semibold flex items-center justify-between border-b backdrop-blur ${meta.tone}`}
              >
                <span className="uppercase tracking-wider">{meta.label}</span>
                <span className="text-[10px] font-normal opacity-70">{items.length}</span>
              </header>
              <div className="p-2 space-y-3">
                {core.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider px-2 py-1 text-clay-charcoal/70">Bắt buộc · {core.length}</p>
                    <ul className="space-y-1">{core.map(renderRow)}</ul>
                  </div>
                )}
                {optional.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider px-2 py-1 text-clay-charcoal/70">Tuỳ chọn · {optional.length}</p>
                    <ul className="space-y-1">{optional.map(renderRow)}</ul>
                  </div>
                )}
              </div>
            </section>
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
