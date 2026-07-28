import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const componentUrl = new URL(
  '../../web/src/app/(admin)/admin/stock/keys/ProductVariantFilterCombobox.tsx',
  import.meta.url,
);
const pageUrl = new URL(
  '../../web/src/app/(admin)/admin/stock/keys/page.tsx',
  import.meta.url,
);

test('combobox sản phẩm có contract tìm kiếm và bàn phím truy cập được', () => {
  assert.equal(existsSync(componentUrl), true, 'ProductVariantFilterCombobox chưa tồn tại');
  const source = readFileSync(componentUrl, 'utf8');

  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-autocomplete="list"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /Escape/);
  assert.match(source, /filterAdminStockProductOptions/);
});

test('trang stock keys dùng combobox để cập nhật đồng thời product và variant filter', () => {
  const source = readFileSync(pageUrl, 'utf8');

  assert.match(source, /<ProductVariantFilterCombobox/);
  assert.match(source, /setProductId\(next\.productId\)/);
  assert.match(source, /setVariantId\(next\.variantId\)/);
  assert.doesNotMatch(source, /<option value="">Tất cả sản phẩm<\/option>/);
});
