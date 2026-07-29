#!/usr/bin/env node

require('dotenv').config({ override: true });

const path = require('node:path');
const Database = require('better-sqlite3');
const { cacheProductAndVariantImageUrls } = require('../src/services/imageCacheService');

async function main() {
  const dbPath = path.resolve(__dirname, '..', 'data', 'shop.db');
  const db = new Database(dbPath);
  const summary = await cacheProductAndVariantImageUrls(db);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('FATAL:', err.stack || err.message);
  process.exit(1);
});
