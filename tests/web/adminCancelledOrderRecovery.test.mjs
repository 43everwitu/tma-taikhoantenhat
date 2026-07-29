import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../web/src/app/(admin)/admin/orders/page.tsx', import.meta.url),
  'utf8',
);

test('admin orders có mutation khôi phục cancelled về paid', () => {
  assert.match(source, /\/admin\/orders\/\$\{id\}\/restore/);
  assert.match(source, /\{\s*status:\s*'paid'\s*\}/);
});

test('đơn cancelled có action Khôi phục với hai hướng xử lý', () => {
  assert.match(source, /order\.status === 'cancelled'/);
  assert.match(source, />Khôi phục<\/button>/);
  assert.match(source, />Đang xử lý<\/button>/);
  assert.match(source, />Đã giao<\/button>/);
});

test('nhánh Đã giao mở modal giao thủ công thay vì đổi status trực tiếp', () => {
  assert.match(source, /setManualOrderId\(restoreOrderId\)/);
  assert.doesNotMatch(source, /\{\s*status:\s*'delivered'\s*\}/);
});
