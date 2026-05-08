const fs = require('node:fs');
const path = require('node:path');
const { REPORT_PATH } = require('./config');

function makeReport() {
  const r = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    counts: {
      categoriesImported: 0,
      productsImported: 0,
      productsSkippedNoPrice: 0,
      productsSkippedNoCategory: 0,
      stockKeysImported: 0,
      stockKeysSkippedSold: 0,
      stockKeysSkippedUnknownProduct: 0,
      imagesOptimized: 0,
      imagesMissingSource: 0,
      imageErrors: 0,
    },
    errors: [],
  };
  return r;
}

function writeReport(report) {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
}

function printSummary(report) {
  console.log('\n=== WordPress migration report ===');
  for (const [k, v] of Object.entries(report.counts)) {
    console.log(`  ${k}: ${v}`);
  }
  if (report.errors.length) {
    console.log(`\n  errors (${report.errors.length}):`);
    for (const e of report.errors.slice(0, 10)) console.log(`    - ${e}`);
    if (report.errors.length > 10) console.log(`    ... ${report.errors.length - 10} more`);
  }
  console.log(`\n  full report: ${REPORT_PATH}`);
}

module.exports = { makeReport, writeReport, printSummary };
