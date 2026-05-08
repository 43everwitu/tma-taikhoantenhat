const test = require('node:test');
const assert = require('node:assert');
const { resolveProductImagePaths } = require('../../scripts/wp-migration/extract-images');

test('resolves product → uploads file path via _thumbnail_id and _wp_attached_file', () => {
  const productRows = [
    { wp_post_id: 100, wp_thumbnail_id: 500 },
    { wp_post_id: 101, wp_thumbnail_id: null },
    { wp_post_id: 102, wp_thumbnail_id: 999 }, // attachment missing _wp_attached_file
  ];
  const meta = [
    { post_id: 500, meta_key: '_wp_attached_file', meta_value: '2024/05/cover.png' },
  ];
  const out = resolveProductImagePaths({ productRows, meta });
  assert.deepStrictEqual(out, new Map([[100, '2024/05/cover.png']]));
});
