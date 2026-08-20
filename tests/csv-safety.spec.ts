import { describe, it, expect } from 'vitest';
import { sanitizeCsvCell, unescapeCsvCell } from '../src/csv/sanitize';
import { writeCsv, parseCsv } from '../src/csv/csvCodec';

describe('sanitizeCsvCell — formula injection', () => {
  it('prefixes apostrophe to equals-prefixed strings', () => {
    expect(sanitizeCsvCell('=1+1')).toBe("'=1+1");
  });

  it('prefixes apostrophe to plus-prefixed strings', () => {
    expect(sanitizeCsvCell('+cmd')).toBe("'+cmd");
  });

  it('prefixes apostrophe to minus-prefixed strings', () => {
    expect(sanitizeCsvCell('-2+3')).toBe("'-2+3");
  });

  it('prefixes apostrophe to at-prefixed strings', () => {
    expect(sanitizeCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
  });

  it('prefixes apostrophe to TAB-prefixed strings', () => {
    // Tab is not a CSV-quoting trigger per RFC 4180; only the apostrophe defense applies.
    expect(sanitizeCsvCell('\thidden')).toBe("'\thidden");
  });

  it('prefixes apostrophe to CR-prefixed strings', () => {
    // CR forces quoting.
    expect(sanitizeCsvCell('\rhidden')).toBe('"\'\rhidden"');
  });

  it('escapes a realistic =SUM formula and quotes it because of commas', () => {
    const out = sanitizeCsvCell('=SUM(A1,A2)');
    expect(out).toBe('"\'=SUM(A1,A2)"');
  });

  it('does not touch benign strings', () => {
    expect(sanitizeCsvCell('Rajesh')).toBe('Rajesh');
    expect(sanitizeCsvCell('123.45')).toBe('123.45');
  });
});

describe('sanitizeCsvCell — quoting rules', () => {
  it('quotes cells containing commas', () => {
    expect(sanitizeCsvCell('a,b')).toBe('"a,b"');
  });

  it('quotes cells containing double quotes and doubles the quotes', () => {
    expect(sanitizeCsvCell('she said "hi"')).toBe('"she said ""hi"""');
  });

  it('quotes cells containing newlines', () => {
    expect(sanitizeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(sanitizeCsvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('quotes cells with leading whitespace', () => {
    expect(sanitizeCsvCell('  Rajesh')).toBe('"  Rajesh"');
  });

  it('quotes cells with trailing whitespace', () => {
    expect(sanitizeCsvCell('Rajesh  ')).toBe('"Rajesh  "');
  });

  it('handles empty and nullish values', () => {
    expect(sanitizeCsvCell('')).toBe('');
    expect(sanitizeCsvCell(null)).toBe('');
    expect(sanitizeCsvCell(undefined)).toBe('');
  });

  it('handles numbers, booleans, dates', () => {
    expect(sanitizeCsvCell(42)).toBe('42');
    expect(sanitizeCsvCell(true)).toBe('true');
    const d = new Date('2026-08-19T00:00:00Z');
    expect(sanitizeCsvCell(d)).toBe('2026-08-19T00:00:00.000Z');
  });
});

describe('sanitizeCsvCell — Unicode / Hindi', () => {
  it('passes Hindi customer names through unchanged', () => {
    expect(sanitizeCsvCell('शर्मा इलेक्ट्रॉनिक्स')).toBe('शर्मा इलेक्ट्रॉनिक्स');
  });

  it('quotes Hindi names with embedded commas', () => {
    expect(sanitizeCsvCell('शर्मा, इलेक्ट्रॉनिक्स')).toBe(
      '"शर्मा, इलेक्ट्रॉनिक्स"',
    );
  });
});

describe('unescapeCsvCell', () => {
  it('strips the leading defense apostrophe from formula-like cells', () => {
    expect(unescapeCsvCell("'=1+1")).toBe('=1+1');
    expect(unescapeCsvCell("'@SUM(A1:A2)")).toBe('@SUM(A1:A2)');
    expect(unescapeCsvCell("'+cmd")).toBe('+cmd');
    expect(unescapeCsvCell("'-2")).toBe('-2');
  });

  it("leaves ordinary apostrophe-prefixed text alone (e.g. Rajesh's)", () => {
    expect(unescapeCsvCell("'Rajesh")).toBe("'Rajesh");
  });
});

describe('writeCsv', () => {
  it('writes headers and rows with CRLF line endings', () => {
    const out = writeCsv(
      [
        { name: 'Rajesh', amount: 100 },
        { name: 'Priya', amount: 200 },
      ],
      ['name', 'amount'],
    );
    expect(out).toBe('name,amount\r\nRajesh,100\r\nPriya,200\r\n');
  });

  it('optionally prepends UTF-8 BOM', () => {
    const out = writeCsv([{ a: '1' }], ['a'], { bom: true });
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe('a\r\n1\r\n');
  });

  it('sanitizes formula-injection cells in a real row', () => {
    const out = writeCsv(
      [{ customer: '=cmd|"/c calc"!A1', total: 500 }],
      ['customer', 'total'],
    );
    expect(out).toBe(
      'customer,total\r\n' +
        '"\'=cmd|""/c calc""!A1",500\r\n',
    );
  });

  it('handles Hindi + embedded comma', () => {
    const out = writeCsv(
      [{ name: 'शर्मा, इलेक्ट्रॉनिक्स', gstin: '27ABCDE1234F1Z5' }],
      ['name', 'gstin'],
    );
    expect(out).toBe(
      'name,gstin\r\n' + '"शर्मा, इलेक्ट्रॉनिक्स",27ABCDE1234F1Z5\r\n',
    );
  });

  it('serializes missing keys as empty strings', () => {
    const out = writeCsv([{ a: 'x' }], ['a', 'b']);
    expect(out).toBe('a,b\r\nx,\r\n');
  });
});

describe('parseCsv', () => {
  it('parses simple CRLF file', () => {
    const { headers, rows } = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('parses LF-only files (Unix)', () => {
    const { headers, rows } = parseCsv('a,b\n1,2\n');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('parses doubled quotes as a literal quote', () => {
    const { rows } = parseCsv('msg\r\n"she said ""hi"""\r\n');
    expect(rows).toEqual([{ msg: 'she said "hi"' }]);
  });

  it('parses embedded commas within quoted fields', () => {
    const { rows } = parseCsv('name,city\r\n"Sharma, Rajesh",Pune\r\n');
    expect(rows).toEqual([{ name: 'Sharma, Rajesh', city: 'Pune' }]);
  });

  it('parses embedded newlines within quoted fields', () => {
    const { rows } = parseCsv('note\r\n"line1\nline2"\r\n');
    expect(rows).toEqual([{ note: 'line1\nline2' }]);
  });

  it('strips a leading UTF-8 BOM', () => {
    const src = '﻿a,b\r\n1,2\r\n';
    const { headers, rows } = parseCsv(src);
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('parses Hindi content', () => {
    const src = 'name\r\nशर्मा इलेक्ट्रॉनिक्स\r\n';
    const { rows } = parseCsv(src);
    expect(rows).toEqual([{ name: 'शर्मा इलेक्ट्रॉनिक्स' }]);
  });

  it('pads missing trailing fields with empty strings', () => {
    const { rows } = parseCsv('a,b,c\r\n1,2\r\n');
    expect(rows).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('ignores a trailing blank line', () => {
    const { rows } = parseCsv('a\r\n1\r\n');
    expect(rows).toHaveLength(1);
  });
});

describe('write → parse roundtrip', () => {
  it('preserves benign fields exactly', () => {
    const columns = ['name', 'gstin', 'total'];
    const rows = [
      { name: 'Rajesh Kumar', gstin: '27ABCDE1234F1Z5', total: '1000.00' },
      { name: 'Priya Sharma', gstin: '29XYZAB5678C1Z9', total: '2500.50' },
    ];
    const csv = writeCsv(rows, columns);
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(columns);
    expect(parsed.rows).toEqual(rows);
  });

  it('preserves Hindi, commas, quotes and newlines through a roundtrip', () => {
    const columns = ['name', 'note'];
    const rows = [
      { name: 'शर्मा, इलेक्ट्रॉनिक्स', note: 'she said "hi"\nnext line' },
      { name: '  Rajesh', note: 'plain' },
    ];
    const csv = writeCsv(rows, columns);
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(columns);
    expect(parsed.rows).toEqual(rows);
  });

  it('sanitized formula cells parse back as the escaped form; unescapeCsvCell recovers the original', () => {
    const columns = ['payload'];
    const rows = [{ payload: '=SUM(A1,A2)' }];
    const csv = writeCsv(rows, columns);
    const parsed = parseCsv(csv);
    expect(parsed.rows[0].payload).toBe("'=SUM(A1,A2)");
    expect(unescapeCsvCell(parsed.rows[0].payload)).toBe('=SUM(A1,A2)');
  });
});
