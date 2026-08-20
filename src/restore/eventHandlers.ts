/**
 * Journal event handlers — applied idempotently during restore replay.
 *
 * Each handler receives the parsed SyncEvent + the Dexie database (already
 * inside a transaction) and applies the effect. Rules:
 *   - MUST be idempotent. `put` (upsert) over `add` for row writes.
 *   - MUST NOT emit new sync events. Restore is silent — no rehydration echo.
 *   - MUST NOT throw on already-applied state. Missing preconditions are logged
 *     as diagnostics; they do not abort the whole replay.
 *
 * The handler map is keyed by `${entity_type}:${operation}`. Unhandled events
 * are counted and surfaced in RestoreReport.diagnostics but do not fail.
 *
 * The SyncEvent shape lives on the provider side (snake_case) — see
 * CustomerStorageProvider.SyncEvent. Journal payloads are whatever the emitter
 * wrote; we treat them as `Record<string, unknown>` and coerce.
 */
import type { BusinessVaultDB } from '../db/database';
import type { SyncEvent } from '../storage/CustomerStorageProvider';
import type {
  Customer,
  Supplier,
  Item,
  Category,
  Unit,
  Warehouse,
  Invoice,
  InvoiceLine,
  Purchase,
  PurchaseLine,
  Payment,
  Expense,
  Account,
  JournalEntry,
  JournalLine,
  StockMovement,
} from '../db/types';

export interface HandlerContext {
  db: BusinessVaultDB;
  businessId: string;
  diagnostics: string[];
}

export type EventHandler = (
  evt: SyncEvent,
  ctx: HandlerContext,
) => Promise<void>;

function asRecord(v: unknown, evtId: string): Record<string, unknown> {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`event ${evtId}: payload is not an object`);
  }
  return v as Record<string, unknown>;
}

const put =
  <T>(table: (db: BusinessVaultDB) => { put(v: T): Promise<unknown> }) =>
  async (evt: SyncEvent, ctx: HandlerContext): Promise<void> => {
    const row = asRecord(evt.payload, evt.event_id) as unknown as T;
    await table(ctx.db).put(row);
  };

const HANDLERS: Record<string, EventHandler> = {
  'business:create': put<unknown>((db) => db.businesses),
  'business:update': put<unknown>((db) => db.businesses),

  'customer:create': put<Customer>((db) => db.customers),
  'customer:update': put<Customer>((db) => db.customers),
  'customer:created': put<Customer>((db) => db.customers),
  'customer:updated': put<Customer>((db) => db.customers),

  'supplier:create': put<Supplier>((db) => db.suppliers),
  'supplier:created': put<Supplier>((db) => db.suppliers),
  'supplier:update': put<Supplier>((db) => db.suppliers),
  'supplier:updated': put<Supplier>((db) => db.suppliers),

  'category:create': put<Category>((db) => db.categories),
  'category:created': put<Category>((db) => db.categories),

  'unit:create': put<Unit>((db) => db.units),
  'unit:created': put<Unit>((db) => db.units),

  'warehouse:create': put<Warehouse>((db) => db.warehouses),
  'warehouse:created': put<Warehouse>((db) => db.warehouses),

  'item:create': put<Item>((db) => db.items),
  'item:created': put<Item>((db) => db.items),
  'item:update': put<Item>((db) => db.items),
  'item:updated': put<Item>((db) => db.items),

  'invoice:create': put<Invoice>((db) => db.invoices),
  'invoice:created': put<Invoice>((db) => db.invoices),
  'invoice:update': put<Invoice>((db) => db.invoices),
  'invoice:updated': put<Invoice>((db) => db.invoices),

  'invoice_line:create': put<InvoiceLine>((db) => db.invoice_lines),
  'invoice_line:created': put<InvoiceLine>((db) => db.invoice_lines),

  'purchase:create': put<Purchase>((db) => db.purchases),
  'purchase:created': put<Purchase>((db) => db.purchases),

  'purchase_line:create': put<PurchaseLine>((db) => db.purchase_lines),
  'purchase_line:created': put<PurchaseLine>((db) => db.purchase_lines),

  'payment:create': put<Payment>((db) => db.payments),
  'payment:created': put<Payment>((db) => db.payments),

  'expense:create': put<Expense>((db) => db.expenses),
  'expense:created': put<Expense>((db) => db.expenses),

  'account:create': put<Account>((db) => db.accounts),
  'account:created': put<Account>((db) => db.accounts),

  'journal_entry:posted': put<JournalEntry>((db) => db.journal_entries),
  'journal_entry:create': put<JournalEntry>((db) => db.journal_entries),
  'journal_entry:created': put<JournalEntry>((db) => db.journal_entries),

  'journal_line:create': put<JournalLine>((db) => db.journal_lines),
  'journal_line:created': put<JournalLine>((db) => db.journal_lines),

  'stock_movement:movement': put<StockMovement>((db) => db.stock_movements),
  'stock_movement:create': put<StockMovement>((db) => db.stock_movements),
  'stock_movement:created': put<StockMovement>((db) => db.stock_movements),

  // spec §24: never destructive. void = credit note emitted separately.
  'invoice:voided': async (evt, ctx) => {
    const p = asRecord(evt.payload, evt.event_id);
    const id = String(p.invoice_id ?? p.id ?? '');
    if (!id) {
      ctx.diagnostics.push(`invoice:voided event ${evt.event_id} has no invoice_id`);
      return;
    }
    const inv = await ctx.db.invoices.get(id);
    if (!inv) {
      ctx.diagnostics.push(`invoice:voided ${id}: invoice not found`);
      return;
    }
    inv.status = 'cancelled';
    inv.reversed_by_invoice_id =
      (p.credit_note_invoice_id as string | null | undefined) ??
      inv.reversed_by_invoice_id;
    inv.updated_at = String(p.voided_at ?? new Date().toISOString());
    await ctx.db.invoices.put(inv);
  },
};

export function getEventHandler(
  entityType: string,
  operation: string,
): EventHandler | undefined {
  return HANDLERS[`${entityType}:${operation}`];
}

export async function applyEvent(
  evt: SyncEvent,
  ctx: HandlerContext,
): Promise<'applied' | 'unhandled'> {
  const h = getEventHandler(evt.entity_type, evt.operation);
  if (!h) return 'unhandled';
  await h(evt, ctx);
  return 'applied';
}
