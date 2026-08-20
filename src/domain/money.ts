export type Money = number & { __brand: 'Money' };

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function assertSafe(paise: number): void {
  if (!Number.isInteger(paise)) {
    throw new Error(`Money must be integer paise, got ${paise}`);
  }
  if (paise > MAX_SAFE || paise < -MAX_SAFE) {
    throw new Error(`Money overflow: ${paise} exceeds Number.MAX_SAFE_INTEGER`);
  }
}

export function toMoney(rupees: number | string, opts?: { allowNegative?: boolean }): Money {
  const allowNegative = opts?.allowNegative ?? false;
  let sign = 1;
  let intPart: string;
  let fracPart: string;

  if (typeof rupees === 'number') {
    if (!Number.isFinite(rupees)) {
      throw new Error(`Money: not a finite number: ${rupees}`);
    }
    if (rupees < 0) {
      if (!allowNegative) throw new Error(`Money: negative not allowed: ${rupees}`);
      sign = -1;
    }
    const abs = Math.abs(rupees);
    const s = abs.toFixed(2);
    const dot = s.indexOf('.');
    intPart = s.slice(0, dot);
    fracPart = s.slice(dot + 1);
    // sanity: round-trip
    const parsed = Number(s);
    if (Math.abs(parsed - abs) > 1e-9 && (abs.toString().split('.')[1]?.length ?? 0) > 2) {
      throw new Error(`Money: more than 2 decimals not allowed: ${rupees}`);
    }
  } else {
    const raw = rupees.trim();
    if (raw.length === 0) throw new Error(`Money: empty string`);
    let body = raw;
    if (body.startsWith('-')) {
      if (!allowNegative) throw new Error(`Money: negative not allowed: ${rupees}`);
      sign = -1;
      body = body.slice(1);
    } else if (body.startsWith('+')) {
      body = body.slice(1);
    }
    // strip Indian commas
    body = body.replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(body)) {
      if (/^\d+\.\d{3,}$/.test(body)) {
        throw new Error(`Money: more than 2 decimals not allowed: ${rupees}`);
      }
      throw new Error(`Money: invalid format: ${rupees}`);
    }
    const dot = body.indexOf('.');
    if (dot === -1) {
      intPart = body;
      fracPart = '00';
    } else {
      intPart = body.slice(0, dot);
      fracPart = body.slice(dot + 1).padEnd(2, '0');
    }
  }

  const paise = sign * (Number(intPart) * 100 + Number(fracPart));
  assertSafe(paise);
  return paise as Money;
}

export function fromMoney(m: Money): string {
  const neg = m < 0;
  const abs = Math.abs(m);
  const rupees = Math.floor(abs / 100);
  const paise = abs - rupees * 100;

  const rupeeStr = rupees.toString();
  let formatted: string;
  if (rupeeStr.length <= 3) {
    formatted = rupeeStr;
  } else {
    const last3 = rupeeStr.slice(-3);
    const rest = rupeeStr.slice(0, -3);
    const withCommas = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    formatted = `${withCommas},${last3}`;
  }
  const paiseStr = paise.toString().padStart(2, '0');
  return `${neg ? '-' : ''}${formatted}.${paiseStr}`;
}

export function addMoney(a: Money, b: Money): Money {
  const r = a + b;
  assertSafe(r);
  return r as Money;
}

export function subMoney(a: Money, b: Money): Money {
  const r = a - b;
  assertSafe(r);
  return r as Money;
}

function bankersRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  // exactly .5 — round to even
  return floor % 2 === 0 ? floor : floor + 1;
}

export function mulMoney(m: Money, factor: number): Money {
  if (!Number.isFinite(factor)) throw new Error(`mulMoney: factor not finite: ${factor}`);
  const product = m * factor;
  if (!Number.isFinite(product)) throw new Error(`mulMoney: overflow`);
  const rounded = m >= 0 ? bankersRound(product) : -bankersRound(-product);
  assertSafe(rounded);
  return rounded as Money;
}

export function sumMoney(list: Money[]): Money {
  let acc = 0;
  for (const v of list) {
    acc += v;
    assertSafe(acc);
  }
  return acc as Money;
}

export function splitTaxInclusive(gross: Money, rate: number): { net: Money; tax: Money } {
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error(`splitTaxInclusive: invalid rate ${rate}`);
  }
  // net = gross / (1 + rate/100); rate expressed in percent
  const denom = 1 + rate / 100;
  const netRaw = gross / denom;
  const netRounded = gross >= 0 ? bankersRound(netRaw) : -bankersRound(-netRaw);
  const net = netRounded as Money;
  const tax = (gross - net) as Money;
  assertSafe(net);
  assertSafe(tax);
  return { net, tax };
}

export function applyTaxExclusive(net: Money, rate: number): { tax: Money; gross: Money } {
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error(`applyTaxExclusive: invalid rate ${rate}`);
  }
  const taxRaw = (net * rate) / 100;
  const taxRounded = net >= 0 ? bankersRound(taxRaw) : -bankersRound(-taxRaw);
  const tax = taxRounded as Money;
  const gross = (net + tax) as Money;
  assertSafe(tax);
  assertSafe(gross);
  return { tax, gross };
}
