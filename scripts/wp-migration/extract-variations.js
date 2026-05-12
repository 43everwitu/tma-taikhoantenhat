const fs = require('node:fs');
const { streamInserts } = require('./sql-stream');
const { indexer } = require('./extract-categories');
const { WP_TABLE_PREFIX, WP_SQL_DUMP } = require('./config');

async function extractVariationsAndMeta() {
  const wantedTables = new Set([
    `${WP_TABLE_PREFIX}posts`,
    `${WP_TABLE_PREFIX}postmeta`,
  ]);

  const variations = [];
  const meta = [];
  const variationIds = new Set();

  const stream = fs.createReadStream(WP_SQL_DUMP);
  for await (const stmt of streamInserts(stream, wantedTables)) {
    const ix = indexer(stmt.columns);
    if (stmt.table === `${WP_TABLE_PREFIX}posts`) {
      for (const row of stmt.rows) {
        const post_type = row[ix('post_type')];
        if (post_type !== 'product_variation') continue;
        const post_status = row[ix('post_status')];
        if (post_status !== 'publish' && post_status !== 'private') continue;
        const ID = Number(row[ix('ID')]);
        variations.push({
          ID,
          post_parent: Number(row[ix('post_parent')]),
          post_status,
          menu_order: Number(row[ix('menu_order')] || 0),
        });
        variationIds.add(ID);
      }
    } else if (stmt.table === `${WP_TABLE_PREFIX}postmeta`) {
      for (const row of stmt.rows) {
        const key = row[ix('meta_key')] || '';
        if (key !== '_price' && key !== '_stock' && key !== '_thumbnail_id' && !key.startsWith('attribute_')) continue;
        meta.push({
          post_id: Number(row[ix('post_id')]),
          meta_key: key,
          meta_value: row[ix('meta_value')],
        });
      }
    }
  }

  // Filter meta to only variation posts to keep payload small
  const metaForVariations = meta.filter((m) => variationIds.has(m.post_id));
  return { variations, meta: metaForVariations };
}

module.exports = { extractVariationsAndMeta };
