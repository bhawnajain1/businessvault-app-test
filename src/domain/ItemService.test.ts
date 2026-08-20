import { describe, expect, it, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { BusinessVaultDB } from '../db/database';
import { ItemService } from './ItemService';

const BIZ = 'biz-item';
const DEV = 'dev-item';

function freshDb(): BusinessVaultDB {
  return new BusinessVaultDB('bv-item-' + Math.random().toString(36).slice(2));
}

describe('ItemService', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('creates an item and emits item.created', async () => {
    const db = freshDb();
    const svc = new ItemService({ db });
    const i = await svc.create({
      businessId: BIZ,
      deviceId: DEV,
      sku: 'SKU-1',
      name: 'Widget',
      unitId: 'unit-1',
      salePricePaise: 10000,
      purchasePricePaise: 7000,
      taxRateBps: 1800,
      openingQtyMicros: 10_000_000,
    });
    expect(i.entity_version).toBe(1);
    expect(i.hsn).toBe('');
    const events = (await db.sync_events.toArray()) as unknown as Array<
      Record<string, unknown>
    >;
    expect(events.length).toBe(1);
    expect(events[0]['entity_type']).toBe('item');
  });

  it('rejects duplicate SKU within the same business', async () => {
    const db = freshDb();
    const svc = new ItemService({ db });
    await svc.create({
      businessId: BIZ,
      deviceId: DEV,
      sku: 'DUP',
      name: 'One',
      unitId: 'u',
      salePricePaise: 100,
      purchasePricePaise: 100,
      taxRateBps: 0,
    });
    await expect(
      svc.create({
        businessId: BIZ,
        deviceId: DEV,
        sku: 'DUP',
        name: 'Two',
        unitId: 'u',
        salePricePaise: 100,
        purchasePricePaise: 100,
        taxRateBps: 0,
      }),
    ).rejects.toThrow(/SKU already exists/);
    const items = await db.items.toArray();
    expect(items.length).toBe(1);
    const events = await db.sync_events.toArray();
    expect(events.length).toBe(1);
  });
});
