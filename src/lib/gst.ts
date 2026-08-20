/**
 * GSTIN = 15 chars: [state(2)][PAN(10)][entity(1)][Z][check(1)]
 *   pos 1-2:  state code (01-38)
 *   pos 3-12: PAN (AAAAA9999A)
 *   pos 13:   entity number 1-9 or A-Z
 *   pos 14:   literal 'Z'
 *   pos 15:   check character (0-9,A-Z), computed by the GST checksum algo
 */

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function isValidStateCode(code: string): boolean {
  if (!/^[0-9]{2}$/.test(code)) return false;
  const n = Number(code);
  return n >= 1 && n <= 38;
}

export function computeGstinCheckChar(first14: string): string {
  if (first14.length !== 14) {
    throw new Error('computeGstinCheckChar: expected 14 characters');
  }
  let factor = 2;
  let sum = 0;
  const base = ALPHABET.length; // 36
  for (let i = first14.length - 1; i >= 0; i--) {
    const ch = first14.charAt(i);
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) throw new Error(`computeGstinCheckChar: bad char '${ch}'`);
    let product = digit * factor;
    product = Math.floor(product / base) + (product % base);
    sum += product;
    factor = factor === 2 ? 1 : 2;
  }
  const check = (base - (sum % base)) % base;
  return ALPHABET.charAt(check);
}

export function isValidGstin(gstin: string): boolean {
  if (typeof gstin !== 'string') return false;
  const g = gstin.toUpperCase();
  if (!GSTIN_RE.test(g)) return false;
  if (!isValidStateCode(g.slice(0, 2))) return false;
  const expected = computeGstinCheckChar(g.slice(0, 14));
  return expected === g.charAt(14);
}

export function assertValidGstin(gstin: string | null | undefined): void {
  if (gstin === null || gstin === undefined || gstin === '') return;
  if (!isValidGstin(gstin)) {
    throw new Error(`Invalid GSTIN: ${gstin}`);
  }
}
