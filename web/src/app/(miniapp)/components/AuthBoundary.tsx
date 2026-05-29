'use client'

import { useEffect, useState } from 'react'
import { useWebApp, applyThemeVars, useTmaViewport } from '@/lib/telegram'
import { getMiniAppToken } from '@/lib/miniappAuth'

export function AuthBoundary({ children }: { children: React.ReactNode }) {
  const wa = useWebApp()
  useTmaViewport()
  const [errMsg, setErrMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!wa) return
    applyThemeVars(wa.themeParams)
    if (!wa.initData) return
    getMiniAppToken(wa.initData)
      .catch((e) => {
        setErrMsg(e instanceof Error ? e.message : 'auth failed')
      })
  }, [wa])

  if (errMsg) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center gap-2">
        <p className="text-base font-semibold">Không thể đăng nhập</p>
        <p className="text-xs opacity-60 max-w-xs break-words">{errMsg}</p>
        <p className="text-sm opacity-70">Mở lại Mini App từ Telegram để thử lại.</p>
      </div>
    )
  }
  return <>{children}</>
}
