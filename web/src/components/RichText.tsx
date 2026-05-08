'use client'

import { useEffect, useRef } from 'react'
import { sanitizeRich } from '@/lib/richHtml'

interface Props {
  html: string | null | undefined
  className?: string
}

// Renders admin-authored rich HTML. Sanitization happens here so callers
// don't have to remember to do it. Spoiler tags toggle on click — Telegram
// does the same UX, and we want parity for users who saw the same product
// in the bot before opening the webapp.
export function RichText({ html, className = '' }: Props) {
  const safe = sanitizeRich(html)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t && t.tagName.toLowerCase() === 'tg-spoiler') t.classList.toggle('revealed')
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [safe])

  if (!safe) return null
  return (
    <div
      ref={ref}
      className={`rich-text ${className}`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}
