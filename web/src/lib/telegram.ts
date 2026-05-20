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
  openLink(url: string): void
  isExpanded?: boolean
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

export function useWebApp(): TelegramWebApp | null {
  const [wa, setWa] = useState<TelegramWebApp | null>(null)
  useEffect(() => {
    const w = getWebApp()
    if (!w) return
    w.ready()
    w.expand()
    setWa(w)
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

function writeInsets(wa: TelegramWebApp) {
  const ci = wa.contentSafeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 }
  const sa = wa.safeAreaInset        ?? { top: 0, bottom: 0, left: 0, right: 0 }
  const r = document.documentElement.style
  r.setProperty('--tma-safe-top',    `${Math.max(ci.top,    sa.top)}px`)
  r.setProperty('--tma-safe-bottom', `${Math.max(ci.bottom, sa.bottom)}px`)
  r.setProperty('--tma-safe-left',   `${Math.max(ci.left,   sa.left)}px`)
  r.setProperty('--tma-safe-right',  `${Math.max(ci.right,  sa.right)}px`)
}

export function useTmaViewport() {
  useEffect(() => {
    const wa = getWebApp()
    if (!wa) return
    wa.ready()
    wa.expand()
    wa.disableVerticalSwipes?.()
    writeInsets(wa)
    const onChange = () => writeInsets(wa)
    wa.onEvent?.('safeAreaChanged', onChange)
    wa.onEvent?.('contentSafeAreaChanged', onChange)
    return () => {
      wa.offEvent?.('safeAreaChanged', onChange)
      wa.offEvent?.('contentSafeAreaChanged', onChange)
    }
  }, [])
}
