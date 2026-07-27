export interface SmartSearchResponse<T> {
  results: T[]
  suggestions: T[]
  total: number
}

export interface SmartSearchOptions {
  category?: string
  sort?: string
  priceMin?: string | number
  priceMax?: string | number
  limit?: number
  suggestionLimit?: number
}

function hasValue(value: string | number | undefined) {
  return value !== undefined && value !== ''
}

export function isSmartSearchQuery(query: string) {
  return query.trim().length >= 2
}

export function buildSmartSearchPath(query: string, options: SmartSearchOptions = {}) {
  const params = new URLSearchParams()
  params.set('q', query.trim())
  if (options.category) params.set('category', options.category)
  if (options.sort && options.sort !== 'default') params.set('sort', options.sort)
  if (hasValue(options.priceMin)) params.set('priceMin', String(options.priceMin))
  if (hasValue(options.priceMax)) params.set('priceMax', String(options.priceMax))
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.suggestionLimit !== undefined) {
    params.set('suggestionLimit', String(options.suggestionLimit))
  }
  return `/products/search?${params.toString()}`
}

export function buildAllProductsSearchHref(query: string) {
  const params = new URLSearchParams({ q: query.trim() })
  return `/san-pham?${params.toString()}`
}
