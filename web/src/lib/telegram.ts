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
