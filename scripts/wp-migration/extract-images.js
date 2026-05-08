function resolveProductImagePaths({ productRows, meta }) {
  const attachedFileByPostId = new Map();
  for (const m of meta) {
    if (m.meta_key === '_wp_attached_file' && m.meta_value) {
      attachedFileByPostId.set(Number(m.post_id), String(m.meta_value));
    }
  }
  const out = new Map();
  for (const p of productRows) {
    if (!p.wp_thumbnail_id) continue;
    const file = attachedFileByPostId.get(Number(p.wp_thumbnail_id));
    if (file) out.set(Number(p.wp_post_id), file);
  }
  return out;
}

module.exports = { resolveProductImagePaths };
