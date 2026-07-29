'use client'

import type { Editor } from '@tiptap/react'
import type { MouseEvent, ReactNode } from 'react'

export function normalizeLinkUrl(raw: string) {
  const url = raw.trim()
  if (!url) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url
  return `https://${url}`
}

export function runEditorCommand(event: MouseEvent<HTMLButtonElement>, command: () => void) {
  event.preventDefault()
  command()
}

export function LinkPopover({ editor, onEdit }: { editor: Editor | null; onEdit: () => void }) {
  if (!editor || !editor.isActive('link')) return null

  const href = String(editor.getAttributes('link').href || '')
  if (!href) return null

  return (
    <div className="admin-editor-link-popover">
      <span className="admin-editor-link-popover__url" title={href}>{href}</span>
      <button
        type="button"
        onMouseDown={(event) => runEditorCommand(event, () => window.open(href, '_blank', 'noopener,noreferrer'))}
      >
        Mở
      </button>
      <button type="button" onMouseDown={(event) => runEditorCommand(event, onEdit)}>
        Sửa
      </button>
      <button
        type="button"
        onMouseDown={(event) => runEditorCommand(event, () => editor.chain().focus().extendMarkRange('link').unsetLink().run())}
      >
        Gỡ
      </button>
    </div>
  )
}

export function ToolbarMouseButton({
  onRun,
  active,
  disabled,
  title,
  children,
}: {
  onRun: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => runEditorCommand(event, onRun)}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed ${active ? 'bg-gray-200' : ''}`}
    >
      {children}
    </button>
  )
}
