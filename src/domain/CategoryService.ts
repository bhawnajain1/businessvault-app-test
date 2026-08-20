import { ulid } from 'ulid';
import type { BusinessVaultDB } from '../db/database';
import type { Category } from '../db/types';
import { appendSyncEvent } from './syncEventLog';

export interface CategoryServiceDeps {
  db: BusinessVaultDB;
  now?: () => string;
}

export interface CreateCategoryInput {
  businessId: string;
  deviceId: string;
  name: string;
  parentId?: string | null;
  idempotencyKey?: string;
}

export interface UpdateCategoryInput {
  id: string;
  businessId: string;
  deviceId: string;
  patch: Partial<Pick<Category, 'name' | 'parent_id'>>;
  idempotencyKey?: string;
}

export class CategoryService {
  private readonly db: BusinessVaultDB;
  private readonly now: () => string;

  constructor(deps: CategoryServiceDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async create(input: CreateCategoryInput): Promise<Category> {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Category name is required');
    }
    const db = this.db;
    const now = this.now();
    const name = input.name.trim();
    return db.transaction(
      'rw',
      [db.categories, db.sync_events],
      async () => {
        const dup = await db.categories
          .where('[business_id+name]')
          .equals([input.businessId, name])
          .first();
        if (dup) throw new Error(`Category name already exists: ${name}`);
        if (input.parentId) {
          const parent = await db.categories.get(input.parentId);
          if (!parent || parent.business_id !== input.businessId) {
            throw new Error(`Parent category not found: ${input.parentId}`);
          }
        }
        const row: Category = {
          id: ulid(),
          business_id: input.businessId,
          name,
          parent_id: input.parentId ?? null,
          created_at: now,
          updated_at: now,
          entity_version: 1,
        };
        await db.categories.add(row);
        await appendSyncEvent(db, {
          businessId: input.businessId,
          deviceId: input.deviceId,
          entityType: 'category',
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

  async update(input: UpdateCategoryInput): Promise<Category> {
    const db = this.db;
    const now = this.now();
    return db.transaction(
      'rw',
      [db.categories, db.sync_events],
      async () => {
        const existing = await db.categories.get(input.id);
        if (!existing) throw new Error(`Category not found: ${input.id}`);
        if (existing.business_id !== input.businessId) {
          throw new Error(
            `Category ${input.id} does not belong to business ${input.businessId}`,
          );
        }
        if (input.patch.parent_id === input.id) {
          throw new Error('Category cannot be its own parent');
        }
        const next: Category = {
          ...existing,
          ...input.patch,
          id: existing.id,
          business_id: existing.business_id,
          updated_at: now,
          entity_version: existing.entity_version + 1,
        };
        await db.categories.put(next);
        await appendSyncEvent(db, {
          businessId: input.businessId,
          deviceId: input.deviceId,
          entityType: 'category',
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

  async get(id: string): Promise<Category | undefined> {
    return this.db.categories.get(id);
  }

  async list(businessId: string): Promise<Category[]> {
    return this.db.categories
      .where('business_id')
      .equals(businessId)
      .toArray();
  }
}

export function createCategoryService(
  deps: CategoryServiceDeps,
): CategoryService {
  return new CategoryService(deps);
}
