/**
 * Regression test for formula-injection prefix coverage in Excel export.
 *
 * Defect: FORMULA_PREFIXES was missing '\t' and '\r'. Attackers could inject
 * a leading tab/CR into a text field which, once opened in Excel, could still
 * be interpreted as a formula.
 */
import { describe, it, expect } from 'vitest';
import { safeCell } from './excelExport';

describe('excelExport safeCell — formula-injection sanitization', () => {
  it('prefixes standard formula sigils', () => {
    expect(safeCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(safeCell('+1+1')).toBe("'+1+1");
    expect(safeCell('-2')).toBe("'-2");
    expect(safeCell('@cmd')).toBe("'@cmd");
  });

  it("prefixes '\\t' and '\\r' (regression — previously missing)", () => {
    expect(safeCell('\tSUM(A1)')).toBe("'\tSUM(A1)");
    expect(safeCell('\rEVIL()')).toBe("'\rEVIL()");
  });

  it('leaves benign values alone', () => {
    expect(safeCell('Acme Ltd')).toBe('Acme Ltd');
    expect(safeCell(42)).toBe(42);
    expect(safeCell(null)).toBe(null);
    expect(safeCell(undefined)).toBe(null);
    expect(safeCell('')).toBe('');
  });
});
