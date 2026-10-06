import assert from 'node:assert/strict';
import test from 'node:test';

import { getProductDisplayPrice } from '../../web/src/lib/productPriceDisplay.js';

test('formats variant price ranges with discounted min and max prices', () => {
  const display = getProductDisplayPrice({
    price: 149000,
    priceMin: 149000,
    priceMax: 349000,
    salePriceMin: 119000,
    salePriceMax: 319000,
  });

  assert.equal(display.current, '119.000đ – 319.000đ');
  assert.equal(display.original, '149.000đ – 349.000đ');
  assert.equal(display.hasRange, true);
  assert.equal(display.hasDiscount, true);
});

test('formats single non-discounted product price', () => {
  const display = getProductDisplayPrice({ price: 25000 });

  assert.equal(display.current, '25.000đ');
  assert.equal(display.original, '');
  assert.equal(display.hasRange, false);
  assert.equal(display.hasDiscount, false);
});
