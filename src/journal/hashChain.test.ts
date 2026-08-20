import { describe, expect, it } from 'vitest';
import { BusinessVaultDB } from '../db/database';
import { createEvent } from './journalWriter';
import { verifyChain } from './hashChain';
import { canonicalJson, sha256Hex, GENESIS_HASH } from './event';
import { appendSyncEvent, tailPayloadHash } from '../domain/syncEventLog';

function freshDb(): BusinessVaultDB {
  return new BusinessVaultDB('bv-test-' + Math.random().toString(36).slice(2));
}

describe('canonicalJson', () => {
  it('sorts keys deterministically at all depths', () => {
    const a = canonicalJson({ b: 1, a: { d: 4, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 4 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":4},"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined values but keeps null', () => {
    expect(canonicalJson({ a: undefined, b: null, c: 1 })).toBe('{"b":null,"c":1}');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow();
  });
});

describe('sha256Hex', () => {
  it('produces the known SHA-256 hex of empty string', async () => {
    const h = await sha256Hex('');
    expect(h).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('produces the known SHA-256 hex of "abc"', async () => {
    const h = await sha256Hex('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('verifyChain', () => {
  it('returns valid=true for an empty chain (genesis-only)', async () => {
    const db = freshDb();
    const r = await verifyChain('biz-1', { db });
    expect(r.valid).toBe(true);
    expect(r.count).toBe(0);
  });

  it('validates a chain of three events', async () => {
    const db = freshDb();
    const businessId = 'biz-1';
    const e1 = await createEvent(
      {
        businessId,
        entityType: 'invoice',
        entityId: 'inv-1',
        operation: 'created',
        entityVersion: 1,
        payload: { total: 100 },
        timestamp: '2026-08-19T10:00:00.000Z',
        deviceId: 'd1',
      },
      { db },
    );
    expect(e1.previousHash).toBe(GENESIS_HASH);

    const e2 = await createEvent(
      {
        businessId,
        entityType: 'invoice',
        entityId: 'inv-1',
        operation: 'updated',
        entityVersion: 2,
        payload: { total: 120 },
        timestamp: '2026-08-19T10:00:01.000Z',
        deviceId: 'd1',
      },
      { db },
    );
    expect(e2.previousHash).toBe(e1.payloadHash);

    const e3 = await createEvent(
      {
        businessId,
        entityType: 'payment',
        entityId: 'pay-1',
        operation: 'created',
        entityVersion: 1,
        payload: { amount: 50 },
        timestamp: '2026-08-19T10:00:02.000Z',
        deviceId: 'd1',
      },
      { db },
    );
    expect(e3.previousHash).toBe(e2.payloadHash);

    const r = await verifyChain(businessId, { db });
    expect(r.valid).toBe(true);
    expect(r.count).toBe(3);
  });

  it('detects tampered payload', async () => {
    const db = freshDb();
    const businessId = 'biz-2';
    const e1 = await createEvent(
      {
        businessId,
        entityType: 'invoice',
        entityId: 'inv-1',
        operation: 'created',
        entityVersion: 1,
        payload: { total: 100 },
        deviceId: 'd1',
        timestamp: '2026-08-19T10:00:00.000Z',
      },
      { db },
    );

    // Rewrite the persisted payload (snake_case column, camelCase field on
    // the SyncEvent shape both exist; the row stored is snake_case).
    await db.sync_events.update(e1.eventId, {
      payload: { total: 999 },
    } as unknown as Partial<import('../db/types').SyncEvent>);

    const r = await verifyChain(businessId, { db });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('payload_hash_mismatch');
    expect(r.brokenAt).toBe(e1.eventId);
  });

  it('detects broken previousHash link', async () => {
    const db = freshDb();
    const businessId = 'biz-3';
    await createEvent(
      {
        businessId,
        entityType: 'invoice',
        entityId: 'inv-1',
        operation: 'created',
        entityVersion: 1,
        payload: { total: 100 },
        deviceId: 'd1',
        timestamp: '2026-08-19T10:00:00.000Z',
      },
      { db },
    );
    const e2 = await createEvent(
      {
        businessId,
        entityType: 'invoice',
        entityId: 'inv-1',
        operation: 'updated',
        entityVersion: 2,
        payload: { total: 200 },
        deviceId: 'd1',
        timestamp: '2026-08-19T10:00:01.000Z',
      },
      { db },
    );

    await db.sync_events.update(e2.eventId, {
      previous_hash: 'f'.repeat(64),
    } as unknown as Partial<import('../db/types').SyncEvent>);

    const r = await verifyChain(businessId, { db });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('previous_hash_mismatch');
    expect(r.brokenAt).toBe(e2.eventId);
  });
});

// The point of the naming unification: appendSyncEvent (production callers
// like AdvanceService) and createEvent (AccountingService.emit) must land
// in ONE hash chain, seen by the same tail-lookup.
describe('cross-writer chain parity', () => {
  it('appendSyncEvent and createEvent share tailPayloadHash and chain together', async () => {
    const db = freshDb();
    const businessId = 'biz-parity';

    // Writer A: appendSyncEvent (must be wrapped in a rw tx by caller).
    const a = await db.transaction('rw', db.sync_events, async () => {
      return appendSyncEvent(db, {
        businessId,
        deviceId: 'd1',
        entityType: 'invoice',
        entityId: 'inv-A',
        operation: 'created',
        payload: { a: 1 },
        timestamp: '2026-08-19T10:00:00.000Z',
      });
    });

    // After A, tail hash is A's payload_hash.
    expect(await tailPayloadHash(db, businessId)).toBe(a.payloadHash);

    // Writer B: createEvent. It computes previousHash from the tail — should
    // see A's hash.
    const b = await createEvent(
      {
        businessId,
        entityType: 'journal_entry',
        entityId: 'je-1',
        operation: 'posted',
        entityVersion: 1,
        payload: { total: 500 },
        deviceId: 'd1',
        timestamp: '2026-08-19T10:00:01.000Z',
      },
      { db },
    );
    expect(b.previousHash).toBe(a.payloadHash);

    // Tail now advances to B.
    expect(await tailPayloadHash(db, businessId)).toBe(b.payloadHash);

    // Writer A again — chains from B.
    const c = await db.transaction('rw', db.sync_events, async () => {
      return appendSyncEvent(db, {
        businessId,
        deviceId: 'd1',
        entityType: 'invoice',
        entityId: 'inv-A',
        operation: 'updated',
        payload: { a: 2 },
        timestamp: '2026-08-19T10:00:02.000Z',
      });
    });
    expect(c.previousHash).toBe(b.payloadHash);

    // Full chain verifies end-to-end.
    const r = await verifyChain(businessId, { db });
    expect(r.valid).toBe(true);
    expect(r.count).toBe(3);
  });
});
