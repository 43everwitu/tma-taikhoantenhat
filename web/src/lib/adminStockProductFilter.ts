export interface AdminStockFilterVariant {
  id: string
  name: string
}

export interface AdminStockFilterProduct {
  id: string
  name: string
  category?: string
  slug?: string
  variantNames?: string[]
  variantOptions?: AdminStockFilterVariant[]
}

export interface AdminStockFilterOption {
  key: string
  kind: 'product' | 'variant'
  productId: string
  productName: string
  variantId: string
  variantName: string
  category: string
  slug: string
}

export function normalizeAdminStockFilterText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function createProductOption(product: AdminStockFilterProduct): AdminStockFilterOption {
  return {
    key: `product:${product.id}`,
    kind: 'product',
    productId: product.id,
    productName: product.name,
    variantId: '',
    variantName: '',
    category: product.category ?? '',
    slug: product.slug ?? '',
  }
}

function createVariantOption(
  product: AdminStockFilterProduct,
  variant: AdminStockFilterVariant,
): AdminStockFilterOption {
  return {
    key: `variant:${product.id}:${variant.id}`,
    kind: 'variant',
    productId: product.id,
    productName: product.name,
    variantId: variant.id,
    variantName: variant.name,
    category: product.category ?? '',
    slug: product.slug ?? '',
  }
}

function scoreOption(
  option: AdminStockFilterOption,
  product: AdminStockFilterProduct,
  query: string,
  tokens: string[],
): number | null {
  const productName = normalizeAdminStockFilterText(option.productName)
  const variantName = normalizeAdminStockFilterText(option.variantName)
  const primaryName = option.kind === 'variant' ? variantName : productName
  const combinedName = normalizeAdminStockFilterText(`${option.productName} ${option.variantName}`)
  const variantNames = (product.variantOptions?.map((variant) => variant.name) ?? product.variantNames ?? [])
    .map(normalizeAdminStockFilterText)
    .join(' ')
  const secondary = normalizeAdminStockFilterText([
    option.category,
    option.slug,
    option.productId,
    productName,
    variantName,
    variantNames,
  ].join(' '))

  if (!tokens.every((token) => secondary.includes(token))) return null

  const primaryWords = primaryName.split(' ').filter(Boolean)
  const productWords = productName.split(' ').filter(Boolean)
  const primaryTokenPrefixes = tokens.every((token) => primaryWords.some((word) => word.startsWith(token)))
  const productTokenPrefixes = tokens.every((token) => productWords.some((word) => word.startsWith(token)))

  if (option.kind === 'variant' && combinedName === query) return 1100
  if (primaryName === query) return 1000
  if (primaryName.startsWith(query)) return 900
  if (primaryTokenPrefixes) return 800
  if (primaryName.includes(query)) return 700
  if (option.kind === 'variant' && productName === query) return 650
  if (option.kind === 'variant' && productName.startsWith(query)) return 600
  if (option.kind === 'variant' && productTokenPrefixes) return 550
  if (productName.includes(query)) return 500
  return 100
}

export function filterAdminStockProductOptions(
  products: AdminStockFilterProduct[],
  query: string,
  limit = Number.POSITIVE_INFINITY,
): AdminStockFilterOption[] {
  const normalizedQuery = normalizeAdminStockFilterText(query)
  if (!normalizedQuery) {
    return products.slice(0, limit).map(createProductOption)
  }

  const tokens = normalizedQuery.split(' ').filter(Boolean)
  const ranked: Array<{ option: AdminStockFilterOption; score: number; index: number }> = []
  let index = 0

  for (const product of products) {
    const options = [
      createProductOption(product),
      ...(product.variantOptions ?? []).map((variant) => createVariantOption(product, variant)),
    ]

    for (const option of options) {
      const score = scoreOption(option, product, normalizedQuery, tokens)
      if (score != null) ranked.push({ option, score, index })
      index += 1
    }
  }

  return ranked
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.option)
}
