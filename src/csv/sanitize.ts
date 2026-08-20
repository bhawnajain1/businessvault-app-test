const FORMULA_INJECTION_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

const CELL_MUST_QUOTE_REGEX = /[",\r\n]/;

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function sanitizeCsvCell(value: unknown): string {
  const raw = stringify(value);
  if (raw.length === 0) return '';

  let s = raw;
  const first = s.charAt(0);
  if (FORMULA_INJECTION_PREFIXES.includes(first)) {
    s = "'" + s;
  }

  const needsQuoting =
    CELL_MUST_QUOTE_REGEX.test(s) ||
    s !== s.trim();

  if (!needsQuoting) return s;

  const escaped = s.replace(/"/g, '""');
  return '"' + escaped + '"';
}

export function unescapeCsvCell(value: string): string {
  if (value.length < 2) return value;
  const first = value.charAt(0);
  const second = value.charAt(1);
  if (first !== "'") return value;
  if (FORMULA_INJECTION_PREFIXES.includes(second)) {
    return value.slice(1);
  }
  return value;
}
