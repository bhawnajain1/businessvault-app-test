import { describe, it, expect } from 'vitest';
import {
  toMoney,
  fromMoney,
  addMoney,
  subMoney,
  mulMoney,
  sumMoney,
  splitTaxInclusive,
  applyTaxExclusive,
  type Money,
} from './money';

describe('toMoney', () => {
  it('parses rupees string with 2 decimals to paise', () => {
    expect(toMoney('1234.50')).toBe(123450);
    expect(toMoney('0.01')).toBe(1);
    expect(toMoney('0')).toBe(0);
    expect(toMoney('100')).toBe(10000);
  });

  it('parses number rupees to paise', () => {
    expect(toMoney(1234.5)).toBe(123450);
    expect(toMoney(0)).toBe(0);
    expect(toMoney(99.99)).toBe(9999);
  });

  it('strips Indian commas in strings', () => {
    expect(toMoney('1,23,450.00')).toBe(12345000);
    expect(toMoney('12,34,567.89')).toBe(123456789);
  });

  it('rejects more than 2 decimals', () => {
    expect(() => toMoney('12.345')).toThrow(/decimals/);
    expect(() => toMoney(12.345)).toThrow(/decimals/);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => toMoney(NaN)).toThrow();
    expect(() => toMoney(Infinity)).toThrow();
  });

  it('rejects negative by default, allows when opted-in', () => {
    expect(() => toMoney(-5)).toThrow(/negative/);
    expect(() => toMoney('-5.00')).toThrow(/negative/);
    expect(toMoney(-5, { allowNegative: true })).toBe(-500);
    expect(toMoney('-5.00', { allowNegative: true })).toBe(-500);
  });

  it('rejects garbage strings', () => {
    expect(() => toMoney('abc')).toThrow();
    expect(() => toMoney('')).toThrow();
    expect(() => toMoney('1.2.3')).toThrow();
  });
});

describe('fromMoney (Indian lakh formatting)', () => {
  it('formats small amounts', () => {
    expect(fromMoney(0 as Money)).toBe('0.00');
    expect(fromMoney(1 as Money)).toBe('0.01');
    expect(fromMoney(100 as Money)).toBe('1.00');
    expect(fromMoney(99999 as Money)).toBe('999.99');
  });

  it('inserts comma before last 3 digits then every 2', () => {
    expect(fromMoney(100000 as Money)).toBe('1,000.00');
    expect(fromMoney(12345000 as Money)).toBe('1,23,450.00');
    expect(fromMoney(123456789 as Money)).toBe('12,34,567.89');
    expect(fromMoney(1000000000 as Money)).toBe('1,00,00,000.00');
  });

  it('handles negative', () => {
    expect(fromMoney(-12345000 as Money)).toBe('-1,23,450.00');
  });

  it('round-trips with toMoney', () => {
    const values = ['1,23,450.00', '12,34,567.89', '1,00,00,000.00', '0.01', '999.99'];
    for (const v of values) {
      expect(fromMoney(toMoney(v))).toBe(v);
    }
  });
});

describe('addMoney / subMoney / sumMoney', () => {
  it('adds and subtracts exactly', () => {
    expect(addMoney(100 as Money, 250 as Money)).toBe(350);
    expect(subMoney(500 as Money, 250 as Money)).toBe(250);
  });

  it('sums a list', () => {
    expect(sumMoney([100, 200, 300].map((n) => n as Money))).toBe(600);
    expect(sumMoney([])).toBe(0);
  });

  it('refuses overflow', () => {
    const big = (Number.MAX_SAFE_INTEGER - 1) as Money;
    expect(() => addMoney(big, 100 as Money)).toThrow(/overflow/);
  });
});

