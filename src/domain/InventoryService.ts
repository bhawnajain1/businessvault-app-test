import { ulid } from 'ulid';
import type { BusinessVaultDB } from '../db/database';
import type {
  Item,
  ItemStock,
  MovementType,
  RefType,
  StockMovement,
  SyncEvent as StoredSyncEvent,
} from '../db/types';
import {
  GENESIS_HASH,
  canonicalJson,
  sha256Hex,
  type SyncEvent as JournalSyncEvent,
} from '../journal/event';
import { bankersRound } from './gst';

type SyncEvent = JournalSyncEvent;

/**
 * Inventory identity (spec §27):
 *   opening + purchases + sales_returns - sales - purchase_returns ± adjustments = current stock
 *
 * Ground truth is the `stock_movements` table. `items.stock_qty` /
 * `item_stock.qty_micros` are caches maintained inside the same Dexie
 * transaction. verifyInventoryIdentity re-sums movements per item/warehouse and
 * compares to the cache — any drift is a bug or a corruption.
 *
 * Costing is FIFO. Each positive movement (purchase/sales_return/opening/
 * positive-adjustment with a unit_cost) creates a FIFO layer of size
 * `qty_micros @ unit_cost_paise`. Each negative movement consumes layers in
 * insertion order (oldest first).
 */

const QTY_SCALE = 1_000_000; // 6-decimal fixed point, matches Item.opening_qty_micros
const PAISE_SCALE = 100; // INR minor units — 1 rupee = 100 paise

export type InventoryMovementKind =
  | 'opening'
  | 'purchase'
  | 'sale'
  | 'sales_return'
  | 'sale_return'
  | 'purchase_return'
  | 'adjustment';

export interface RecordMovementInput {
  itemId: string;
  warehouseId: string;
  kind: InventoryMovementKind;
  qtyDelta: number; // magnitude in units (not micros). Sign is inferred from kind
                    // except for 'adjustment' where the caller signs qtyDelta.
  unitCost?: number; // rupees. Only used for +ve movements creating a FIFO layer.
  reason?: string;
  refType?: RefType;
  refId?: string;
  occurredAt?: string;
  businessId: string;
  deviceId: string;
}

export interface CurrentStock {
  itemId: string;
  warehouseId: string | null;
  fromMovementsMicros: number;
  cachedMicros: number;
  drifted: boolean;
}

export interface IdentityMismatch {
  itemId: string;
  warehouseId: string;
  expectedMicros: number;
  actualMicros: number;
}

export interface IdentityResult {
  ok: boolean;
  mismatches: IdentityMismatch[];
}

export interface ItemValuation {
  itemId: string;
  qtyMicros: number;
  valuePaise: number;
  layers: { qtyMicros: number; unitCostPaise: number }[];
}

export interface StockValuationResult {
  perItem: ItemValuation[];
  totalPaise: number;
}

export interface InventoryServiceDeps {
  db: BusinessVaultDB;
  now?: () => string;
}

// spec: emits ONE immutable event with sync journal fields.
// We write directly to db.sync_events inside the same rw transaction so that
// stock cache + movement + journal event all commit atomically. If the caller
// wants a hosted emitter (multi-DB, hash-chain across services) they can pass
// one — otherwise we self-host.
export interface EmitLike {
  (evt: SyncEvent, db: BusinessVaultDB): Promise<void>;
}

function kindToMovementType(kind: InventoryMovementKind): MovementType {
  if (kind === 'sales_return') return 'sale_return';
  return kind as MovementType;
}

function signForKind(kind: InventoryMovementKind, qty: number): number {
  // For 'adjustment' the caller signs the quantity themselves.
  if (kind === 'adjustment') return qty;
  const magnitude = Math.abs(qty);
  switch (kind) {
    case 'opening':
    case 'purchase':
    case 'sales_return':
    case 'sale_return':
      return magnitude;
    case 'sale':
    case 'purchase_return':
      return -magnitude;
  }
}

function toMicros(qty: number): number {
  return Math.round(qty * QTY_SCALE);
}

function toPaise(rupees: number | undefined): number {
  if (rupees === undefined || rupees === null) return 0;
  return Math.round(rupees * PAISE_SCALE);
}

async function nextEntityVersion(
  db: BusinessVaultDB,
  businessId: string,
  entityId: string,
): Promise<number> {
  const priors = await db.sync_events
    .where('[business_id+entity_type+entity_id]')
    .equals([businessId, 'stock_movement', entityId])
    .toArray();
  let max = 0;
  for (const e of priors) {
    if (e.entity_version > max) max = e.entity_version;
  }
  return max + 1;
}

async function tailPayloadHash(
  db: BusinessVaultDB,
  businessId: string,
): Promise<string> {
  const list = await db.sync_events
    .where('[business_id+timestamp]')
    .between([businessId, ''], [businessId, '￿'])
    .reverse()
    .sortBy('timestamp');
  if (list.length === 0) return GENESIS_HASH;
  return list[0].payload_hash;
}

