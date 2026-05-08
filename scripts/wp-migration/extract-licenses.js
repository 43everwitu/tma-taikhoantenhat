const fs = require('node:fs');
const { LMFWC_CSV_PATH } = require('./config');

/**
 * Parse the lmfwc CSV export. The plugin exports columns including:
 *   id, license_key, hash, product_id, status, expires_at, ...
 * Status codes: 1=ACTIVE, 2=INACTIVE, 3=SOLD, 4=DELIVERED.
 * We treat status=1 as "unsold and importable".
 */
function extractLicenses() {
  if (!fs.existsSync(LMFWC_CSV_PATH)) {
    throw new Error(
      `LMFWC export CSV not found at ${LMFWC_CSV_PATH}. ` +
      `Produce it via WP-admin → License Manager → Export, then re-run.`
    );
  }
  const text = fs.readFileSync(LMFWC_CSV_PATH, 'utf8');
  return parseCsv(text);
}

function parseCsv(text) {
  // Minimal RFC 4180-ish parser: handles quoted fields with escaped quotes.
  const lines = [];
  let i = 0, field = '', row = [], inQuote = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuote = false; i++; continue; }
      field += c; i++;
    } else {
      if (c === '"') { inQuote = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\n') { row.push(field); lines.push(row); row = []; field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      field += c; i++;
    }
  }
  if (field || row.length) { row.push(field); lines.push(row); }

  if (lines.length < 2) return [];
  const header = lines[0].map(h => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const out = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r];
    if (cols.length === 1 && cols[0] === '') continue;
    out.push({
      id: cols[idx('id')],
      license_key: cols[idx('license_key')] ?? cols[idx('key')] ?? '',
      wp_product_id: Number(cols[idx('product_id')]),
      status: cols[idx('status')],
    });
  }
  return out;
}

module.exports = { extractLicenses };
