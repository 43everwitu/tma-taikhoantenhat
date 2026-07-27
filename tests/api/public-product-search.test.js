const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const db = require('../../src/database');

async function getJson(app, path) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`);
        const json = await response.json();
        server.close();
        resolve({ status: response.status, json });
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', require('../../src/api/routes/public'));
  return app;
}

function createFixture(t) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const category = db.prepare(`
    INSERT INTO categories (name, slug, is_active)
    VALUES (?, ?, 1)
  `).run(`Smart Search ${suffix}`, `smart-search-${suffix}`);
  const otherCategory = db.prepare(`
    INSERT INTO categories (name, slug, is_active)
    VALUES (?, ?, 1)
  `).run(`Smart Search Other ${suffix}`, `smart-search-other-${suffix}`);

  function addProduct(overrides = {}) {
    return db.prepare(`
      INSERT INTO products (
        category_id, name, slug, price, description, long_description,
        usage_instructions, is_active, is_archived, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      overrides.categoryId || category.lastInsertRowid,
      overrides.name || `Sản phẩm ${suffix}`,
      overrides.slug || `smart-product-${suffix}-${Math.floor(Math.random() * 100000)}`,
      overrides.price || 100000,
      overrides.description || '',
      overrides.longDescription || '',
      overrides.usageInstructions || '',
      overrides.active === false ? 0 : 1,
      overrides.archived ? 1 : 0,
      overrides.sortOrder || 0,
    );
  }

  const direct = addProduct({
    name: `Kiểm tra đạo văn chuyên sâu ${suffix}`,
    slug: `smart-direct-${suffix}`,
    price: 149000,
  });
  const content = addProduct({
    name: `Nghiên cứu học thuật ${suffix}`,
    slug: `smart-content-${suffix}`,
    price: 249000,
    usageInstructions: '<p>Dùng chế độ trích xuất ma trận tài liệu.</p>',
  });
  const variantProduct = addProduct({
    name: `Công cụ làm việc ${suffix}`,
    slug: `smart-variant-${suffix}`,
    price: 399000,
  });
  const activeVariant = db.prepare(`
    INSERT INTO product_variants (product_id, name, description, price, is_active)
    VALUES (?, ?, ?, ?, 1)
  `).run(
    variantProduct.lastInsertRowid,
    `Business Vision ${suffix}`,
    'Tự động hóa workflow',
    399000,
  );
  const inactiveVariant = db.prepare(`
    INSERT INTO product_variants (product_id, name, description, price, is_active)
    VALUES (?, ?, ?, ?, 0)
  `).run(
    variantProduct.lastInsertRowid,
    `Hidden Quantum ${suffix}`,
    '',
    399000,
  );
  const archived = addProduct({
    name: `Archived Nebula ${suffix}`,
    slug: `smart-archived-${suffix}`,
    archived: true,
  });
  const other = addProduct({
    categoryId: otherCategory.lastInsertRowid,
    name: `Kiểm tra đạo văn ngoài danh mục ${suffix}`,
    slug: `smart-other-${suffix}`,
    price: 99000,
  });
  const fuzzy = addProduct({
    name: `Netflix Premium ${suffix}`,
    slug: `smart-fuzzy-${suffix}`,
    price: 199000,
  });

  const productIds = [
    direct.lastInsertRowid,
    content.lastInsertRowid,
    variantProduct.lastInsertRowid,
    archived.lastInsertRowid,
    other.lastInsertRowid,
    fuzzy.lastInsertRowid,
  ];
  t.after(() => {
    db.prepare(`DELETE FROM product_variants WHERE product_id IN (${productIds.map(() => '?').join(',')})`)
      .run(...productIds);
    db.prepare(`DELETE FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`)
      .run(...productIds);
    db.prepare('DELETE FROM categories WHERE id IN (?, ?)')
      .run(category.lastInsertRowid, otherCategory.lastInsertRowid);
  });

  return {
    suffix,
    categorySlug: `smart-search-${suffix}`,
    ids: {
      direct: Number(direct.lastInsertRowid),
      content: Number(content.lastInsertRowid),
      variantProduct: Number(variantProduct.lastInsertRowid),
      activeVariant: Number(activeVariant.lastInsertRowid),
      inactiveVariant: Number(inactiveVariant.lastInsertRowid),
      archived: Number(archived.lastInsertRowid),
      other: Number(other.lastInsertRowid),
      fuzzy: Number(fuzzy.lastInsertRowid),
    },
  };
}

test('GET /products/search từ chối query ngắn hơn hai ký tự', async () => {
  const { status, json } = await getJson(makeApp(), '/api/v1/products/search?q=a');

  assert.equal(status, 400);
  assert.equal(json.error.code, 'INVALID_SEARCH_QUERY');
});

test('GET /products/search tìm tên không dấu, biến thể và nội dung', async (t) => {
  const fixture = createFixture(t);
  const app = makeApp();

  const direct = await getJson(app, '/api/v1/products/search?q=kiem%20tra%20dao%20van');
  const variant = await getJson(app, `/api/v1/products/search?q=${encodeURIComponent(`business vision ${fixture.suffix}`)}`);
  const content = await getJson(app, '/api/v1/products/search?q=trich%20xuat%20ma%20tran%20tai%20lieu');

  assert.equal(direct.status, 200);
  assert.deepEqual(Object.keys(direct.json.data).sort(), ['results', 'suggestions', 'total']);
  assert.equal(direct.json.data.results[0].id, String(fixture.ids.direct));
  assert.equal(variant.json.data.results[0].id, String(fixture.ids.variantProduct));
  assert.match(variant.json.data.results[0].matchLabel, /^Khớp biến thể:/);
  assert.equal(content.json.data.results[0].id, String(fixture.ids.content));
  assert.equal(content.json.data.results[0].matchLabel, 'Khớp nội dung sản phẩm');
});

test('GET /products/search áp dụng category, price và loại dữ liệu inactive', async (t) => {
  const fixture = createFixture(t);
  const app = makeApp();

  const filtered = await getJson(
    app,
    `/api/v1/products/search?q=kiem%20tra%20dao%20van&category=${fixture.categorySlug}&priceMin=100000`,
  );
  const hidden = await getJson(
    app,
    `/api/v1/products/search?q=${encodeURIComponent(`hidden quantum ${fixture.suffix}`)}`,
  );
  const archived = await getJson(
    app,
    `/api/v1/products/search?q=${encodeURIComponent(`archived nebula ${fixture.suffix}`)}`,
  );

  assert.deepEqual(filtered.json.data.results.map((item) => item.id), [String(fixture.ids.direct)]);
  assert.deepEqual(hidden.json.data.results, []);
  assert.deepEqual(hidden.json.data.suggestions, []);
  assert.deepEqual(archived.json.data.results, []);
  assert.deepEqual(archived.json.data.suggestions, []);
});

test('GET /products/search giới hạn riêng kết quả và gợi ý', async (t) => {
  const fixture = createFixture(t);

  const { status, json } = await getJson(
    makeApp(),
    `/api/v1/products/search?q=${encodeURIComponent(`netfix ${fixture.suffix}`)}&limit=1&suggestionLimit=1`,
  );

  assert.equal(status, 200);
  assert.equal(json.data.results.length, 0);
  assert.equal(json.data.suggestions.length, 1);
  assert.equal(json.data.suggestions[0].id, String(fixture.ids.fuzzy));
});
