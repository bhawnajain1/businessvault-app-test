import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  __resetMetaDbForTests,
  getDeviceId,
  getDeviceLabel,
  metaDb,
} from './device';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  __resetMetaDbForTests();
});

describe('getDeviceId', () => {
  it('creates and persists a ULID on first call', async () => {
    const id = await getDeviceId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const rows = await metaDb().devices.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deviceId: id,
      id,
    });
    expect(rows[0].createdAt).toBeTruthy();
    expect(typeof rows[0].userAgent).toBe('string');
    expect(typeof rows[0].platform).toBe('string');
  });

  it('returns the same id on subsequent calls (in-memory cache)', async () => {
    const first = await getDeviceId();
    const second = await getDeviceId();
    expect(second).toBe(first);

    const rows = await metaDb().devices.toArray();
    expect(rows).toHaveLength(1);
  });

  it('reloads the persisted id across a simulated app restart', async () => {
    const first = await getDeviceId();
    __resetMetaDbForTests();
    const second = await getDeviceId();
    expect(second).toBe(first);

    const rows = await metaDb().devices.toArray();
    expect(rows).toHaveLength(1);
  });
});

describe('getDeviceLabel', () => {
  it('produces a label with a 4-char parenthesized suffix', async () => {
    const label = await getDeviceLabel();
    expect(label).toMatch(/^.+ \([0-9a-z]{4}\)$/);
  });

  it('is stable across calls', async () => {
    const a = await getDeviceLabel();
    const b = await getDeviceLabel();
    expect(a).toBe(b);
  });

  it('persists in the devices row', async () => {
    const label = await getDeviceLabel();
    const row = await metaDb().devices.toCollection().first();
    expect(row?.label).toBe(label);
  });
});
