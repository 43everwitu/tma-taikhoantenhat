const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const auditService = require('../../src/services/auditService');

function seedAudit(rows) {
  const stmt = db.prepare(`
    INSERT INTO audit_log (admin_id, action, entity_type, entity_id, details, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const ids = [];
  for (const r of rows) {
    const info = stmt.run(r.admin_id, r.action, r.entity_type, r.entity_id, r.details, r.ip_address, r.created_at);
    ids.push(info.lastInsertRowid);
  }
  return ids;
}

function cleanup(ids) {
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM audit_log WHERE id IN (${ph})`).run(...ids);
}

test('getRecent: from/to filter narrows by created_at range', () => {
  const tag = 'audittest_' + Math.floor(Math.random() * 1e9);
  const ids = seedAudit([
    { admin_id: 1, action: tag,            entity_type: 'order', entity_id: 1, details: null, ip_address: null, created_at: '2026-05-15 10:00:00' },
    { admin_id: 1, action: tag,            entity_type: 'order', entity_id: 2, details: null, ip_address: null, created_at: '2026-05-18 10:00:00' },
    { admin_id: 1, action: tag,            entity_type: 'order', entity_id: 3, details: null, ip_address: null, created_at: '2026-05-20 10:00:00' },
  ]);

  try {
    const all = auditService.getRecent(100, 0, { action: tag });
    assert.strictEqual(all.total, 3);

    const ranged = auditService.getRecent(100, 0, {
      action: tag,
      from: '2026-05-17 00:00:00',
      to:   '2026-05-19 23:59:59',
    });
    assert.strictEqual(ranged.total, 1);
    assert.strictEqual(ranged.rows[0].entity_id, 2);

    const onlyFrom = auditService.getRecent(100, 0, { action: tag, from: '2026-05-19 00:00:00' });
    assert.strictEqual(onlyFrom.total, 1);
    assert.strictEqual(onlyFrom.rows[0].entity_id, 3);

    const onlyTo = auditService.getRecent(100, 0, { action: tag, to: '2026-05-16 00:00:00' });
    assert.strictEqual(onlyTo.total, 1);
    assert.strictEqual(onlyTo.rows[0].entity_id, 1);
  } finally {
    cleanup(ids);
  }
});

test('getRecent: q filter matches action and details substring', () => {
  const tag = 'qtest_' + Math.floor(Math.random() * 1e9);
  const ids = seedAudit([
    { admin_id: 1, action: tag + '.create', entity_type: 'product', entity_id: 1, details: '{"name":"alpha"}', ip_address: null, created_at: '2026-05-20 10:00:00' },
    { admin_id: 1, action: tag + '.update', entity_type: 'product', entity_id: 2, details: '{"name":"beta"}',  ip_address: null, created_at: '2026-05-20 10:00:00' },
    { admin_id: 1, action: 'other_' + Math.random(), entity_type: 'product', entity_id: 3, details: '{"name":"alpha pattern"}', ip_address: null, created_at: '2026-05-20 10:00:00' },
  ]);

  try {
    const hits = auditService.getRecent(100, 0, { q: 'alpha' });
    // Should match: row 1 (details has "alpha") + row 3 (details has "alpha pattern").
    const hitIds = new Set(hits.rows.map(r => r.id));
    assert.ok(hitIds.has(ids[0]), 'row with alpha in details');
    assert.ok(hitIds.has(ids[2]), 'row with alpha pattern in details');
    assert.ok(!hitIds.has(ids[1]), 'row with beta in details should not match');

    const actionHits = auditService.getRecent(100, 0, { q: tag });
    const actionIds = new Set(actionHits.rows.map(r => r.id));
    assert.ok(actionIds.has(ids[0]) && actionIds.has(ids[1]));
    assert.ok(!actionIds.has(ids[2]));
  } finally {
    cleanup(ids);
  }
});

