const test = require('node:test');
const assert = require('node:assert');
const { stripWpShortcodes } = require('../../src/utils/wpShortcodes');

test('strips [caption ...] but keeps inner img', () => {
  const html = '[caption id="x" align="aligncenter" width="1024"]<img src="/a.jpg" alt="A" width="1024" height="682" /> Cap text[/caption]';
  const out = stripWpShortcodes(html);
  assert.equal(out, '<img src="/a.jpg" alt="A" width="1024" height="682" />');
});

test('drops [gallery ...] entirely', () => {
  const html = 'Before [gallery ids="1,2,3"] After';
  assert.equal(stripWpShortcodes(html), 'Before  After');
});

test('handles multiple captions in one string', () => {
  const html = '[caption id="1"]<img src="a.jpg" /> a[/caption] middle [caption id="2"]<img src="b.jpg" /> b[/caption]';
  const out = stripWpShortcodes(html);
  assert.ok(out.includes('<img src="a.jpg" />'));
  assert.ok(out.includes('<img src="b.jpg" />'));
  assert.ok(!out.includes('[caption'));
  assert.ok(!out.includes('[/caption]'));
});

test('preserves text when no shortcodes', () => {
  assert.equal(stripWpShortcodes('<p>Just html</p>'), '<p>Just html</p>');
});

test('handles null/empty', () => {
  assert.equal(stripWpShortcodes(''), '');
  assert.equal(stripWpShortcodes(null), '');
});
