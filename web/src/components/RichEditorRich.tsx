'use client'

import { useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import LinkExt from '@tiptap/extension-link'
import UnderlineExt from '@tiptap/extension-underline'
import ImageExt from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Link as LinkIcon, Code, Heading2, Heading3, List, ListOrdered, ImageIcon, RemoveFormatting } from '@/lib/icons'
import { MediaLibrary } from './admin/MediaLibrary'
import { LinkPopover, ToolbarMouseButton, normalizeLinkUrl } from './editor/linkTools'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

export function RichEditorRich({ value, onChange, placeholder }: Props) {
  const [libOpen, setLibOpen] = useState(false)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: false,
        underline: false,
      }),
      UnderlineExt,
      LinkExt.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      ImageExt.configure({ HTMLAttributes: { loading: 'lazy' } }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none px-3 py-2 min-h-[200px]',
        'data-placeholder': placeholder || '',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  function promptLink() {
    if (!editor) return
    const url = window.prompt('URL', editor.getAttributes('link').href || 'https://')
    if (url === null) return
    const href = normalizeLinkUrl(url)
    if (!href) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  function insertImage(url: string) {
    if (!editor) return
    editor.chain().focus().setImage({ src: url }).run()
    setLibOpen(false)
  }

  if (!editor) return null
  const isInTable = editor.isActive('table')

  return (
    <>
      <div className="border border-gray-300 rounded-lg overflow-visible focus-within:ring-2 focus-within:ring-yellow-400">
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 py-1 bg-gray-50 sticky top-0 z-20">
          <ToolbarMouseButton onRun={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="In đậm"><Bold size={14} /></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="In nghiêng"><Italic size={14} /></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Gạch chân"><UnderlineIcon size={14} /></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Gạch ngang"><Strikethrough size={14} /></ToolbarMouseButton>
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <ToolbarMouseButton onRun={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2"><Heading2 size={14} /></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3"><Heading3 size={14} /></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list"><List size={14} /></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Ordered list"><ListOrdered size={14} /></ToolbarMouseButton>
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <ToolbarMouseButton onRun={promptLink} active={editor.isActive('link')} title="Link"><LinkIcon size={14} /></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Code"><Code size={14} /></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => setLibOpen(true)} title="Chèn ảnh"><ImageIcon size={14} /></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="Xoá định dạng"><RemoveFormatting size={14} /></ToolbarMouseButton>
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <ToolbarMouseButton onRun={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Chèn bảng"><span className="text-xs font-medium">Bảng</span></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().addColumnBefore().run()} disabled={!isInTable} title="Thêm cột trước"><span className="text-xs font-medium">Cột trước</span></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().addColumnAfter().run()} disabled={!isInTable} title="Thêm cột sau"><span className="text-xs font-medium">Cột sau</span></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().deleteColumn().run()} disabled={!isInTable} title="Xoá cột"><span className="text-xs font-medium">Xoá cột</span></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().addRowBefore().run()} disabled={!isInTable} title="Thêm dòng trước"><span className="text-xs font-medium">Dòng trước</span></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().addRowAfter().run()} disabled={!isInTable} title="Thêm dòng sau"><span className="text-xs font-medium">Dòng sau</span></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().deleteRow().run()} disabled={!isInTable} title="Xoá dòng"><span className="text-xs font-medium">Xoá dòng</span></ToolbarMouseButton>
          <ToolbarMouseButton onRun={() => editor.chain().focus().deleteTable().run()} disabled={!isInTable} title="Xoá bảng"><span className="text-xs font-medium">Xoá bảng</span></ToolbarMouseButton>
        </div>
        <LinkPopover editor={editor} onEdit={promptLink} />
        <EditorContent editor={editor} />
      </div>
      {libOpen && <MediaLibrary onPick={insertImage} onClose={() => setLibOpen(false)} />}
    </>
  )
}
