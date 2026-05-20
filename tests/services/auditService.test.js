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
