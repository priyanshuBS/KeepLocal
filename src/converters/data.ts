/**
 * Data converter engine: CSV, JSON and YAML in any direction.
 * Pure TypeScript — no WASM. Loaded lazily by the registry.
 */
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { parseCsv, stringifyCsv } from '../lib/csv';
import { UserFacingError, type ConverterEngine, type OptionValues } from '../types';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Row = Record<string, Json>;

const engine: ConverterEngine = {
  async convert(file, sourceId, targetId, options) {
    const text = await file.text();
    if (text.trim() === '') throw new UserFacingError('This file is empty — there is nothing to convert.');

    // Step 1: read the input into a plain JS value.
    const data: Json =
      sourceId === 'csv' ? csvToObjects(text, options) : sourceId === 'yaml' ? parseYamlText(text) : parseJson(text);

    // Step 2: write it out in the target format.
    switch (targetId) {
      case 'json':
        return new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
      case 'yaml':
        return new Blob([toYaml(data)], { type: 'application/yaml' });
      case 'csv':
        return new Blob([objectsToCsv(data)], { type: 'text/csv' });
      default:
        throw new UserFacingError(`Unsupported target format: ${targetId}`);
    }
  },
};
export default engine;

// ---------------------------------------------------------------------------
// CSV -> objects
// ---------------------------------------------------------------------------

function csvToObjects(text: string, options: OptionValues): Row[] {
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (e) {
    throw new UserFacingError((e as Error).message);
  }
  if (rows.length === 0) throw new UserFacingError('No rows found in this CSV.');

  // First row = column names. Fill in blanks and de-duplicate so every key is unique.
  const seen = new Map<string, number>();
  const headers = rows[0].map((h, i) => {
    let name = h.trim() || `column_${i + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count > 0) name = `${name}_${count + 1}`;
    return name;
  });

  const inferTypes = options.inferTypes !== false;
  return rows.slice(1).map((cells) => {
    const obj: Row = {};
    headers.forEach((h, i) => {
      const raw = cells[i] ?? '';
      obj[h] = inferTypes ? inferValue(raw) : raw;
    });
    return obj;
  });
}

/** Turn "42" into 42, "true" into true, "" into null. Leaves things like "007" as text. */
function inferValue(raw: string): Json {
  const v = raw.trim();
  if (v === '') return null;
  if (v === 'true' || v === 'TRUE') return true;
  if (v === 'false' || v === 'FALSE') return false;
  if (v === 'null') return null;
  // Numbers: reject leading zeros ("007", zip codes) and anything Number() would accept loosely.
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n) && (Number.isSafeInteger(n) || !/^-?\d+$/.test(v))) return n;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// JSON -> objects -> CSV
// ---------------------------------------------------------------------------

function parseJson(text: string): Json {
  try {
    return JSON.parse(text) as Json;
  } catch (e) {
    throw new UserFacingError(`This isn't valid JSON: ${(e as Error).message}`);
  }
}

function parseYamlText(text: string): Json {
  try {
    return parseYaml(text) as Json;
  } catch (e) {
    throw new UserFacingError(`This isn't valid YAML: ${(e as Error).message.split('\n')[0]}`);
  }
}

function objectsToCsv(data: Json): string {
  // Accept: an array of objects, an array of arrays, a single object, or an object
  // that wraps the array (e.g. { "items": [...] }).
  let list: Json[];
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === 'object') {
    const arrays = Object.values(data).filter(Array.isArray);
    list = arrays.length === 1 ? (arrays[0] as Json[]) : [data];
  } else {
    throw new UserFacingError('To make a CSV, the JSON must be a list of records (e.g. [{"name": "Ada"}, …]).');
  }
  if (list.length === 0) throw new UserFacingError('The JSON list is empty — there are no rows to write.');

  // Array of arrays -> write rows directly.
  if (list.every(Array.isArray)) {
    return stringifyCsv((list as Json[][]).map((r) => r.map(cellText)));
  }

  // Array of objects -> flatten nested objects into "parent.child" columns.
  const flat = list.map((item) =>
    item && typeof item === 'object' && !Array.isArray(item) ? flatten(item) : { value: item },
  );
  // Union of all keys, in first-seen order, so ragged records still line up.
  const headers: string[] = [];
  const known = new Set<string>();
  for (const rec of flat) {
    for (const k of Object.keys(rec)) {
      if (!known.has(k)) {
        known.add(k);
        headers.push(k);
      }
    }
  }

  const rows = [headers, ...flat.map((rec) => headers.map((h) => cellText(rec[h])))];
  return stringifyCsv(rows);
}

function flatten(obj: { [key: string]: Json }, prefix = '', out: Row = {}): Row {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function cellText(v: Json | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v); // arrays / empty objects
  return String(v);
}
