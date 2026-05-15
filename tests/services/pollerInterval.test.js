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
