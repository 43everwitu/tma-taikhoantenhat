function up(db) {
  // ALTER TABLE only adds the column if missing — SQLite has no IF NOT EXISTS
  // for ADD COLUMN, so guard via PRAGMA.
  const cols = db.prepare("PRAGMA table_info(wallet_topups)").all();
  if (!cols.find((c) => c.name === 'actual_amount')) {
    db.exec("ALTER TABLE wallet_topups ADD COLUMN actual_amount INTEGER");
  }
}

module.exports = { up };
