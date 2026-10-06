function formatPriceShort(amount) {
  return `${Math.round(Number(amount || 0)).toLocaleString('vi-VN')}đ`;
}

function getProductDisplayPrice(product) {
  const price = Number(product.price || 0);
  const priceMin = product.priceMin ?? price;
  const priceMax = product.priceMax ?? priceMin;
  const salePriceMin = product.salePriceMin ?? product.salePrice ?? priceMin;
  const salePriceMax = product.salePriceMax ?? product.salePrice ?? priceMax;
  const hasRange = priceMin !== priceMax;
  const hasDiscount = hasRange
    ? salePriceMin < priceMin || salePriceMax < priceMax
    : typeof product.salePrice === 'number' && product.salePrice < price;

  const current = hasRange
    ? `${formatPriceShort(hasDiscount ? salePriceMin : priceMin)} – ${formatPriceShort(hasDiscount ? salePriceMax : priceMax)}`
    : formatPriceShort(hasDiscount ? product.salePrice : price);
  const original = hasDiscount
    ? (hasRange ? `${formatPriceShort(priceMin)} – ${formatPriceShort(priceMax)}` : formatPriceShort(price))
    : '';

  return { current, original, hasRange, hasDiscount };
}

exports.formatPriceShort = formatPriceShort;
exports.getProductDisplayPrice = getProductDisplayPrice;
