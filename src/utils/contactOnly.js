function resolveContactOnly(product, variant = null) {
  const productContactOnly = Boolean(product?.contact_only ?? product?.contactOnly);
  if (!variant) return productContactOnly;

  const variantContactOnly = variant.contact_only ?? variant.contactOnly;
  return variantContactOnly == null ? productContactOnly : Boolean(variantContactOnly);
}

module.exports = { resolveContactOnly };
