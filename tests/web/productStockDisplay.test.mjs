import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findDefaultPurchasableVariant,
  getProductStockMode,
} from '../../web/src/lib/productStockDisplay.js';

test('stock thật được ưu tiên hiển thị trước chế độ đặt trước', () => {
  assert.equal(getProductStockMode({ stock: 3, isBackorder: true }), 'stock');
  assert.equal(getProductStockMode({ stock: 0, isBackorder: true }), 'backorder');
  assert.equal(getProductStockMode({ stock: 0, isBackorder: false }), 'out');
});

test('chế độ chỉ liên hệ được ưu tiên hơn trạng thái kho', () => {
  assert.equal(
    getProductStockMode({ stock: 3, isBackorder: true, contactOnly: true }),
    'contact',
  );
});

test('biến thể còn stock được chọn trước backorder hết stock', () => {
  const variants = [
    { id: 'backorder', stock: 0, isBackorder: true },
    { id: 'in-stock', stock: 2, isBackorder: false },
  ];

  assert.equal(findDefaultPurchasableVariant(variants)?.id, 'in-stock');
  assert.equal(
    findDefaultPurchasableVariant([{ id: 'backorder', stock: 0, isBackorder: true }])?.id,
    'backorder',
  );
});
