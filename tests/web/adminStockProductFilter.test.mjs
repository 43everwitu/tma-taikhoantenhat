import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterAdminStockProductOptions,
  normalizeAdminStockFilterText,
} from '../../web/src/lib/adminStockProductFilter.ts';

const products = [
  {
    id: '1',
    name: 'Nâng cấp Yousician chính chủ',
    category: 'Học tập',
    slug: 'nang-cap-yousician',
    variantOptions: [
      { id: '11', name: 'Premium 12 tháng' },
    ],
  },
  {
    id: '2',
    name: 'Notion Plus/Business',
    category: 'Năng suất',
    slug: 'notion-plus-business',
    variantOptions: [
      { id: '21', name: 'Business Có AI 1 tháng' },
      { id: '22', name: 'Plus 1 tháng' },
    ],
  },
  {
    id: '3',
    name: 'Bộ công cụ văn phòng',
    category: 'Notion',
    slug: 'bo-cong-cu',
    variantOptions: [],
  },
];

test('chuẩn hóa chữ tiếng Việt và ký tự phân cách', () => {
  assert.equal(
    normalizeAdminStockFilterText('  Nâng cấp / Chính chủ  '),
    'nang cap chinh chu',
  );
});

test('tìm tên sản phẩm bằng chuỗi không dấu', () => {
  const results = filterAdminStockProductOptions(products, 'nang cap yousician');

  assert.equal(results[0]?.kind, 'product');
  assert.equal(results[0]?.productId, '1');
});

test('tìm trực tiếp bằng một phần tên biến thể', () => {
  const results = filterAdminStockProductOptions(products, 'co ai');

  assert.equal(results[0]?.kind, 'variant');
  assert.equal(results[0]?.variantId, '21');
});

test('ưu tiên khớp tên sản phẩm trước category', () => {
  const results = filterAdminStockProductOptions(products, 'notion');

  assert.equal(results[0]?.productId, '2');
  assert.equal(results[0]?.kind, 'product');
  assert.ok(results.findIndex((item) => item.productId === '3') > 0);
});

test('query rỗng chỉ trả option sản phẩm', () => {
  const results = filterAdminStockProductOptions(products, '');

  assert.deepStrictEqual(results.map((item) => item.kind), ['product', 'product', 'product']);
});

test('mọi token phải xuất hiện trong option', () => {
  const results = filterAdminStockProductOptions(products, 'notion ai');

  assert.equal(results.some((item) => item.variantId === '21'), true);
  assert.equal(results.some((item) => item.productId === '3'), false);
});

test('nhãn gộp đang chọn ưu tiên đúng biến thể khi mở lại combobox', () => {
  const results = filterAdminStockProductOptions(
    products,
    'Notion Plus/Business · Business Có AI 1 tháng',
  );

  assert.equal(results[0]?.kind, 'variant');
  assert.equal(results[0]?.variantId, '21');
});
