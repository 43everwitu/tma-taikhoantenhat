const assert = require('node:assert');
const test = require('node:test');

const { getBackorderWaitMode } = require('../../src/utils/backorderWaitWindow');

test('getBackorderWaitMode uses after-hours before 09:00 GMT+7', () => {
  assert.strictEqual(
    getBackorderWaitMode(new Date('2026-06-13T01:59:00.000Z')),
    'after_hours',
  );
});

test('getBackorderWaitMode starts business hours at exactly 09:00 GMT+7', () => {
  assert.strictEqual(
    getBackorderWaitMode(new Date('2026-06-13T02:00:00.000Z')),
    'business_hours',
  );
});

test('getBackorderWaitMode keeps business hours through exactly 22:30 GMT+7', () => {
  assert.strictEqual(
    getBackorderWaitMode(new Date('2026-06-13T15:30:00.000Z')),
    'business_hours',
  );
});

test('getBackorderWaitMode switches to after-hours at 22:31 GMT+7', () => {
  assert.strictEqual(
    getBackorderWaitMode(new Date('2026-06-13T15:31:00.000Z')),
    'after_hours',
  );
});
