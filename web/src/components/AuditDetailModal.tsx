'use client'

import { useEffect } from 'react'
import { X } from '@/lib/icons'
import type { AuditRow } from '@/lib/api'

interface Props {
  row: AuditRow | null
  onClose: () => void
}

function parseObject(details: string | null): Record<string, unknown> | null {
  if (!details) return null
  try {
    const v = JSON.parse(details)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function rawPretty(details: string | null): string {
  if (!details) return '—'
  try {
    return JSON.stringify(JSON.parse(details), null, 2)
  } catch {
    return details
  }
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function parseDbDate(s: string): Date {
  return new Date(s.replace(' ', 'T') + 'Z')
}

export function AuditDetailModal({ row, onClose }: Props) {
  useEffect(() => {
    if (!row) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row, onClose])

  if (!row) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Chi tiết audit log"
    >
      <div
        className="clay-card max-w-2xl w-full max-h-[80vh] overflow-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">
            {row.action}
            {row.entity_type ? ` · ${row.entity_type}${row.entity_id ? ` #${row.entity_id}` : ''}` : ''}
          </h2>
          <button onClick={onClose} className="clay-btn p-2" aria-label="Đóng">
            <X size={16} />
          </button>
        </div>

        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm mb-4">
          <dt className="opacity-60">Thời gian</dt>
          <dd>{parseDbDate(row.created_at).toLocaleString('vi-VN')}</dd>
          <dt className="opacity-60">Admin</dt>
          <dd>{row.admin_name ?? '(system)'}</dd>
          <dt className="opacity-60">IP</dt>
          <dd>{row.ip_address ?? '—'}</dd>
        </dl>

        <h3 className="text-sm font-semibold mb-1">Details</h3>
        {(() => {
          const obj = parseObject(row.details)
          if (obj) {
            const entries = Object.entries(obj)
            if (entries.length === 0) {
              return <p className="text-sm opacity-60">—</p>
            }
            return (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                {entries.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="opacity-60 font-mono">{k}</dt>
                    <dd className="break-words">{renderValue(v)}</dd>
                  </div>
                ))}
              </dl>
            )
          }
          return (
            <pre className="text-xs bg-black/5 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words">
              {rawPretty(row.details)}
            </pre>
          )
        })()}
      </div>
    </div>
  )
}
