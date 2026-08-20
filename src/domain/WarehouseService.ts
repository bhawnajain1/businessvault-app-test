import { ulid } from 'ulid';
import type { BusinessVaultDB } from '../db/database';
import type { Warehouse } from '../db/types';
import { appendSyncEvent } from './syncEventLog';

export interface WarehouseServiceDeps {
  db: BusinessVaultDB;
  now?: () => string;
}

export interface CreateWarehouseInput {
  businessId: string;
  deviceId: string;
  name: string;
  address?: string;
  isDefault?: boolean;
  idempotencyKey?: string;
}

export interface UpdateWarehouseInput {
  id: string;
  businessId: string;
  deviceId: string;
  patch: Partial<Pick<Warehouse, 'name' | 'address' | 'is_default' | 'active'>>;
  idempotencyKey?: string;
}

export class WarehouseService {
  private readonly db: BusinessVaultDB;
  private readonly now: () => string;

  constructor(deps: WarehouseServiceDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async create(input: CreateWarehouseInput): Promise<Warehouse> {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Warehouse name is required');
    }
    const db = this.db;
    const now = this.now();
    const name = input.name.trim();

    return db.transaction(
      'rw',
      [db.warehouses, db.sync_events],
      async () => {
        const dup = await db.warehouses
          .where('[business_id+name]')
          .equals([input.businessId, name])
          .first();
        if (dup) throw new Error(`Warehouse name already exists: ${name}`);
        const row: Warehouse = {
          id: ulid(),
          business_id: input.businessId,
          name,
          address: input.address ?? '',
          is_default: input.isDefault ? 1 : 0,
          active: 1,
          created_at: now,
          updated_at: now,
          entity_version: 1,
        };
        await db.warehouses.add(row);
        await appendSyncEvent(db, {
          businessId: input.businessId,
          deviceId: input.deviceId,
          entityType: 'warehouse',
          entityId: row.id,
          operation: 'created',
          payload: row,
          timestamp: now,
          idempotencyKey: input.idempotencyKey,
        });
        return row;
      },
    );
  }

  async update(input: UpdateWarehouseInput): Promise<Warehouse> {
    const db = this.db;
    const now = this.now();
    return db.transaction(
      'rw',
      [db.warehouses, db.sync_events],
      async () => {
        const existing = await db.warehouses.get(input.id);
        if (!existing) throw new Error(`Warehouse not found: ${input.id}`);
        if (existing.business_id !== input.businessId) {
          throw new Error(
            `Warehouse ${input.id} does not belong to business ${input.businessId}`,
          );
        }
        const next: Warehouse = {
          ...existing,
          ...input.patch,
          id: existing.id,
          business_id: existing.business_id,
          updated_at: now,
          entity_version: existing.entity_version + 1,
        };
        await db.warehouses.put(next);
        await appendSyncEvent(db, {
          businessId: input.businessId,
          deviceId: input.deviceId,
          entityType: 'warehouse',
          entityId: next.id,
          operation: 'updated',
          payload: { id: next.id, ...input.patch, entity_version: next.entity_version },
          timestamp: now,
          idempotencyKey: input.idempotencyKey,
        });
        return next;
      },
    );
  }

  async get(id: string): Promise<Warehouse | undefined> {
    return this.db.warehouses.get(id);
  }

  async list(businessId: string): Promise<Warehouse[]> {
    return this.db.warehouses
      .where('business_id')
      .equals(businessId)
      .toArray();
  }
}

export function createWarehouseService(
  deps: WarehouseServiceDeps,
): WarehouseService {
  return new WarehouseService(deps);
}
