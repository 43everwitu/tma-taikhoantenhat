import type { ReactNode } from 'react'

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g

/** Auto-link bare URLs in plain text. */
export function linkifyText(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let m: RegExpExecArray | null
  let idx = 0
  URL_REGEX.lastIndex = 0
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index))
    const href = m[0]
    parts.push(
      <a key={`u-${idx++}`} href={href} target="_blank" rel="noopener noreferrer">{href}</a>
    )
    lastIndex = m.index + href.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

const LABEL_RE = /\b([A-Za-zÀ-ỹ0-9][A-Za-zÀ-ỹ0-9\s./()&]{0,40}?):\s/g

/** Plain text with `Label: value` segments — labels rendered bold. */
export function renderLabeledText(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let idx = 0
  LABEL_RE.lastIndex = 0
  while ((m = LABEL_RE.exec(text)) !== null) {
    if (m[1].includes('//')) continue
    if (m.index > last) nodes.push(...linkifyText(text.slice(last, m.index)))
    nodes.push(<b key={`lb-${idx++}`}>{m[1]}:</b>, ' ')
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(...linkifyText(text.slice(last)))
  return nodes.length > 0 ? nodes : linkifyText(text)
}

export function extractUrls(text: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  URL_REGEX.lastIndex = 0
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (!out.includes(m[0])) out.push(m[0])
  }
  return out
}

export function shortenUrl(u: string): string {
  try {
    const url = new URL(u)
    const host = url.hostname.replace(/^www\./, '')
    const path = url.pathname.length > 24 ? url.pathname.slice(0, 22) + '…' : url.pathname
    return host + (path === '/' ? '' : path)
  } catch {
    return u
  }
}
