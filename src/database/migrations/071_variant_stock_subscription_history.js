// Keep "notify me when back in stock" subscriptions after they were delivered
// (notified_at) instead of deleting them, so admins can see product demand.
function up(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(variant_stock_subscriptions)').all().map((c) => c.name));
  if (!cols.has('notified_at')) db.exec('ALTER TABLE variant_stock_subscriptions ADD COLUMN notified_at DATETIME');
}

module.exports = { up };
