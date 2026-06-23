'use client'

import { useEffect } from 'react'
import { getWebApp, isTmaVersionAtLeast } from './telegram'

export function useTelegramBackButton(enabled: boolean, onBack: () => void) {
  useEffect(() => {
    const wa = getWebApp()
    if (!wa || !isTmaVersionAtLeast(wa, '6.1')) return

    const bb = wa.BackButton
    if (!bb) return

    if (!enabled) {
      bb.hide()
      return
    }

    bb.onClick(onBack)
    bb.show()
    return () => {
      bb.offClick(onBack)
      bb.hide()
    }
  }, [enabled, onBack])
}
