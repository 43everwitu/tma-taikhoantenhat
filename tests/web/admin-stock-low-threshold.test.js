const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, '../../web/src/app/(admin)/admin/stock/page.tsx');

test('/admin/stock low filter uses effective low-stock threshold instead of hardcoded 5', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /effectiveLowStockThreshold\??:\s*number\s*\|\s*null/);
  assert.doesNotMatch(source, /statusFilter === 'low'[\s\S]*p\.stock\s*<=\s*5/);
  assert.match(source, /p\.stock\s*<=\s*\(p\.effectiveLowStockThreshold\s*\?\?\s*p\.lowStockThreshold\s*\?\?\s*0\)/);
});
