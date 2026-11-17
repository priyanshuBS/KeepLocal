/**
 * A small, dependency-free CSV parser/writer following RFC 4180:
 *  - fields may be wrapped in double quotes,
 *  - quoted fields may contain delimiters, newlines and escaped quotes ("" -> "),
 *  - rows end with \n or \r\n.
 */

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const;

/**
 * Guess the delimiter by counting candidates in the first few lines (outside quotes).
 * The delimiter that appears most consistently across lines wins.
 */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 10_000).split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 10);
  let best = ',';
  let bestScore = 0;
  for (const d of CANDIDATE_DELIMITERS) {
    const counts = sample.map((line) => countOutsideQuotes(line, d));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    // Score = how many lines share the first line's count, weighted by that count.
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 100 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, ch: string): number {
  let n = 0;
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ch && !inQuotes) n++;
  }
  return n;
}

/** Parse CSV text into rows of string cells. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  // Strip a UTF-8 byte-order mark (Excel likes to add one).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      inQuotes = true;
      i++;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\n' || c === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (inQuotes) throw new Error('The CSV has an unclosed quote ("), so it could not be read reliably.');
  // Flush the final field/row unless the file ended with a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop completely empty lines.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Quote a cell only when needed. */
function escapeCell(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes(delimiter) || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialise rows to CSV using CRLF line endings (what spreadsheet apps expect). */
export function stringifyCsv(rows: string[][], delimiter = ','): string {
  return rows.map((r) => r.map((c) => escapeCell(c, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}
