import { ulid } from 'ulid';
import type { BusinessVaultDB } from '../db/database';
import type { Unit } from '../db/types';
import { appendSyncEvent } from './syncEventLog';

export interface UnitServiceDeps {
  db: BusinessVaultDB;
  now?: () => string;
}

export interface CreateUnitInput {
  businessId: string;
  deviceId: string;
  code: string;
  name: string;
  decimalPlaces?: number;
  idempotencyKey?: string;
}

export interface UpdateUnitInput {
  id: string;
  businessId: string;
  deviceId: string;
  patch: Partial<Pick<Unit, 'code' | 'name' | 'decimal_places'>>;
  idempotencyKey?: string;
}

export class UnitService {
  private readonly db: BusinessVaultDB;
  private readonly now: () => string;

  constructor(deps: UnitServiceDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async create(input: CreateUnitInput): Promise<Unit> {
    if (!input.code || input.code.trim().length === 0) {
      throw new Error('Unit code is required');
    }
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Unit name is required');
    }
    const dp = input.decimalPlaces ?? 0;
    if (!Number.isInteger(dp) || dp < 0 || dp > 6) {
      throw new Error('decimalPlaces must be integer 0..6');
    }
    const db = this.db;
    const now = this.now();
    const code = input.code.trim();

    return db.transaction(
      'rw',
      [db.units, db.sync_events],
      async () => {
        const dup = await db.units
          .where('[business_id+code]')
          .equals([input.businessId, code])
          .first();
        if (dup) throw new Error(`Unit code already exists: ${code}`);
        const row: Unit = {
          id: ulid(),
          business_id: input.businessId,
          code,
          name: input.name.trim(),
          decimal_places: dp,
          created_at: now,
          updated_at: now,
          entity_version: 1,
        };
        await db.units.add(row);
        await appendSyncEvent(db, {
          businessId: input.businessId,
          deviceId: input.deviceId,
          entityType: 'unit',
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

  async update(input: UpdateUnitInput): Promise<Unit> {
    if (input.patch.decimal_places !== undefined) {
      const dp = input.patch.decimal_places;
      if (!Number.isInteger(dp) || dp < 0 || dp > 6) {
        throw new Error('decimal_places must be integer 0..6');
      }
    }
    const db = this.db;
    const now = this.now();
    return db.transaction(
      'rw',
      [db.units, db.sync_events],
      async () => {
        const existing = await db.units.get(input.id);
        if (!existing) throw new Error(`Unit not found: ${input.id}`);
        if (existing.business_id !== input.businessId) {
          throw new Error(
            `Unit ${input.id} does not belong to business ${input.businessId}`,
          );
        }
        if (input.patch.code && input.patch.code !== existing.code) {
          const dup = await db.units
            .where('[business_id+code]')
            .equals([input.businessId, input.patch.code])
            .first();
          if (dup) throw new Error(`Unit code already exists: ${input.patch.code}`);
        }
        const next: Unit = {
          ...existing,
          ...input.patch,
          id: existing.id,
          business_id: existing.business_id,
          updated_at: now,
          entity_version: existing.entity_version + 1,
        };
        await db.units.put(next);
        await appendSyncEvent(db, {
          businessId: input.businessId,
          deviceId: input.deviceId,
          entityType: 'unit',
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

  async get(id: string): Promise<Unit | undefined> {
    return this.db.units.get(id);
  }

  async list(businessId: string): Promise<Unit[]> {
    return this.db.units.where('business_id').equals(businessId).toArray();
  }
}

export function createUnitService(deps: UnitServiceDeps): UnitService {
  return new UnitService(deps);
}
