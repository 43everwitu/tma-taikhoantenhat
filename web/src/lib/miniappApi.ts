'use client'

import { getCachedToken, requireMiniAppToken } from './miniappAuth'

export interface ApiResponse<T> { success: boolean; data?: T; error?: { code: string; message: string } }
export interface MiniAppApiOptions { auth?: 'optional' | 'required' }

function userFacingError(path: string, status: number, error?: { code: string; message: string }) {
  if (error?.code === 'UNAUTHORIZED' || error?.code === 'INVALID_TOKEN') {
    return 'Phiên Telegram chưa sẵn sàng hoặc đã hết hạn. Vui lòng đóng Mini App, mở lại từ Telegram rồi thử lại.'
  }
  if (status >= 500) {
    return 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau ít phút.'
  }
  return error?.message || `Không thể xử lý yêu cầu ${path}. Vui lòng thử lại.`
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, options: MiniAppApiOptions = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = options.auth === 'required'
    ? await requireMiniAppToken()
    : getCachedToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  const res = await fetch(`/api/v1${path}`, { ...init, headers })
  const contentType = res.headers.get('Content-Type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(`Máy chủ phản hồi không hợp lệ (HTTP ${res.status})`)
  }

  let json: ApiResponse<T>
  try {
    json = await res.json()
  } catch {
    throw new Error(`Máy chủ phản hồi không hợp lệ (HTTP ${res.status})`)
  }

  if (!json.success || json.data === undefined) {
    throw new Error(userFacingError(path, res.status, json.error))
  }
  return json.data
}
