import { ulid } from 'ulid';
import { db as defaultDb } from '../db';
import type { BusinessVaultDB } from '../db/database';
import type { Account, AccountType } from '../db/types';
import { appendSyncEvent } from './syncEventLog';
import { getDeviceId } from '../lib/device';

export type NormalSide = 'debit' | 'credit';

export interface SeedAccount {
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  normal: NormalSide;
  is_system: boolean;
}

// Account codes here MUST match the constants in InvoiceService.ts and the
// test fixtures in InvoiceService.test.ts. See ACC_*_CODE at the top of
// InvoiceService.ts — those are the load-bearing source of truth because
// invoice posting hard-codes them, and rebuild/restore fixtures depend on
// the same numbering. Do NOT drift this table without updating both places.
export const SEED_ACCOUNTS: SeedAccount[] = [
  { code: '1010', name: 'Cash', type: 'asset', subtype: 'current_asset', normal: 'debit', is_system: true },
  { code: '1020', name: 'Bank', type: 'asset', subtype: 'current_asset', normal: 'debit', is_system: true },
  { code: '1200', name: 'Accounts Receivable', type: 'asset', subtype: 'receivable', normal: 'debit', is_system: true },
  { code: '1250', name: 'Supplier Advances', type: 'asset', subtype: 'current_asset', normal: 'debit', is_system: true },
  { code: '1400', name: 'Inventory', type: 'asset', subtype: 'inventory', normal: 'debit', is_system: true },

  { code: '2010', name: 'Accounts Payable', type: 'liability', subtype: 'payable', normal: 'credit', is_system: true },
  { code: '2050', name: 'Customer Advances', type: 'liability', subtype: 'current_liability', normal: 'credit', is_system: true },
  { code: '2210', name: 'Output CGST', type: 'liability', subtype: 'gst_output', normal: 'credit', is_system: true },
  { code: '2220', name: 'Output SGST', type: 'liability', subtype: 'gst_output', normal: 'credit', is_system: true },
  { code: '2230', name: 'Output IGST', type: 'liability', subtype: 'gst_output', normal: 'credit', is_system: true },
  { code: '2240', name: 'Output Cess', type: 'liability', subtype: 'gst_output', normal: 'credit', is_system: true },

  { code: '1310', name: 'Input CGST', type: 'asset', subtype: 'gst_input', normal: 'debit', is_system: true },
  { code: '1320', name: 'Input SGST', type: 'asset', subtype: 'gst_input', normal: 'debit', is_system: true },
  { code: '1330', name: 'Input IGST', type: 'asset', subtype: 'gst_input', normal: 'debit', is_system: true },
  { code: '1340', name: 'Input Cess', type: 'asset', subtype: 'gst_input', normal: 'debit', is_system: true },

  { code: '3010', name: 'Owner Equity', type: 'equity', subtype: 'equity', normal: 'credit', is_system: true },
  { code: '3020', name: 'Retained Earnings', type: 'equity', subtype: 'equity', normal: 'credit', is_system: true },

  { code: '4000', name: 'Sales Revenue', type: 'income', subtype: 'operating_income', normal: 'credit', is_system: true },
  { code: '4090', name: 'Discount Received', type: 'income', subtype: 'other_income', normal: 'credit', is_system: true },
  { code: '4900', name: 'Round Off', type: 'income', subtype: 'other_income', normal: 'credit', is_system: true },

  { code: '5010', name: 'Purchases', type: 'expense', subtype: 'cogs', normal: 'debit', is_system: true },
  { code: '5020', name: 'Cost of Goods Sold', type: 'expense', subtype: 'cogs', normal: 'debit', is_system: true },
  { code: '5090', name: 'Discount Given', type: 'expense', subtype: 'operating_expense', normal: 'debit', is_system: true },

  { code: '6010', name: 'Rent Expense', type: 'expense', subtype: 'operating_expense', normal: 'debit', is_system: true },
  { code: '6020', name: 'Salaries Expense', type: 'expense', subtype: 'operating_expense', normal: 'debit', is_system: true },
  { code: '6030', name: 'Utilities Expense', type: 'expense', subtype: 'operating_expense', normal: 'debit', is_system: true },
  { code: '6040', name: 'Travel Expense', type: 'expense', subtype: 'operating_expense', normal: 'debit', is_system: true },
  { code: '6050', name: 'Office Supplies Expense', type: 'expense', subtype: 'operating_expense', normal: 'debit', is_system: true },
  { code: '6060', name: 'Professional Fees', type: 'expense', subtype: 'operating_expense', normal: 'debit', is_system: true },
  { code: '6070', name: 'Bank Charges', type: 'expense', subtype: 'operating_expense', normal: 'debit', is_system: true },
  { code: '6080', name: 'Miscellaneous Expense', type: 'expense', subtype: 'operating_expense', normal: 'debit', is_system: true },
];

export function normalSideForType(type: AccountType): NormalSide {
  if (type === 'asset' || type === 'expense') return 'debit';
  return 'credit';
}

export async function seedChartOfAccounts(
  businessId: string,
  opts: { db?: BusinessVaultDB; deviceId?: string } = {},
): Promise<Account[]> {
  const db = opts.db ?? (defaultDb as unknown as BusinessVaultDB);
  const now = new Date().toISOString();
  const deviceId = opts.deviceId ?? (await getDeviceId());

  return db.transaction('rw', [db.accounts, db.sync_events], async () => {
    const existing = await db.accounts
      .where('[business_id+code]')
      .between([businessId, ''], [businessId, '￿'])
      .toArray();
    const seenCodes = new Set(existing.map((a) => a.code));
    const out: Account[] = [...existing];

    for (const s of SEED_ACCOUNTS) {
      if (seenCodes.has(s.code)) continue;
      const acct: Account = {
        id: ulid(),
        business_id: businessId,
        code: s.code,
        name: s.name,
        type: s.type,
        subtype: s.subtype,
        parent_id: null,
        opening_balance_paise: 0,
        is_system: s.is_system ? 1 : 0,
        active: 1,
        created_at: now,
        updated_at: now,
        entity_version: 1,
      };
      await db.accounts.add(acct);
      await appendSyncEvent(db, {
        businessId,
        deviceId,
        entityType: 'account',
        entityId: acct.id,
        operation: 'created',
        payload: acct,
        timestamp: now,
      });
      out.push(acct);
    }
    return out;
  });
}

export async function findAccountByCode(
  businessId: string,
  code: string,
  opts: { db?: BusinessVaultDB } = {},
): Promise<Account | undefined> {
  const db = opts.db ?? (defaultDb as unknown as BusinessVaultDB);
  return db.accounts.where('[business_id+code]').equals([businessId, code]).first();
}

export const SYSTEM_ACCOUNT_CODES = {
  CASH: '1010',
  BANK: '1020',
  RECEIVABLE: '1200',
  SUPPLIER_ADVANCE: '1250',
  INVENTORY: '1400',
  PAYABLE: '2010',
  CUSTOMER_ADVANCE: '2050',
  OUTPUT_CGST: '2210',
  OUTPUT_SGST: '2220',
  OUTPUT_IGST: '2230',
  OUTPUT_CESS: '2240',
  INPUT_CGST: '1310',
  INPUT_SGST: '1320',
  INPUT_IGST: '1330',
  INPUT_CESS: '1340',
  OWNER_EQUITY: '3010',
  RETAINED_EARNINGS: '3020',
  SALES_REVENUE: '4000',
  DISCOUNT_RECEIVED: '4090',
  ROUND_OFF: '4900',
  PURCHASES: '5010',
  COGS: '5020',
  DISCOUNT_GIVEN: '5090',
} as const;
