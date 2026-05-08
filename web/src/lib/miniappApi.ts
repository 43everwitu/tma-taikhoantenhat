'use client'

import { getCachedToken } from './miniappAuth'

export interface ApiResponse<T> { success: boolean; data?: T; error?: { code: string; message: string } }

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getCachedToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  const res = await fetch(`/api/v1${path}`, { ...init, headers })
  const json: ApiResponse<T> = await res.json()
  if (!json.success || json.data === undefined) {
    throw new Error(json.error?.message || `API ${path} failed (${res.status})`)
  }
  return json.data
}
