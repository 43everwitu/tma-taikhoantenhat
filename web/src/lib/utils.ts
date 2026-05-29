import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(amount: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(amount)
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleString('vi-VN')
}

export function formatRelativeTime(date: string): string {
  const ts = new Date(date).getTime()
  if (Number.isNaN(ts)) return ''
  const diffSec = Math.floor((Date.now() - ts) / 1000)
  if (diffSec < 60) return 'Vừa xong'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)} ngày trước`
  return new Date(ts).toLocaleDateString('vi-VN')
}
