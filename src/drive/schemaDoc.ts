export type CsvColumnType =
  | 'string'
  | 'text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'uuid'
  | 'enum'
  | 'json';

export interface CsvColumnSchema {
  name: string;
  type: CsvColumnType;
  nullable?: boolean;
  primary_key?: boolean;
  foreign_key?: { table: string; column: string; note?: string };
  enum_values?: readonly string[];
  description: string;
}

export interface CsvTableSchema {
  file: string;
  entity: string;
  description: string;
  primary_key: readonly string[];
  columns: readonly CsvColumnSchema[];
}

export interface SchemaDoc {
  schema_version: number;
  generated_by: string;
  description: string;
  conventions: {
    encoding: string;
    line_ending: string;
    quoting: string;
    date_format: string;
    datetime_format: string;
    money_format: string;
    id_format: string;
    formula_injection_guard: string;
  };
  tables: readonly CsvTableSchema[];
}

const ID: CsvColumnSchema = {
  name: 'id',
  type: 'uuid',
  primary_key: true,
  description: 'Stable internal identifier (ULID). Never edit.',
};

const BUSINESS_ID: CsvColumnSchema = {
  name: 'business_id',
  type: 'uuid',
  foreign_key: { table: 'business', column: 'id' },
  description: 'The business this row belongs to.',
};

const CREATED_AT: CsvColumnSchema = {
  name: 'created_at',
  type: 'datetime',
  description: 'ISO-8601 UTC timestamp when the row was first created.',
};

const UPDATED_AT: CsvColumnSchema = {
  name: 'updated_at',
  type: 'datetime',
  description: 'ISO-8601 UTC timestamp of last update.',
};

const ENTITY_VERSION: CsvColumnSchema = {
  name: 'entity_version',
  type: 'integer',
  description: 'Monotonic version used for multi-device conflict detection.',
};

