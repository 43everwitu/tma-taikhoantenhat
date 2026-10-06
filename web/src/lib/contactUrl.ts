export const DEFAULT_CONTACT_URL = 'https://t.me/taikhoantenhat'

export function resolveContactUrl(value?: string | null) {
  const raw = (value ?? '').trim()
  if (!raw) return DEFAULT_CONTACT_URL
  if (/^https?:\/\//i.test(raw)) return raw
  if (/^\/\//.test(raw)) return `https:${raw}`
  if (/^(t\.me|m\.me|zalo\.me)\//i.test(raw)) return `https://${raw}`
  if (/^@[\w_]{3,}$/.test(raw)) return `https://t.me/${raw.slice(1)}`
  return raw
}
