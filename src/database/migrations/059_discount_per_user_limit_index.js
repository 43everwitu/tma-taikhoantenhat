function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_discount_user_status
    ON orders(discount_code_id, user_id, status);
  `);
}

module.exports = { up };
