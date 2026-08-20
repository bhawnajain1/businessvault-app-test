import { describe, expect, it } from 'vitest';
import { BusinessVaultDB } from '../db/database';
import { createEvent } from './journalWriter';
import { GENESIS_HASH, canonicalJson, sha256Hex } from './event';

function freshDb(): BusinessVaultDB {
  return new BusinessVaultDB(
    'bv-writer-' + Math.random().toString(36).slice(2),
  );
}

describe('createEvent', () => {
  it('genesis event has previousHash of 64 zeros', async () => {
    const db = freshDb();
    const evt = await createEvent(
      {
        businessId: 'biz',
        entityType: 'invoice',
        entityId: 'inv-1',
        operation: 'created',
        entityVersion: 1,
        payload: { a: 1 },
        deviceId: 'd1',
        timestamp: '2026-08-19T00:00:00.000Z',
      },
      { db },
    );
    expect(evt.previousHash).toBe(GENESIS_HASH);
    expect(evt.payloadHash).toBe(await sha256Hex(canonicalJson({ a: 1 })));
    expect(evt.eventId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(evt.syncStatus).toBe('LOCAL_ONLY');
  });

  it('subsequent events chain from prior payloadHash', async () => {
    const db = freshDb();
    const businessId = 'biz';
    const e1 = await createEvent(
      {
        businessId,
        entityType: 'x',
        entityId: '1',
        operation: 'created',
        entityVersion: 1,
        payload: { v: 1 },
        deviceId: 'd1',
        timestamp: '2026-08-19T00:00:00.000Z',
      },
      { db },
    );
    const e2 = await createEvent(
      {
        businessId,
        entityType: 'x',
        entityId: '1',
        operation: 'updated',
        entityVersion: 2,
        payload: { v: 2 },
        deviceId: 'd1',
        timestamp: '2026-08-19T00:00:01.000Z',
      },
      { db },
    );
    expect(e2.previousHash).toBe(e1.payloadHash);
  });

  it('scopes previousHash to businessId', async () => {
    const db = freshDb();
    const a = await createEvent(
      {
        businessId: 'A',
        entityType: 'x',
        entityId: '1',
        operation: 'created',
        entityVersion: 1,
        payload: { v: 1 },
        deviceId: 'd1',
        timestamp: '2026-08-19T00:00:00.000Z',
      },
      { db },
    );
    const b = await createEvent(
      {
        businessId: 'B',
        entityType: 'x',
        entityId: '1',
        operation: 'created',
        entityVersion: 1,
        payload: { v: 1 },
        deviceId: 'd1',
        timestamp: '2026-08-19T00:00:00.000Z',
      },
      { db },
    );
    expect(a.previousHash).toBe(GENESIS_HASH);
    expect(b.previousHash).toBe(GENESIS_HASH);
  });

  it('is idempotent when idempotencyKey is reused', async () => {
    const db = freshDb();
    const businessId = 'biz';
    const key = 'op-abc-123';
    const first = await createEvent(
      {
        businessId,
        entityType: 'invoice',
        entityId: 'inv-1',
        operation: 'created',
        entityVersion: 1,
        payload: { total: 100 },
        deviceId: 'd1',
        timestamp: '2026-08-19T00:00:00.000Z',
        idempotencyKey: key,
      },
      { db },
    );
    const second = await createEvent(
      {
        businessId,
        entityType: 'invoice',
        entityId: 'inv-1',
        operation: 'created',
        entityVersion: 1,
        payload: { total: 100 },
        deviceId: 'd1',
        timestamp: '2026-08-19T00:00:05.000Z',
        idempotencyKey: key,
      },
      { db },
    );
    expect(second.eventId).toBe(first.eventId);
    const count = await db.sync_events
      .where('business_id')
      .equals(businessId)
      .count();
    expect(count).toBe(1);
  });

  it('produces identical payloadHash regardless of input key order', async () => {
    const db = freshDb();
    const e1 = await createEvent(
      {
        businessId: 'biz',
        entityType: 'x',
        entityId: '1',
        operation: 'created',
        entityVersion: 1,
        payload: { b: 2, a: 1, nested: { z: 9, y: 8 } },
        deviceId: 'd1',
        timestamp: '2026-08-19T00:00:00.000Z',
      },
      { db },
    );
    const e2Hash = await sha256Hex(
      canonicalJson({ a: 1, nested: { y: 8, z: 9 }, b: 2 }),
    );
    expect(e1.payloadHash).toBe(e2Hash);
  });

  it('persists snake_case columns for deviceId, timestamp, entityVersion, syncStatus', async () => {
    const db = freshDb();
    const evt = await createEvent(
      {
        businessId: 'biz',
        entityType: 'invoice',
        entityId: 'inv-1',
        operation: 'created',
        entityVersion: 7,
        payload: {},
        deviceId: 'device-xyz',
        timestamp: '2026-08-19T00:00:00.000Z',
        syncStatus: 'QUEUED',
      },
      { db },
    );
    const row = (await db.sync_events.get(evt.eventId)) as unknown as Record<
      string,
      unknown
    >;
    expect(row?.['device_id']).toBe('device-xyz');
    expect(row?.['entity_version']).toBe(7);
    expect(row?.['timestamp']).toBe('2026-08-19T00:00:00.000Z');
    expect(row?.['sync_status']).toBe('QUEUED');
  });
});
