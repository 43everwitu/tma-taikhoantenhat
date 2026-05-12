const test = require('node:test');
const assert = require('node:assert');
const { extractWpImageUrls, rewriteImageSrcs } = require('../../scripts/wp-migration/inline-images');

test('extractWpImageUrls finds taikhoantenhat.com uploads URLs', () => {
  const html = '<p>Hi</p><img src="https://taikhoantenhat.com/wp-content/uploads/2024/10/a.jpg" /><img src="/local/b.webp"><img src="https://taikhoantenhat.com/wp-content/uploads/2025/01/c.png" alt="c">';
  const urls = extractWpImageUrls(html);
  assert.deepEqual(urls, [
    'https://taikhoantenhat.com/wp-content/uploads/2024/10/a.jpg',
    'https://taikhoantenhat.com/wp-content/uploads/2025/01/c.png',
  ]);
});

test('extractWpImageUrls deduplicates', () => {
  const html = '<img src="https://taikhoantenhat.com/wp-content/uploads/x.jpg"><img src="https://taikhoantenhat.com/wp-content/uploads/x.jpg">';
  assert.deepEqual(extractWpImageUrls(html), ['https://taikhoantenhat.com/wp-content/uploads/x.jpg']);
});

test('extractWpImageUrls ignores non-wp-content URLs', () => {
  const html = '<img src="https://taikhoantenhat.com/some-page.jpg">';
  assert.deepEqual(extractWpImageUrls(html), []);
});

test('rewriteImageSrcs replaces according to map', () => {
  const html = 'Pre <img src="https://taikhoantenhat.com/wp-content/uploads/a.jpg" alt="A"> mid <img src="https://taikhoantenhat.com/wp-content/uploads/b.png" alt="B"> end';
  const map = new Map([
    ['https://taikhoantenhat.com/wp-content/uploads/a.jpg', '/uploads/products-inline/aaa.webp'],
    ['https://taikhoantenhat.com/wp-content/uploads/b.png', '/uploads/products-inline/bbb.webp'],
  ]);
  const out = rewriteImageSrcs(html, map);
  assert.ok(out.includes('src="/uploads/products-inline/aaa.webp"'));
  assert.ok(out.includes('src="/uploads/products-inline/bbb.webp"'));
  assert.ok(!out.includes('taikhoantenhat.com/wp-content'));
});

test('rewriteImageSrcs leaves unmapped URLs alone', () => {
  const html = '<img src="https://taikhoantenhat.com/wp-content/uploads/missing.jpg">';
  const out = rewriteImageSrcs(html, new Map());
  assert.equal(out, '<img src="https://taikhoantenhat.com/wp-content/uploads/missing.jpg">');
});
