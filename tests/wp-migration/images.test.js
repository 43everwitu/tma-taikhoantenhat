const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { processImage } = require('../../scripts/wp-migration/images');

test('processImage produces AVIF and WebP at original and thumb widths', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpimg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const srcPath = path.join(dir, 'src.png');
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .png().toFile(srcPath);

  const result = await processImage({
    srcPath,
    productId: 42,
    slug: 'red',
    outDir: dir,
    variants: [
      { name: 'original', width: 800, formats: ['avif', 'webp'] },
      { name: 'thumb',    width: 400, formats: ['avif', 'webp'] },
    ],
  });

  for (const v of ['42-red-original.avif', '42-red-original.webp', '42-red-thumb.avif', '42-red-thumb.webp']) {
    assert.ok(fs.existsSync(path.join(dir, v)), `missing ${v}`);
  }
  // Public URL chosen by processImage = the WebP original (universal fallback).
  assert.strictEqual(result.imageUrl, '/uploads/products/42-red-original.webp');
});
