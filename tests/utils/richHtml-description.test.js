const test = require('node:test');
const assert = require('node:assert');
const { sanitizeDescription, sanitizeRich } = require('../../src/utils/richHtml');

test('sanitizeDescription keeps paragraphs and headings', () => {
  const html = '<p>Hello <b>world</b></p><h3>Section</h3>';
  assert.equal(sanitizeDescription(html), '<p>Hello <b>world</b></p><h3>Section</h3>');
});

test('sanitizeDescription keeps img with src and alt', () => {
  const html = '<img src="/uploads/products-inline/abc.webp" alt="Demo" width="800" height="600">';
  const out = sanitizeDescription(html);
  assert.ok(out.includes('src="/uploads/products-inline/abc.webp"'));
  assert.ok(out.includes('alt="Demo"'));
});

test('sanitizeDescription strips script and iframe', () => {
  const html = '<p>ok</p><script>alert(1)</script><iframe src="x"></iframe>';
  assert.equal(sanitizeDescription(html), '<p>ok</p>');
});

test('sanitizeDescription keeps lists and links', () => {
  const html = '<ul><li>One <a href="https://example.com">link</a></li><li>Two</li></ul>';
  const out = sanitizeDescription(html);
  assert.ok(out.includes('<ul>'));
  assert.ok(out.includes('<li>'));
  assert.ok(out.includes('href="https://example.com"'));
});

test('sanitizeDescription drops empty string and null', () => {
  assert.equal(sanitizeDescription(''), '');
  assert.equal(sanitizeDescription(null), '');
  assert.equal(sanitizeDescription(undefined), '');
});

test('sanitizeRich is untouched — bot allow-list still narrow', () => {
  const html = '<p>removed</p><b>kept</b>';
  assert.equal(sanitizeRich(html), 'removed<b>kept</b>');
});
