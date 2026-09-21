import { describe, expect, it } from 'vitest';
import { migrateSnapshot } from './index';

describe('purchase lifecycle migration', () => {
  it('links an unambiguous historical edit reversal', () => {
    const result = migrateSnapshot(
      {
        purchases: [
          {
            id: 'old',
            bill_number: 'BILL-1-REV-ABC123',
            status: 'cancelled',
            journal_entry_id: 'je-old',
            updated_at: '2026-08-19T10:00:00.000Z',
          },
          {
            id: 'new',
            bill_number: 'BILL-1',
            status: 'received',
          },
        ],
        journal_entries: [
          { id: 'je-old', reversed_by_id: null },
          { id: 'je-reversal', reverses_id: 'je-old' },
        ],
      },
      8,
      9,
    );

    expect(result.tables.purchases).toEqual([
      expect.objectContaining({
        id: 'old',
        replaced_by_purchase_id: 'new',
        reversal_journal_entry_id: 'je-reversal',
        cancel_reason: 'historical edit reversal',
      }),
      expect.objectContaining({ id: 'new', replaces_purchase_id: 'old' }),
    ]);
    expect(result.tables.journal_entries).toContainEqual(
      expect.objectContaining({ id: 'je-old', reversed_by_id: 'je-reversal' }),
    );
  });

  it('does not guess when multiple live replacements share a bill number', () => {
    const result = migrateSnapshot(
      {
        purchases: [
          { id: 'old', bill_number: 'BILL-1-REV-ABC123', status: 'cancelled', journal_entry_id: 'je-old' },
          { id: 'new-1', bill_number: 'BILL-1', status: 'received' },
          { id: 'new-2', bill_number: 'BILL-1', status: 'received' },
        ],
        journal_entries: [
          { id: 'je-old' },
          { id: 'je-reversal', reverses_id: 'je-old' },
        ],
      },
      8,
      9,
    );

    expect(result.tables.purchases[0]).toEqual(
      expect.objectContaining({ replaced_by_purchase_id: null, reversal_journal_entry_id: null }),
    );
  });
});
