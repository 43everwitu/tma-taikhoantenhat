function up(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(product_variants)').all().map((c) => c.name));
  if (!cols.has('nfshop_package_id')) db.exec('ALTER TABLE product_variants ADD COLUMN nfshop_package_id INTEGER');
  if (!cols.has('nfshop_kind')) db.exec('ALTER TABLE product_variants ADD COLUMN nfshop_kind TEXT');
  if (!cols.has('nfshop_valid_days')) db.exec('ALTER TABLE product_variants ADD COLUMN nfshop_valid_days INTEGER');
}

module.exports = { up };
