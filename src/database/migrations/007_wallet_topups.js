/**
 * Migration 007: Wallet topups
 * Tracks wallet top-up requests with memo PNS<username> or PNSU<telegram_id>
 * so the payment poller can credit the user's wallet on bank transfer match.
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_topups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      memo TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      mb_transaction_number TEXT,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      matched_at DATETIME,
      expires_at DATETIME,
      qr_chat_id INTEGER,
      qr_message_id INTEGER,
      cancel_reason TEXT,
      FOREIGN KEY (user_id) REFERENCES users(telegram_id)
    );

    CREATE INDEX IF NOT EXISTS idx_topups_status ON wallet_topups(status);
    CREATE INDEX IF NOT EXISTS idx_topups_memo ON wallet_topups(memo);
    CREATE INDEX IF NOT EXISTS idx_topups_user ON wallet_topups(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_topups_expires ON wallet_topups(status, expires_at);
  `);

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('topup_expiry_minutes', '30');
  insertSetting.run('topup_min_amount', '10000');
}

module.exports = { up };