describe('mulMoney banker rounding', () => {
  it('rounds .5 to even', () => {
    // 1 paise * 0.5 = 0.5 → banker → 0 (even)
    expect(mulMoney(1 as Money, 0.5)).toBe(0);
    // 3 paise * 0.5 = 1.5 → banker → 2 (even)
    expect(mulMoney(3 as Money, 0.5)).toBe(2);
    // 5 paise * 0.5 = 2.5 → banker → 2 (even)
    expect(mulMoney(5 as Money, 0.5)).toBe(2);
    // 7 paise * 0.5 = 3.5 → banker → 4 (even)
    expect(mulMoney(7 as Money, 0.5)).toBe(4);
  });

  it('rounds non-.5 normally', () => {
    // 100 paise * 0.333 = 33.3 → 33
    expect(mulMoney(100 as Money, 0.333)).toBe(33);
    // 100 paise * 0.336 = 33.6 → 34
    expect(mulMoney(100 as Money, 0.336)).toBe(34);
  });

  it('handles negative money symmetrically', () => {
    expect(mulMoney(-5 as Money, 0.5)).toBe(-2);
  });

  it('rejects non-finite factor', () => {
    expect(() => mulMoney(100 as Money, NaN)).toThrow();
    expect(() => mulMoney(100 as Money, Infinity)).toThrow();
  });
});

describe('tax inclusive / exclusive parity', () => {
  it('splitTaxInclusive: net + tax === gross exactly', () => {
    const cases: Array<[string, number]> = [
      ['118.00', 18],
      ['1180.00', 18],
      ['1,00,000.00', 18],
      ['100.00', 5],
      ['100.00', 12],
      ['100.00', 28],
      ['0.01', 18],
      ['12,34,567.89', 18],
    ];
    for (const [gs, rate] of cases) {
      const gross = toMoney(gs);
      const { net, tax } = splitTaxInclusive(gross, rate);
      expect(net + tax).toBe(gross);
    }
  });

  it('splitTaxInclusive known values', () => {
    const { net, tax } = splitTaxInclusive(toMoney('118.00'), 18);
    expect(net).toBe(10000);
    expect(tax).toBe(1800);
  });

  it('applyTaxExclusive: net + tax === gross exactly', () => {
    const cases: Array<[string, number]> = [
      ['100.00', 18],
      ['1000.00', 18],
      ['1,00,000.00', 18],
      ['100.00', 5],
      ['100.00', 12],
      ['100.00', 28],
      ['0.01', 18],
      ['12,34,567.89', 18],
    ];
    for (const [ns, rate] of cases) {
      const net = toMoney(ns);
      const { tax, gross } = applyTaxExclusive(net, rate);
      expect(net + tax).toBe(gross);
    }
  });

  it('applyTaxExclusive known values', () => {
    const { tax, gross } = applyTaxExclusive(toMoney('100.00'), 18);
    expect(tax).toBe(1800);
    expect(gross).toBe(11800);
  });

  it('rejects negative or non-finite rates', () => {
    expect(() => splitTaxInclusive(toMoney('100.00'), -1)).toThrow();
    expect(() => splitTaxInclusive(toMoney('100.00'), NaN)).toThrow();
    expect(() => applyTaxExclusive(toMoney('100.00'), -1)).toThrow();
    expect(() => applyTaxExclusive(toMoney('100.00'), NaN)).toThrow();
  });
});

describe('overflow refusal at MAX_SAFE_INTEGER', () => {
  it('toMoney rejects paise exceeding MAX_SAFE_INTEGER', () => {
    // MAX_SAFE_INTEGER = 9007199254740991
    // rupees = ~90071992547409.91
    const tooBig = '90071992547410.00';
    expect(() => toMoney(tooBig)).toThrow(/overflow/);
  });

  it('addMoney refuses to cross MAX_SAFE_INTEGER', () => {
    const near = (Number.MAX_SAFE_INTEGER - 10) as Money;
    expect(() => addMoney(near, 100 as Money)).toThrow(/overflow/);
  });

  it('mulMoney refuses overflow', () => {
    const big = 1_000_000_000_000 as Money;
    expect(() => mulMoney(big, 1_000_000)).toThrow(/overflow/);
  });

  it('sumMoney refuses overflow mid-sum', () => {
    const big = (Number.MAX_SAFE_INTEGER - 10) as Money;
    expect(() => sumMoney([big, 100 as Money])).toThrow(/overflow/);
  });
});
