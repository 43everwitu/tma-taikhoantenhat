const test = require('node:test');
const assert = require('node:assert');
const { sanitizeDescription } = require('../../src/utils/richHtml');

test('preserves a complete table', () => {
  const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
  const out = sanitizeDescription(html);
  assert.ok(out.includes('<table>'));
  assert.ok(out.includes('<thead>'));
  assert.ok(out.includes('<th>A</th>'));
  assert.ok(out.includes('<tbody>'));
  assert.ok(out.includes('<td>1</td>'));
});

test('keeps colspan/rowspan/scope/align attributes', () => {
  const html = '<table><tr><th scope="col" align="left">H</th></tr><tr><td colspan="2" rowspan="3">x</td></tr></table>';
  const out = sanitizeDescription(html);
  assert.ok(out.includes('scope="col"'));
  assert.ok(out.includes('align="left"'));
  assert.ok(out.includes('colspan="2"'));
  assert.ok(out.includes('rowspan="3"'));
});

test('drops style + onclick on td', () => {
  const html = '<table><tr><td style="color:red" onclick="alert(1)">x</td></tr></table>';
  const out = sanitizeDescription(html);
  assert.ok(out.includes('<td>x</td>'));
  assert.ok(!out.includes('style='));
  assert.ok(!out.includes('onclick='));
});

test('keeps caption + colgroup + col', () => {
  const html = '<table><caption>Pricing</caption><colgroup><col><col></colgroup><tr><td>a</td><td>b</td></tr></table>';
  const out = sanitizeDescription(html);
  assert.ok(out.includes('<caption>Pricing</caption>'));
  assert.ok(out.includes('<colgroup>'));
});
