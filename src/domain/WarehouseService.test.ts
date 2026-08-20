import { describe, expect, it, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { BusinessVaultDB } from '../db/database';
import { WarehouseService } from './WarehouseService';

const BIZ = 'biz-wh';
const DEV = 'dev-wh';

function freshDb(): BusinessVaultDB {
  return new BusinessVaultDB('bv-wh-' + Math.random().toString(36).slice(2));
}

describe('WarehouseService', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('creates a warehouse and emits event', async () => {
    const db = freshDb();
    const svc = new WarehouseService({ db });
    const w = await svc.create({
      businessId: BIZ,
      deviceId: DEV,
      name: 'Main',
      isDefault: true,
    });
    expect(w.is_default).toBe(1);
    const events = await db.sync_events.toArray();
    expect(events.length).toBe(1);
  });

  it('rejects duplicate warehouse name and rolls back', async () => {
    const db = freshDb();
    const svc = new WarehouseService({ db });
    await svc.create({ businessId: BIZ, deviceId: DEV, name: 'Warehouse-A' });
    await expect(
      svc.create({ businessId: BIZ, deviceId: DEV, name: 'Warehouse-A' }),
    ).rejects.toThrow(/already exists/);
    const rows = await db.warehouses.toArray();
    expect(rows.length).toBe(1);
    const events = await db.sync_events.toArray();
    expect(events.length).toBe(1);
  });
});
