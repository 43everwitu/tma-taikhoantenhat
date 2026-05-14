'use client'

import { useEffect } from 'react'
import { getWebApp } from './telegram'

export function useTelegramBackButton(enabled: boolean, onBack: () => void) {
  useEffect(() => {
    const bb = getWebApp()?.BackButton
    if (!bb) return

    if (!enabled) { bb.hide(); return }

    bb.onClick(onBack)
    bb.show()
    return () => {
      bb.offClick(onBack)
      bb.hide()
    }
  }, [enabled, onBack])
}
