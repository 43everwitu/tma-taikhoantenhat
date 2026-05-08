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
      const text = await res.text()
      throw new Error(`Mini App auth failed: ${res.status} ${text}`)
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
export function clearAuth() { cachedToken = null; cachedMe = null }
