function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some((row) => row.name === column);
}

function up(db) {
  if (!hasColumn(db, 'twofa_notification_events', 'claim_token')) {
    db.exec('ALTER TABLE twofa_notification_events ADD COLUMN claim_token TEXT');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_twofa_events_processing_claim
    ON twofa_notification_events(event_id, status, claim_token)
  `);
}

module.exports = { up };