test('getEntityTypes: returns sorted distinct non-null values', () => {
  const tag = 'etypes_' + Math.floor(Math.random() * 1e9);
  const ids = seedAudit([
    { admin_id: 1, action: tag, entity_type: 'zeta',  entity_id: 1, details: null, ip_address: null, created_at: '2026-05-20 10:00:00' },
    { admin_id: 1, action: tag, entity_type: 'alpha', entity_id: 1, details: null, ip_address: null, created_at: '2026-05-20 10:00:00' },
    { admin_id: 1, action: tag, entity_type: 'alpha', entity_id: 2, details: null, ip_address: null, created_at: '2026-05-20 10:00:00' },
    { admin_id: 1, action: tag, entity_type: null,    entity_id: 3, details: null, ip_address: null, created_at: '2026-05-20 10:00:00' },
  ]);

  try {
    const types = auditService.getEntityTypes();
    assert.ok(Array.isArray(types));
    const idx = types.indexOf('alpha');
    const idy = types.indexOf('zeta');
    assert.ok(idx !== -1, 'alpha present');
    assert.ok(idy !== -1, 'zeta present');
    assert.ok(idx < idy, 'alpha sorted before zeta');
    assert.ok(!types.includes(null), 'no nulls');
  } finally {
    cleanup(ids);
  }
});

test('log: auto-fills details.entityLabel for known entity types when row exists', () => {
  const slug = 'audit-label-' + Math.floor(Math.random() * 1e9);
  const catInfo = db.prepare("INSERT INTO categories (name, slug) VALUES (?, ?)").run('Auto Label Cat', slug);
  const productInfo = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, 'Auto Label Product', ?, 1000, 1)
  `).run(catInfo.lastInsertRowid, 'p-' + slug);
  const productId = productInfo.lastInsertRowid;

  try {
    auditService.log(1, 'product.test_update', 'product', productId, { foo: 'bar' }, '::1');
    const row = db.prepare("SELECT details FROM audit_log WHERE action = 'product.test_update' ORDER BY id DESC LIMIT 1").get();
    assert.ok(row, 'audit row created');
    const parsed = JSON.parse(row.details);
    assert.strictEqual(parsed.entityLabel, 'Auto Label Product');
    assert.strictEqual(parsed.foo, 'bar', 'existing details fields preserved');
  } finally {
    db.prepare("DELETE FROM audit_log WHERE action = 'product.test_update'").run();
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(catInfo.lastInsertRowid);
  }
});

test('log: leaves details.entityLabel alone when caller already supplied it', () => {
  const slug = 'audit-label-noop-' + Math.floor(Math.random() * 1e9);
  const catInfo = db.prepare("INSERT INTO categories (name, slug) VALUES (?, ?)").run('Untouched Cat', slug);
  const productInfo = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, 'Real Name', ?, 1000, 1)
  `).run(catInfo.lastInsertRowid, 'p-' + slug);
  const productId = productInfo.lastInsertRowid;

  try {
    auditService.log(1, 'product.test_pre', 'product', productId, { entityLabel: 'Snapshot Before Delete', extra: 1 }, '::1');
    const row = db.prepare("SELECT details FROM audit_log WHERE action = 'product.test_pre' ORDER BY id DESC LIMIT 1").get();
    const parsed = JSON.parse(row.details);
    assert.strictEqual(parsed.entityLabel, 'Snapshot Before Delete', 'caller value preserved, not overwritten by SELECT');
    assert.strictEqual(parsed.extra, 1);
  } finally {
    db.prepare("DELETE FROM audit_log WHERE action = 'product.test_pre'").run();
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(catInfo.lastInsertRowid);
  }
});

test('log: silently no-ops enrichment when entity row is missing or entityType unknown', () => {
  try {
    auditService.log(1, 'misc.action', 'unmapped_type', 99999, { keep: true }, '::1');
    auditService.log(1, 'product.test_missing', 'product', 9999999, { keep: true }, '::1');

    const r1 = JSON.parse(db.prepare("SELECT details FROM audit_log WHERE action = 'misc.action' ORDER BY id DESC LIMIT 1").get().details);
    assert.strictEqual(r1.entityLabel, undefined, 'no enrichment for unknown type');
    assert.strictEqual(r1.keep, true);

    const r2 = JSON.parse(db.prepare("SELECT details FROM audit_log WHERE action = 'product.test_missing' ORDER BY id DESC LIMIT 1").get().details);
    assert.strictEqual(r2.entityLabel, undefined, 'no enrichment when product row missing');
    assert.strictEqual(r2.keep, true);
  } finally {
    db.prepare("DELETE FROM audit_log WHERE action IN ('misc.action','product.test_missing')").run();
  }
});
