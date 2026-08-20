import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { __resetMetaDbForTests } from './device';
import {
  NotOnboardedError,
  currentBusinessId,
  setCurrentBusinessId,
} from './business';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  __resetMetaDbForTests();
});

describe('currentBusinessId', () => {
  it('throws NotOnboardedError before onboarding', async () => {
    await expect(currentBusinessId()).rejects.toBeInstanceOf(NotOnboardedError);
  });

  it('returns the id after setCurrentBusinessId', async () => {
    await setCurrentBusinessId('biz_01HXYZ');
    const id = await currentBusinessId();
    expect(id).toBe('biz_01HXYZ');
  });

  it('overwrites the singleton on subsequent set calls', async () => {
    await setCurrentBusinessId('biz_A');
    await setCurrentBusinessId('biz_B');
    const id = await currentBusinessId();
    expect(id).toBe('biz_B');
  });

  it('survives a simulated app restart', async () => {
    await setCurrentBusinessId('biz_persist');
    __resetMetaDbForTests();
    const id = await currentBusinessId();
    expect(id).toBe('biz_persist');
  });
});

describe('setCurrentBusinessId', () => {
  it('rejects empty ids', async () => {
    await expect(setCurrentBusinessId('')).rejects.toThrow();
    await expect(setCurrentBusinessId('   ')).rejects.toThrow();
  });
});
