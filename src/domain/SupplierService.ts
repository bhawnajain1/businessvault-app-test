import { ulid } from 'ulid';
import type { BusinessVaultDB } from '../db/database';
import type { Supplier } from '../db/types';
import { assertValidGstin, isValidStateCode } from '../lib/gst';
import { appendSyncEvent } from './syncEventLog';

export interface SupplierServiceDeps {
  db: BusinessVaultDB;
  now?: () => string;
}

export interface CreateSupplierInput {
  businessId: string;
  deviceId: string;
  name: string;
  phone?: string;
  email?: string;
  gstin?: string | null;
  address?: string;
  state?: string;
  stateCode?: string;
  openingBalancePaise?: number;
  notes?: string;
  idempotencyKey?: string;
}

export interface UpdateSupplierInput {
  id: string;
  businessId: string;
  deviceId: string;
  patch: Partial<
    Pick<
      Supplier,
      | 'name'
      | 'phone'
      | 'email'
      | 'gstin'
      | 'address'
      | 'state'
      | 'state_code'
      | 'opening_balance_paise'
      | 'notes'
      | 'active'
    >
  >;
  idempotencyKey?: string;
}

function validate(input: {
  gstin?: string | null;
  stateCode?: string;
  openingBalancePaise?: number;
}): void {
  assertValidGstin(input.gstin ?? null);
  if (input.stateCode && input.stateCode.length > 0) {
    if (!isValidStateCode(input.stateCode)) {
      throw new Error(`Invalid state code: ${input.stateCode}`);
    }
  }
  if (
    input.openingBalancePaise !== undefined &&
    !Number.isInteger(input.openingBalancePaise)
  ) {
    throw new Error('openingBalancePaise must be integer paise');
  }
}

export class SupplierService {
  private readonly db: BusinessVaultDB;
  private readonly now: () => string;

  constructor(deps: SupplierServiceDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async create(input: CreateSupplierInput): Promise<Supplier> {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Supplier name is required');
    }
    validate({
      gstin: input.gstin ?? null,
      stateCode: input.stateCode,
      openingBalancePaise: input.openingBalancePaise,
    });

    const now = this.now();
    const gstinNormalized =
      input.gstin && input.gstin.length > 0 ? input.gstin.toUpperCase() : null;

    const supplier: Supplier = {
      id: ulid(),
      business_id: input.businessId,
      name: input.name.trim(),
      phone: input.phone ?? '',
      email: input.email ?? '',
      gstin: gstinNormalized,
      address: input.address ?? '',
      state: input.state ?? '',
      state_code: input.stateCode ?? '',
      opening_balance_paise: input.openingBalancePaise ?? 0,
      notes: input.notes ?? '',
      active: 1,
      created_at: now,
      updated_at: now,
      entity_version: 1,
    };

    const db = this.db;
    return db.transaction(
      'rw',
      [db.suppliers, db.sync_events],
      async () => {
        await db.suppliers.add(supplier);
        await appendSyncEvent(db, {
          businessId: input.businessId,
          deviceId: input.deviceId,
          entityType: 'supplier',
          entityId: supplier.id,
          operation: 'created',
          payload: supplier,
          timestamp: now,
          idempotencyKey: input.idempotencyKey,
        });
        return supplier;
      },
    );
  }

  async update(input: UpdateSupplierInput): Promise<Supplier> {
    validate({
      gstin: input.patch.gstin ?? null,
      stateCode: input.patch.state_code,
      openingBalancePaise: input.patch.opening_balance_paise,
    });

    const db = this.db;
    const now = this.now();
    return db.transaction(
      'rw',
      [db.suppliers, db.sync_events],
      async () => {
        const existing = await db.suppliers.get(input.id);
        if (!existing) {
          throw new Error(`Supplier not found: ${input.id}`);
        }
        if (existing.business_id !== input.businessId) {
          throw new Error(
            `Supplier ${input.id} does not belong to business ${input.businessId}`,
          );
        }
        const patch = { ...input.patch };
        if (patch.gstin && patch.gstin.length > 0) {
          patch.gstin = patch.gstin.toUpperCase();
        }
        const next: Supplier = {
          ...existing,
          ...patch,
          id: existing.id,
          business_id: existing.business_id,
          updated_at: now,
          entity_version: existing.entity_version + 1,
        };
        await db.suppliers.put(next);
        await appendSyncEvent(db, {
          businessId: input.businessId,
          deviceId: input.deviceId,
          entityType: 'supplier',
          entityId: next.id,
          operation: 'updated',
          payload: { id: next.id, ...patch, entity_version: next.entity_version },
          timestamp: now,
          idempotencyKey: input.idempotencyKey,
        });
        return next;
      },
    );
  }

  async get(id: string): Promise<Supplier | undefined> {
    return this.db.suppliers.get(id);
  }

  async list(businessId: string): Promise<Supplier[]> {
    return this.db.suppliers
      .where('business_id')
      .equals(businessId)
      .toArray();
  }
}

export function createSupplierService(
  deps: SupplierServiceDeps,
): SupplierService {
  return new SupplierService(deps);
}
