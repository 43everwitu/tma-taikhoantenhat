'use client'

import { useState } from 'react'
import { EmojiIcon } from './EmojiIcon'

interface Props {
  imageUrl?: string | null
  emoji?: string | null
  alt: string
  className: string
  emojiSize?: number
}

// Renders product image with graceful fallback: gradient background + emoji.
// Pollinations.ai (used for AI-generated images) sometimes 5xx or stalls on
// mobile networks — without a fallback the user sees a broken-image icon.
// referrerPolicy avoids being blocked when the upstream rejects referrers.
export function ProductImage({ imageUrl, emoji, alt, className, emojiSize = 88 }: Props) {
  const [errored, setErrored] = useState(false)
  const showImage = !!imageUrl && !errored

  if (showImage) {
    return (
      <img
        src={imageUrl as string}
        alt={alt}
        className={`${className} object-cover`}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
      />
    )
  }

  return (
    <div
      className={`${className} flex items-center justify-center`}
      style={{ background: 'linear-gradient(135deg, var(--color-lemon-400), var(--color-matcha-300))' }}
    >
      <EmojiIcon emoji={emoji ?? undefined} size={emojiSize} />
    </div>
  )
}
