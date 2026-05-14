const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1'

interface ApiResponse<T = unknown> {
  success: boolean
  data: T
  meta?: { page: number; limit: number; total: number }
  error?: { code: string; message: string }
}

// Two distinct localStorage keys so admin sessions and customer sessions do
// not overwrite each other. Backend uses different JWT payload shapes
// (adminId vs telegramId) and different verifier middleware, so a single
// "token" slot would break one role whenever the other logs in.
const ADMIN_KEY = 'adminToken'
const CUSTOMER_KEY = 'customerToken'

function readKey(key: string): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(key)
}

export function setAdminToken(token: string) { localStorage.setItem(ADMIN_KEY, token) }
export function clearAdminToken() { localStorage.removeItem(ADMIN_KEY) }
export function getAdminToken(): string | null { return readKey(ADMIN_KEY) }

export function setCustomerToken(token: string) { localStorage.setItem(CUSTOMER_KEY, token) }
export function clearCustomerToken() { localStorage.removeItem(CUSTOMER_KEY) }
export function getCustomerToken(): string | null { return readKey(CUSTOMER_KEY) }

// Backward-compat aliases — point at customer storage so any old call sites
// behave the same as before the split. Remove once all imports updated.
export const setToken = setCustomerToken
export const clearToken = clearCustomerToken

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  // Path-based token selection. /admin/* hits admin-protected routes; the
  // /auth/login endpoint also expects no token (and ignores any that's
  // present), so it's fine to omit. Everything else gets the customer token.
  const isAdmin = path.startsWith('/admin/')
  const token = isAdmin ? getAdminToken() : getCustomerToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const data = await res.json()

  if (!res.ok && !data.success) {
    throw new Error(data.error?.message || `API error ${res.status}`)
  }

  return data
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
}

export interface MessageTemplate {
  key: string
  channel: 'bot' | 'admin' | 'group' | 'web'
  label: string
  variables: string[]
  body: string
  default_body: string
  updated_at: string
  enabled: boolean
  core: boolean
}

export interface Admin2FAState {
  enabled: boolean
  required: boolean
  backupCount: number
}

export const adminAuth = {
  login: (username: string, password: string) =>
    api.post<{ ok: true; token?: string; requires2fa?: boolean; challengeToken?: string; requiresEnroll?: boolean; enrollToken?: string; admin?: { id: number; username: string; displayName: string; role: string } }>('/auth/login', { username, password }),
  verify2fa: (challengeToken: string, code: string) =>
    api.post<{ ok: true; token: string; consumedBackup: boolean; admin: { id: number; username: string; displayName: string; role: string } }>('/auth/login/2fa', { challengeToken, code }),
}

export const twoFactor = {
  state: () => api.get<Admin2FAState>('/admin/me/2fa'),
  setup: () => api.post<{ secret: string; otpauthUrl: string; qrDataUrl: string }>('/admin/me/2fa/setup', {}),
  enable: (code: string) => api.post<{ backupCodes: string[]; token: string | null }>('/admin/me/2fa/enable', { code }),
  disable: (code: string) => api.post<{ disabled: true }>('/admin/me/2fa/disable', { code }),
  regenerate: (code: string) => api.post<{ backupCodes: string[] }>('/admin/me/2fa/regenerate-backup', { code }),
  adminSet: (id: number, body: { required?: boolean; reset?: boolean }) =>
    api.patch<{ updated: boolean }>(`/admin/admins/${id}/2fa`, body),
}

export const templates = {
  list: () => api.get<MessageTemplate[]>('/admin/messages'),
  update: (key: string, body: string) => api.put<void>(`/admin/messages/${key}`, { body }),
  reset: (key: string) => api.post<void>(`/admin/messages/${key}/reset`, {}),
  preview: (key: string, vars: Record<string, string>) =>
    api.post<{ text: string }>(`/admin/messages/${key}/preview`, { vars }),
  toggle: (key: string, enabled: boolean) =>
    api.put<{ enabled: boolean }>(`/admin/messages/${key}/toggle`, { enabled }),
}
