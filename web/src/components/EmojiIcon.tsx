'use client'

const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg'

function emojiToCodepoint(emoji: string): string {
  const cps: string[] = []
  for (const ch of Array.from(emoji)) {
    const cp = ch.codePointAt(0)
    if (cp == null) continue
    if (cp === 0xfe0f) continue
    cps.push(cp.toString(16))
  }
  return cps.join('-')
}

interface EmojiIconProps {
  emoji?: string | null
  size?: number
  className?: string
  fallback?: string
}

export function EmojiIcon({ emoji, size = 48, className = '', fallback = '📦' }: EmojiIconProps) {
  const ch = emoji && emoji.trim() ? emoji.trim() : fallback
  const cp = emojiToCodepoint(ch)
  if (!cp) return null
  return (
    <img
      src={`${TWEMOJI_BASE}/${cp}.svg`}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ display: 'inline-block' }}
      loading="lazy"
      draggable={false}
    />
  )
}
