import { db as defaultDb, type BusinessVaultDB } from '../db';
import type {
  Business,
  Customer,
  Invoice,
  InvoiceLine,
  Item,
  Purchase,
  PurchaseLine,
  Supplier,
  Unit,
} from '../db/types';
import { log } from '../lib/log';
import { streamCsvToBlob, triggerDownload } from '../csv/streamCsvExport';

export type GstrReportKind = 'gstr1' | 'gstr2';

export interface GstrRow {
  [key: string]: string | number | null;
}

export interface GstrSection {
  columns: string[];
  rows: GstrRow[];
}

export interface GstrReport {
  report: GstrReportKind;
  schema_version: 1;
  generated_at: string;
  period: { from: string; to: string };
  business: { gstin: string | null; legal_name: string; trade_name: string };
  sections: Record<string, GstrSection>;
}

export interface GstrExportOptions {
  db?: BusinessVaultDB;
}

const B2CL_THRESHOLD_PAISE = 10_000_000;

const GSTR1_COLUMNS = {
  b2b: ['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'],
  b2cl: ['Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'],
  b2cs: ['Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'],
  hsn: ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'],
};

const GSTR2_COLUMNS = {
  b2b: ['GSTIN/UIN of Supplier', 'Supplier Name', 'Bill Number', 'Bill date', 'Bill Value', 'Place Of Supply', 'Reverse Charge', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'],
  hsn: GSTR1_COLUMNS.hsn,
};

function rupees(paise: number): number {
  return Number((paise / 100).toFixed(2));
}

function qty(micros: number): number {
  return Number((micros / 1_000_000).toFixed(6));
}

function rate(bps: number): number {
  return Number((bps / 100).toFixed(2));
}

function empty(columns: string[]): GstrSection {
  return { columns, rows: [] };
}

function hsnRows(
  lines: Array<InvoiceLine | PurchaseLine>,
  invoicesById: Map<string, Invoice | Purchase>,
  itemsById: Map<string, Item>,
  unitsById: Map<string, Unit>,
): GstrRow[] {
  const grouped = new Map<string, GstrRow>();
  for (const line of lines) {
    const doc = invoicesById.get('invoice_id' in line ? line.invoice_id : line.purchase_id);
    if (!doc || doc.status === 'cancelled' || ('deleted_at' in doc && doc.deleted_at)) continue;
    const item = itemsById.get(line.item_id);
    const unit = item ? unitsById.get(item.unit_id) : undefined;
    const key = `${line.hsn}|${line.tax_rate_bps}|${unit?.code ?? ''}`;
    const row = grouped.get(key) ?? {
      HSN: line.hsn,
      Description: item?.name ?? line.description,
      UQC: unit?.code ?? '',
      'Total Quantity': 0,
      'Total Value': 0,
      Rate: rate(line.tax_rate_bps),
      'Taxable Value': 0,
      'Integrated Tax Amount': 0,
      'Central Tax Amount': 0,
      'State/UT Tax Amount': 0,
      'Cess Amount': 0,
    };
    row['Total Quantity'] = Number(row['Total Quantity']) + qty(line.qty_micros);
    row['Total Value'] = Number(row['Total Value']) + rupees(line.line_total_paise);
    row['Taxable Value'] = Number(row['Taxable Value']) + rupees(line.taxable_paise);
    row['Integrated Tax Amount'] = Number(row['Integrated Tax Amount']) + rupees(line.igst_paise);
    row['Central Tax Amount'] = Number(row['Central Tax Amount']) + rupees(line.cgst_paise);
    row['State/UT Tax Amount'] = Number(row['State/UT Tax Amount']) + rupees(line.sgst_paise);
    row['Cess Amount'] = Number(row['Cess Amount']) + rupees(line.cess_paise);
    grouped.set(key, row);
  }
  return Array.from(grouped.values());
}

export async function buildGstrReport(
  businessId: string,
  report: GstrReportKind,
  from: string,
  to: string,
  opts: GstrExportOptions = {},
): Promise<GstrReport> {
  const db = opts.db ?? (defaultDb as unknown as BusinessVaultDB);
  const [business, customers, suppliers, items, units, invoices, invoiceLines, purchases, purchaseLines] = await Promise.all([
    db.businesses.get(businessId),
    db.customers.where('business_id').equals(businessId).toArray(),
    db.suppliers.where('business_id').equals(businessId).toArray(),
    db.items.where('business_id').equals(businessId).toArray(),
    db.units.where('business_id').equals(businessId).toArray(),
    db.invoices.where('[business_id+invoice_date]').between([businessId, from], [businessId, to], true, true).toArray(),
    db.invoice_lines.where('business_id').equals(businessId).toArray(),
    db.purchases.where('[business_id+bill_date]').between([businessId, from], [businessId, to], true, true).toArray(),
    db.purchase_lines.where('business_id').equals(businessId).toArray(),
  ]);
  if (!business) throw new Error('Business not found');
  const activeInvoices = invoices.filter((i) => i.status !== 'draft' && i.status !== 'cancelled' && !i.deleted_at);
  const activePurchases = purchases.filter((p) => p.status !== 'draft' && p.status !== 'cancelled');
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const unitsById = new Map(units.map((u) => [u.id, u]));
  const invoiceById = new Map(activeInvoices.map((i) => [i.id, i]));
  const purchaseById = new Map(activePurchases.map((p) => [p.id, p]));
  const linesByInvoice = new Map<string, InvoiceLine[]>();
  for (const line of invoiceLines) {
    if (invoiceById.has(line.invoice_id)) linesByInvoice.set(line.invoice_id, [...(linesByInvoice.get(line.invoice_id) ?? []), line]);
  }
  const linesByPurchase = new Map<string, PurchaseLine[]>();
  for (const line of purchaseLines) {
    if (purchaseById.has(line.purchase_id)) linesByPurchase.set(line.purchase_id, [...(linesByPurchase.get(line.purchase_id) ?? []), line]);
  }
  const b2cInvoiceIds = new Set(
    activeInvoices
      .filter((invoice) => !customerById.get(invoice.customer_id)?.gstin)
      .map((invoice) => invoice.id),
  );

  const gstr1B2b: GstrRow[] = [];
  const gstr1B2cl: GstrRow[] = [];
  const gstr1B2cs: GstrRow[] = [];
  for (const invoice of activeInvoices) {
    const customer = customerById.get(invoice.customer_id);
    const lines = linesByInvoice.get(invoice.id) ?? [];
    const target = customer?.gstin ? gstr1B2b : invoice.is_interstate && invoice.total_paise > B2CL_THRESHOLD_PAISE ? gstr1B2cl : gstr1B2cs;
    for (const line of lines) {
      const base = {
        'Invoice Number': invoice.invoice_number,
        'Invoice date': invoice.invoice_date,
        'Invoice Value': rupees(invoice.total_paise),
        'Place Of Supply': invoice.place_of_supply,
        'Rate': rate(line.tax_rate_bps),
        'Taxable Value': rupees(line.taxable_paise),
        'Cess Amount': rupees(line.cess_paise),
      };
      if (target === gstr1B2b) target.push({
        'GSTIN/UIN of Recipient': customer?.gstin ?? '',
        'Receiver Name': customer?.name ?? '',
        ...base,
        'Reverse Charge': 'N',
        'Applicable % of Tax Rate': '',
        'Invoice Type': 'Regular B2B',
        'E-Commerce GSTIN': '',
      });
      else if (target === gstr1B2cl) target.push({ ...base, 'Applicable % of Tax Rate': '', 'E-Commerce GSTIN': '' });
      else target.push({ Type: 'OE', 'Place Of Supply': invoice.place_of_supply, 'Applicable % of Tax Rate': '', Rate: rate(line.tax_rate_bps), 'Taxable Value': rupees(line.taxable_paise), 'Cess Amount': rupees(line.cess_paise), 'E-Commerce GSTIN': '' });
    }
  }
  const gstr2B2b: GstrRow[] = [];
  for (const purchase of activePurchases) {
    const supplier = supplierById.get(purchase.supplier_id);
    for (const line of linesByPurchase.get(purchase.id) ?? []) {
      gstr2B2b.push({
        'GSTIN/UIN of Supplier': supplier?.gstin ?? '', 'Supplier Name': supplier?.name ?? '', 'Bill Number': purchase.supplier_bill_number || purchase.bill_number,
        'Bill date': purchase.bill_date, 'Bill Value': rupees(purchase.total_paise), 'Place Of Supply': purchase.supplier_state_code,
        'Reverse Charge': 'N', Rate: rate(line.tax_rate_bps), 'Taxable Value': rupees(line.taxable_paise),
        'Integrated Tax Amount': rupees(line.igst_paise), 'Central Tax Amount': rupees(line.cgst_paise), 'State/UT Tax Amount': rupees(line.sgst_paise), 'Cess Amount': rupees(line.cess_paise),
      });
    }
  }
  const reportData: GstrReport = {
    report, schema_version: 1, generated_at: new Date().toISOString(), period: { from, to },
    business: { gstin: business.gstin, legal_name: business.legal_name, trade_name: business.name },
    sections: report === 'gstr1' ? {
      'GSTR1 Report': { columns: ['GSTIN/UIN', 'Party Name', 'Transaction Type', 'Invoice No.', 'Invoice Date', 'Invoice Value', 'Rate', 'Cess Rate', 'Taxable value', 'Reverse Charge', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount', 'Place of Supply(Name of state)'], rows: [] },
      'b2b,sez,de': { columns: GSTR1_COLUMNS.b2b, rows: gstr1B2b }, b2cl: { columns: GSTR1_COLUMNS.b2cl, rows: gstr1B2cl }, b2cs: { columns: GSTR1_COLUMNS.b2cs, rows: gstr1B2cs },
      cdnr: empty(['GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Reverse Charge', 'Note Supply Type', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount']), cdnur: empty(['UR Type', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount']), exp: empty(['Export Type', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Port Code', 'Shipping Bill Number', 'Shipping Bill Date', 'Rate', 'Taxable Value']), at: empty(['Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Gross Advance Received', 'Cess Amount']), atadj: empty(['Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Gross Advance Adjusted', 'Cess Amount']), exemp: empty(['Description', 'Nil Rated Supplies', 'Exempted(other than nil rated/non GST supply)', 'Non-GST Supplies']),
      'hsn(b2b)': { columns: GSTR1_COLUMNS.hsn, rows: hsnRows(invoiceLines.filter((line) => !b2cInvoiceIds.has(line.invoice_id)), invoiceById, itemsById, unitsById) }, 'hsn(b2c)': { columns: GSTR1_COLUMNS.hsn, rows: hsnRows(invoiceLines.filter((line) => b2cInvoiceIds.has(line.invoice_id)), invoiceById, itemsById, unitsById) }, itemSummary: { columns: GSTR1_COLUMNS.hsn, rows: hsnRows(invoiceLines, invoiceById, itemsById, unitsById) }, docs: { columns: ['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'], rows: [{ 'Nature of Document': 'Invoices for outward supply', 'Sr. No. From': activeInvoices[0]?.invoice_number ?? '', 'Sr. No. To': activeInvoices.at(-1)?.invoice_number ?? '', 'Total Number': activeInvoices.length, Cancelled: invoices.filter((i) => i.status === 'cancelled').length }] },
    } : {
      'GSTR2 Report': { columns: ['GSTIN/UIN', 'Supplier Name', 'Bill Number', 'Bill Date', 'Bill Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'], rows: [] }, b2b: { columns: GSTR2_COLUMNS.b2b, rows: gstr2B2b }, hsn: { columns: GSTR2_COLUMNS.hsn, rows: hsnRows(purchaseLines, purchaseById, itemsById, unitsById) }, docs: { columns: ['Nature of Document', 'Bill Number From', 'Bill Number To', 'Total Number', 'Cancelled'], rows: [{ 'Nature of Document': 'Bills for inward supply', 'Bill Number From': activePurchases[0]?.supplier_bill_number || activePurchases[0]?.bill_number || '', 'Bill Number To': activePurchases.at(-1)?.supplier_bill_number || activePurchases.at(-1)?.bill_number || '', 'Total Number': activePurchases.length, Cancelled: purchases.filter((p) => p.status === 'cancelled').length }] },
    },
  };
  log.info('gstrExport', 'report built', { businessId, report, from, to, sectionCount: Object.keys(reportData.sections).length, activeInvoiceCount: activeInvoices.length, activePurchaseCount: activePurchases.length });
  return reportData;
}

export async function downloadGstrJson(data: GstrReport): Promise<void> {
  triggerDownload(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }), `${data.report}-${data.period.from}-to-${data.period.to}.json`);
  log.info('gstrExport', 'JSON downloaded', { report: data.report, sectionCount: Object.keys(data.sections).length });
}

export async function downloadGstrCsv(data: GstrReport): Promise<void> {
  const rows = Object.entries(data.sections).flatMap(([section, value]) => value.rows.map((row) => ({ section, ...row })));
  const columns = ['section', ...Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((key) => key !== 'section'))))];
  await streamCsvToBlob({ columns, rows, toRow: (row) => row }, { bom: true }).then((blob) => triggerDownload(blob, `${data.report}-${data.period.from}-to-${data.period.to}.csv`));
  log.info('gstrExport', 'CSV downloaded', { report: data.report, rowCount: rows.length });
}
