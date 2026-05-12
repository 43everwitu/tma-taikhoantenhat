#!/usr/bin/env node
// Reset admin password.
//
// Usage:
//   npm run admin:reset-password                  # uses ADMIN_INITIAL_PASSWORD from .env
//   npm run admin:reset-password -- <password>    # explicit password (preferred when rotating)
//   npm run admin:reset-password -- <username> <password>

require('dotenv').config();
const bcrypt = require('bcrypt');
const path = require('path');
const Database = require('better-sqlite3');

const SALT_ROUNDS = 10;
const DB_PATH = path.join(__dirname, '..', 'data', 'shop.db');

const args = process.argv.slice(2);
let username = 'admin';
let password;

if (args.length === 0) {
  password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password) {
    console.error('❌ No password argument and ADMIN_INITIAL_PASSWORD not set in .env');
    process.exit(1);
  }
} else if (args.length === 1) {
  password = args[0];
} else {
  username = args[0];
  password = args[1];
}

if (!password || password.length < 4) {
  console.error('❌ Password must be at least 4 characters');
  process.exit(1);
}

const db = new Database(DB_PATH);
const row = db.prepare('SELECT id, username FROM admins WHERE username = ?').get(username);

if (!row) {
  console.error(`❌ No admin row with username "${username}". Existing admins:`);
  console.error(db.prepare('SELECT id, username, role FROM admins').all());
  process.exit(2);
}

bcrypt.hash(password, SALT_ROUNDS).then((hash) => {
  const r = db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, row.id);
  console.log(`✅ Reset password for "${username}" (id=${row.id}). Rows updated: ${r.changes}`);
});
