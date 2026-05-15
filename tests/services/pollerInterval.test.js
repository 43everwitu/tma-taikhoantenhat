const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function setInterval(seconds) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('payment_poll_interval_seconds', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(seconds));
}

function reload() {
  delete require.cache[require.resolve('../../src/services/pollerConfig')];
  return require('../../src/services/pollerConfig');
}

test('returns setting in ms when valid', () => {
  setInterval(15);
  assert.strictEqual(reload().getPollIntervalMs(), 15_000);
});

test('falls back to 30000ms when value < 5', () => {
  setInterval(0);
  assert.strictEqual(reload().getPollIntervalMs(), 30_000);
});

test('clamps to 120s upper bound', () => {
  setInterval(500);
  assert.strictEqual(reload().getPollIntervalMs(), 120_000);
});

test('cleanup', () => { setInterval(30); });

test('isAutoPaymentEnabled returns true when setting is "true"', () => {
  db.prepare("INSERT INTO settings (key,value) VALUES ('auto_payment_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
  delete require.cache[require.resolve('../../src/services/pollerConfig')];
  const { isAutoPaymentEnabled } = require('../../src/services/pollerConfig');
  assert.strictEqual(isAutoPaymentEnabled(false), true);
});

test('isAutoPaymentEnabled returns true when setting is "1"', () => {
  db.prepare("INSERT INTO settings (key,value) VALUES ('auto_payment_enabled','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  delete require.cache[require.resolve('../../src/services/pollerConfig')];
  const { isAutoPaymentEnabled } = require('../../src/services/pollerConfig');
  assert.strictEqual(isAutoPaymentEnabled(false), true);
});

test('isAutoPaymentEnabled returns false when setting is "false"', () => {
  db.prepare("INSERT INTO settings (key,value) VALUES ('auto_payment_enabled','false') ON CONFLICT(key) DO UPDATE SET value='false'").run();
  delete require.cache[require.resolve('../../src/services/pollerConfig')];
  const { isAutoPaymentEnabled } = require('../../src/services/pollerConfig');
  assert.strictEqual(isAutoPaymentEnabled(true), false);
});

test('isAutoPaymentEnabled falls back to env when row missing', () => {
  db.prepare("DELETE FROM settings WHERE key='auto_payment_enabled'").run();
  delete require.cache[require.resolve('../../src/services/pollerConfig')];
  const { isAutoPaymentEnabled } = require('../../src/services/pollerConfig');
  assert.strictEqual(isAutoPaymentEnabled(true), true);
  assert.strictEqual(isAutoPaymentEnabled(false), false);
  // restore for next runs
  db.prepare("INSERT INTO settings (key,value) VALUES ('auto_payment_enabled','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
});
