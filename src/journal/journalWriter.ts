import Dexie from 'dexie';
import { ulid } from 'ulid';
import { getDeviceId } from '../lib/device';
import { db as defaultDb } from '../db';
import type { BusinessVaultDB } from '../db/database';
import {
  GENESIS_HASH,
  canonicalJson,
  sha256Hex,
  type SyncEvent,
  type SyncOperation,
  type SyncStatus,
} from './event';

export interface CreateEventInput {
  businessId: string;
  entityType: string;
  entityId: string;
  operation: SyncOperation;
  entityVersion: number;
  payload: unknown;
  deviceId?: string;
  timestamp?: string;
  eventId?: string;
  syncStatus?: SyncStatus;
  idempotencyKey?: string;
}

export interface CreateEventOptions {
  db?: BusinessVaultDB;
}

// Writes an event to the production sync_events table (snake_case rows).
// Return shape is camelCase — same as appendSyncEvent — so both writers'
// events participate in one hash chain readable via tailPayloadHash.
export async function createEvent(
  input: CreateEventInput,
  opts: CreateEventOptions = {},
): Promise<SyncEvent> {
  const db = opts.db ?? defaultDb;

  const deviceId = input.deviceId ?? (await getDeviceId());
  const timestamp = input.timestamp ?? new Date().toISOString();
  const eventId = input.eventId ?? ulid();
  const syncStatus: SyncStatus = input.syncStatus ?? 'LOCAL_ONLY';

  return await db.transaction('rw', db.sync_events, async () => {
    if (input.idempotencyKey) {
      const existing = await findByIdempotencyKey(
        db,
        input.businessId,
        input.idempotencyKey,
      );
      if (existing) return existing;
    }

    const previousHash = await tailPayloadHash(db, input.businessId);
    const payloadHash = await Dexie.waitFor(
      sha256Hex(canonicalJson(input.payload)),
    );

    const evt: SyncEvent = {
      eventId,
      businessId: input.businessId,
      deviceId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      entityVersion: input.entityVersion,
      timestamp,
      payload: input.payload,
      payloadHash,
      previousHash,
      syncStatus,
    };
    if (input.idempotencyKey) evt.idempotencyKey = input.idempotencyKey;

    const row = {
      event_id: evt.eventId,
      business_id: evt.businessId,
      device_id: evt.deviceId,
      entity_type: evt.entityType,
      entity_id: evt.entityId,
      operation: evt.operation,
      entity_version: evt.entityVersion,
      timestamp: evt.timestamp,
      payload: evt.payload,
      payload_hash: evt.payloadHash,
      previous_hash: evt.previousHash,
      sync_status: evt.syncStatus,
      sync_attempts: 0,
      last_error: null,
      synced_at: null,
      journal_file: null,
      idempotency_key: evt.idempotencyKey ?? null,
    };
    await db.sync_events.add(row as unknown as import('../db/types').SyncEvent);
    return evt;
  });
}

async function findByIdempotencyKey(
  db: BusinessVaultDB,
  businessId: string,
  key: string,
): Promise<SyncEvent | undefined> {
  const rows = (await db.sync_events
    .where('business_id')
    .equals(businessId)
    .toArray()) as unknown as Array<Record<string, unknown>>;
  for (const r of rows) {
    if (r['idempotency_key'] === key) return rowToEvent(r);
  }
  return undefined;
}

async function tailPayloadHash(
  db: BusinessVaultDB,
  businessId: string,
): Promise<string> {
  const rows = (await db.sync_events
    .where('[business_id+timestamp]')
    .between([businessId, ''], [businessId, '￿'])
    .toArray()) as unknown as Array<Record<string, unknown>>;
  if (rows.length === 0) return GENESIS_HASH;
  rows.sort((a, b) => {
    const ta = String(a['timestamp']);
    const tb = String(b['timestamp']);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a['event_id']) < String(b['event_id']) ? -1 : 1;
  });
  return String(rows[rows.length - 1]['payload_hash'] ?? GENESIS_HASH);
}

function rowToEvent(r: Record<string, unknown>): SyncEvent {
  return {
    eventId: String(r['event_id']),
    businessId: String(r['business_id']),
    deviceId: String(r['device_id']),
    entityType: String(r['entity_type']),
    entityId: String(r['entity_id']),
    operation: r['operation'] as SyncOperation,
    entityVersion: Number(r['entity_version']),
    timestamp: String(r['timestamp']),
    payload: r['payload'],
    payloadHash: String(r['payload_hash']),
    previousHash: String(r['previous_hash']),
    syncStatus: r['sync_status'] as SyncStatus,
    ...(r['idempotency_key']
      ? { idempotencyKey: String(r['idempotency_key']) }
      : {}),
  };
}
