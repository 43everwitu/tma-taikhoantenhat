const fs = require('node:fs');
const { streamInserts } = require('./sql-stream');
const { indexer } = require('./extract-categories');
const { WP_TABLE_PREFIX, WP_SQL_DUMP } = require('./config');

const META_KEYS_OF_INTEREST = new Set([
  '_price', '_regular_price', '_sale_price', '_thumbnail_id', '_sku',
  '_stock', '_stock_status', '_visibility',
]);

async function extractProductsAndMeta() {
  const wantedTables = new Set([
    `${WP_TABLE_PREFIX}posts`,
    `${WP_TABLE_PREFIX}postmeta`,
    `${WP_TABLE_PREFIX}term_relationships`,
  ]);

  const posts = [];
  const meta = [];
  const termRel = [];
  const productPostIds = new Set();

  const stream = fs.createReadStream(WP_SQL_DUMP);
  for await (const stmt of streamInserts(stream, wantedTables)) {
    const ix = indexer(stmt.columns);
    if (stmt.table === `${WP_TABLE_PREFIX}posts`) {
      for (const row of stmt.rows) {
        const post = {
          ID: row[ix('ID')],
          post_title: row[ix('post_title')],
          post_status: row[ix('post_status')],
          post_type: row[ix('post_type')],
          post_name: row[ix('post_name')],
          post_content: row[ix('post_content')],
          post_excerpt: row[ix('post_excerpt')],
        };
        if (post.post_type === 'product' || post.post_type === 'attachment') {
          posts.push(post);
          if (post.post_type === 'product') productPostIds.add(Number(post.ID));
        }
      }
    } else if (stmt.table === `${WP_TABLE_PREFIX}postmeta`) {
      for (const row of stmt.rows) {
        const key = row[ix('meta_key')];
        if (!META_KEYS_OF_INTEREST.has(key) && key !== '_wp_attached_file') continue;
        meta.push({
          post_id: row[ix('post_id')],
          meta_key: key,
          meta_value: row[ix('meta_value')],
        });
      }
    } else {
      for (const row of stmt.rows) {
        termRel.push({
          object_id: row[ix('object_id')],
          term_taxonomy_id: row[ix('term_taxonomy_id')],
        });
      }
    }
  }

  return { posts, meta, termRel, productPostIds };
}

module.exports = { extractProductsAndMeta };
