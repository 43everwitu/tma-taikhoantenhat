export function buildTelegramContactUrl(input: { username?: string | null; telegramId: string | number }) {
  const username = input.username?.trim().replace(/^@+/, '')
  if (username) return `https://t.me/${encodeURIComponent(username)}`
  return `tg://user?id=${encodeURIComponent(String(input.telegramId))}`
}

export function telegramContactTitle(input: { username?: string | null; telegramId: string | number }) {
  const username = input.username?.trim().replace(/^@+/, '')
  if (username) return `Mở Telegram @${username}`
  return `Mở Telegram bằng ID ${input.telegramId} — có thể không hoạt động nếu Telegram không cho`
}
