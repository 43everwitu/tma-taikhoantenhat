function getProductStockMode({ stock = 0, isBackorder = false, contactOnly = false }) {
  if (contactOnly) return 'contact';
  if (Number(stock) > 0) return 'stock';
  if (isBackorder) return 'backorder';
  return 'out';
}

/**
 * @template {{ stock?: number, isBackorder?: boolean }} T
 * @param {T[]} variants
 * @returns {T | null}
 */
function findDefaultPurchasableVariant(variants) {
  return variants.find((variant) => Number(variant.stock) > 0)
    || variants.find((variant) => variant.isBackorder)
    || variants[0]
    || null;
}

exports.findDefaultPurchasableVariant = findDefaultPurchasableVariant;
exports.getProductStockMode = getProductStockMode;
