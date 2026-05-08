'use client'

import { useEffect, useState } from 'react'
import { useWebApp, applyThemeVars, getWebApp } from '@/lib/telegram'
import { getMiniAppToken } from '@/lib/miniappAuth'

type AuthState = 'pending' | 'ready' | 'guest' | 'failed'

const SCRIPT_TIMEOUT_MS = 1500

export function AuthBoundary({ children }: { children: React.ReactNode }) {
  const wa = useWebApp()
  const [authState, setAuthState] = useState<AuthState>('pending')
  const [errMsg, setErrMsg] = useState<string | null>(null)

  // If the Telegram WebApp script never loads (browser without Telegram or
  // tunnel test), fall through to guest mode so public pages still render.
  useEffect(() => {
    if (wa) return
    const timer = setTimeout(() => {
      if (!getWebApp()) setAuthState('guest')
    }, SCRIPT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [wa])

  useEffect(() => {
    if (!wa) return
    applyThemeVars(wa.themeParams)
    if (!wa.initData) {
      // Telegram script loaded but no initData (opened outside Telegram or
      // in-browser tunnel test). Public catalog still works; auth-required
      // actions surface their own errors.
      setAuthState('guest')
      return
    }
    getMiniAppToken(wa.initData)
      .then(() => setAuthState('ready'))
      .catch((e) => {
        setErrMsg(e instanceof Error ? e.message : 'auth failed')
        setAuthState('failed')
      })
  }, [wa])

  if (authState === 'failed') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center gap-2">
        <p className="text-base font-semibold">Không thể đăng nhập</p>
        {errMsg && <p className="text-xs opacity-60 max-w-xs break-words">{errMsg}</p>}
        <p className="text-sm opacity-70">Mở lại Mini App từ Telegram để thử lại.</p>
      </div>
    )
  }
  if (authState === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <p className="opacity-60 text-sm">Đang khởi tạo…</p>
      </div>
    )
  }
  return <>{children}</>
}
