/**
 * Migration 011: Seed website_url setting (default = current WEB_URL env).
 * Editable from /admin/settings so admin can change the public URL without
 * restarting the bot.
 */

function up(db) {
  const config = require('../../config');
  const fallback = (config.WEB_URL || '').replace(/\/$/, '') || 'https://peanut.shop';
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('website_url', fallback);
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(
    'website_description',
    'Cửa hàng tài khoản số chính hãng — giao tự động sau thanh toán.'
  );
}

module.exports = { up };
