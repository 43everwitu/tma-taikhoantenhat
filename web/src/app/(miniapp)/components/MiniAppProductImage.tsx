'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'

interface MiniAppProductImageProps {
  src?: string | null
  alt: string
  className?: string
  imgClassName?: string
  fallbackClassName?: string
  iconSize?: number
  priority?: boolean
}

function normalizeImageSrc(src?: string | null) {
  const value = String(src || '').trim()
  if (!value) return ''
  if (value.startsWith('/')) return value
  if (value.startsWith('https://')) return value
  return ''
}

export function MiniAppProductImage({
  src,
  alt,
  className = 'absolute inset-0',
  imgClassName = 'w-full h-full object-cover',
  fallbackClassName = '',
  iconSize = 44,
  priority = false,
}: MiniAppProductImageProps) {
  const safeSrc = useMemo(() => normalizeImageSrc(src), [src])
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    setErrored(false)
  }, [safeSrc])

  if (safeSrc && !errored) {
    return (
      <img
        src={safeSrc}
        alt={alt}
        className={`${className} ${imgClassName}`.trim()}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
      />
    )
  }

  return (
    <div
      className={`${className} ${fallbackClassName} grid place-items-center`.trim()}
      style={{ color: 'var(--brand-gold-deep)' }}
    >
      <Icon name="package" size={iconSize} strokeWidth={1.25} />
    </div>
  )
}
