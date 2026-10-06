// cleanupExpiredOrders() hard-deletes rows from `orders`. Both
// `transactions.matched_order_id` and `renewal_reminder_logs.order_id`
// reference orders(id) with the default ON DELETE NO ACTION, so once either
// table held a row pointing at an order that aged past the 24h cleanup
// window, the DELETE FROM orders statement aborted with
// "FOREIGN KEY constraint failed" and rolled back every cycle. Both columns
// are already nullable and already read as optional elsewhere in the
// codebase, so SET NULL keeps the log/transaction row and just detaches the
// dangling reference (same fix already applied to order_notes in 058, which
// used CASCADE there since notes have no meaning without their order).
function up(db) {
  fixTable(db, {
    table: 'transactions',
    fkColumn: 'matched_order_id',
    createSql: `
      CREATE TABLE transactions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mb_transaction_number TEXT UNIQUE,
        amount REAL NOT NULL,
        description TEXT NOT NULL,
        matched_order_id INTEGER,
        matched_payment_code TEXT,
        match_status TEXT DEFAULT 'unmatched',
        raw_data TEXT,
        detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        bank_transaction_at DATETIME,
        match_reason TEXT,
        candidate_order_ids_json TEXT,
        FOREIGN KEY (matched_order_id) REFERENCES orders(id) ON DELETE SET NULL
      );
    `,
    copyColumns: [
      'id', 'mb_transaction_number', 'amount', 'description', 'matched_order_id',
      'matched_payment_code', 'match_status', 'raw_data', 'detected_at',
      'bank_transaction_at', 'match_reason', 'candidate_order_ids_json',
    ],
    postSql: `
      CREATE INDEX IF NOT EXISTS idx_transactions_number ON transactions(mb_transaction_number);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(match_status);
    `,
  });

  fixTable(db, {
    table: 'renewal_reminder_logs',
    fkColumn: 'order_id',
    createSql: `
      CREATE TABLE renewal_reminder_logs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id INTEGER,
        order_id INTEGER,
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        expiry_date TEXT,
        days_before_expiry INTEGER,
        telegram_sent INTEGER DEFAULT 0,
        web_notification_id INTEGER,
        status TEXT NOT NULL,
        error_message TEXT,
        message_body TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (stock_id) REFERENCES stock(id),
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
        FOREIGN KEY (user_id) REFERENCES users(telegram_id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (web_notification_id) REFERENCES notifications(id)
      );
    `,
    copyColumns: [
      'id', 'stock_id', 'order_id', 'user_id', 'product_id', 'product_name',
      'expiry_date', 'days_before_expiry', 'telegram_sent', 'web_notification_id',
      'status', 'error_message', 'message_body', 'created_at',
    ],
    postSql: `
      CREATE INDEX IF NOT EXISTS idx_renewal_reminder_logs_created ON renewal_reminder_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_renewal_reminder_logs_status ON renewal_reminder_logs(status);
      CREATE INDEX IF NOT EXISTS idx_renewal_reminder_logs_user ON renewal_reminder_logs(user_id);
    `,
  });
}

function fixTable(db, { table, fkColumn, createSql, copyColumns, postSql }) {
  const exists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table);
  if (!exists) return;

  const fk = db.prepare(`PRAGMA foreign_key_list(${table})`).all()
    .find(row => row.table === 'orders' && row.from === fkColumn);
  if (fk?.on_delete === 'SET NULL') return;

  const newTable = `${table}_new`;
  db.exec(createSql);
  db.exec(`
    INSERT INTO ${newTable} (${copyColumns.join(', ')})
    SELECT ${copyColumns.join(', ')} FROM ${table};

    DROP TABLE ${table};
    ALTER TABLE ${newTable} RENAME TO ${table};

    ${postSql}
  `);
}

module.exports = { up };