const TABLES: readonly CsvTableSchema[] = [
  {
    file: 'customers.csv',
    entity: 'customer',
    description: 'Customer master.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'name', type: 'string', description: 'Display name of the customer.' },
      { name: 'legal_name', type: 'string', nullable: true, description: 'Registered legal name if different.' },
      { name: 'gstin', type: 'string', nullable: true, description: 'GSTIN if registered.' },
      { name: 'pan', type: 'string', nullable: true, description: 'PAN if collected.' },
      { name: 'phone', type: 'string', nullable: true, description: 'Primary phone.' },
      { name: 'email', type: 'string', nullable: true, description: 'Primary email.' },
      { name: 'billing_address', type: 'text', nullable: true, description: 'Billing address (multi-line allowed).' },
      { name: 'shipping_address', type: 'text', nullable: true, description: 'Shipping address (multi-line allowed).' },
      { name: 'state', type: 'string', nullable: true, description: 'State (for GST place-of-supply).' },
      { name: 'state_code', type: 'string', nullable: true, description: 'GST state code.' },
      { name: 'opening_balance', type: 'decimal', description: 'Opening receivable balance in business currency.' },
      { name: 'is_active', type: 'boolean', description: 'Whether the customer is active.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'suppliers.csv',
    entity: 'supplier',
    description: 'Supplier master.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'name', type: 'string', description: 'Display name of the supplier.' },
      { name: 'legal_name', type: 'string', nullable: true, description: 'Registered legal name.' },
      { name: 'gstin', type: 'string', nullable: true, description: 'GSTIN if registered.' },
      { name: 'pan', type: 'string', nullable: true, description: 'PAN if collected.' },
      { name: 'phone', type: 'string', nullable: true, description: 'Primary phone.' },
      { name: 'email', type: 'string', nullable: true, description: 'Primary email.' },
      { name: 'address', type: 'text', nullable: true, description: 'Postal address.' },
      { name: 'state', type: 'string', nullable: true, description: 'State (for GST place-of-supply).' },
      { name: 'state_code', type: 'string', nullable: true, description: 'GST state code.' },
      { name: 'opening_balance', type: 'decimal', description: 'Opening payable balance.' },
      { name: 'is_active', type: 'boolean', description: 'Whether the supplier is active.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'categories.csv',
    entity: 'category',
    description: 'Item categories.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'name', type: 'string', description: 'Category name.' },
      { name: 'parent_id', type: 'uuid', nullable: true, foreign_key: { table: 'categories', column: 'id' }, description: 'Parent category, if hierarchical.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'units.csv',
    entity: 'unit',
    description: 'Units of measure.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'code', type: 'string', description: 'Short code (e.g. PCS, KG, MTR).' },
      { name: 'name', type: 'string', description: 'Full name of the unit.' },
      { name: 'decimals', type: 'integer', description: 'Number of decimal places allowed for quantities in this unit.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'warehouses.csv',
    entity: 'warehouse',
    description: 'Physical or logical stock locations.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'name', type: 'string', description: 'Warehouse name.' },
      { name: 'address', type: 'text', nullable: true, description: 'Warehouse address.' },
      { name: 'is_default', type: 'boolean', description: 'Whether this is the default warehouse.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'items.csv',
    entity: 'item',
    description: 'Products and services sold or purchased.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'sku', type: 'string', nullable: true, description: 'Stock-keeping unit / internal code.' },
      { name: 'name', type: 'string', description: 'Item name shown on invoices.' },
      { name: 'description', type: 'text', nullable: true, description: 'Longer description.' },
      { name: 'category_id', type: 'uuid', nullable: true, foreign_key: { table: 'categories', column: 'id' }, description: 'Category, if categorised.' },
      { name: 'unit_id', type: 'uuid', foreign_key: { table: 'units', column: 'id' }, description: 'Default unit of measure.' },
      { name: 'hsn_code', type: 'string', nullable: true, description: 'HSN / SAC code for GST.' },
      { name: 'tax_rate', type: 'decimal', description: 'Default GST rate in percent (e.g. 18.00).' },
      { name: 'sale_price', type: 'decimal', description: 'Default sale price (excl. tax) in business currency.' },
      { name: 'purchase_price', type: 'decimal', description: 'Default purchase price (excl. tax).' },
      { name: 'is_service', type: 'boolean', description: 'True for services (no stock movement).' },
      { name: 'is_active', type: 'boolean', description: 'Whether the item is active.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'invoices.csv',
    entity: 'invoice',
    description: 'Sales invoice headers. Append-only; corrections happen via credit notes.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'invoice_number', type: 'string', description: 'Human-facing invoice number (e.g. INV-000123).' },
      { name: 'customer_id', type: 'uuid', foreign_key: { table: 'customers', column: 'id' }, description: 'Customer this invoice was issued to.' },
      { name: 'invoice_date', type: 'date', description: 'Date printed on the invoice.' },
      { name: 'due_date', type: 'date', nullable: true, description: 'Payment due date.' },
      { name: 'financial_year', type: 'string', description: 'Indian financial year, e.g. "2026-27".' },
      { name: 'place_of_supply', type: 'string', nullable: true, description: 'GST place of supply (state name).' },
      { name: 'place_of_supply_code', type: 'string', nullable: true, description: 'GST place-of-supply code.' },
      { name: 'subtotal', type: 'decimal', description: 'Sum of line amounts before tax.' },
      { name: 'discount_total', type: 'decimal', description: 'Total discount applied.' },
      { name: 'cgst_total', type: 'decimal', description: 'CGST portion of tax.' },
      { name: 'sgst_total', type: 'decimal', description: 'SGST portion of tax.' },
      { name: 'igst_total', type: 'decimal', description: 'IGST portion of tax.' },
      { name: 'cess_total', type: 'decimal', description: 'Cess portion of tax.' },
      { name: 'round_off', type: 'decimal', description: 'Rounding adjustment.' },
      { name: 'total', type: 'decimal', description: 'Grand total (customer owes this amount).' },
      { name: 'amount_paid', type: 'decimal', description: 'Sum of payments applied to this invoice.' },
      { name: 'status', type: 'enum', enum_values: ['draft', 'issued', 'partial', 'paid', 'cancelled'], description: 'Lifecycle status.' },
      { name: 'notes', type: 'text', nullable: true, description: 'Free-text notes / terms.' },
      { name: 'pdf_ref', type: 'string', nullable: true, description: 'Path within invoices/ where the PDF lives.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'invoice_items.csv',
    entity: 'invoice_line',
    description: 'Line items on sales invoices.',
    primary_key: ['id'],
    columns: [
      ID,
      { name: 'invoice_id', type: 'uuid', foreign_key: { table: 'invoices', column: 'id' }, description: 'Parent invoice.' },
      { name: 'line_no', type: 'integer', description: '1-based ordering within the invoice.' },
      { name: 'item_id', type: 'uuid', foreign_key: { table: 'items', column: 'id' }, description: 'Item sold.' },
      { name: 'description', type: 'text', nullable: true, description: 'Line description (overrides item name if set).' },
      { name: 'quantity', type: 'decimal', description: 'Quantity sold.' },
      { name: 'unit_id', type: 'uuid', foreign_key: { table: 'units', column: 'id' }, description: 'Unit of measure for this line.' },
      { name: 'unit_price', type: 'decimal', description: 'Price per unit (excl. tax).' },
      { name: 'discount_pct', type: 'decimal', description: 'Discount percent on this line.' },
      { name: 'discount_amount', type: 'decimal', description: 'Absolute discount on this line.' },
      { name: 'taxable_amount', type: 'decimal', description: 'Amount on which tax is computed.' },
      { name: 'tax_rate', type: 'decimal', description: 'GST rate applied (percent).' },
      { name: 'cgst', type: 'decimal', description: 'CGST amount.' },
      { name: 'sgst', type: 'decimal', description: 'SGST amount.' },
      { name: 'igst', type: 'decimal', description: 'IGST amount.' },
      { name: 'cess', type: 'decimal', description: 'Cess amount.' },
      { name: 'line_total', type: 'decimal', description: 'Line total including tax.' },
      { name: 'hsn_code', type: 'string', nullable: true, description: 'HSN / SAC used for this line.' },
    ],
  },
  {
    file: 'purchases.csv',
    entity: 'purchase',
    description: 'Purchase bill headers.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'bill_number', type: 'string', description: 'Supplier-issued bill number.' },
      { name: 'supplier_id', type: 'uuid', foreign_key: { table: 'suppliers', column: 'id' }, description: 'Supplier this bill came from.' },
      { name: 'bill_date', type: 'date', description: 'Date on the supplier bill.' },
      { name: 'due_date', type: 'date', nullable: true, description: 'Payment due date.' },
      { name: 'financial_year', type: 'string', description: 'Indian financial year.' },
      { name: 'subtotal', type: 'decimal', description: 'Sum of line amounts before tax.' },
      { name: 'discount_total', type: 'decimal', description: 'Total discount received.' },
      { name: 'cgst_total', type: 'decimal', description: 'CGST portion.' },
      { name: 'sgst_total', type: 'decimal', description: 'SGST portion.' },
      { name: 'igst_total', type: 'decimal', description: 'IGST portion.' },
      { name: 'cess_total', type: 'decimal', description: 'Cess portion.' },
      { name: 'round_off', type: 'decimal', description: 'Rounding adjustment.' },
      { name: 'total', type: 'decimal', description: 'Grand total payable.' },
      { name: 'amount_paid', type: 'decimal', description: 'Sum of payments made against this bill.' },
      { name: 'status', type: 'enum', enum_values: ['draft', 'received', 'partial', 'paid', 'cancelled'], description: 'Lifecycle status.' },
      { name: 'notes', type: 'text', nullable: true, description: 'Free-text notes.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'purchase_items.csv',
    entity: 'purchase_line',
    description: 'Line items on purchase bills.',
    primary_key: ['id'],
    columns: [
      ID,
      { name: 'purchase_id', type: 'uuid', foreign_key: { table: 'purchases', column: 'id' }, description: 'Parent purchase bill.' },
      { name: 'line_no', type: 'integer', description: '1-based ordering within the bill.' },
      { name: 'item_id', type: 'uuid', foreign_key: { table: 'items', column: 'id' }, description: 'Item purchased.' },
      { name: 'description', type: 'text', nullable: true, description: 'Line description.' },
      { name: 'quantity', type: 'decimal', description: 'Quantity purchased.' },
      { name: 'unit_id', type: 'uuid', foreign_key: { table: 'units', column: 'id' }, description: 'Unit of measure.' },
      { name: 'unit_price', type: 'decimal', description: 'Price per unit (excl. tax).' },
      { name: 'discount_pct', type: 'decimal', description: 'Discount percent on the line.' },
      { name: 'discount_amount', type: 'decimal', description: 'Absolute discount.' },
      { name: 'taxable_amount', type: 'decimal', description: 'Amount on which tax is computed.' },
      { name: 'tax_rate', type: 'decimal', description: 'GST rate applied.' },
      { name: 'cgst', type: 'decimal', description: 'CGST amount.' },
      { name: 'sgst', type: 'decimal', description: 'SGST amount.' },
      { name: 'igst', type: 'decimal', description: 'IGST amount.' },
      { name: 'cess', type: 'decimal', description: 'Cess amount.' },
      { name: 'line_total', type: 'decimal', description: 'Line total including tax.' },
      { name: 'hsn_code', type: 'string', nullable: true, description: 'HSN / SAC used.' },
    ],
  },
  {
    file: 'payments.csv',
    entity: 'payment',
    description: 'Money received from customers or paid to suppliers. Append-only.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'payment_number', type: 'string', description: 'Human-facing payment reference.' },
      { name: 'direction', type: 'enum', enum_values: ['in', 'out'], description: '"in" = received from customer, "out" = paid to supplier.' },
      { name: 'party_type', type: 'enum', enum_values: ['customer', 'supplier'], description: 'Which party table party_id points at.' },
      { name: 'party_id', type: 'uuid', foreign_key: { table: 'customers or suppliers', column: 'id', note: 'Resolve using party_type.' }, description: 'The customer or supplier involved.' },
      { name: 'payment_date', type: 'date', description: 'Date of the payment.' },
      { name: 'method', type: 'enum', enum_values: ['cash', 'bank', 'upi', 'card', 'cheque'], description: 'Payment method.' },
      { name: 'reference', type: 'string', nullable: true, description: 'Cheque number, UPI reference, etc.' },
      { name: 'account_id', type: 'uuid', foreign_key: { table: 'accounts', column: 'id' }, description: 'Cash / bank account credited or debited.' },
      { name: 'amount', type: 'decimal', description: 'Amount in business currency.' },
      { name: 'allocated_to', type: 'json', nullable: true, description: 'JSON array of { invoice_id | bill_id, amount } allocations.' },
      { name: 'notes', type: 'text', nullable: true, description: 'Free-text notes.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'expenses.csv',
    entity: 'expense',
    description: 'Business expenses (rent, utilities, salaries, etc.).',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'expense_number', type: 'string', description: 'Human-facing reference.' },
      { name: 'expense_date', type: 'date', description: 'Date of expense.' },
      { name: 'category_account_id', type: 'uuid', foreign_key: { table: 'accounts', column: 'id' }, description: 'Expense account (chart of accounts).' },
      { name: 'payment_account_id', type: 'uuid', foreign_key: { table: 'accounts', column: 'id' }, description: 'Cash / bank account funded from.' },
      { name: 'supplier_id', type: 'uuid', nullable: true, foreign_key: { table: 'suppliers', column: 'id' }, description: 'Supplier if applicable.' },
      { name: 'description', type: 'text', description: 'What the expense was for.' },
      { name: 'amount', type: 'decimal', description: 'Net amount.' },
      { name: 'tax_amount', type: 'decimal', description: 'GST amount if input tax credit applies.' },
      { name: 'total', type: 'decimal', description: 'Amount + tax.' },
      { name: 'attachment_ref', type: 'string', nullable: true, description: 'Path in attachments/expenses/ if a receipt is stored.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'stock_movements.csv',
    entity: 'stock_movement',
    description:
      'Every inventory in/out event. Stock on hand = opening + purchases + sales_returns - sales - purchase_returns +/- adjustments.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'item_id', type: 'uuid', foreign_key: { table: 'items', column: 'id' }, description: 'Item that moved.' },
      { name: 'warehouse_id', type: 'uuid', foreign_key: { table: 'warehouses', column: 'id' }, description: 'Warehouse involved.' },
      { name: 'movement_type', type: 'enum', enum_values: ['opening', 'purchase', 'sale', 'sale_return', 'purchase_return', 'adjustment', 'transfer'], description: 'Kind of movement.' },
      { name: 'quantity', type: 'decimal', description: 'Signed quantity: positive = stock in, negative = stock out.' },
      { name: 'unit_cost', type: 'decimal', description: 'Per-unit cost at time of movement (for valuation).' },
      { name: 'ref_type', type: 'enum', enum_values: ['invoice', 'purchase', 'payment', 'expense', 'manual', 'opening', 'reversal', 'adjustment', 'item', 'product'], description: 'Type of source document.' },
      { name: 'ref_id', type: 'uuid', nullable: true, foreign_key: { table: 'ref_type-dependent', column: 'id', note: 'Interpret using ref_type.' }, description: 'Source document id.' },
      { name: 'occurred_at', type: 'datetime', description: 'When the movement happened.' },
      { name: 'notes', type: 'text', nullable: true, description: 'Free-text notes.' },
      CREATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'accounts.csv',
    entity: 'account',
    description: 'Chart of accounts (ledger heads).',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'code', type: 'string', description: 'Ledger code (e.g. "1100").' },
      { name: 'name', type: 'string', description: 'Account name (e.g. "Cash in hand").' },
      { name: 'type', type: 'enum', enum_values: ['asset', 'liability', 'equity', 'income', 'expense'], description: 'Accounting classification.' },
      { name: 'parent_id', type: 'uuid', nullable: true, foreign_key: { table: 'accounts', column: 'id' }, description: 'Parent account for grouping.' },
      { name: 'opening_balance', type: 'decimal', description: 'Opening balance (debit positive, credit negative or per convention).' },
      { name: 'is_system', type: 'boolean', description: 'True for accounts created by the application (cannot be deleted).' },
      { name: 'is_active', type: 'boolean', description: 'Whether the account is active.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'journal_entries.csv',
    entity: 'journal_entry',
    description: 'Double-entry journal headers. Append-only. Corrections are reversing entries.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'entry_number', type: 'string', description: 'Human-facing journal number.' },
      { name: 'entry_date', type: 'date', description: 'Effective date.' },
      { name: 'narration', type: 'text', description: 'Reason / description of the entry.' },
      { name: 'ref_type', type: 'enum', enum_values: ['invoice', 'purchase', 'payment', 'expense', 'manual', 'opening', 'reversal', 'adjustment', 'item', 'product'], description: 'Source document type.' },
      { name: 'ref_id', type: 'uuid', nullable: true, description: 'Source document id (interpret via ref_type).' },
      { name: 'is_reversed', type: 'boolean', description: 'True if a reversing entry has been posted.' },
      { name: 'reverses_entry_id', type: 'uuid', nullable: true, foreign_key: { table: 'journal_entries', column: 'id' }, description: 'If this entry reverses another, the reversed entry id.' },
      CREATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'journal_lines.csv',
    entity: 'journal_line',
    description: 'Debit / credit lines belonging to journal entries. SUM(debit) = SUM(credit) per entry_id.',
    primary_key: ['id'],
    columns: [
      ID,
      { name: 'entry_id', type: 'uuid', foreign_key: { table: 'journal_entries', column: 'id' }, description: 'Parent journal entry.' },
      { name: 'line_no', type: 'integer', description: '1-based ordering within the entry.' },
      { name: 'account_id', type: 'uuid', foreign_key: { table: 'accounts', column: 'id' }, description: 'Account being debited or credited.' },
      { name: 'debit', type: 'decimal', description: 'Debit amount (>= 0). Exactly one of debit / credit is > 0.' },
      { name: 'credit', type: 'decimal', description: 'Credit amount (>= 0). Exactly one of debit / credit is > 0.' },
      { name: 'description', type: 'text', nullable: true, description: 'Line-level description.' },
    ],
  },
  {
    file: 'orders.csv',
    entity: 'order',
    description: 'Sales orders and quotations. Non-financial until converted to an invoice.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'order_number', type: 'string', description: 'Human-facing number.' },
      { name: 'customer_id', type: 'uuid', foreign_key: { table: 'customers', column: 'id' }, description: 'Customer.' },
      { name: 'order_date', type: 'date', description: 'Order date.' },
      { name: 'status', type: 'enum', enum_values: ['draft', 'confirmed', 'invoiced', 'cancelled'], description: 'Lifecycle status.' },
      { name: 'total_estimate', type: 'decimal', description: 'Estimated total.' },
      { name: 'converted_invoice_id', type: 'uuid', nullable: true, foreign_key: { table: 'invoices', column: 'id' }, description: 'Invoice this order was converted to, if any.' },
      { name: 'notes', type: 'text', nullable: true, description: 'Free-text notes.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'returns.csv',
    entity: 'return',
    description: 'Sales returns (credit notes) and purchase returns (debit notes).',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'return_number', type: 'string', description: 'Human-facing number.' },
      { name: 'return_type', type: 'enum', enum_values: ['sale_return', 'purchase_return'], description: 'Which kind of return.' },
      { name: 'ref_invoice_id', type: 'uuid', nullable: true, foreign_key: { table: 'invoices', column: 'id' }, description: 'Original invoice, if a sale return.' },
      { name: 'ref_purchase_id', type: 'uuid', nullable: true, foreign_key: { table: 'purchases', column: 'id' }, description: 'Original purchase, if a purchase return.' },
      { name: 'return_date', type: 'date', description: 'Date of return.' },
      { name: 'reason', type: 'text', nullable: true, description: 'Reason.' },
      { name: 'total', type: 'decimal', description: 'Return value (positive).' },
      { name: 'tax_total', type: 'decimal', description: 'Tax reversed.' },
      CREATED_AT,
      UPDATED_AT,
      ENTITY_VERSION,
    ],
  },
  {
    file: 'audit_log.csv',
    entity: 'audit_log',
    description: 'Chronological log of significant changes. Read-only.',
    primary_key: ['id'],
    columns: [
      ID,
      BUSINESS_ID,
      { name: 'occurred_at', type: 'datetime', description: 'When the change happened.' },
      { name: 'device_id', type: 'uuid', description: 'Device that produced the change.' },
      { name: 'user_label', type: 'string', nullable: true, description: 'Human label of the user, if known.' },
      { name: 'entity_type', type: 'string', description: 'Kind of entity that changed.' },
      { name: 'entity_id', type: 'uuid', description: 'Id of the entity that changed.' },
      { name: 'operation', type: 'enum', enum_values: ['created', 'updated', 'deleted', 'posted', 'reversed'], description: 'What happened.' },
      { name: 'event_id', type: 'uuid', description: 'Corresponding event journal id.' },
      { name: 'summary', type: 'text', nullable: true, description: 'Human-readable summary.' },
    ],
  },
];

export function buildSchemaDoc(): SchemaDoc {
  return {
    schema_version: 1,
    generated_by: 'BusinessVault',
    description:
      'Machine-readable description of every CSV in current/. A customer with no access to the app can understand the data using this file alone. UUID-style values in id / *_id columns are stable internal identifiers, not human-facing numbers.',
    conventions: {
      encoding: 'UTF-8 with BOM',
      line_ending: 'LF (\\n)',
      quoting: 'RFC 4180 — fields containing commas, quotes, or newlines are wrapped in double quotes; embedded double quotes are doubled.',
      date_format: 'YYYY-MM-DD',
      datetime_format: 'ISO-8601 UTC, e.g. 2026-08-19T14:32:11.000Z',
      money_format: 'Decimal with 2 fractional digits, plain period (.) as decimal separator, no thousand separators, no currency symbol. Business currency is recorded on the business record.',
      id_format: 'ULID (26-character Crockford base32), sortable by creation time.',
      formula_injection_guard: 'Any cell that begins with =, +, -, or @ is prefixed with a single apostrophe (\') on export so spreadsheet software does not interpret it as a formula.',
    },
    tables: TABLES,
  };
}

export function renderSchemaJson(): string {
  return JSON.stringify(buildSchemaDoc(), null, 2);
}
