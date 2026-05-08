const test = require('node:test');
const assert = require('node:assert');
const {
  buildCategoryRows,
  buildProductRows,
  buildLicenseStockRows,
} = require('../../scripts/wp-migration/transform');

test('buildCategoryRows maps product_cat terms to fork categories', () => {
  const terms = [
    { term_id: 10, name: 'ChatGPT', slug: 'chatgpt' },
    { term_id: 11, name: 'Capcut',  slug: 'capcut' },
  ];
  const taxonomy = [
    { term_id: 10, taxonomy: 'product_cat', parent: 0 },
    { term_id: 11, taxonomy: 'product_cat', parent: 0 },
    { term_id: 12, taxonomy: 'category',    parent: 0 }, // not product_cat — ignored
  ];
  const rows = buildCategoryRows({ terms, taxonomy });
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], {
    wp_term_id: 10,
    name: 'ChatGPT',
    slug: 'chatgpt',
    emoji: '📦',
    sort_order: 0,
    is_active: 1,
  });
});

test('buildProductRows maps product posts and joins price/stock postmeta', () => {
  const posts = [
    { ID: 100, post_title: 'GPT Plus', post_status: 'publish', post_type: 'product',
      post_name: 'gpt-plus', post_content: 'Long', post_excerpt: 'Short' },
    { ID: 101, post_title: 'Draft',   post_status: 'draft',   post_type: 'product',
      post_name: 'draft', post_content: '', post_excerpt: '' }, // dropped
    { ID: 102, post_title: 'Variation', post_status: 'publish', post_type: 'product_variation',
      post_name: 'var', post_content: '', post_excerpt: '' }, // dropped
  ];
  const meta = [
    { post_id: 100, meta_key: '_price', meta_value: '8000' },
    { post_id: 100, meta_key: '_thumbnail_id', meta_value: '500' },
  ];
  const wpTermIdToCategoryId = new Map([[10, 1]]);
  const termRel = [
    { object_id: 100, term_taxonomy_id: 10 },
  ];
  const taxonomy = [
    { term_taxonomy_id: 10, term_id: 10, taxonomy: 'product_cat' },
  ];
  const rows = buildProductRows({ posts, meta, termRel, taxonomy, wpTermIdToCategoryId });
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0], {
    wp_post_id: 100,
    category_id: 1,
    name: 'GPT Plus',
    slug: 'gpt-plus',
    price: 8000,
    description: 'Short',
    long_description: 'Long',
    emoji: '📦',
    promotion: null,
    contact_only: 0,
    contact_url: null,
    sheet_stock: 0,
    is_active: 1,
    image_url: null, // resolved later by image task
    wp_thumbnail_id: 500,
  });
});

test('buildProductRows falls back to slugify(name) when post_name is empty', () => {
  const posts = [
    { ID: 200, post_title: 'Nâng Cấp Tài Khoản', post_status: 'publish', post_type: 'product',
      post_name: '', post_content: '', post_excerpt: '' },
  ];
  // _price meta required so the row isn't filtered out as priceless.
  const rows = buildProductRows({
    posts,
    meta: [{ post_id: 200, meta_key: '_price', meta_value: '1000' }],
    termRel: [], taxonomy: [], wpTermIdToCategoryId: new Map(),
  });
  assert.strictEqual(rows[0].slug, 'nang-cap-tai-khoan');
});

test('buildProductRows drops products with no price meta', () => {
  const posts = [
    { ID: 300, post_title: 'Free Sample', post_status: 'publish', post_type: 'product',
      post_name: 'free-sample', post_content: '', post_excerpt: '' },
  ];
  const rows = buildProductRows({
    posts, meta: [], termRel: [], taxonomy: [], wpTermIdToCategoryId: new Map(),
  });
  assert.strictEqual(rows.length, 0);
});

test('buildLicenseStockRows imports only unsold (status=1) keys mapped to known products', () => {
  const csvRows = [
    { license_key: 'KEY-001', wp_product_id: 100, status: '1' }, // active
    { license_key: 'KEY-002', wp_product_id: 100, status: '2' }, // sold
    { license_key: 'KEY-003', wp_product_id: 999, status: '1' }, // unknown product
  ];
  const wpProductIdToFork = new Map([[100, 7]]);
  const rows = buildLicenseStockRows({ csvRows, wpProductIdToFork });
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0], { product_id: 7, data: 'KEY-001' });
});
