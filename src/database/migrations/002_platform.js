/**
 * Migration 002: Platform upgrade
 * Adds tables and columns for: admin dashboard, auto-payment, notifications,
 * product follows, announcements, audit log, and runtime settings.
 */

const { slugify } = require('../../utils/slugify');

function hasColumn(db, table, column) {
  const cols = db.pragma(`table_info(${table})`);
  return cols.some(c => c.name === column);
}

function addColumnSafe(db, table, column, definition) {
  if (hasColumn(db, table, column)) return;
  // Strip UNIQUE from definition — enforce via index instead
  const cleanDef = definition.replace(/\bUNIQUE\b/gi, '').trim();
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${cleanDef}`);
}

function up(db) {
  // ============================================================
  // Evolve existing tables
  // ============================================================

  // users
  addColumnSafe(db, 'users', 'email', 'TEXT');
  addColumnSafe(db, 'users', 'web_token', 'TEXT');
  addColumnSafe(db, 'users', 'notification_prefs', "TEXT DEFAULT '{}'");
  addColumnSafe(db, 'users', 'updated_at', 'DATETIME');

  // categories
  addColumnSafe(db, 'categories', 'slug', 'TEXT');
  addColumnSafe(db, 'categories', 'description', 'TEXT');
  addColumnSafe(db, 'categories', 'is_active', 'INTEGER DEFAULT 1');
  addColumnSafe(db, 'categories', 'created_at', 'DATETIME');

  // products
  addColumnSafe(db, 'products', 'slug', 'TEXT');
  addColumnSafe(db, 'products', 'image_url', 'TEXT');
  addColumnSafe(db, 'products', 'long_description', 'TEXT');
  addColumnSafe(db, 'products', 'low_stock_threshold', 'INTEGER DEFAULT 5');
  addColumnSafe(db, 'products', 'sort_order', 'INTEGER DEFAULT 0');
  addColumnSafe(db, 'products', 'created_at', 'DATETIME');
  addColumnSafe(db, 'products', 'updated_at', 'DATETIME');

  // stock
  addColumnSafe(db, 'stock', 'added_by', 'INTEGER');
  addColumnSafe(db, 'stock', 'added_at', 'DATETIME');

  // orders
  addColumnSafe(db, 'orders', 'source', "TEXT DEFAULT 'telegram'");
  addColumnSafe(db, 'orders', 'bank_name', 'TEXT');
  addColumnSafe(db, 'orders', 'payment_matched_at', 'DATETIME');
  addColumnSafe(db, 'orders', 'auto_confirmed', 'INTEGER DEFAULT 0');
  addColumnSafe(db, 'orders', 'notes', 'TEXT');
  addColumnSafe(db, 'orders', 'expires_at', 'DATETIME');

  // ============================================================
  // New tables
  // ============================================================

  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      is_active INTEGER DEFAULT 1,
      last_login_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mb_transaction_number TEXT UNIQUE,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      matched_order_id INTEGER,
      matched_payment_code TEXT,
      match_status TEXT DEFAULT 'unmatched',
      raw_data TEXT,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (matched_order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data TEXT,
      is_read INTEGER DEFAULT 0,
      channel TEXT DEFAULT 'all',
      sent_telegram INTEGER DEFAULT 0,
      sent_web INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(telegram_id)
    );

    CREATE TABLE IF NOT EXISTS product_follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(telegram_id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      UNIQUE(user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      admin_id INTEGER NOT NULL,
      is_pinned INTEGER DEFAULT 0,
      target TEXT DEFAULT 'all',
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES admins(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ============================================================
  // Indexes
  // ============================================================

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_web_token ON users(web_token);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug) WHERE slug IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug ON products(slug) WHERE slug IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
    CREATE INDEX IF NOT EXISTS idx_stock_available ON stock(product_id, is_sold);
    CREATE INDEX IF NOT EXISTS idx_stock_sold_to ON stock(sold_to);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_payment_code ON orders(payment_code);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_expires ON orders(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_number ON transactions(mb_transaction_number);
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(match_status);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
    CREATE INDEX IF NOT EXISTS idx_audit_log_admin ON audit_log(admin_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
  `);

  // ============================================================
  // Seed settings
  // ============================================================

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  insertSetting.run('shop_name', 'Taikhoantenhat');
  insertSetting.run('support_contact', '@taikhoantenhat_support');
  insertSetting.run('payment_timeout_minutes', '5');
  insertSetting.run('auto_payment_enabled', '1');
  insertSetting.run('payment_poll_interval_seconds', '15');
  insertSetting.run('low_stock_alert_threshold', '5');
  insertSetting.run('order_expiry_minutes', '5');

  // Generate slugs for existing categories and products
  const categories = db.prepare('SELECT id, name FROM categories WHERE slug IS NULL').all();
  const updateCatSlug = db.prepare('UPDATE categories SET slug = ? WHERE id = ?');
  for (const cat of categories) {
    updateCatSlug.run(slugify(cat.name) || `cat-${cat.id}`, cat.id);
  }

  const products = db.prepare('SELECT id, name FROM products WHERE slug IS NULL').all();
  const updateProdSlug = db.prepare('UPDATE products SET slug = ? WHERE id = ?');
  for (const prod of products) {
    updateProdSlug.run(slugify(prod.name) || `product-${prod.id}`, prod.id);
  }
}

module.exports = { up };
