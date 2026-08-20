import { describe, expect, it, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { BusinessVaultDB } from '../db/database';
import { CategoryService } from './CategoryService';

const BIZ = 'biz-cat';
const DEV = 'dev-cat';

function freshDb(): BusinessVaultDB {
  return new BusinessVaultDB('bv-cat-' + Math.random().toString(36).slice(2));
}

describe('CategoryService', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('creates a category and emits event', async () => {
    const db = freshDb();
    const svc = new CategoryService({ db });
    const c = await svc.create({
      businessId: BIZ,
      deviceId: DEV,
      name: 'Electronics',
    });
    expect(c.entity_version).toBe(1);
    expect((await db.sync_events.toArray()).length).toBe(1);
  });

  it('rejects unknown parent and rolls back', async () => {
    const db = freshDb();
    const svc = new CategoryService({ db });
    await expect(
      svc.create({
        businessId: BIZ,
        deviceId: DEV,
        name: 'Phones',
        parentId: 'does-not-exist',
      }),
    ).rejects.toThrow(/Parent category not found/);
    expect((await db.categories.toArray()).length).toBe(0);
    expect((await db.sync_events.toArray()).length).toBe(0);
  });
});
