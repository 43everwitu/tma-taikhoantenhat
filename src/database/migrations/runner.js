const path = require('path');
const fs = require('fs');

function runMigrations(db) {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Discover migration files (sorted by name)
  const migrationsDir = __dirname;
  const files = fs.readdirSync(migrationsDir)
    .filter(f => /^\d{3}_.+\.js$/.test(f))
    .sort();

  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map(r => r.name)
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const migration = require(path.join(migrationsDir, file));
    console.log(`📦 Running migration: ${file}`);

    const runInTransaction = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    });

    runInTransaction();
    console.log(`✅ Migration applied: ${file}`);
  }
}

module.exports = { runMigrations };
