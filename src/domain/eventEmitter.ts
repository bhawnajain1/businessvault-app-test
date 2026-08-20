import { currentBusinessId } from '../lib/business';
import { getDeviceId } from '../lib/device';
import { db as defaultDb } from '../db';
import type { BusinessVaultDB } from '../db/database';
import { createEvent } from '../journal/journalWriter';
import type { SyncEvent } from '../journal/event';
import type {
  BusinessEvent,
  BusinessEventEntityType,
  BusinessEventOperation,
  PayloadFor,
} from './eventTypes';

export interface EmitOptions {
  idempotencyKey?: string;
  businessId?: string;
  deviceId?: string;
  db?: BusinessVaultDB;
  timestamp?: string;
}

export async function emit<T extends BusinessEvent>(
  entityType: T['entityType'],
  operation: T['operation'],
  entityId: string,
  payload: PayloadFor<T['entityType'], T['operation']>,
  opts: EmitOptions = {},
): Promise<SyncEvent> {
  const db = opts.db ?? defaultDb;
  const businessId = opts.businessId ?? (await currentBusinessId());
  const deviceId = opts.deviceId ?? (await getDeviceId());

  const entityVersion = await nextEntityVersion(
    db,
    businessId,
    entityType,
    entityId,
  );

  return createEvent(
    {
      businessId,
      deviceId,
      entityType,
      entityId,
      operation,
      entityVersion,
      payload,
      idempotencyKey: opts.idempotencyKey,
      timestamp: opts.timestamp,
    },
    { db },
  );
}

async function nextEntityVersion(
  db: BusinessVaultDB,
  businessId: string,
  entityType: BusinessEventEntityType,
  entityId: string,
): Promise<number> {
  const rows = (await db.sync_events
    .where('[business_id+entity_type+entity_id]')
    .equals([businessId, entityType, entityId])
    .toArray()) as unknown as Array<Record<string, unknown>>;
  if (rows.length === 0) return 1;
  let max = 0;
  for (const r of rows) {
    const v = Number(r['entity_version'] ?? 0);
    if (v > max) max = v;
  }
  return max + 1;
}

export type { BusinessEvent, BusinessEventEntityType, BusinessEventOperation };
