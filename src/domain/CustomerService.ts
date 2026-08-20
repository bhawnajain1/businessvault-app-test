import { ulid } from 'ulid';
import type { BusinessVaultDB } from '../db/database';
import type { Customer } from '../db/types';
import { assertValidGstin, isValidStateCode } from '../lib/gst';
import { appendSyncEvent } from './syncEventLog';

export interface CustomerServiceDeps {
  db: BusinessVaultDB;
  now?: () => string;
}

export interface CreateCustomerInput {
  businessId: string;
  deviceId: string;
  name: string;
  phone?: string;
  email?: string;
  gstin?: string | null;
  billingAddress?: string;
  shippingAddress?: string;
  state?: string;
  stateCode?: string;
  openingBalancePaise?: number;
  creditLimitPaise?: number;
  notes?: string;
  idempotencyKey?: string;
}

export interface UpdateCustomerInput {
  id: string;
  businessId: string;
  deviceId: string;
  patch: Partial<
    Pick<
      Customer,
      | 'name'
      | 'phone'
      | 'email'
      | 'gstin'
      | 'billing_address'
      | 'shipping_address'
      | 'state'
      | 'state_code'
      | 'opening_balance_paise'
      | 'credit_limit_paise'
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
  creditLimitPaise?: number;
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
  if (
    input.creditLimitPaise !== undefined &&
    !Number.isInteger(input.creditLimitPaise)
  ) {
    throw new Error('creditLimitPaise must be integer paise');
  }
}

export class CustomerService {
  private readonly db: BusinessVaultDB;
  private readonly now: () => string;

  constructor(deps: CustomerServiceDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Customer name is required');
    }
    validate({
      gstin: input.gstin ?? null,
      stateCode: input.stateCode,
      openingBalancePaise: input.openingBalancePaise,
      creditLimitPaise: input.creditLimitPaise,
    });

    const now = this.now();
    const gstinNormalized =
      input.gstin && input.gstin.length > 0 ? input.gstin.toUpperCase() : null;

    const customer: Customer = {
      id: ulid(),
      business_id: input.businessId,
      name: input.name.trim(),
      phone: input.phone ?? '',
      email: input.email ?? '',
      gstin: gstinNormalized,
      billing_address: input.billingAddress ?? '',
      shipping_address: input.shippingAddress ?? '',
      state: input.state ?? '',
      state_code: input.stateCode ?? '',
      opening_balance_paise: input.openingBalancePaise ?? 0,
      credit_limit_paise: input.creditLimitPaise ?? 0,
      notes: input.notes ?? '',
      active: 1,
      created_at: now,
      updated_at: now,
      entity_version: 1,
    };

    const db = this.db;
    return db.transaction(
      'rw',
      [db.customers, db.sync_events],
      async () => {
        await db.customers.add(customer);
        await appendSyncEvent(db, {
          businessId: input.businessId,
          deviceId: input.deviceId,
          entityType: 'customer',
          entityId: customer.id,
          operation: 'created',
          payload: customer,
          timestamp: now,
          idempotencyKey: input.idempotencyKey,
        });
        return customer;
      },
    );
  }

  async update(input: UpdateCustomerInput): Promise<Customer> {
    validate({
      gstin: input.patch.gstin ?? null,
      stateCode: input.patch.state_code,
      openingBalancePaise: input.patch.opening_balance_paise,
      creditLimitPaise: input.patch.credit_limit_paise,
    });

    const db = this.db;
    const now = this.now();
    return db.transaction(
      'rw',
      [db.customers, db.sync_events],
      async () => {
        const existing = await db.customers.get(input.id);
        if (!existing) {
          throw new Error(`Customer not found: ${input.id}`);
        }
        if (existing.business_id !== input.businessId) {
          throw new Error(
            `Customer ${input.id} does not belong to business ${input.businessId}`,
          );
        }
        const patch = { ...input.patch };
        if (patch.gstin && patch.gstin.length > 0) {
          patch.gstin = patch.gstin.toUpperCase();
        }
        const next: Customer = {
          ...existing,
          ...patch,
          id: existing.id,
          business_id: existing.business_id,
          updated_at: now,
          entity_version: existing.entity_version + 1,
        };
        await db.customers.put(next);
        await appendSyncEvent(db, {
          businessId: input.businessId,
          deviceId: input.deviceId,
          entityType: 'customer',
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

  async get(id: string): Promise<Customer | undefined> {
    return this.db.customers.get(id);
  }

  async list(businessId: string): Promise<Customer[]> {
    return this.db.customers
      .where('business_id')
      .equals(businessId)
      .toArray();
  }
}

export function createCustomerService(
  deps: CustomerServiceDeps,
): CustomerService {
  return new CustomerService(deps);
}
