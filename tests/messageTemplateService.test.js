const assert = require('node:assert');
const test = require('node:test');
const messageTemplateService = require('../src/services/messageTemplateService');

test('render substitutes variables', () => {
  const out = messageTemplateService.render('order_created', {
    orderCode: 'PNS123456',
    productName: 'ChatGPT Plus',
    quantity: 1,
    total: '500.000',
    expiryMinutes: 10,
  });
  assert.match(out, /PNS123456/);
  assert.match(out, /ChatGPT Plus/);
  assert.match(out, /500\.000/);
});

test('render leaves no curly placeholders for known templates', () => {
  const out = messageTemplateService.render('welcome', { name: 'taro', username: 'taro', balance: '0' });
  assert.ok(!out.includes('{{'), 'expected no leftover {{ in output');
  assert.ok(!out.includes('}}'), 'expected no leftover }} in output');
});

test('render returns empty string for unknown vars (does not throw)', () => {
  const out = messageTemplateService.render('welcome', { name: 'taro' });
  assert.ok(typeof out === 'string');
  assert.ok(out.length > 0);
});

test('list returns all seeded templates with parsed variables', () => {
  const all = messageTemplateService.list();
  assert.ok(all.length >= 18, `expected at least 18 templates, got ${all.length}`);
  const welcome = all.find((t) => t.key === 'welcome');
  assert.ok(welcome);
  assert.ok(Array.isArray(welcome.variables));
  assert.ok(welcome.variables.includes('name'));
});

test('update + reset cycle works and bumps cache', () => {
  const before = messageTemplateService.render('welcome', { name: 'x', username: 'x', balance: '0' });
  messageTemplateService.update('welcome', 'OVERRIDE {{name}}');
  const overridden = messageTemplateService.render('welcome', { name: 'taro' });
  assert.strictEqual(overridden, 'OVERRIDE taro');
  messageTemplateService.reset('welcome');
  const restored = messageTemplateService.render('welcome', { name: 'x', username: 'x', balance: '0' });
  assert.strictEqual(restored, before);
});

test('render throws for unknown template key', () => {
  assert.throws(() => messageTemplateService.render('does_not_exist', {}), /Unknown message template/);
});
