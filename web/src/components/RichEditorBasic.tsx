'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import LinkExt from '@tiptap/extension-link'
import UnderlineExt from '@tiptap/extension-underline'
import { Bold, Italic, Underline as UnderlineIcon, Link as LinkIcon, List, ListOrdered, RemoveFormatting } from '@/lib/icons'
import { LinkPopover, ToolbarMouseButton, normalizeLinkUrl } from './editor/linkTools'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null

  function promptLink() {
    const ed = editor
    if (!ed) return
    const previous = ed.getAttributes('link').href as string | undefined
    const url = window.prompt('URL', previous || 'https://')
    if (url === null) return
    const href = normalizeLinkUrl(url)
    if (!href) {
      ed.chain().focus().unsetLink().run()
      return
    }
    ed.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 py-1 bg-gray-50 rounded-t-lg">
        <ToolbarMouseButton onRun={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="In đậm"><Bold size={14} /></ToolbarMouseButton>
        <ToolbarMouseButton onRun={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="In nghiêng"><Italic size={14} /></ToolbarMouseButton>
        <ToolbarMouseButton onRun={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Gạch chân"><UnderlineIcon size={14} /></ToolbarMouseButton>
        <span className="w-px h-4 bg-gray-300 mx-1" />
        <ToolbarMouseButton onRun={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Danh sách"><List size={14} /></ToolbarMouseButton>
        <ToolbarMouseButton onRun={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Danh sách số"><ListOrdered size={14} /></ToolbarMouseButton>
        <span className="w-px h-4 bg-gray-300 mx-1" />
        <ToolbarMouseButton onRun={promptLink} active={editor.isActive('link')} title="Chèn link"><LinkIcon size={14} /></ToolbarMouseButton>
        <ToolbarMouseButton onRun={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="Xoá định dạng"><RemoveFormatting size={14} /></ToolbarMouseButton>
      </div>
      <LinkPopover editor={editor} onEdit={promptLink} />
    </>
  )
}

export function RichEditorBasic({ value, onChange, placeholder, minHeight = 120 }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        horizontalRule: false,
        codeBlock: false,
        link: false,
        underline: false,
      }),
      UnderlineExt,
      LinkExt.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none px-3 py-2',
        style: `min-height: ${minHeight}px`,
        'data-placeholder': placeholder || '',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.isEmpty ? '' : editor.getHTML())
    },
  })

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-yellow-400">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}
