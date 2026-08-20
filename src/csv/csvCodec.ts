import { sanitizeCsvCell } from './sanitize';

const UTF8_BOM = '﻿';
const CRLF = '\r\n';

export interface WriteCsvOptions {
  bom?: boolean;
}

export function writeCsv(
  rows: Record<string, unknown>[],
  columns: string[],
  opts: WriteCsvOptions = {},
): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => sanitizeCsvCell(c)).join(','));
  for (const row of rows) {
    const cells: string[] = [];
    for (const col of columns) {
      cells.push(sanitizeCsvCell(row[col]));
    }
    lines.push(cells.join(','));
  }
  const body = lines.join(CRLF) + CRLF;
  return opts.bom ? UTF8_BOM + body : body;
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string): ParsedCsv {
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) {
    src = src.slice(1);
  }

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src.charAt(i);

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && src.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ',') {
      record.push(field);
      field = '';
      i += 1;
      continue;
    }

    if (ch === '\r') {
      record.push(field);
      field = '';
      records.push(record);
      record = [];
      if (i + 1 < len && src.charAt(i + 1) === '\n') {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (ch === '\n') {
      record.push(field);
      field = '';
      records.push(record);
      record = [];
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = records[0];
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < records.length; r += 1) {
    const rec = records[r];
    if (rec.length === 1 && rec[0] === '') continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]] = c < rec.length ? rec[c] : '';
    }
    rows.push(obj);
  }

  return { headers, rows };
}
