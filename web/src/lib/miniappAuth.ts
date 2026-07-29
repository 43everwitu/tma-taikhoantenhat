'use client'

let cachedToken: string | null = null
let inflight: Promise<string> | null = null

export interface MiniAppMe {
  telegramId: number
  username: string | null
  fullName: string
  balance: number
}

let cachedMe: MiniAppMe | null = null

export async function getMiniAppToken(initData: string): Promise<string> {
  if (cachedToken) return cachedToken
  if (inflight) return inflight
  inflight = (async () => {
    const res = await fetch('/api/v1/auth/miniapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
    if (!res.ok) {
      throw new Error('Không thể xác thực Telegram. Vui lòng đóng Mini App và mở lại từ Telegram.')
    }
    const json = await res.json()
    cachedToken = json.data.token as string
    cachedMe = json.data.user as MiniAppMe
    return cachedToken as string
  })().finally(() => { inflight = null })
  return inflight
}

export function getCachedMe(): MiniAppMe | null { return cachedMe }
export function getCachedToken(): string | null { return cachedToken }

export async function requireMiniAppToken(): Promise<string> {
  if (cachedToken) return cachedToken
  if (inflight) return inflight
  const initData = typeof window !== 'undefined'
    ? window.Telegram?.WebApp?.initData
    : ''
  if (!initData) {
    throw new Error('Vui lòng mở Mini App từ Telegram để tiếp tục.')
  }
  return getMiniAppToken(initData)
}
export function clearAuth() { cachedToken = null; cachedMe = null }
