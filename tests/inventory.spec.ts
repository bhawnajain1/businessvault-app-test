import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { BusinessVaultDB } from '../src/db/database';
import {
  createInventoryService,
  type InventoryMovementKind,
} from '../src/domain/InventoryService';

// Deterministic PRNG so the "1000 random movements" test is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUSINESS = 'biz-inv-test';
const DEVICE = 'dev-inv-test';
const WH = 'wh-main';

async function freshDb(): Promise<BusinessVaultDB> {
  const name = `bv-inv-${ulid()}`;
  const db = new BusinessVaultDB(name);
  await db.open();
  return db;
}

describe('InventoryService — identity (spec §27)', () => {
  it('identity holds after 1000 random movements across 20 items', { timeout: 60_000 }, async () => {
    const db = await freshDb();
    const svc = createInventoryService({ db, now: fixedClock() });

    const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    const rng = mulberry32(0xdecafbad);
    const stock = new Map<string, number>(); // itemId -> current qty (units)

    // Seed each item with opening stock so subsequent sales don't go persistently negative.
    for (const id of items) {
      const openQty = 50 + Math.floor(rng() * 50);
      await svc.recordMovement({
        itemId: id,
        warehouseId: WH,
        kind: 'opening',
        qtyDelta: openQty,
        unitCost: 100,
        businessId: BUSINESS,
        deviceId: DEVICE,
      });
      stock.set(id, openQty);
    }

    const kinds: InventoryMovementKind[] = [
      'purchase',
      'sale',
      'sales_return',
      'purchase_return',
      'adjustment',
    ];

    for (let n = 0; n < 1000; n++) {
      const itemId = items[Math.floor(rng() * items.length)];
      const kind = kinds[Math.floor(rng() * kinds.length)];
      const magnitude = 1 + Math.floor(rng() * 10);
      let qtyDelta = magnitude;
      if (kind === 'adjustment') {
        // signed
        qtyDelta = rng() < 0.5 ? magnitude : -magnitude;
      }
      // Skip movements that would drive current stock negative for the
      // deterministic identity check (spec's identity is defined on non-negative
      // real inventories; going below zero indicates a data-entry error the UI
      // would block).
      const cur = stock.get(itemId) ?? 0;
      const signed = simulateSign(kind, qtyDelta);
      if (cur + signed < 0) continue;

      await svc.recordMovement({
        itemId,
        warehouseId: WH,
        kind,
        qtyDelta,
        unitCost: kind === 'purchase' || kind === 'sales_return' ? 100 : undefined,
        businessId: BUSINESS,
        deviceId: DEVICE,
      });
      stock.set(itemId, cur + signed);
    }

    const result = await svc.verifyInventoryIdentity(BUSINESS);
    expect(result.mismatches).toEqual([]);
    expect(result.ok).toBe(true);

    // Also cross-check the model's stock map against getCurrentStock.
    for (const [itemId, expectedQty] of stock) {
      const cs = await svc.getCurrentStock(itemId, WH);
      expect(cs.fromMovementsMicros).toBe(expectedQty * 1_000_000);
      expect(cs.cachedMicros).toBe(expectedQty * 1_000_000);
      expect(cs.drifted).toBe(false);
    }

    db.close();
  });

  it('catches a hand-injected drift', async () => {
    const db = await freshDb();
    const svc = createInventoryService({ db, now: fixedClock() });

    await svc.recordMovement({
      itemId: 'item-A',
      warehouseId: WH,
      kind: 'opening',
      qtyDelta: 10,
      unitCost: 50,
      businessId: BUSINESS,
      deviceId: DEVICE,
    });
    await svc.recordMovement({
      itemId: 'item-A',
      warehouseId: WH,
      kind: 'sale',
      qtyDelta: 3,
      businessId: BUSINESS,
      deviceId: DEVICE,
    });

    const before = await svc.verifyInventoryIdentity(BUSINESS);
    expect(before.ok).toBe(true);

    // Corrupt the cache directly — simulating a rogue writer or restore drift.
    const stockRow = await db.item_stock.get(`${BUSINESS}:item-A:${WH}`);
    if (!stockRow) throw new Error('expected item_stock row');
    await db.item_stock.put({
      ...stockRow,
      qty_micros: stockRow.qty_micros + 999_000_000, // +999 units of drift
    });

    const after = await svc.verifyInventoryIdentity(BUSINESS);
    expect(after.ok).toBe(false);
    expect(after.mismatches).toHaveLength(1);
    expect(after.mismatches[0]).toMatchObject({
      itemId: 'item-A',
      warehouseId: WH,
      expectedMicros: 7_000_000, // 10 - 3
      actualMicros: 7_000_000 + 999_000_000,
    });

    db.close();
  });
});

