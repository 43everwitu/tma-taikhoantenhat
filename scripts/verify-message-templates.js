// scripts/verify-message-templates.js
// One-shot render check: iterate every key in seeds/message-templates.json,
// render it with placeholder vars, and fail if any {{var}} remains
// unsubstituted or any key is unknown to the service.

const fs = require('fs');
const path = require('path');
const seed = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'src', 'database', 'seeds', 'message-templates.json'),
  'utf8',
));
const m = require('../src/services/messageTemplateService');

let failed = 0;
for (const [key, t] of Object.entries(seed)) {
  const vars = {};
  for (const v of t.variables) vars[v] = `[${v}]`;
  let out;
  try { out = m.render(key, vars); }
  catch (e) { console.error(`✗ ${key}: ${e.message}`); failed++; continue; }
  const leftover = out.match(/\{\{[^}]+\}\}/);
  if (leftover) {
    console.error(`✗ ${key}: unsubstituted ${leftover[0]}`);
    failed++;
  } else {
    console.log(`✓ ${key}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} template(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${Object.keys(seed).length} templates render cleanly.`);
