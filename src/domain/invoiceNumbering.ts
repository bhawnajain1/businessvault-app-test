import type { BusinessVaultDB } from '../db';

// Allocate the next invoice number for a business.
//
// Guarantees the returned string is not already used by another invoice in
// this business, then bumps `invoice_next_seq` past it. The seq counter can
// drift below the true max (e.g. after restore-from-drive, or manual edit),
// so we scan forward past any collision. Gaps are safe; duplicates are not.
//
// Runs one Dexie rw tx spanning `businesses` + `invoices` so the seq bump
// and the collision scan are atomic together.
export async function allocateInvoiceNumber(
  db: BusinessVaultDB,
  businessId: string,
): Promise<string> {
  return db.transaction('rw', [db.businesses, db.invoices], async () => {
    const biz = await db.businesses.get(businessId);
    if (!biz) throw new Error('Business not found');
    const prefix = biz.invoice_prefix || 'INV';
    let seq = biz.invoice_next_seq;
    // Walk forward past any pre-existing invoice_number in this business.
    // Bounded by MAX_SCAN to avoid runaway loops on pathological data.
    const MAX_SCAN = 10_000;
    for (let i = 0; i < MAX_SCAN; i++) {
      const candidate = `${prefix}-${String(seq).padStart(6, '0')}`;
      const exists = await db.invoices
        .where('[business_id+invoice_number]')
        .equals([businessId, candidate])
        .first();
      if (!exists) {
        await db.businesses.update(businessId, {
          invoice_next_seq: seq + 1,
          updated_at: new Date().toISOString(),
        });
        return candidate;
      }
      seq++;
    }
    throw new Error(
      `Could not allocate an unused invoice number after ${MAX_SCAN} attempts.`,
    );
  });
}
