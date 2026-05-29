'use client'

import { useEffect, useState } from 'react'

export interface TelegramThemeParams {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
}

export interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
}

export interface TelegramWebApp {
  initData: string
  initDataUnsafe: { user?: TelegramUser; auth_date?: number; hash?: string; start_param?: string }
  themeParams: TelegramThemeParams
  colorScheme: 'light' | 'dark'
  ready(): void
  expand(): void
  close(): void
  MainButton: {
    text: string
    show(): void
    hide(): void
    setText(t: string): void
    onClick(cb: () => void): void
    offClick(cb: () => void): void
    enable(): void
    disable(): void
    showProgress(leaveActive?: boolean): void
    hideProgress(): void
  }
  BackButton: {
    show(): void
    hide(): void
    onClick(cb: () => void): void
    offClick(cb: () => void): void
  }
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void
    notificationOccurred(type: 'error' | 'success' | 'warning'): void
    selectionChanged(): void
  }
  downloadFile?: (params: { url: string; file_name: string }, callback?: (accepted: boolean) => void) => void
  isVersionAtLeast?: (version: string) => boolean
  openLink(url: string): void
  isExpanded?: boolean
  version?: string
  platform?: string
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number }
  safeAreaInset?:        { top: number; bottom: number; left: number; right: number }
  onEvent?: (event: 'safeAreaChanged' | 'contentSafeAreaChanged' | 'viewportChanged', cb: () => void) => void
  offEvent?: (event: 'safeAreaChanged' | 'contentSafeAreaChanged' | 'viewportChanged', cb: () => void) => void
  disableVerticalSwipes?: () => void
  enableVerticalSwipes?: () => void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null
  return window.Telegram?.WebApp ?? null
}

export function isTmaVersionAtLeast(wa: TelegramWebApp, minVersion: string): boolean {
  const current = (wa.version ?? '0').split('.').map((part) => parseInt(part, 10) || 0)
  const minimum = minVersion.split('.').map((part) => parseInt(part, 10) || 0)
  const len = Math.max(current.length, minimum.length)
  for (let i = 0; i < len; i += 1) {
    const a = current[i] ?? 0
    const b = minimum[i] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return true
}

function prepareWebApp(wa: TelegramWebApp) {
  wa.ready()
  wa.expand()
  // Telegram lets users pull the Mini App down with vertical swipes by default.
  // For a shop UI with scrollable product cards, disable that gesture when the
  // client supports it so normal content scrolling does not collapse the app.
  wa.disableVerticalSwipes?.()
}

export function useWebApp(): TelegramWebApp | null {
  const [wa, setWa] = useState<TelegramWebApp | null>(() => getWebApp())
  useEffect(() => {
    const w = getWebApp()
    if (w) {
      prepareWebApp(w)
      return
    }

    const timer = window.setInterval(() => {
      const next = getWebApp()
      if (!next) return
      prepareWebApp(next)
      setWa(next)
      window.clearInterval(timer)
    }, 50)

    return () => window.clearInterval(timer)
  }, [])
  return wa
}

const THEME_VAR_MAP: [keyof TelegramThemeParams, string][] = [
  ['bg_color',          '--tg-bg'],
  ['text_color',        '--tg-text'],
  ['hint_color',        '--tg-hint'],
  ['link_color',        '--tg-link'],
  ['button_color',      '--tg-button'],
  ['button_text_color', '--tg-button-text'],
  ['secondary_bg_color','--tg-bg-2'],
]

export function applyThemeVars(theme: TelegramThemeParams) {
  if (typeof document === 'undefined') return
  for (const [src, varName] of THEME_VAR_MAP) {
    const v = theme[src]
    if (v) document.documentElement.style.setProperty(varName, v)
  }
}

// Legacy fallback for Telegram clients on Bot API < 8.0 where
// contentSafeAreaInset is undefined AND the iOS WebView does not honor
// viewport-fit=cover (so env(safe-area-inset-*) also resolves to 0).
// We measure approximate iOS Telegram chrome dimensions and pad manually.
// Updating the Telegram app to a recent version is the real fix; this
// keeps the layout usable in the meantime.
function getLegacyInsets(wa: TelegramWebApp) {
  const isApple = wa.platform === 'ios' || wa.platform === 'macos'
  if (isTmaVersionAtLeast(wa, '8.0') || !isApple) return { top: 0, bottom: 0, left: 0, right: 0 }
  const landscape = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(orientation: landscape)').matches
  // Portrait:  Telegram chrome row (~56px) above content; home indicator (~34px) below.
  // Landscape: chrome cluster moves to the notch side (~64px); home-indicator gesture rail (~21px).
  //            Notch can be on either left or right depending on rotation direction,
  //            so pad both sides equally.
  return landscape
    ? { top: 0,  bottom: 21, left: 64, right: 64 }
    : { top: 56, bottom: 34, left: 0,  right: 0  }
}

function writeInsets(wa: TelegramWebApp) {
  if (typeof document === 'undefined') return
  const ci = wa.contentSafeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 }
  const sa = wa.safeAreaInset        ?? { top: 0, bottom: 0, left: 0, right: 0 }
  const lg = getLegacyInsets(wa)
  const r = document.documentElement.style
  r.setProperty('--tma-safe-top',    `${Math.max(ci.top,    sa.top,    lg.top)}px`)
  r.setProperty('--tma-safe-bottom', `${Math.max(ci.bottom, sa.bottom, lg.bottom)}px`)
  r.setProperty('--tma-safe-left',   `${Math.max(ci.left,   sa.left,   lg.left)}px`)
  r.setProperty('--tma-safe-right',  `${Math.max(ci.right,  sa.right,  lg.right)}px`)
}

export function useTmaViewport() {
  useEffect(() => {
    const wa = getWebApp()
    if (!wa) return
    prepareWebApp(wa)
    writeInsets(wa)
    const onChange = () => writeInsets(wa)
    const supportsSafeAreaEvents = isTmaVersionAtLeast(wa, '8.0')
    if (supportsSafeAreaEvents) {
      wa.onEvent?.('safeAreaChanged', onChange)
      wa.onEvent?.('contentSafeAreaChanged', onChange)
    }
    const orientation = window.matchMedia?.('(orientation: landscape)')
    orientation?.addEventListener?.('change', onChange)
    return () => {
      if (supportsSafeAreaEvents) {
        wa.offEvent?.('safeAreaChanged', onChange)
        wa.offEvent?.('contentSafeAreaChanged', onChange)
      }
      orientation?.removeEventListener?.('change', onChange)
    }
  }, [])
}
