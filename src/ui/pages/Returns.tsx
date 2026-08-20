import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from '../hooks/useLiveQuery';
import { db } from '../../db';
import type { Customer, Invoice, InvoiceLine, Item } from '../../db/types';
import { useActiveBusiness } from '../hooks/useActiveBusiness';
import { createReturnService } from '../../domain/ReturnService';
import Money from '../components/Money';
import Qty from '../components/Qty';

// Returns are full-invoice reversals. ReturnService.createSalesReturn copies
// every line of the source invoice with negated qty/amount, restores stock,
// and posts a reversing journal. Partial (per-line) returns would need a
// service change and are not offered here.

export default function Returns() {
  const { businessId, deviceId, loading } = useActiveBusiness();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [reason, setReason] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every invoice for this business — small enough to filter client-side.
  const invoices = useLiveQuery<Invoice[]>(
    async () => {
      if (!businessId) return [];
      return db.invoices.where('business_id').equals(businessId).toArray();
    },
    [businessId],
    [] as Invoice[],
  );

  const customers = useLiveQuery<Customer[]>(
    async () => {
      if (!businessId) return [];
      return db.customers.where('business_id').equals(businessId).toArray();
    },
    [businessId],
    [] as Customer[],
  );

  const customerById = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const c of customers ?? []) m.set(c.id, c);
    return m;
  }, [customers]);

  // Credit notes: invoices whose reverses_invoice_id is set.
  const creditNotes = useMemo(() => {
    return (invoices ?? [])
      .filter((i) => i.reverses_invoice_id !== null)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [invoices]);

  const invoicesById = useMemo(() => {
    const m = new Map<string, Invoice>();
    for (const i of invoices ?? []) m.set(i.id, i);
    return m;
  }, [invoices]);

  // Invoices eligible to be returned: not already reversed, not a credit note,
  // not cancelled.
  const returnableInvoices = useMemo(() => {
    return (invoices ?? [])
      .filter(
        (i) =>
          i.reverses_invoice_id === null &&
          i.reversed_by_invoice_id === null &&
          i.status !== 'cancelled',
      )
      .sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : -1));
  }, [invoices]);

  const filteredReturnable = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return returnableInvoices;
    return returnableInvoices.filter((i) => {
      const cust = customerById.get(i.customer_id);
      return (
        i.invoice_number.toLowerCase().includes(q) ||
        (cust?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [returnableInvoices, pickerQuery, customerById]);

  const selectedInvoice = selectedInvoiceId ? invoicesById.get(selectedInvoiceId) : null;

  // Line detail + item names for the selected invoice (only fetched when set).
  const selectedLines = useLiveQuery<InvoiceLine[]>(
    async () => {
      if (!selectedInvoiceId) return [];
      return db.invoice_lines
        .where('invoice_id')
        .equals(selectedInvoiceId)
        .sortBy('line_no');
    },
    [selectedInvoiceId],
    [] as InvoiceLine[],
  );
  const items = useLiveQuery<Item[]>(
    async () => {
      if (!businessId) return [];
      return db.items.where('business_id').equals(businessId).toArray();
    },
    [businessId],
    [] as Item[],
  );
  const itemById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of items ?? []) m.set(i.id, i);
    return m;
  }, [items]);

  function beginNew() {
    setError(null);
    setPickerQuery('');
    setSelectedInvoiceId(null);
    setReason('');
    setPickerOpen(true);
  }

  function pickInvoice(id: string) {
    setSelectedInvoiceId(id);
    setPickerOpen(false);
    setReason('');
    setError(null);
  }

  function cancelFlow() {
    setSelectedInvoiceId(null);
    setPickerOpen(false);
    setReason('');
    setError(null);
  }

  async function postReturn() {
    if (!businessId || !deviceId || !selectedInvoice) return;
    if (!reason.trim()) {
      setError('Enter a reason for the return.');
      return;
    }
    setPosting(true);
    setError(null);
    try {
      const svc = createReturnService({ db });
      await svc.createSalesReturn({
        businessId,
        deviceId,
        originalInvoiceId: selectedInvoice.id,
        creditNoteNumber: `CN-${selectedInvoice.invoice_number}`,
        returnDate: new Date().toISOString().slice(0, 10),
        reason: reason.trim(),
      });
      cancelFlow();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }

  if (loading) return <div className="p-6 text-fg-muted">Loading...</div>;
  if (!businessId) {
    return (
      <div className="p-6 text-fg-muted">
        No active business — complete onboarding first.
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">Sale Returns</h1>
          <p className="text-sm text-fg-muted">
            Reverse a sale in full — restores stock and posts a credit note.
          </p>
        </div>
        {!pickerOpen && !selectedInvoice && (
          <button
            type="button"
            onClick={beginNew}
            className="bg-accent text-accent-fg text-sm rounded px-3 py-1.5 font-medium"
          >
            New sale return
          </button>
        )}
      </div>

      {/* Invoice picker */}
      {pickerOpen && (
        <section className="border border-border rounded p-3 bg-surface flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-fg">
              Pick an invoice to reverse
            </h2>
            <button
              type="button"
              onClick={cancelFlow}
              className="text-xs text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
          <input
            type="text"
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            placeholder="Search by invoice # or customer name…"
            className="w-full border border-border rounded px-2 py-1.5 text-sm bg-surface text-fg"
            autoFocus
          />
          <div className="max-h-96 overflow-auto border border-border rounded">
            <table className="w-full text-sm">
              <thead className="bg-surface-hover text-xs uppercase text-fg-muted sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Invoice #</th>
                  <th className="text-left px-3 py-2">Customer</th>
                  <th className="text-right px-3 py-2">Total</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {filteredReturnable.map((inv) => (
                  <tr key={inv.id} className="border-t border-border">
                    <td className="px-3 py-1.5 text-fg-muted">{inv.invoice_date}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {inv.invoice_number}
                    </td>
                    <td className="px-3 py-1.5">
                      {customerById.get(inv.customer_id)?.name ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <Money paise={inv.total_paise} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => pickInvoice(inv.id)}
                        className="text-xs text-blue-700 hover:underline"
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredReturnable.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-fg-subtle">
                      {returnableInvoices.length === 0
                        ? 'No invoices eligible for return.'
                        : 'No matches.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Confirm panel */}
      {selectedInvoice && (
        <section className="border border-border rounded p-4 bg-surface flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-fg">
              Reverse invoice{' '}
              <span className="font-mono">{selectedInvoice.invoice_number}</span>
            </h2>
            <button
              type="button"
              onClick={cancelFlow}
              className="text-xs text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
          <div className="text-sm text-fg-muted grid grid-cols-3 gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-fg-subtle">
                Customer
              </div>
              <div className="text-fg">
                {customerById.get(selectedInvoice.customer_id)?.name ?? '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-fg-subtle">
                Invoice date
              </div>
              <div className="text-fg">{selectedInvoice.invoice_date}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-fg-subtle">
                Original total
              </div>
              <div className="text-fg tabular-nums">
                <Money paise={selectedInvoice.total_paise} />
              </div>
            </div>
          </div>

          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-hover text-xs uppercase text-fg-muted">
                <tr>
                  <th className="text-left px-2 py-1.5">Item</th>
                  <th className="text-right px-2 py-1.5 w-24">Qty</th>
                  <th className="text-right px-2 py-1.5 w-28">Unit ₹</th>
                  <th className="text-right px-2 py-1.5 w-28">Line total</th>
                </tr>
              </thead>
              <tbody>
                {(selectedLines ?? []).map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-2 py-1.5">
                      {itemById.get(l.item_id)?.name ?? l.description ?? l.item_id}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <Qty micros={l.qty_micros} />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <Money paise={l.unit_price_paise} />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <Money paise={l.line_total_paise} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="flex flex-col text-sm">
            <span className="text-fg-muted mb-1">Reason for return</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Customer returned damaged goods"
              className="border border-border rounded px-2 py-1.5 bg-surface text-fg"
            />
          </label>

          <div className="text-xs text-fg-muted">
            Credit note number: <span className="font-mono">CN-{selectedInvoice.invoice_number}</span>
          </div>

          {error && (
            <div className="text-sm text-danger border border-danger/40 bg-danger/10 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void postReturn()}
              disabled={posting || !reason.trim()}
              className="bg-accent text-accent-fg text-sm rounded px-4 py-2 font-medium disabled:opacity-50"
            >
              {posting ? 'Posting…' : 'Post credit note'}
            </button>
            <button
              type="button"
              onClick={cancelFlow}
              className="text-sm border border-border rounded px-3 py-2 hover:bg-surface-hover"
            >
              Back
            </button>
          </div>

          <p className="text-xs text-fg-subtle">
            This reverses every line of the original invoice, restores stock, and posts a
            reversing journal entry. The original invoice stays in the audit trail.
          </p>
        </section>
      )}

      {/* Existing credit notes */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-fg">Existing sale returns</h2>
        <div className="border border-border rounded overflow-hidden bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-hover text-xs uppercase text-fg-muted">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Credit note #</th>
                <th className="text-left px-3 py-2">Reverses invoice</th>
                <th className="text-left px-3 py-2">Customer</th>
                <th className="text-right px-3 py-2">Amount</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {creditNotes.map((cn) => {
                const original = cn.reverses_invoice_id
                  ? invoicesById.get(cn.reverses_invoice_id)
                  : null;
                return (
                  <tr key={cn.id} className="border-t border-border">
                    <td className="px-3 py-1.5 text-fg-muted">{cn.invoice_date}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {cn.invoice_number}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {original?.invoice_number ?? '—'}
                    </td>
                    <td className="px-3 py-1.5">
                      {customerById.get(cn.customer_id)?.name ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <Money paise={cn.total_paise} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Link
                        to={`/invoices/${cn.id}`}
                        className="text-xs text-blue-700 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {creditNotes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-fg-subtle">
                    No sale returns yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
