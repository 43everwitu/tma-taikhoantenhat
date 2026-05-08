import { api } from './api'

export interface PublicTemplate {
  key: string
  body: string
  variables: string[]
}

let cache: { ts: number; map: Record<string, PublicTemplate> } = { ts: 0, map: {} }
const TTL = 60_000

async function loadAll(): Promise<Record<string, PublicTemplate>> {
  if (cache.ts && Date.now() - cache.ts < TTL) return cache.map
  const res = await api.get<PublicTemplate[]>('/messages/public')
  const map: Record<string, PublicTemplate> = {}
  for (const t of res.data) map[t.key] = t
  cache = { ts: Date.now(), map }
  return map
}

export async function renderTemplate(key: string, vars: Record<string, string | number>): Promise<string> {
  const all = await loadAll()
  const tpl = all[key]
  if (!tpl) return ''
  return tpl.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => {
    const v = vars[name]
    return v === undefined || v === null ? '' : String(v)
  })
}

export function invalidateTemplateCache() {
  cache = { ts: 0, map: {} }
}
