'use client'

import { useEffect, useState } from 'react'
import { useWebApp, applyThemeVars } from '@/lib/telegram'
import { getMiniAppToken } from '@/lib/miniappAuth'
import { t } from '@/i18n/vi'

export function AuthBoundary({ children }: { children: React.ReactNode }) {
  const wa = useWebApp()
  const [authState, setAuthState] = useState<'pending' | 'ready' | 'failed'>('pending')

  useEffect(() => {
    if (!wa) return
    applyThemeVars(wa.themeParams)
    if (!wa.initData) {
      // Page opened outside Telegram → leave as failed; Mini-App-only routes
      // will show the error banner. Geo-block (sub-project #4) prevents
      // direct access from VN browsers; this is the in-route fallback.
      setAuthState('failed')
      return
    }
    getMiniAppToken(wa.initData)
      .then(() => setAuthState('ready'))
      .catch(() => setAuthState('failed'))
  }, [wa])

  if (authState === 'failed') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <p>{t.errors.auth}</p>
      </div>
    )
  }
  if (authState === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <p>Đang khởi tạo…</p>
      </div>
    )
  }
  return <>{children}</>
}
