const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const scriptPath = require.resolve('../../scripts/backfill-renewal-logs');
const servicePath = require.resolve('../../src/services/renewalReminderLogService');
const standardDatabasePath = require.resolve('../../src/database');

function freshScript() {
  delete require.cache[scriptPath];
  return require(scriptPath);
}

function freshService() {
  delete require.cache[servicePath];
  return require(servicePath);
}

function createTempDir(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renewal-backfill-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  return tempDir;
}

function createLegacyDatabase(t) {
  const tempDir = createTempDir(t);
  const sourcePath = path.join(tempDir, 'shop.db');
  const database = new Database(sourcePath);
  t.after(() => {
    if (database.open) database.close();
  });

  database.exec(`
    CREATE TABLE users (
      telegram_id INTEGER PRIMARY KEY,
      full_name TEXT
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE stock (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL,
      sold_to INTEGER NOT NULL,
      sold_at TEXT,
      duration_days INTEGER,
      reminder_sent_at TEXT
    );
    CREATE TABLE renewal_reminder_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER,
      order_id INTEGER,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      expiry_date TEXT,
      days_before_expiry INTEGER,
      telegram_sent INTEGER DEFAULT 0,
      web_notification_id INTEGER,
      status TEXT NOT NULL,
      error_message TEXT,
      message_body TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  database.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(
    898000001,
    'Backfill Renewal User',
  );
  database.prepare('INSERT INTO products (id, name) VALUES (?, ?)').run(
    41,
    'Backfill Renewal Product',
  );
  database.prepare(`
    INSERT INTO stock (
      id,
      product_id,
      sold_to,
      sold_at,
      duration_days,
      reminder_sent_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    71,
    41,
    898000001,
    '2026-05-21 02:00:00',
    30,
    '2026-06-20 02:00:00',
  );

  return { database, sourcePath, tempDir };
}

async function withoutStandardDatabase(run) {
  const originalLoad = Module._load;
  delete require.cache[servicePath];
  delete require.cache[standardDatabasePath];
  Module._load = function guardedLoad(request, parent, isMain) {
    if (
      request === '../database'
      && parent
      && parent.filename === servicePath
    ) {
      throw new Error('standard database must not be loaded');
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return await run();
  } finally {
    Module._load = originalLoad;
    delete require.cache[servicePath];
    delete require.cache[standardDatabasePath];
  }
}

test('service can be imported without loading the standard database', async () => {
  await withoutStandardDatabase(() => {
    const service = freshService();
    assert.strictEqual(typeof service.findMissingLegacyLogs, 'function');
  });
});

test('WAL-safe backup contains committed schema and row still present in WAL', async (t) => {
  const tempDir = createTempDir(t);
  const sourcePath = path.join(tempDir, 'shop.db');
  const destinationPath = path.join(tempDir, 'shop.db.backup');
  const source = new Database(sourcePath);
  t.after(() => {
    if (source.open) source.close();
  });

  source.pragma('journal_mode = WAL');
  source.pragma('wal_autocheckpoint = 0');
  source.exec('CREATE TABLE baseline (id INTEGER PRIMARY KEY)');
  source.pragma('wal_checkpoint(TRUNCATE)');
  source.exec(`
    CREATE TABLE wal_only (
      id INTEGER PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT INTO wal_only (id, value) VALUES (1, 'committed in WAL');
  `);

  assert.ok(fs.statSync(`${sourcePath}-wal`).size > 0);

  const { createBackup } = freshScript();
  const backupPath = await createBackup({ sourcePath, destinationPath });
  const restored = new Database(backupPath, { readonly: true });
  t.after(() => restored.close());

  assert.deepStrictEqual(
    restored.prepare('SELECT id, value FROM wal_only').get(),
    { id: 1, value: 'committed in WAL' },
  );
});

test('dry-run uses an injected read-only DB, creates no log, and creates no backup', async (t) => {
  const { database, sourcePath, tempDir } = createLegacyDatabase(t);
  database.close();
  const output = [];

  await withoutStandardDatabase(async () => {
    const { run } = freshScript();
    const result = await run({
      apply: false,
      sourcePath,
      limit: 1,
      createBackupFn: async () => {
        throw new Error('dry-run must not create a backup');
      },
      loadService: () => {
        const service = freshService();
        return {
          backfillMissingLegacyLogs(options) {
            assert.strictEqual(options.database.readonly, true);
            return service.backfillMissingLegacyLogs(options);
          },
        };
      },
      log: (message) => output.push(message),
    });

    assert.strictEqual(result.scanned, 1);
    assert.strictEqual(result.created, 0);
  });

  const check = new Database(sourcePath, { readonly: true });
  t.after(() => check.close());
  assert.strictEqual(
    check.prepare('SELECT COUNT(*) AS count FROM renewal_reminder_logs').get().count,
    0,
  );
  assert.deepStrictEqual(
    fs.readdirSync(tempDir).filter((name) => name.includes('.bak-pre-renewal-log-backfill-')),
    [],
  );
  assert.match(output.join('\n'), /another batch may remain/i);
});

test('apply helper creates exact legacy fields once and remains idempotent', async (t) => {
  const { database } = createLegacyDatabase(t);
  await withoutStandardDatabase(() => {
    const service = freshService();

    const first = service.backfillMissingLegacyLogs({
      apply: true,
      limit: 1000,
      database,
    });
    const row = database.prepare(`
      SELECT *
      FROM renewal_reminder_logs
      WHERE stock_id = ?
    `).get(71);

    assert.strictEqual(first.scanned, 1);
    assert.strictEqual(first.created, 1);
    assert.strictEqual(row.status, 'sent_legacy');
    assert.strictEqual(row.telegram_sent, 1);
    assert.strictEqual(row.created_at, '2026-06-20 02:00:00');
    assert.strictEqual(row.expiry_date, '2026-06-20');
    assert.strictEqual(row.user_id, 898000001);
    assert.strictEqual(row.product_id, 41);
    assert.strictEqual(row.product_name, 'Backfill Renewal Product');
    assert.strictEqual(row.order_id, null);
    assert.strictEqual(row.web_notification_id, null);
    assert.strictEqual(row.days_before_expiry, null);
    assert.strictEqual(row.error_message, null);
    assert.strictEqual(row.message_body, null);

    const second = service.backfillMissingLegacyLogs({
      apply: true,
      limit: 1000,
      database,
    });
    const total = database.prepare(`
      SELECT COUNT(*) AS count
      FROM renewal_reminder_logs
      WHERE stock_id = ?
    `).get(71).count;

    assert.strictEqual(second.scanned, 0);
    assert.strictEqual(second.created, 0);
    assert.strictEqual(total, 1);
  });
});

test('backup failure prevents loading the service and applying changes', async (t) => {
  const { database, sourcePath } = createLegacyDatabase(t);
  database.close();
  let serviceLoaded = false;

  const { run } = freshScript();
  await assert.rejects(
    run({
      apply: true,
      sourcePath,
      createBackupFn: async () => {
        throw new Error('backup failed');
      },
      loadService: () => {
        serviceLoaded = true;
        return {
          backfillMissingLegacyLogs() {
            throw new Error('apply must not run');
          },
        };
      },
      log: () => {},
    }),
    /backup failed/,
  );

  assert.strictEqual(serviceLoaded, false);
});
