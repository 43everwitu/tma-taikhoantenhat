'use client'

import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { Mark, mergeAttributes } from '@tiptap/core'
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Link as LinkIcon, EyeOff, Code, RemoveFormatting } from '@/lib/icons'

// Custom <tg-spoiler> mark — Telegram's native spoiler syntax. Tiptap has
// no built-in spoiler, so we declare a one-line Mark that round-trips the tag.
const Spoiler = Mark.create({
  name: 'spoiler',
  parseHTML() { return [{ tag: 'tg-spoiler' }] },
  renderHTML({ HTMLAttributes }) { return ['tg-spoiler', mergeAttributes(HTMLAttributes), 0] },
})

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  rows?: number
}

function ToolbarButton({ onClick, active, disabled, title, children }: {
  onClick: () => void; active?: boolean; disabled?: boolean; title: string; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 ${active ? 'bg-gray-200' : ''}`}
    >{children}</button>
  )
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null
  const promptLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('URL', prev || 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 py-1 bg-gray-50 rounded-t-lg">
      <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="In đậm"><Bold size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="In nghiêng"><Italic size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Gạch chân"><UnderlineIcon size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Gạch ngang"><Strikethrough size={14} /></ToolbarButton>
      <ToolbarButton onClick={promptLink} active={editor.isActive('link')} title="Chèn link"><LinkIcon size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleMark('spoiler').run()} active={editor.isActive('spoiler')} title="Ẩn nội dung (spoiler)"><EyeOff size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Code inline"><Code size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().unsetAllMarks().run()} title="Xoá định dạng"><RemoveFormatting size={14} /></ToolbarButton>
    </div>
  )
}

export function RichEditor({ value, onChange, placeholder, rows = 4 }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        horizontalRule: false,
        codeBlock: false,
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Spoiler,
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose-editor focus:outline-none px-3 py-2',
        style: `min-height: ${rows * 1.5}rem`,
        'data-placeholder': placeholder || '',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      // Tiptap emits <p> wrappers for paragraphs; the storage format is
      // line-break-only, so collapse <p>...</p> → ...<br>.
      const flat = html
        .replace(/<p[^>]*><\/p>/g, '<br>')
        .replace(/<p[^>]*>/g, '')
        .replace(/<\/p>/g, '<br>')
        .replace(/(<br>)+$/, '')
      onChange(flat)
    },
  })

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}
