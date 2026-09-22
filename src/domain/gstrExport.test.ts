import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { BusinessVaultDB } from '../db/database';
import type { Business, Customer, Item, Invoice, InvoiceLine, Purchase, PurchaseLine, Supplier, Unit } from '../db/types';
import { buildGstrReport } from './gstrExport';

const now = '2026-08-31T00:00:00.000Z';
const businessId = 'gstr-business';

function business(): Business {
  return { id: businessId, name: 'Test Trade', legal_name: 'Test Trade Legal', gstin: '08AAAAA0000A1Z5', pan: null, address_line1: '', address_line2: '', city: 'Jaipur', state: 'Rajasthan', state_code: '08', pincode: '', country: 'IN', phone: '', email: '', financial_year_start_month: 4, current_financial_year: '2026-27', currency: 'INR', logo_ref: null, invoice_prefix: 'INV', invoice_next_seq: 1, drive_folder_id: null, drive_connected_email: null, schema_version: 1, created_at: now, updated_at: now, entity_version: 1 };
}

describe('GSTR report export', () => {
  it('covers every supplied GSTR1 worksheet and classifies outward supplies', async () => {
    const db = new BusinessVaultDB(`gstr-${Date.now()}`);
    const customer: Customer = { id: 'cust', business_id: businessId, name: 'Registered Buyer', phone: '', email: '', gstin: '08BBBBB0000B1Z5', billing_address: '', shipping_address: '', state: 'Rajasthan', state_code: '08', opening_balance_paise: 0, credit_limit_paise: 0, notes: '', active: 1, created_at: now, updated_at: now, entity_version: 1 };
    const item: Item = { id: 'item', business_id: businessId, sku: 'SKU', name: 'Widget', description: 'Widget', hsn: '8471', category_id: null, unit_id: 'unit', sale_price_paise: 10000, purchase_price_paise: 8000, tax_rate_bps: 1800, cess_rate_bps: 0, is_service: 0, track_inventory: 0, opening_qty_micros: 0, opening_value_paise: 0, reorder_level_micros: 0, barcode: null, image_ref: null, active: 1, created_at: now, updated_at: now, entity_version: 1 };
    const unit: Unit = { id: 'unit', business_id: businessId, code: 'PCS', name: 'Pieces', decimal_places: 0, created_at: now, updated_at: now, entity_version: 1 };
    const invoice: Invoice = { id: 'inv', business_id: businessId, invoice_number: '1001', invoice_date: '2026-08-10', due_date: null, customer_id: customer.id, customer_state_code: '08', place_of_supply: '08-Rajasthan', is_interstate: 0, financial_year: '2026-27', subtotal_paise: 10000, discount_paise: 0, taxable_paise: 10000, cgst_paise: 900, sgst_paise: 900, igst_paise: 0, cess_paise: 0, round_off_paise: 0, round_off_mode: 'none', pre_round_total_paise: 11800, total_paise: 11800, paid_paise: 0, balance_paise: 11800, status: 'issued', reversed_by_invoice_id: null, reverses_invoice_id: null, notes: '', terms: '', pdf_attachment_id: null, journal_entry_id: 'je', created_at: now, updated_at: now, entity_version: 1 };
    const line: InvoiceLine = { id: 'line', business_id: businessId, invoice_id: invoice.id, line_no: 1, item_id: item.id, description: 'Widget', hsn: '8471', warehouse_id: '', qty_micros: 1_000_000, unit_price_paise: 10000, discount_pct_bps: 0, discount_paise: 0, taxable_paise: 10000, tax_rate_bps: 1800, cgst_paise: 900, sgst_paise: 900, igst_paise: 0, cess_paise: 0, line_total_paise: 11800 };
    await db.businesses.add(business()); await db.customers.add(customer); await db.items.add(item); await db.units.add(unit); await db.invoices.add(invoice); await db.invoice_lines.add(line);
    const report = await buildGstrReport(businessId, 'gstr1', '2026-08-01', '2026-08-31', { db });
    expect(Object.keys(report.sections)).toEqual(['GSTR1 Report', 'b2b,sez,de', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp', 'at', 'atadj', 'exemp', 'hsn(b2b)', 'hsn(b2c)', 'itemSummary', 'docs']);
    expect(report.sections['b2b,sez,de'].rows).toHaveLength(1);
    expect(report.sections['b2b,sez,de'].rows[0]['GSTIN/UIN of Recipient']).toBe(customer.gstin);
    expect(report.sections['hsn(b2b)'].rows[0]['HSN']).toBe('8471');
    await db.delete();
  });

  it('builds GSTR2 inward rows and HSN data from purchases', async () => {
    const db = new BusinessVaultDB(`gstr2-${Date.now()}`);
    const supplier: Supplier = { id: 'supplier', business_id: businessId, name: 'Supplier', phone: '', email: '', gstin: '08CCCCC0000C1Z5', address: '', state: 'Rajasthan', state_code: '08', opening_balance_paise: 0, notes: '', active: 1, created_at: now, updated_at: now, entity_version: 1 };
    const purchase: Purchase = { id: 'purchase', business_id: businessId, bill_number: 'PB-1', supplier_bill_number: 'SUP-1', bill_date: '2026-08-10', due_date: null, supplier_id: supplier.id, supplier_state_code: '08', is_interstate: 0, financial_year: '2026-27', subtotal_paise: 10000, discount_paise: 0, taxable_paise: 10000, cgst_paise: 900, sgst_paise: 900, igst_paise: 0, cess_paise: 0, round_off_paise: 0, round_off_mode: 'none', pre_round_total_paise: 11800, total_paise: 11800, paid_paise: 0, balance_paise: 11800, status: 'received', reversed_by_purchase_id: null, reverses_purchase_id: null, notes: '', attachment_id: null, journal_entry_id: 'je', created_at: now, updated_at: now, entity_version: 1 };
    const line: PurchaseLine = { id: 'purchase-line', business_id: businessId, purchase_id: purchase.id, line_no: 1, item_id: 'item', description: 'Widget', hsn: '8471', warehouse_id: '', qty_micros: 1_000_000, unit_cost_paise: 10000, discount_paise: 0, taxable_paise: 10000, tax_rate_bps: 1800, cgst_paise: 900, sgst_paise: 900, igst_paise: 0, cess_paise: 0, line_total_paise: 11800 };
    const item: Item = { id: 'item', business_id: businessId, sku: 'SKU', name: 'Widget', description: 'Widget', hsn: '8471', category_id: null, unit_id: 'unit', sale_price_paise: 10000, purchase_price_paise: 8000, tax_rate_bps: 1800, cess_rate_bps: 0, is_service: 0, track_inventory: 0, opening_qty_micros: 0, opening_value_paise: 0, reorder_level_micros: 0, barcode: null, image_ref: null, active: 1, created_at: now, updated_at: now, entity_version: 1 };
    const unit: Unit = { id: 'unit', business_id: businessId, code: 'PCS', name: 'Pieces', decimal_places: 0, created_at: now, updated_at: now, entity_version: 1 };
    await db.businesses.add(business()); await db.suppliers.add(supplier); await db.items.add(item); await db.units.add(unit); await db.purchases.add(purchase); await db.purchase_lines.add(line);
    const report = await buildGstrReport(businessId, 'gstr2', '2026-08-01', '2026-08-31', { db });
    expect(report.sections.b2b.rows).toHaveLength(1);
    expect(report.sections.b2b.rows[0]['GSTIN/UIN of Supplier']).toBe(supplier.gstin);
    expect(report.sections.hsn.rows[0]['Taxable Value']).toBe(100);
    await db.delete();
  });
});
