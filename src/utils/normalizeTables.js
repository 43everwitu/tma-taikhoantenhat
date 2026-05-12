function stripEmptyPInTables(html) {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (table) =>
    table.replace(/<p>\s*<\/p>/gi, '')
  );
}

function wrapOrphanTrRuns(html) {
  const tables = [];
  const masked = html.replace(/<table\b[\s\S]*?<\/table>/gi, (m) => {
    tables.push(m);
    return ` T${tables.length - 1} `;
  });

  const wrapped = masked.replace(/(?:<tr\b[\s\S]*?<\/tr>\s*)+/gi, (run) =>
    `<table><tbody>${run.trim()}</tbody></table>`
  );

  return wrapped.replace(/ T(\d+) /g, (_, i) => tables[Number(i)]);
}

function normalizeTables(html) {
  if (html == null || html === '') return '';
  let out = String(html);
  out = stripEmptyPInTables(out);
  out = wrapOrphanTrRuns(out);
  return out;
}

module.exports = { normalizeTables };
