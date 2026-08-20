import { describe, expect, it, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { BusinessVaultDB } from '../db/database';
import { UnitService } from './UnitService';

const BIZ = 'biz-unit';
const DEV = 'dev-unit';

function freshDb(): BusinessVaultDB {
  return new BusinessVaultDB('bv-unit-' + Math.random().toString(36).slice(2));
}

describe('UnitService', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('creates a unit and emits event', async () => {
    const db = freshDb();
    const svc = new UnitService({ db });
    const u = await svc.create({
      businessId: BIZ,
      deviceId: DEV,
      code: 'KG',
      name: 'Kilogram',
      decimalPlaces: 3,
    });
    expect(u.decimal_places).toBe(3);
    expect((await db.sync_events.toArray()).length).toBe(1);
  });

  it('rejects out-of-range decimal_places and rolls back', async () => {
    const db = freshDb();
    const svc = new UnitService({ db });
    await expect(
      svc.create({
        businessId: BIZ,
        deviceId: DEV,
        code: 'X',
        name: 'X',
        decimalPlaces: 7,
      }),
    ).rejects.toThrow(/decimalPlaces/);
    expect((await db.units.toArray()).length).toBe(0);
  });
});
