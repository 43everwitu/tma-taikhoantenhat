const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

/**
 * Convert a single source image into all (variant, format) combinations.
 * Returns { imageUrl } — the canonical URL used in `products.image_url`,
 * which we set to the WebP original (broadest browser support).
 *
 * Skips any output that already exists with the same source mtime to make
 * re-runs fast without complicating the pipeline with content hashing.
 */
async function processImage({ srcPath, productId, slug, outDir, variants }) {
  fs.mkdirSync(outDir, { recursive: true });
  const baseName = `${productId}-${slug}`;
  const srcMtimeMs = fs.statSync(srcPath).mtimeMs;

  for (const v of variants) {
    for (const fmt of v.formats) {
      const out = path.join(outDir, `${baseName}-${v.name}.${fmt}`);
      if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= srcMtimeMs) continue;
      const pipeline = sharp(srcPath).resize({ width: v.width, withoutEnlargement: true });
      if (fmt === 'avif') pipeline.avif({ quality: 60 });
      else if (fmt === 'webp') pipeline.webp({ quality: 80 });
      else throw new Error(`Unsupported format ${fmt}`);
      await pipeline.toFile(out);
    }
  }

  return { imageUrl: `/uploads/products/${baseName}-original.webp` };
}

async function processAll({ items, outDir, variants, concurrency = 4 }) {
  const results = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      const it = items[i];
      try {
        const { imageUrl } = await processImage({
          srcPath: it.srcPath, productId: it.productId, slug: it.slug,
          outDir, variants,
        });
        results.set(it.productId, imageUrl);
      } catch (err) {
        results.set(it.productId, { error: err.message });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

module.exports = { processImage, processAll };
