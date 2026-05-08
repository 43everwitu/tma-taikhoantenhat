const path = require('node:path');
const fs = require('node:fs');

// Resolve backup root: prefer in-fork copy, fall back to parent repo.
// Override with WP_BACKUP_ROOT env var for non-default layouts.
const FORK_BACKUP = path.resolve(__dirname, '../../taikhoantenhat.com__2026-05-06T15_42_06+0700');
const PARENT_BACKUP = '/Users/peanut/Users/peanut/Project Local/telegram-shop-bot/taikhoantenhat.com__2026-05-06T15_42_06+0700';
const BACKUP_ROOT = process.env.WP_BACKUP_ROOT
  || (fs.existsSync(FORK_BACKUP) ? FORK_BACKUP : PARENT_BACKUP);

module.exports = {
  WP_TABLE_PREFIX: 'AGJiSNzCU_',
  WP_SQL_DUMP: path.join(BACKUP_ROOT, 'taikho35_taikhoan_wp_lmbr8.sql'),
  WP_UPLOADS_ROOT: path.join(BACKUP_ROOT, 'files/wp-content/uploads'),
  LMFWC_CSV_PATH: path.resolve(__dirname, '../../data/wp-imports/lmfwc-export.csv'),
  PRODUCT_IMAGES_OUT: path.resolve(__dirname, '../../data/uploads/products'),
  REPORT_PATH: path.resolve(__dirname, '../../data/wp-imports/migration-report.json'),
  IMAGE_VARIANTS: [
    { name: 'original', width: 800, formats: ['avif', 'webp'] },
    { name: 'thumb',    width: 400, formats: ['avif', 'webp'] },
  ],
};
