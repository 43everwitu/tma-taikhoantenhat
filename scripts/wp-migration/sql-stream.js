/**
 * Streams INSERT statements from a mysqldump file and yields them as
 * { table, columns, rows } objects. Only tables in `tables` (a Set) are
 * yielded; other rows are discarded without parsing their VALUES tuples.
 *
 * Trade-offs:
 *  - We assume mysqldump's format: one INSERT per table-block, columns
 *    listed, VALUES tuples comma-separated, statement terminated by `;\n`.
 *  - We do NOT execute SQL — we tokenize tuples and convert literals
 *    (quoted string, NULL, integer, float) into JS values.
 *  - Hex blobs (`X'...'`) become Buffers.
 *  - Backslash-escapes inside quoted strings are honored:
 *      \' \" \\ \n \r \t \0 → expanded.
 */
async function* streamInserts(readable, tables) {
  let buf = '';
  for await (const chunk of readable) {
    buf += chunk.toString('utf8');
    while (true) {
      const stmt = takeNextInsert(buf);
      if (!stmt) break;
      buf = stmt.rest;
      if (tables.has(stmt.table)) yield parseInsert(stmt);
    }
  }
}

const INSERT_RE = /INSERT INTO `([^`]+)` \(([^)]+)\) VALUES\s*/g;

function takeNextInsert(buf) {
  INSERT_RE.lastIndex = 0;
  const m = INSERT_RE.exec(buf);
  if (!m) return null;
  const table = m[1];
  const columns = m[2].split(',').map(c => c.trim().replace(/^`|`$/g, ''));
  // Find the terminating `;` not inside a string.
  const valuesStart = INSERT_RE.lastIndex;
  const end = findStatementEnd(buf, valuesStart);
  if (end === -1) return null; // not yet fully buffered
  return {
    table,
    columns,
    valuesText: buf.slice(valuesStart, end),
    rest: buf.slice(end + 1), // skip the ';'
  };
}

function findStatementEnd(s, from) {
  let i = from;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") { i = skipQuoted(s, i); if (i === -1) return -1; continue; }
    if (c === ';') return i;
    i++;
  }
  return -1;
}

function skipQuoted(s, i) {
  // s[i] is the opening quote
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'") return i + 1;
    i++;
  }
  return -1;
}

function parseInsert({ table, columns, valuesText, rest }) {
  const rows = [];
  let i = 0;
  while (i < valuesText.length) {
    while (i < valuesText.length && /[\s,]/.test(valuesText[i])) i++;
    if (i >= valuesText.length) break;
    if (valuesText[i] !== '(') {
      throw new Error(`Expected '(' at offset ${i} in ${table} INSERT`);
    }
    const close = findTupleClose(valuesText, i);
    rows.push(parseTuple(valuesText.slice(i + 1, close)));
    i = close + 1;
  }
  return { table, columns, rows };
}

function findTupleClose(s, open) {
  let i = open + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") { i = skipQuoted(s, i); continue; }
    if (c === ')') return i;
    i++;
  }
  throw new Error('Unterminated tuple');
}

function parseTuple(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text[i] === ',') { i++; continue; }
    if (text[i] === "'") {
      const end = skipQuoted(text, i);
      out.push(unescapeMysql(text.slice(i + 1, end - 1)));
      i = end;
    } else if (text.startsWith('NULL', i)) {
      out.push(null);
      i += 4;
    } else if (text[i] === 'X' && text[i + 1] === "'") {
      // Hex literal X'...'
      const end = skipQuoted(text, i + 1);
      out.push(Buffer.from(text.slice(i + 2, end - 1), 'hex'));
      i = end;
    } else {
      // numeric literal
      let j = i;
      while (j < text.length && /[-0-9.eE+]/.test(text[j])) j++;
      const tok = text.slice(i, j);
      const num = Number(tok);
      out.push(Number.isNaN(num) ? tok : num);
      i = j;
    }
  }
  return out;
}

function unescapeMysql(s) {
  return s.replace(/\\(.)/g, (_, c) => {
    switch (c) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case '0': return '\0';
      default:  return c;
    }
  });
}

module.exports = { streamInserts };
