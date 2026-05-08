const fs = require('node:fs');
const { streamInserts } = require('./sql-stream');
const { WP_TABLE_PREFIX, WP_SQL_DUMP } = require('./config');

/**
 * Returns { terms: [{term_id, name, slug}], taxonomy: [{term_id, term_taxonomy_id, taxonomy, parent}] }
 * pulled from the dump.
 */
async function extractCategories() {
  const wantedTables = new Set([
    `${WP_TABLE_PREFIX}terms`,
    `${WP_TABLE_PREFIX}term_taxonomy`,
  ]);
  const terms = [];
  const taxonomy = [];

  const stream = fs.createReadStream(WP_SQL_DUMP);
  for await (const stmt of streamInserts(stream, wantedTables)) {
    const ix = indexer(stmt.columns);
    if (stmt.table === `${WP_TABLE_PREFIX}terms`) {
      for (const row of stmt.rows) {
        terms.push({
          term_id: row[ix('term_id')],
          name: row[ix('name')],
          slug: row[ix('slug')],
        });
      }
    } else {
      for (const row of stmt.rows) {
        taxonomy.push({
          term_taxonomy_id: row[ix('term_taxonomy_id')],
          term_id: row[ix('term_id')],
          taxonomy: row[ix('taxonomy')],
          parent: row[ix('parent')],
        });
      }
    }
  }
  return { terms, taxonomy };
}

function indexer(columns) {
  const map = new Map(columns.map((c, i) => [c, i]));
  return (name) => {
    const i = map.get(name);
    if (i == null) throw new Error(`Column ${name} not in INSERT (${columns.join(',')})`);
    return i;
  };
}

module.exports = { extractCategories, indexer };
