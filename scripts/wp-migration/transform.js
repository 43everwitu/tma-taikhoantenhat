const { slugify } = require('../../src/utils/slugify');

function buildCategoryRows({ terms, taxonomy }) {
  const productCatTermIds = new Set(
    taxonomy.filter(t => t.taxonomy === 'product_cat').map(t => Number(t.term_id))
  );
  return terms
    .filter(t => productCatTermIds.has(Number(t.term_id)))
    .map(t => ({
      wp_term_id: Number(t.term_id),
      name: String(t.name),
      slug: t.slug ? String(t.slug) : (slugify(t.name) || `cat-wp-${t.term_id}`),
      emoji: '📦',
      sort_order: 0,
      is_active: 1,
    }));
}

function buildProductRows({ posts, meta, termRel, taxonomy, wpTermIdToCategoryId }) {
  // Index meta by post_id for fast lookup
  const metaByPost = new Map();
  for (const m of meta) {
    const key = Number(m.post_id);
    if (!metaByPost.has(key)) metaByPost.set(key, {});
    metaByPost.get(key)[m.meta_key] = m.meta_value;
  }

  // Map term_taxonomy_id → term_id (for product_cat only)
  const ttIdToTermId = new Map();
  for (const t of taxonomy) {
    if (t.taxonomy === 'product_cat') {
      ttIdToTermId.set(Number(t.term_taxonomy_id), Number(t.term_id));
    }
  }

  // Map post → first product_cat category
  const postToCategory = new Map();
  for (const r of termRel) {
    const termId = ttIdToTermId.get(Number(r.term_taxonomy_id));
    if (termId == null) continue;
    const catId = wpTermIdToCategoryId.get(termId);
    if (catId == null) continue;
    if (!postToCategory.has(Number(r.object_id))) {
      postToCategory.set(Number(r.object_id), catId);
    }
  }

  const out = [];
  for (const p of posts) {
    if (p.post_status !== 'publish') continue;
    if (p.post_type !== 'product') continue; // skip variations and drafts
    const m = metaByPost.get(Number(p.ID)) || {};
    const priceRaw = m._price ?? m._regular_price;
    const price = priceRaw != null ? Math.round(Number(priceRaw)) : NaN;
    if (!Number.isFinite(price) || price <= 0) continue; // skip priceless
    out.push({
      wp_post_id: Number(p.ID),
      category_id: postToCategory.get(Number(p.ID)) ?? null,
      name: String(p.post_title),
      slug: p.post_name ? String(p.post_name) : (slugify(p.post_title) || `product-wp-${p.ID}`),
      price,
      description: p.post_excerpt ? String(p.post_excerpt) : '',
      long_description: p.post_content ? String(p.post_content) : '',
      emoji: '📦',
      promotion: null,
      contact_only: 0,
      contact_url: null,
      sheet_stock: 0,
      is_active: 1,
      image_url: null,
      wp_thumbnail_id: m._thumbnail_id ? Number(m._thumbnail_id) : null,
    });
  }
  return out;
}

function buildLicenseStockRows({ csvRows, wpProductIdToFork }) {
  const out = [];
  for (const r of csvRows) {
    if (String(r.status) !== '1') continue; // 1 = active/unsold in lmfwc
    const forkId = wpProductIdToFork.get(Number(r.wp_product_id));
    if (forkId == null) continue;
    const key = String(r.license_key || '').trim();
    if (!key) continue;
    out.push({ product_id: forkId, data: key });
  }
  return out;
}

module.exports = { buildCategoryRows, buildProductRows, buildLicenseStockRows };