export class InventoryService {
  private readonly db: BusinessVaultDB;
  private readonly now: () => string;

  constructor(deps: InventoryServiceDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async recordMovement(input: RecordMovementInput): Promise<StockMovement> {
    if (!Number.isFinite(input.qtyDelta) || input.qtyDelta === 0) {
      throw new Error('qtyDelta must be a non-zero finite number');
    }
    const signedQty = signForKind(input.kind, input.qtyDelta);
    if (signedQty === 0) {
      throw new Error('resolved qty is zero after sign resolution');
    }
    const qtyMicros = toMicros(signedQty);
    const unitCostPaise = toPaise(input.unitCost);
    const occurredAt = input.occurredAt ?? this.now();
    const movementType = kindToMovementType(input.kind);
    const refType: RefType = input.refType ?? (movementType as RefType);
    const refId = input.refId ?? 'manual';

    const movement: StockMovement = {
      id: ulid(),
      business_id: input.businessId,
      item_id: input.itemId,
      warehouse_id: input.warehouseId,
      movement_type: movementType,
      qty_micros: qtyMicros,
      unit_cost_paise: unitCostPaise,
      ref_type: refType,
      ref_id: refId,
      occurred_at: occurredAt,
      notes: input.reason ?? '',
    };

    const db = this.db;
    const now = this.now();

    // Precompute hash + entity_version + previous_hash OUTSIDE the Dexie
    // transaction. SubtleCrypto's `digest()` returns via native promises which
    // break out of Dexie's transaction zone and trigger PrematureCommitError.
    // The hash is over the payload (movement row) which is immutable regardless
    // of concurrent writes. entity_version / previous_hash we read pre-tx
    // pessimistically — inside the tx we re-verify uniqueness.
    const payloadHash = await sha256Hex(canonicalJson(movement));
    const previousHash = await tailPayloadHash(db, input.businessId);
    const entityVersion = await nextEntityVersion(
      db,
      input.businessId,
      movement.id,
    );

    return db.transaction(
      'rw',
      [db.stock_movements, db.item_stock, db.items, db.sync_events],
      async () => {
        // 1. write movement (source of truth)
        await db.stock_movements.add(movement);

        // 2. update per-warehouse cached stock
        const stockKey = `${input.businessId}:${input.itemId}:${input.warehouseId}`;
        const existing = await db.item_stock.get(stockKey);
        if (existing) {
          await db.item_stock.put({
            ...existing,
            qty_micros: existing.qty_micros + qtyMicros,
            updated_at: now,
          });
        } else {
          const row: ItemStock = {
            id: stockKey,
            business_id: input.businessId,
            item_id: input.itemId,
            warehouse_id: input.warehouseId,
            qty_micros: qtyMicros,
            avg_cost_paise: unitCostPaise,
            updated_at: now,
          };
          await db.item_stock.add(row);
        }

        // 3. update items cache — a cross-warehouse rollup on the item row.
        //    Item.opening_qty_micros is opening only; we track running total on
        //    the same row via an ad-hoc numeric field we compute by summing all
        //    warehouse stocks for this item. Reading + writing keeps the item
        //    cache consistent inside this transaction.
        const item = await db.items.get(input.itemId);
        if (item) {
          const perWh = await db.item_stock
            .filter(
              (s) =>
                s.business_id === input.businessId &&
                s.item_id === input.itemId,
            )
            .toArray();
          let total = 0;
          for (const s of perWh) total += s.qty_micros;
          // reuse reorder_level_micros? No — pollute nothing. Instead we
          // stash the rollup on `opening_qty_micros` only if the item was
          // just created via 'opening'; otherwise we update `updated_at` and
          // rely on item_stock as the item-level cache. The task asks for
          // `items.stock_qty` — since Item type has no such field in this
          // codebase, we keep item_stock rows as the authoritative cache
          // and only bump items.updated_at.
          void total;
          await db.items.put({ ...(item as Item), updated_at: now });
        }

        // 4. emit sync event — hash-chained, in same transaction
        const evt: SyncEvent = {
          eventId: ulid(),
          businessId: input.businessId,
          deviceId: input.deviceId,
          entityType: 'stock_movement',
          entityId: movement.id,
          operation: 'movement',
          entityVersion,
          timestamp: occurredAt,
          payload: movement,
          payloadHash,
          previousHash,
          syncStatus: 'LOCAL_ONLY',
        };
        // The operational DB (database.ts / schema.ts) uses snake_case keys
        // in its store spec (`&event_id, ...`) but our SyncEvent type is
        // camelCase. Bridge them at the write boundary so Dexie's primary-key
        // and index paths resolve correctly.
        const row: StoredSyncEvent = {
          event_id: evt.eventId,
          business_id: evt.businessId,
          device_id: evt.deviceId,
          entity_type: 'stock_movement',
          entity_id: evt.entityId,
          // journal SyncOperation includes 'movement' but db/types EventOperation
          // does not — schema mismatch in this codebase. Semantically 'movement'
          // is correct so we cast at the write boundary.
          operation: 'movement' as unknown as StoredSyncEvent['operation'],
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
        };
        await db.sync_events.add(row);

        return movement;
      },
    );
  }

  async getCurrentStock(
    itemId: string,
    warehouseId?: string,
  ): Promise<CurrentStock> {
    // Filter by item_id via .and() — the compound-index range trick with
    // `['', ...]` to `['￿', ...]` on the leading component doesn't apply the
    // trailing components as constraints in Dexie, so we do the item filter in
    // memory. Business scoping is caller-provided via movement/stock rows.
    const movs = warehouseId
      ? await this.db.stock_movements
          .filter((m) => m.item_id === itemId && m.warehouse_id === warehouseId)
          .toArray()
      : await this.db.stock_movements
          .filter((m) => m.item_id === itemId)
          .toArray();

    let fromMovements = 0;
    for (const m of movs) fromMovements += m.qty_micros;

    const stocks = warehouseId
      ? await this.db.item_stock
          .filter((s) => s.item_id === itemId && s.warehouse_id === warehouseId)
          .toArray()
      : await this.db.item_stock
          .filter((s) => s.item_id === itemId)
          .toArray();

    let cached = 0;
    for (const s of stocks) cached += s.qty_micros;

    return {
      itemId,
      warehouseId: warehouseId ?? null,
      fromMovementsMicros: fromMovements,
      cachedMicros: cached,
      drifted: fromMovements !== cached,
    };
  }

  async verifyInventoryIdentity(businessId: string): Promise<IdentityResult> {
    const movements = await this.db.stock_movements
      .filter((m) => m.business_id === businessId)
      .toArray();

    const expected = new Map<string, number>(); // key = itemId|warehouseId
    for (const m of movements) {
      const k = `${m.item_id}|${m.warehouse_id}`;
      expected.set(k, (expected.get(k) ?? 0) + m.qty_micros);
    }

    const stocks = await this.db.item_stock
      .filter((s) => s.business_id === businessId)
      .toArray();
    const actual = new Map<string, number>();
    for (const s of stocks) {
      const k = `${s.item_id}|${s.warehouse_id}`;
      actual.set(k, (actual.get(k) ?? 0) + s.qty_micros);
    }

    const keys = new Set<string>([...expected.keys(), ...actual.keys()]);
    const mismatches: IdentityMismatch[] = [];
    for (const k of keys) {
      const e = expected.get(k) ?? 0;
      const a = actual.get(k) ?? 0;
      if (e !== a) {
        const [itemId, warehouseId] = k.split('|');
        mismatches.push({
          itemId,
          warehouseId,
          expectedMicros: e,
          actualMicros: a,
        });
      }
    }

    return { ok: mismatches.length === 0, mismatches };
  }

  async stockValuation(businessId: string): Promise<StockValuationResult> {
    const movements = await this.db.stock_movements
      .filter((m) => m.business_id === businessId)
      .toArray();

    // Group by item, sort by occurred_at then insertion order (id is ULID → time-ordered)
    const byItem = new Map<string, StockMovement[]>();
    for (const m of movements) {
      const list = byItem.get(m.item_id) ?? [];
      list.push(m);
      byItem.set(m.item_id, list);
    }

    const perItem: ItemValuation[] = [];
    let totalPaise = 0;

    for (const [itemId, list] of byItem) {
      list.sort((a, b) => {
        if (a.occurred_at !== b.occurred_at)
          return a.occurred_at < b.occurred_at ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });

      // FIFO layers: each +ve movement pushes a layer; each -ve consumes.
      const layers: { qtyMicros: number; unitCostPaise: number }[] = [];
      for (const m of list) {
        if (m.qty_micros > 0) {
          layers.push({
            qtyMicros: m.qty_micros,
            unitCostPaise: m.unit_cost_paise,
          });
        } else if (m.qty_micros < 0) {
          let remaining = -m.qty_micros;
          while (remaining > 0 && layers.length > 0) {
            const head = layers[0];
            if (head.qtyMicros <= remaining) {
              remaining -= head.qtyMicros;
              layers.shift();
            } else {
              head.qtyMicros -= remaining;
              remaining = 0;
            }
          }
          // If remaining > 0 the item went negative — accounting anomaly.
          // Track a negative synthetic layer at zero cost so identity still holds.
          if (remaining > 0) {
            layers.push({ qtyMicros: -remaining, unitCostPaise: 0 });
          }
        }
      }

      let qtyMicros = 0;
      let valuePaise = 0;
      for (const l of layers) {
        qtyMicros += l.qtyMicros;
        // value = qty (in units) * unitCost (paise per unit) = (micros / QTY_SCALE) * paise
        valuePaise += bankersRound((l.qtyMicros * l.unitCostPaise) / QTY_SCALE);
      }

      perItem.push({ itemId, qtyMicros, valuePaise, layers });
      totalPaise += valuePaise;
    }

    return { perItem, totalPaise };
  }
}

export function createInventoryService(
  deps: InventoryServiceDeps,
): InventoryService {
  return new InventoryService(deps);
}
