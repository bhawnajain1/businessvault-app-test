export type SyncOperation =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'reversed'
  | 'voided'
  | 'allocated'
  | 'posted'
  | 'adjusted'
  | 'movement';

export type SyncStatus =
  | 'LOCAL_ONLY'
  | 'QUEUED'
  | 'SYNCING'
  | 'SYNCED'
  | 'CONFLICT'
  | 'FAILED';

export interface SyncEvent {
  eventId: string;
  businessId: string;
  deviceId: string;
  entityType: string;
  entityId: string;
  operation: SyncOperation;
  entityVersion: number;
  timestamp: string;
  payload: unknown;
  payloadHash: string;
  previousHash: string;
  syncStatus: SyncStatus;
  idempotencyKey?: string;
}

export const GENESIS_HASH = '0'.repeat(64);

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonical(value));
}

function sortForCanonical(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonicalJson: non-finite number is not JSON-safe');
    }
    return value;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sortForCanonical(v));
  }
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(src).sort();
    for (const k of keys) {
      const v = src[k];
      if (typeof v === 'undefined') continue;
      out[k] = sortForCanonical(v);
    }
    return out;
  }
  throw new Error(`canonicalJson: unsupported value of type ${typeof value}`);
}

export async function sha256Hex(input: string): Promise<string> {
  const subtle = getSubtle();
  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest('SHA-256', bytes);
  return bufferToHex(digest);
}

function getSubtle(): SubtleCrypto {
  const g = globalThis as unknown as {
    crypto?: { subtle?: SubtleCrypto };
  };
  if (g.crypto && g.crypto.subtle) return g.crypto.subtle;
  throw new Error('Web Crypto SubtleCrypto is not available in this environment');
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}
