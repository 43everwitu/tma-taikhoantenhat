const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

test('nfshop columns and tables exist', () => {
  const cols = db.prepare('PRAGMA table_info(product_variants)').all().map((c) => c.name);
  for (const c of ['nfshop_package_id', 'nfshop_kind', 'nfshop_valid_days']) assert.ok(cols.includes(c), c);
  const ledger = db.prepare('PRAGMA table_info(nfshop_orders)').all().map((c) => c.name);
  for (const c of ['tma_order_id', 'user_id', 'variant_id', 'nfshop_package_id', 'nfshop_order_id', 'public_id', 'kind', 'action']) {
    assert.ok(ledger.includes(c), c);
  }
  const attempts = db.prepare('PRAGMA table_info(nfshop_fulfillment_attempts)').all().map((c) => c.name);
  for (const c of ['tma_order_id', 'attempts', 'last_error', 'gave_up', 'alerted_at']) assert.ok(attempts.includes(c), c);
});
