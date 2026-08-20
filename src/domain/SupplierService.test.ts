import { describe, expect, it, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { BusinessVaultDB } from '../db/database';
import { SupplierService } from './SupplierService';

const BIZ = 'biz-supp';
const DEV = 'dev-supp';

function freshDb(): BusinessVaultDB {
  return new BusinessVaultDB('bv-sup-' + Math.random().toString(36).slice(2));
}

describe('SupplierService', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('creates supplier and emits supplier.created', async () => {
    const db = freshDb();
    const svc = new SupplierService({ db });
    const s = await svc.create({
      businessId: BIZ,
      deviceId: DEV,
      name: 'XYZ Vendors',
      stateCode: '07',
      openingBalancePaise: 12500,
    });
    expect(s.entity_version).toBe(1);
    expect(s.state_code).toBe('07');
    const events = (await db.sync_events.toArray()) as unknown as Array<
      Record<string, unknown>
    >;
    expect(events.length).toBe(1);
    expect(events[0]['entity_type']).toBe('supplier');
    expect(events[0]['operation']).toBe('created');
  });

  it('rejects invalid state code and rolls back', async () => {
    const db = freshDb();
    const svc = new SupplierService({ db });
    await expect(
      svc.create({
        businessId: BIZ,
        deviceId: DEV,
        name: 'Bad State',
        stateCode: '99', // out of 01..38 range
      }),
    ).rejects.toThrow(/Invalid state code/);
    expect((await db.suppliers.toArray()).length).toBe(0);
    expect((await db.sync_events.toArray()).length).toBe(0);
  });
});
