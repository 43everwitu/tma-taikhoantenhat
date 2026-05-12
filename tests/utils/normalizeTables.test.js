const test = require('node:test');
const assert = require('node:assert');
const { normalizeTables } = require('../../src/utils/normalizeTables');

test('passthrough — fully-formed table unchanged', () => {
  const html = '<table><tr><td>a</td></tr></table>';
  assert.equal(normalizeTables(html), html);
});

test('wraps orphan <tr> run in <table><tbody>', () => {
  const html = 'Before <tr><td>1</td></tr><tr><td>2</td></tr> after';
  const out = normalizeTables(html);
  assert.ok(out.includes('<table><tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table>'));
  assert.ok(!out.match(/<tr>(?![\s\S]*<\/?table)/));
});

test('does not double-wrap when already in table', () => {
  const html = '<table><tbody><tr><td>x</td></tr></tbody></table>';
  assert.equal(normalizeTables(html), html);
});

test('strips empty <p></p> between rows in a table', () => {
  const html = '<table><tr><td>1</td></tr><p></p><tr><td>2</td></tr></table>';
  const out = normalizeTables(html);
  assert.ok(!out.includes('<p></p>'));
  assert.ok(out.includes('<tr><td>1</td></tr><tr><td>2</td></tr>'));
});

test('strips whitespace-only <p> </p> between rows', () => {
  const html = '<table><tr><td>1</td></tr><p>   </p><tr><td>2</td></tr></table>';
  const out = normalizeTables(html);
  assert.ok(!out.match(/<p>\s*<\/p>/));
});

test('null/empty input', () => {
  assert.equal(normalizeTables(null), '');
  assert.equal(normalizeTables(''), '');
  assert.equal(normalizeTables(undefined), '');
});
