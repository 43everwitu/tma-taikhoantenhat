import sanitizeHtml from 'sanitize-html'

// Mirror of src/utils/richHtml.js ALLOWED_TAGS — kept identical so server
// and client agree on the tag whitelist. Update both files together.
const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'a', 'code', 'pre', 'br', 'tg-spoiler']

const OPTS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https'],
  selfClosing: ['br'],
}

/**
 * Sanitize admin-authored HTML for safe rendering in the customer pages.
 * Same allowed-tag set as the server-side sanitizer, so what survives storage
 * also survives display.
 */
export function sanitizeRich(html: string | null | undefined): string {
  if (!html) return ''
  return sanitizeHtml(html, OPTS).trim()
}
