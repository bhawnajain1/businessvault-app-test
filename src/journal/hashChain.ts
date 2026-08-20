import { db as defaultDb } from '../db';
import type { BusinessVaultDB } from '../db/database';
import { GENESIS_HASH, canonicalJson, sha256Hex } from './event';

export interface VerifyChainResult {
  valid: boolean;
  count: number;
  brokenAt?: string;
  reason?: 'payload_hash_mismatch' | 'previous_hash_mismatch';
  expected?: string;
  actual?: string;
}

export interface VerifyChainOptions {
  db?: BusinessVaultDB;
}

interface StoredEventRow {
  event_id: string;
  timestamp: string;
  payload: unknown;
  payload_hash: string;
  previous_hash: string;
}

export async function verifyChain(
  businessId: string,
  opts: VerifyChainOptions = {},
): Promise<VerifyChainResult> {
  const db = opts.db ?? defaultDb;
  const rows = (await db.sync_events
    .where('[business_id+timestamp]')
    .between([businessId, ''], [businessId, '￿'])
    .toArray()) as unknown as StoredEventRow[];

  const ordered = stableOrder(rows);

  let prev = GENESIS_HASH;
  for (const row of ordered) {
    const expectedPayloadHash = await sha256Hex(canonicalJson(row.payload));
    if (row.payload_hash !== expectedPayloadHash) {
      return {
        valid: false,
        count: ordered.length,
        brokenAt: row.event_id,
        reason: 'payload_hash_mismatch',
        expected: expectedPayloadHash,
        actual: row.payload_hash,
      };
    }
    if (row.previous_hash !== prev) {
      return {
        valid: false,
        count: ordered.length,
        brokenAt: row.event_id,
        reason: 'previous_hash_mismatch',
        expected: prev,
        actual: row.previous_hash,
      };
    }
    prev = row.payload_hash;
  }

  return { valid: true, count: ordered.length };
}

function stableOrder(rows: StoredEventRow[]): StoredEventRow[] {
  return [...rows].sort((a, b) => {
    if (a.timestamp === b.timestamp) {
      return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
    }
    return a.timestamp < b.timestamp ? -1 : 1;
  });
}
