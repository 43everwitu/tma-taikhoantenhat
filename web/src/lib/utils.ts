import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(amount: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(amount)
}

// Compact price for tight UI (product cards): "9.500đ" — drops the NBSP +
// currency symbol that Intl currency style emits, so ranges fit on one line.
export function formatPriceShort(amount: number): string {
  return `${Math.round(amount).toLocaleString('vi-VN')}đ`
}

const HANOI_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const SQLITE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

export function parseDbDate(date: string | null | undefined): Date | null {
  if (!date) return null
  const normalized = SQLITE_TIMESTAMP_RE.test(date) ? `${date.replace(' ', 'T')}Z` : date
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDate(date: string | null | undefined): string {
  const parsed = parseDbDate(date)
  if (!parsed) return date || ''
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: HANOI_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed)
}

export function formatRelativeTime(date: string): string {
  const parsed = parseDbDate(date)
  if (!parsed) return ''
  const diffSec = Math.floor((Date.now() - parsed.getTime()) / 1000)
  if (diffSec < 60) return 'Vừa xong'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)} ngày trước`
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: HANOI_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed)
}
