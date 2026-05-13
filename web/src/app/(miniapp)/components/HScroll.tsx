'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  children: ReactNode
  ariaLabel?: string
}

export function HScroll({ children, ariaLabel }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    function update() {
      if (!el) return
      const max = el.scrollWidth - el.clientWidth
      setAtStart(el.scrollLeft <= 1)
      setAtEnd(el.scrollLeft >= max - 1 || max <= 0)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  function scrollBy(dir: 1 | -1) {
    const el = trackRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' })
  }

  return (
    <div className="miniapp-hscroll" aria-label={ariaLabel}>
      <button
        type="button"
        className="miniapp-hscroll-arrow miniapp-hscroll-arrow--left"
        onClick={() => scrollBy(-1)}
        disabled={atStart}
        aria-label="Cuộn trái"
      >
        <Icon name="arrowRight" size={16} className="rotate-180" />
      </button>
      <div ref={trackRef} className="miniapp-hscroll-track">
        {children}
      </div>
      <button
        type="button"
        className="miniapp-hscroll-arrow miniapp-hscroll-arrow--right"
        onClick={() => scrollBy(1)}
        disabled={atEnd}
        aria-label="Cuộn phải"
      >
        <Icon name="arrowRight" size={16} />
      </button>
    </div>
  )
}
