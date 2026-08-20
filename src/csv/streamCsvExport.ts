import { sanitizeCsvCell } from './sanitize';

const UTF8_BOM = '﻿';
const CRLF = '\r\n';

export interface StreamCsvOptions {
  bom?: boolean;
  filename?: string;
}

export interface CsvRowSource<T> {
  columns: string[];
  header?: string[];
  rows: AsyncIterable<T> | Iterable<T>;
  toRow: (item: T) => Record<string, unknown>;
}

function encodeRow(cells: string[]): Uint8Array {
  return new TextEncoder().encode(cells.join(',') + CRLF);
}

export function csvReadableStream<T>(src: CsvRowSource<T>, opts: StreamCsvOptions = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator: AsyncIterator<T> | Iterator<T> =
    (Symbol.asyncIterator in Object(src.rows))
      ? (src.rows as AsyncIterable<T>)[Symbol.asyncIterator]()
      : (src.rows as Iterable<T>)[Symbol.iterator]();

  let headerSent = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          const prefix = opts.bom ? encoder.encode(UTF8_BOM) : null;
          const header = (src.header ?? src.columns).map((c) => sanitizeCsvCell(c));
          const headerBytes = encodeRow(header);
          if (prefix) {
            const merged = new Uint8Array(prefix.byteLength + headerBytes.byteLength);
            merged.set(prefix, 0);
            merged.set(headerBytes, prefix.byteLength);
            controller.enqueue(merged);
          } else {
            controller.enqueue(headerBytes);
          }
          return;
        }
        const next = await (iterator as AsyncIterator<T>).next();
        if (next.done) {
          controller.close();
          return;
        }
        const item = next.value;
        const rowObj = src.toRow(item);
        const cells: string[] = new Array(src.columns.length);
        for (let i = 0; i < src.columns.length; i += 1) {
          cells[i] = sanitizeCsvCell(rowObj[src.columns[i]]);
        }
        controller.enqueue(encodeRow(cells));
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

export async function streamCsvToBlob<T>(src: CsvRowSource<T>, opts: StreamCsvOptions = {}): Promise<Blob> {
  const stream = csvReadableStream(src, opts);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], { type: 'text/csv;charset=utf-8' });
}

export async function downloadCsv<T>(
  src: CsvRowSource<T> & { filename?: string },
  opts: StreamCsvOptions = {},
): Promise<void> {
  const blob = await streamCsvToBlob(src, { bom: true, ...opts });
  const filename = src.filename ?? opts.filename ?? 'export.csv';
  triggerDownload(blob, filename);
}

export interface StreamCsvColumn<T> {
  header: string;
  get: (row: T) => unknown;
}

export interface StreamCsvExportInput<T> {
  filename: string;
  columns: Array<StreamCsvColumn<T>>;
  rows: AsyncIterable<T> | Iterable<T>;
  bom?: boolean;
}

export async function streamCsvExport<T>(input: StreamCsvExportInput<T>): Promise<void> {
  const columnKeys = input.columns.map((_, idx) => `c${idx}`);
  const src: CsvRowSource<T> = {
    columns: columnKeys,
    header: input.columns.map((c) => c.header),
    rows: input.rows,
    toRow: (item: T) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < input.columns.length; i += 1) {
        obj[columnKeys[i]] = input.columns[i].get(item);
      }
      return obj;
    },
  };
  const blob = await streamCsvToBlob(src, { bom: input.bom ?? true });
  triggerDownload(blob, input.filename);
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
