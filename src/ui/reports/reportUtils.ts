import { fromMoney, type Money } from '../../domain/money';

export function money(paise: number): string {
  return fromMoney(paise as Money);
}

export function paiseToRupees(paise: number): number {
  return Number((paise / 100).toFixed(2));
}

export function toDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDateInput(s: string): Date {
  if (!s) return new Date();
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function financialYearStart(asOf: Date, startMonth: number = 4): Date {
  const m = asOf.getUTCMonth() + 1;
  const y = asOf.getUTCFullYear();
  const fyYear = m >= startMonth ? y : y - 1;
  return new Date(Date.UTC(fyYear, startMonth - 1, 1));
}
