function titleCaseFromSlug(slug) {
  return String(slug || '').split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').trim();
}

function buildVariationRows({ variations, meta, wpPostIdToProductId }) {
  const byPost = new Map();
  for (const m of meta) {
    if (!byPost.has(m.post_id)) byPost.set(m.post_id, { attrs: [] });
    const slot = byPost.get(m.post_id);
    if (m.meta_key === '_price') slot.price = Number(m.meta_value);
    else if (m.meta_key === '_stock') slot.stock = Number(m.meta_value);
    else if (m.meta_key === '_thumbnail_id') slot.thumbnailId = Number(m.meta_value);
    else if (m.meta_key.startsWith('attribute_')) slot.attrs.push({ k: m.meta_key.replace(/^attribute_/, ''), v: String(m.meta_value || '') });
  }

  const out = [];
  for (const v of variations) {
    const productId = wpPostIdToProductId.get(v.post_parent);
    if (!productId) continue;
    const slot = byPost.get(v.ID) || { attrs: [] };
    if (!slot.price || slot.price <= 0) continue;

    const name = slot.attrs.length > 0
      ? slot.attrs.map((a) => titleCaseFromSlug(a.v)).filter(Boolean).join(' / ')
      : `Biến thể #${v.ID}`;

    out.push({
      wp_variation_id: v.ID,
      product_id: productId,
      name: name || `Biến thể ${v.ID}`,
      price: Math.round(slot.price),
      sort_order: v.menu_order,
      is_active: 1,
    });
  }
  return out;
}

function loadVariations(db, rows) {
  const insert = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?)
  `);
  let count = 0;
  const tx = db.transaction((rs) => {
    for (const r of rs) {
      insert.run(r.product_id, r.name, r.price, r.sort_order, r.is_active);
      count++;
    }
  });
  tx(rows);
  return count;
}

module.exports = { buildVariationRows, loadVariations };