describe('InventoryService — FIFO valuation', () => {
  it('values interleaved purchases and sales in FIFO order', async () => {
    const db = await freshDb();
    const svc = createInventoryService({ db, now: fixedClock() });

    // Buy 10 @ Rs.100, buy 10 @ Rs.120, sell 15, buy 5 @ Rs.150, sell 5
    // FIFO consumption: 15 sale consumes 10@100 + 5@120 → remaining 5@120
    // Then buy 5@150 → layers: 5@120, 5@150
    // Then sell 5 → consumes 5@120 → layers: 5@150
    // Final value = 5 * 150 = Rs.750 = 75000 paise
    // Final qty = 5 units
    const item = 'item-fifo';

    await svc.recordMovement({
      itemId: item,
      warehouseId: WH,
      kind: 'purchase',
      qtyDelta: 10,
      unitCost: 100,
      businessId: BUSINESS,
      deviceId: DEVICE,
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    await svc.recordMovement({
      itemId: item,
      warehouseId: WH,
      kind: 'purchase',
      qtyDelta: 10,
      unitCost: 120,
      businessId: BUSINESS,
      deviceId: DEVICE,
      occurredAt: '2026-01-02T00:00:00.000Z',
    });
    await svc.recordMovement({
      itemId: item,
      warehouseId: WH,
      kind: 'sale',
      qtyDelta: 15,
      businessId: BUSINESS,
      deviceId: DEVICE,
      occurredAt: '2026-01-03T00:00:00.000Z',
    });
    await svc.recordMovement({
      itemId: item,
      warehouseId: WH,
      kind: 'purchase',
      qtyDelta: 5,
      unitCost: 150,
      businessId: BUSINESS,
      deviceId: DEVICE,
      occurredAt: '2026-01-04T00:00:00.000Z',
    });
    await svc.recordMovement({
      itemId: item,
      warehouseId: WH,
      kind: 'sale',
      qtyDelta: 5,
      businessId: BUSINESS,
      deviceId: DEVICE,
      occurredAt: '2026-01-05T00:00:00.000Z',
    });

    const val = await svc.stockValuation(BUSINESS);
    expect(val.perItem).toHaveLength(1);
    const iv = val.perItem[0];
    expect(iv.itemId).toBe(item);
    expect(iv.qtyMicros).toBe(5_000_000);
    // 5 units * Rs.150 * 100 paise/Re = 75000 paise
    expect(iv.valuePaise).toBe(75_000);
    expect(iv.layers).toEqual([{ qtyMicros: 5_000_000, unitCostPaise: 15_000 }]);
    expect(val.totalPaise).toBe(75_000);

    db.close();
  });

  it('emits a stock.movement event with hash chain per movement', async () => {
    const db = await freshDb();
    const svc = createInventoryService({ db, now: fixedClock() });

    await svc.recordMovement({
      itemId: 'item-e',
      warehouseId: WH,
      kind: 'opening',
      qtyDelta: 5,
      unitCost: 10,
      businessId: BUSINESS,
      deviceId: DEVICE,
    });
    await svc.recordMovement({
      itemId: 'item-e',
      warehouseId: WH,
      kind: 'sale',
      qtyDelta: 2,
      businessId: BUSINESS,
      deviceId: DEVICE,
    });

    const rows = await db.sync_events.toCollection().sortBy('timestamp');
    expect(rows).toHaveLength(2);
    // schema stores snake_case
    const r0 = rows[0] as unknown as Record<string, unknown>;
    const r1 = rows[1] as unknown as Record<string, unknown>;
    expect(r0.entity_type).toBe('stock_movement');
    expect(r0.operation).toBe('movement');
    expect(r0.previous_hash).toBe('0'.repeat(64));
    expect(r1.previous_hash).toBe(r0.payload_hash);
    expect(r0.sync_status).toBe('LOCAL_ONLY');

    db.close();
  });
});

function simulateSign(kind: InventoryMovementKind, qty: number): number {
  if (kind === 'adjustment') return qty;
  const m = Math.abs(qty);
  switch (kind) {
    case 'opening':
    case 'purchase':
    case 'sales_return':
    case 'sale_return':
      return m;
    case 'sale':
    case 'purchase_return':
      return -m;
  }
}

function fixedClock(): () => string {
  let n = 0;
  return () => new Date(Date.UTC(2026, 0, 1) + n++ * 1000).toISOString();
}
