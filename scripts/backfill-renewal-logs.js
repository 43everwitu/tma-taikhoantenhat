#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const repoRoot = path.join(__dirname, '..');
const dbPath = path.join(repoRoot, 'data', 'shop.db');
const DEFAULT_LIMIT = 1000;

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

async function createBackup({
  sourcePath = dbPath,
  destinationPath = path.join(
    path.dirname(sourcePath),
    `${path.basename(sourcePath)}.bak-pre-renewal-log-backfill-${nowStamp()}`,
  ),
  backupDatabase = (database, targetPath) => database.backup(targetPath),
} = {}) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`DB file not found: ${sourcePath}`);
  }
  if (fs.existsSync(destinationPath)) {
    const error = new Error(`Backup file already exists: ${destinationPath}`);
    error.code = 'EEXIST';
    throw error;
  }

  const database = new Database(sourcePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await backupDatabase(database, destinationPath);
    return destinationPath;
  } catch (error) {
    fs.rmSync(destinationPath, { force: true });
    throw error;
  } finally {
    database.close();
  }
}

function openDatabasePath(sourcePath, { readonly = false } = {}) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`DB file not found: ${sourcePath}`);
  }
  return new Database(sourcePath, {
    readonly,
    fileMustExist: true,
  });
}

function loadService() {
  return require('../src/services/renewalReminderLogService');
}

function logBatchNote(result, limit, log) {
  if (result.scanned === limit) {
    log(`Scanned the batch limit (${limit}); another batch may remain.`);
  }
}

async function run({
  apply = process.argv.includes('--apply'),
  sourcePath = dbPath,
  limit = DEFAULT_LIMIT,
  createBackupFn = createBackup,
  openDatabase = openDatabasePath,
  loadService: loadServiceFn = loadService,
  log = console.log,
} = {}) {
  if (!apply) {
    let database;
    try {
      database = openDatabase(sourcePath, { readonly: true });
      const { backfillMissingLegacyLogs } = loadServiceFn();
      const result = backfillMissingLegacyLogs({ limit, database });
      log(`Missing renewal reminder logs: ${result.scanned}`);
      logBatchNote(result, limit, log);
      log('Dry run only. Re-run with --apply to create a backup and backfill these rows.');
      return result;
    } finally {
      if (database && database.open) database.close();
    }
  }

  const backupPath = await createBackupFn({ sourcePath });
  log(`Backup created: ${backupPath}`);

  let database;
  try {
    database = openDatabase(sourcePath);
    const { backfillMissingLegacyLogs } = loadServiceFn();
    const result = backfillMissingLegacyLogs({
      apply: true,
      limit,
      database,
    });
    log(`Created renewal reminder logs: ${result.created}`);
    logBatchNote(result, limit, log);
    return result;
  } finally {
    if (database && database.open) database.close();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createBackup,
  run,
};
