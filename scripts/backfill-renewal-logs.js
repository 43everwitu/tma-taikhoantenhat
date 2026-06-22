#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const dbPath = path.join(repoRoot, 'data', 'shop.db');

function nowStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function createBackup() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`DB file not found: ${dbPath}`);
  }

  const backupPath = path.join(
    repoRoot,
    'data',
    `shop.db.bak-pre-renewal-log-backfill-${nowStamp()}`,
  );
  fs.copyFileSync(dbPath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

function main() {
  const apply = process.argv.includes('--apply');
  if (apply && !fs.existsSync(dbPath)) {
    throw new Error(`DB file not found: ${dbPath}`);
  }

  const { backfillMissingLegacyLogs } = require('../src/services/renewalReminderLogService');

  if (!apply) {
    const result = backfillMissingLegacyLogs();
    console.log(`Missing renewal reminder logs: ${result.scanned}`);
    console.log('Dry run only. Re-run with --apply to create a backup and backfill these rows.');
    return;
  }

  const backupPath = createBackup();
  console.log(`Backup created: ${backupPath}`);
  const result = backfillMissingLegacyLogs({ apply: true });
  console.log(`Created renewal reminder logs: ${result.created}`);
}

if (require.main === module) {
  main();
}
