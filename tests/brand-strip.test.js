const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function grepMatches(pattern) {
  const cmd = `grep -rIni "${pattern}" \
    --include="*.js" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.css" --include="*.html" --include="*.svg" \
    --exclude="package-lock.json" \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=docs --exclude-dir=tests \
    "${ROOT}" || true`;
  const out = execSync(cmd, { encoding: 'utf8' });
  return out.trim() ? out.trim().split('\n') : [];
}

test('no Starizzi brand strings outside docs', () => {
  const matches = grepMatches('starizzi');
  assert.strictEqual(matches.length, 0, `unexpected matches:\n${matches.join('\n')}`);
});

test('no Auto-chan brand strings outside docs', () => {
  const matches = grepMatches('auto.\\?chan');
  assert.strictEqual(matches.length, 0, `unexpected matches:\n${matches.join('\n')}`);
});
