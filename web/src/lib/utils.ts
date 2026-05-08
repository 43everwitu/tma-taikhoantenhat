import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(amount) + 'đ'
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleString('vi-VN')
}
