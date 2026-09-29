const QUOTE = 34;
const COMMA = 44;
const LF = 10;
const CR = 13;

/**
 * Reads the named columns out of an RFC 4180 CSV (quoted fields, doubled quotes, newlines
 * inside quotes, CRLF). Rows come back as arrays in the order of `columns`. Fields of other
 * columns are skipped without being copied, which matters for the 50 MB ItemSparse table.
 * A requested column that is missing from the header is a format change and throws.
 */
export function readCsvColumns(text: string, columns: readonly string[]): string[][] {
  let pos = 0;
  let eol = false;

  /** Consumes one field; returns its text when `keep`, else "". Sets `eol` at a row end. */
  const field = (keep: boolean): string => {
    let value = "";
    if (text.charCodeAt(pos) === QUOTE) {
      pos++;
      let start = pos;
      for (;;) {
        const q = text.indexOf('"', pos);
        if (q === -1) {
          pos = text.length;
          if (keep) value += text.slice(start);
          break;
        }
        if (keep) value += text.slice(start, q);
        if (text.charCodeAt(q + 1) === QUOTE) {
          if (keep) value += '"';
          pos = q + 2;
          start = pos;
        } else {
          pos = q + 1;
          break;
        }
      }
      // Anything between the closing quote and the delimiter is malformed; skip it.
      while (pos < text.length && text.charCodeAt(pos) !== COMMA && text.charCodeAt(pos) !== LF) {
        pos++;
      }
    } else {
      const start = pos;
      while (pos < text.length) {
        const c = text.charCodeAt(pos);
        if (c === COMMA || c === LF) break;
        pos++;
      }
      if (keep) value = text.slice(start, pos);
      if (keep && value.charCodeAt(value.length - 1) === CR) value = value.slice(0, -1);
    }
    const c = text.charCodeAt(pos);
    eol = pos >= text.length || c === LF;
    pos++; // the delimiter
    return value;
  };

  const header: string[] = [];
  do header.push(field(true));
  while (!eol);
  const missing = columns.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`CSV is missing column(s): ${missing.join(", ")}`);
  const slot = header.map((name) => columns.indexOf(name));

  const rows: string[][] = [];
  while (pos < text.length) {
    const row = new Array<string>(columns.length).fill("");
    let i = 0;
    do {
      const s = slot[i++] ?? -1;
      const value = field(s !== -1);
      if (s !== -1) row[s] = value;
    } while (!eol);
    // A blank line is a single empty field; skip it.
    if (i > 1 || row.some((v) => v !== "")) rows.push(row);
  }
  return rows;
}
