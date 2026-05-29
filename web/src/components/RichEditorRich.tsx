'use client'

import { useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import LinkExt from '@tiptap/extension-link'
import UnderlineExt from '@tiptap/extension-underline'
import ImageExt from '@tiptap/extension-image'
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Link as LinkIcon, Code, Heading2, Heading3, List, ListOrdered, ImageIcon, RemoveFormatting } from '@/lib/icons'
import { MediaLibrary } from './admin/MediaLibrary'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

function Tb({ onClick, active, title, children }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded hover:bg-gray-100 ${active ? 'bg-gray-200' : ''}`}
    >{children}</button>
  )
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
    if (url === '') editor.chain().focus().unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  function insertImage(url: string) {
    if (!editor) return
    editor.chain().focus().setImage({ src: url }).run()
    setLibOpen(false)
  }

  if (!editor) return null

  return (
    <>
      <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-yellow-400">
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 py-1 bg-gray-50 sticky top-0 z-10">
          <Tb onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="In đậm"><Bold size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="In nghiêng"><Italic size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Gạch chân"><UnderlineIcon size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Gạch ngang"><Strikethrough size={14} /></Tb>
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <Tb onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2"><Heading2 size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3"><Heading3 size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list"><List size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Ordered list"><ListOrdered size={14} /></Tb>
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <Tb onClick={promptLink} active={editor.isActive('link')} title="Link"><LinkIcon size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Code"><Code size={14} /></Tb>
          <Tb onClick={() => setLibOpen(true)} title="Chèn ảnh"><ImageIcon size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="Xoá định dạng"><RemoveFormatting size={14} /></Tb>
        </div>
        <EditorContent editor={editor} />
      </div>
      {libOpen && <MediaLibrary onPick={insertImage} onClose={() => setLibOpen(false)} />}
    </>
  )
}
