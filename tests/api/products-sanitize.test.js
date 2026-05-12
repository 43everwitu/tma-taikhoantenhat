const test = require('node:test');
const assert = require('node:assert');
const { sanitizeProductForClient } = require('../../src/services/productService');

test('sanitizeProductForClient strips script and keeps p/h3', () => {
  const out = sanitizeProductForClient({
    id: '1', name: 'X',
    description: '<p>Ok</p><script>alert(1)</script>',
    longDescription: '<h3>Heading</h3><img src="/uploads/x.webp">',
  });
  assert.equal(out.description, '<p>Ok</p>');
  assert.ok(out.longDescription.includes('<h3>'));
  assert.ok(out.longDescription.includes('src="/uploads/x.webp"'));
});

test('sanitizeProductForClient preserves non-text fields', () => {
  const out = sanitizeProductForClient({ id: '7', name: 'A', price: 100, description: '<p>d</p>', longDescription: '' });
  assert.equal(out.id, '7');
  assert.equal(out.name, 'A');
  assert.equal(out.price, 100);
});
