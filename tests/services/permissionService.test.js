const test = require('node:test');
const assert = require('node:assert');
const { resolvePerms, has, ROLE_PERMS } = require('../../src/services/permissionService');

test('super_admin has * wildcard', () => {
  assert.deepEqual(resolvePerms({ role: 'super_admin' }), ['*']);
  assert.equal(has({ role: 'super_admin' }, 'anything.you.want'), true);
});

test('manager has products/orders/stock but not dashboard/settings/admins', () => {
  const m = { role: 'manager' };
  assert.equal(has(m, 'products.write'), true);
  assert.equal(has(m, 'orders.read'), true);
  assert.equal(has(m, 'dashboard.read'), false);
  assert.equal(has(m, 'settings.write'), false);
  assert.equal(has(m, 'admins.write'), false);
});

test('permissions column overrides role defaults', () => {
  const a = { role: 'manager', permissions: JSON.stringify(['products.read']) };
  assert.deepEqual(resolvePerms(a), ['products.read']);
  assert.equal(has(a, 'products.read'), true);
  assert.equal(has(a, 'products.write'), false);
});

test('invalid JSON falls back to role defaults', () => {
  const broken = { role: 'manager', permissions: 'not json' };
  assert.deepEqual(resolvePerms(broken), ROLE_PERMS.manager);
});

test('null admin → empty perms', () => {
  assert.deepEqual(resolvePerms(null), []);
  assert.equal(has(null, 'anything'), false);
});
