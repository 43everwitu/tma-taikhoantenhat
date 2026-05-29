'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  children: ReactNode
  ariaLabel?: string
}

const DRAG_THRESHOLD_PX = 6

export function HScroll({ children, ariaLabel }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false, pointerId: -1 })
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)
  const [canScroll, setCanScroll] = useState(false)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return

    function update() {
      if (!el) return
      const max = el.scrollWidth - el.clientWidth
      setCanScroll(max > 1)
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

  // Desktop: vertical wheel → horizontal scroll while hovering the rail.
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const track = el

    function onWheel(e: WheelEvent) {
      if (track.scrollWidth <= track.clientWidth) return
      // Respect native horizontal / shift+wheel.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      if (e.shiftKey) return
      e.preventDefault()
      track.scrollLeft += e.deltaY
    }

    track.addEventListener('wheel', onWheel, { passive: false })
    return () => track.removeEventListener('wheel', onWheel)
  }, [])

  // Suppress accidental link clicks after a drag gesture.
  useEffect(() => {
    const el = trackRef.current
    if (!el) return

    function onClickCapture(e: MouseEvent) {
      if (!dragRef.current.moved) return
      e.preventDefault()
      e.stopPropagation()
      dragRef.current.moved = false
    }

    el.addEventListener('click', onClickCapture, true)
    return () => el.removeEventListener('click', onClickCapture, true)
  }, [])

  function scrollBy(dir: 1 | -1) {
    const el = trackRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' })
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const el = trackRef.current
    if (!el || el.scrollWidth <= el.clientWidth) return

    dragRef.current = {
      active: true,
      startX: e.clientX,
      scrollLeft: el.scrollLeft,
      moved: false,
      pointerId: e.pointerId,
    }
    el.setPointerCapture(e.pointerId)
    el.classList.add('is-dragging')
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = trackRef.current
    const d = dragRef.current
    if (!el || !d.active) return

    const dx = e.clientX - d.startX
    if (Math.abs(dx) >= DRAG_THRESHOLD_PX) d.moved = true
    el.scrollLeft = d.scrollLeft - dx
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const el = trackRef.current
    const d = dragRef.current
    if (!el || !d.active) return

    dragRef.current.active = false
    if (d.pointerId >= 0) {
      try { el.releasePointerCapture(d.pointerId) } catch { /* already released */ }
    }
    el.classList.remove('is-dragging')
  }

  const showArrows = canScroll

  return (
    <div className="miniapp-hscroll" role={ariaLabel ? 'region' : undefined} aria-label={ariaLabel}>
      {showArrows && !atStart && (
        <button
          type="button"
          className="miniapp-hscroll-arrow miniapp-hscroll-arrow--left"
          onClick={() => scrollBy(-1)}
          aria-label="Cuộn trái"
        >
          <Icon name="arrowRight" size={20} className="rotate-180" />
        </button>
      )}
      <div
        ref={trackRef}
        className="miniapp-hscroll-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {children}
      </div>
      {showArrows && !atEnd && (
        <button
          type="button"
          className="miniapp-hscroll-arrow miniapp-hscroll-arrow--right"
          onClick={() => scrollBy(1)}
          aria-label="Cuộn phải"
        >
          <Icon name="arrowRight" size={20} />
        </button>
      )}
    </div>
  )
}
