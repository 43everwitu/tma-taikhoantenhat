import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, '../../web/src/app/(admin)/admin/stock/keys/page.tsx');

test('/admin/stock/keys uses status-specific table columns', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /const columns = useMemo<Column<KeyRow>\[\]>\(\(\) =>/);
  assert.match(source, /if \(status === 'unsold'\)/);
  assert.match(source, /header: 'Thêm lúc'/);
  assert.match(source, /if \(status === 'sold'\)/);
  assert.match(source, /header: 'Đơn\/khách'/);
  assert.match(source, /header: 'Thời gian'/);
  assert.match(source, /header: 'Giao dịch'/);
});
