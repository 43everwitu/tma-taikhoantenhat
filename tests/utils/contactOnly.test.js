const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveContactOnly } = require('../../src/utils/contactOnly');

test('biến thể mặc định kế thừa trạng thái chỉ liên hệ của sản phẩm', () => {
  assert.equal(resolveContactOnly({ contact_only: 1 }, { contact_only: null }), true);
  assert.equal(resolveContactOnly({ contact_only: 0 }, { contact_only: null }), false);
});

test('biến thể có thể ghi đè sang bán trực tiếp hoặc chỉ liên hệ', () => {
  assert.equal(resolveContactOnly({ contact_only: 1 }, { contact_only: 0 }), false);
  assert.equal(resolveContactOnly({ contact_only: 0 }, { contact_only: 1 }), true);
});

test('sản phẩm không có biến thể dùng trực tiếp trạng thái sản phẩm', () => {
  assert.equal(resolveContactOnly({ contact_only: 1 }), true);
  assert.equal(resolveContactOnly({ contact_only: 0 }), false);
});
