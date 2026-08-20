import { describe, expect, it, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { BusinessVaultDB } from '../db/database';
import { PurchaseService } from './PurchaseService';
import { ReturnService } from './ReturnService';

const BIZ = 'biz-ret';
const DEV = 'dev-ret';

function freshDb(): BusinessVaultDB {
  return new BusinessVaultDB('bv-ret-' + Math.random().toString(36).slice(2));
}

const ACCOUNTS = {
  purchases: 'acc-purchases',
  inputCgst: 'acc-input-cgst',
  inputSgst: 'acc-input-sgst',
  inputIgst: 'acc-input-igst',
  inputCess: 'acc-input-cess',
  accountsPayable: 'acc-ap',
};

describe('ReturnService (purchase return)', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('creates purchase return as new record with negative quantities and reverse journal', async () => {
    const db = freshDb();
    const ps = new PurchaseService({ db });
    const rs = new ReturnService({ db });

    const original = await ps.create({
      businessId: BIZ,
      deviceId: DEV,
      billNumber: 'BILL-100',
      billDate: '2026-08-19',
      supplierId: 'sup-1',
      supplierStateCode: '29',
      isInterstate: false,
      financialYear: '2026-27',
      accounts: ACCOUNTS,
      lines: [
        {
          itemId: 'item-1',
          warehouseId: 'wh-1',
          qtyMicros: 5_000_000,
          unitCostPaise: 10000,
          taxRateBps: 1800,
        },
      ],
    });

    const debitNote = await rs.createPurchaseReturn({
      businessId: BIZ,
      deviceId: DEV,
      originalPurchaseId: original.id,
      debitNoteNumber: 'DN-100',
      returnDate: '2026-08-20',
      reason: 'Defective goods',
    });

    // Original untouched (append-only)
    const stillOriginal = await db.purchases.get(original.id);
    expect(stillOriginal!.total_paise).toBe(original.total_paise);
    expect(stillOriginal!.taxable_paise).toBe(original.taxable_paise);

    // Debit note has negatives
    expect(debitNote.id).not.toBe(original.id);
    expect(debitNote.total_paise).toBe(-original.total_paise);
    expect(debitNote.taxable_paise).toBe(-original.taxable_paise);

    // Reverse JE balanced and points back
    const revJe = await db.journal_entries.get(debitNote.journal_entry_id);
    expect(revJe).toBeDefined();
    expect(revJe!.reverses_id).toBe(original.journal_entry_id);
    expect(revJe!.total_debit_paise).toBe(revJe!.total_credit_paise);

    // Stock returned to zero (positive purchase 5M + negative return 5M)
    const stock = await db.item_stock.get(`${BIZ}:item-1:wh-1`);
    expect(stock!.qty_micros).toBe(0);

    // Stock movements: one positive (purchase), one negative (return)
    const movs = await db.stock_movements.toArray();
    expect(movs.length).toBe(2);
    const purchMov = movs.find((m) => m.movement_type === 'purchase');
    const retMov = movs.find((m) => m.movement_type === 'purchase_return');
    expect(purchMov!.qty_micros).toBe(5_000_000);
    expect(retMov!.qty_micros).toBe(-5_000_000);
  });

  it('refuses to reverse the same purchase twice', async () => {
    const db = freshDb();
    const ps = new PurchaseService({ db });
    const rs = new ReturnService({ db });

    const original = await ps.create({
      businessId: BIZ,
      deviceId: DEV,
      billNumber: 'BILL-200',
      billDate: '2026-08-19',
      supplierId: 'sup-1',
      supplierStateCode: '29',
      isInterstate: false,
      financialYear: '2026-27',
      accounts: ACCOUNTS,
      lines: [
        {
          itemId: 'item-1',
          warehouseId: 'wh-1',
          qtyMicros: 1_000_000,
          unitCostPaise: 5000,
          taxRateBps: 0,
        },
      ],
    });

    await rs.createPurchaseReturn({
      businessId: BIZ,
      deviceId: DEV,
      originalPurchaseId: original.id,
      debitNoteNumber: 'DN-200',
      returnDate: '2026-08-20',
      reason: 'x',
    });
    await expect(
      rs.createPurchaseReturn({
        businessId: BIZ,
        deviceId: DEV,
        originalPurchaseId: original.id,
        debitNoteNumber: 'DN-200-B',
        returnDate: '2026-08-20',
        reason: 'y',
      }),
    ).rejects.toThrow(/already been reversed/);
    const purchases = await db.purchases.toArray();
    expect(purchases.length).toBe(2); // original + first debit note; second one refused
  });
});
