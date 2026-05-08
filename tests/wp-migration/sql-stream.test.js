const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const { streamInserts } = require('../../scripts/wp-migration/sql-stream');

function fromString(s) {
  return Readable.from(Buffer.from(s, 'utf8'));
}

test('extracts a single-line INSERT', async () => {
  const sql = "INSERT INTO `AGJiSNzCU_terms` (`term_id`, `name`, `slug`, `term_group`) VALUES (1, 'Cat A', 'cat-a', 0), (2, 'Cat B', 'cat-b', 0);\n";
  const out = [];
  for await (const stmt of streamInserts(fromString(sql), new Set(['AGJiSNzCU_terms']))) {
    out.push(stmt);
  }
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].table, 'AGJiSNzCU_terms');
  assert.deepStrictEqual(out[0].columns, ['term_id', 'name', 'slug', 'term_group']);
  assert.strictEqual(out[0].rows.length, 2);
  assert.deepStrictEqual(out[0].rows[0], [1, 'Cat A', 'cat-a', 0]);
  assert.deepStrictEqual(out[0].rows[1], [2, 'Cat B', 'cat-b', 0]);
});

test('handles escaped quotes and commas inside strings', async () => {
  const sql = "INSERT INTO `AGJiSNzCU_terms` (`name`) VALUES ('it\\'s, fine'), ('plain');\n";
  const out = [];
  for await (const stmt of streamInserts(fromString(sql), new Set(['AGJiSNzCU_terms']))) {
    out.push(stmt);
  }
  assert.deepStrictEqual(out[0].rows, [["it's, fine"], ['plain']]);
});

test('handles multi-line INSERT split across chunks', async () => {
  const sql = "INSERT INTO `AGJiSNzCU_terms` (`name`) VALUES\n  ('a'),\n  ('b');\n";
  const out = [];
  for await (const stmt of streamInserts(fromString(sql), new Set(['AGJiSNzCU_terms']))) {
    out.push(stmt);
  }
  assert.deepStrictEqual(out[0].rows, [['a'], ['b']]);
});

test('skips tables not in the allowlist', async () => {
  const sql = "INSERT INTO `wp_skipme` (`x`) VALUES (1);\nINSERT INTO `AGJiSNzCU_terms` (`name`) VALUES ('keep');\n";
  const out = [];
  for await (const stmt of streamInserts(fromString(sql), new Set(['AGJiSNzCU_terms']))) {
    out.push(stmt);
  }
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].rows[0][0], 'keep');
});

test('parses NULL as JS null', async () => {
  const sql = "INSERT INTO `AGJiSNzCU_terms` (`name`) VALUES (NULL), ('x');\n";
  const out = [];
  for await (const stmt of streamInserts(fromString(sql), new Set(['AGJiSNzCU_terms']))) {
    out.push(stmt);
  }
  assert.strictEqual(out[0].rows[0][0], null);
  assert.strictEqual(out[0].rows[1][0], 'x');
});
