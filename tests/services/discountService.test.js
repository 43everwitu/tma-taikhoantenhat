const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE discount_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('percent','fixed')),
      amount INTEGER NOT NULL,
      max_discount INTEGER,
      min_order INTEGER DEFAULT 0,
      usage_limit INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      per_user_limit INTEGER,
      starts_at DATETIME,
      ends_at DATETIME,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_global INTEGER NOT NULL DEFAULT 0,
      notify_title TEXT,
      app_meta_mode TEXT NOT NULL DEFAULT 'auto',
      app_meta_text TEXT,
      app_message TEXT,
      bot_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      discount_code_id INTEGER,
      status TEXT
    );
  `);
  return db;
}

function loadServiceWithDb(db) {
  const dbPath = require.resolve('../../src/database');
  const servicePath = require.resolve('../../src/services/discountService');
  const oldDb = require.cache[dbPath];
  const oldService = require.cache[servicePath];

  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  delete require.cache[servicePath];
  const service = require('../../src/services/discountService');

  return {
    service,
    restore() {
      if (oldDb) require.cache[dbPath] = oldDb;
      else delete require.cache[dbPath];
      if (oldService) require.cache[servicePath] = oldService;
      else delete require.cache[servicePath];
    },
  };
}

test('findActiveGlobal returns currently valid global discount', () => {
  const db = makeDb();
  db.prepare(`
    INSERT INTO discount_codes (code, type, amount, is_global, app_message, bot_message)
    VALUES ('GLOBAL10', 'percent', 10, 1, 'Sale app', 'Sale bot')
  `).run();

  const { service, restore } = loadServiceWithDb(db);
  try {
    const global = service.findActiveGlobal();
    assert.equal(global.code, 'GLOBAL10');
    assert.equal(global.app_message, 'Sale app');
  } finally {
    restore();
  }
});

test('resolveBestForOrder chooses the larger discount between manual and global', () => {
  const db = makeDb();
  db.prepare(`
    INSERT INTO discount_codes (code, type, amount, is_global)
    VALUES ('GLOBAL10', 'percent', 10, 1)
  `).run();
  db.prepare(`
    INSERT INTO discount_codes (code, type, amount, is_global)
    VALUES ('MANUAL50K', 'fixed', 50000, 0)
  `).run();

  const { service, restore } = loadServiceWithDb(db);
  try {
    const best = service.resolveBestForOrder('MANUAL50K', 200000, 123);
    assert.equal(best.ok, true);
    assert.equal(best.code.code, 'MANUAL50K');
    assert.equal(best.discount, 50000);
  } finally {
    restore();
  }
});
