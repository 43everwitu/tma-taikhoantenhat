const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../src/database');

function callCreateOrder(validated) {
  const router = require('../../src/api/routes/customer');
  const layer = router.stack.find((item) => item.route?.path === '/orders' && item.route?.methods?.post);
  const handler = layer.route.stack.at(-1).handle;
  let status = 200;
  let body = null;

  handler(
    {
      customer: { telegramId: 998877001 },
      validated,
      app: { locals: {} },
    },
    {
      status(code) {
        status = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    },
  );

  return { status, body };
}

test('checkout chặn biến thể kế thừa chỉ liên hệ và cho phép override bán trực tiếp', (t) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const product = db.prepare(`
    INSERT INTO products (name, slug, price, is_active, contact_only)
    VALUES (?, ?, 100000, 1, 1)
  `).run(`Liên hệ API ${suffix}`, `contact-only-api-${suffix}`);
  const inherited = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, contact_only)
    VALUES (?, 'Kế thừa', 100000, 1, NULL)
  `).run(product.lastInsertRowid);
  const direct = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, contact_only)
    VALUES (?, 'Bán trực tiếp', 100000, 1, 0)
  `).run(product.lastInsertRowid);

  t.after(() => {
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
  });

  const blocked = callCreateOrder({
    productId: Number(product.lastInsertRowid),
    variantId: Number(inherited.lastInsertRowid),
    quantity: 1,
    bankIndex: 0,
  });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.error.code, 'CONTACT_ONLY');

  const allowed = callCreateOrder({
    productId: Number(product.lastInsertRowid),
    variantId: Number(direct.lastInsertRowid),
    quantity: 1,
    bankIndex: 0,
  });
  assert.equal(allowed.status, 400);
  assert.equal(allowed.body.error.code, 'INSUFFICIENT_STOCK');
});
