import { useEffect, useMemo, useState } from 'react';
import { db } from '../../db';
import type { AuditLogEntry } from '../../db/types';
import { downloadCsv } from '../../csv/streamCsvExport';
import { useBusinessId } from './useBusinessId';

const PAGE_SIZE = 100;

export default function AuditLogPage() {
  const { businessId, error: bizError } = useBusinessId();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState<string>('');
  const [page, setPage] = useState<number>(0);

  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const rows = await db.audit_log
          .where('business_id')
          .equals(businessId)
          .reverse()
          .sortBy('at');
        if (alive) setEntries(rows);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [businessId]);

  const filtered = useMemo(() => {
    if (!q.trim()) return entries;
    const needle = q.toLowerCase();
    return entries.filter(
      (e) =>
        e.action.toLowerCase().includes(needle) ||
        e.entity_type.toLowerCase().includes(needle) ||
        e.entity_id.toLowerCase().includes(needle) ||
        e.actor.toLowerCase().includes(needle),
    );
  }, [entries, q]);

  const pageStart = page * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  async function exportCsv(): Promise<void> {
    await downloadCsv({
      columns: ['at', 'actor', 'action', 'entity_type', 'entity_id', 'device_id', 'before', 'after'],
      rows: filtered,
      toRow: (e) => ({
        at: e.at,
        actor: e.actor,
        action: e.action,
        entity_type: e.entity_type,
        entity_id: e.entity_id,
        device_id: e.device_id,
        before: e.before === null || e.before === undefined ? '' : JSON.stringify(e.before),
        after: e.after === null || e.after === undefined ? '' : JSON.stringify(e.after),
      }),
      filename: `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
    });
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <p className="text-sm text-slate-500">
            Immutable record of application actions. Read-only.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <input
            placeholder="Filter action/entity/actor"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            className="border border-slate-300 rounded px-2 py-1 text-sm w-64"
          />
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="border border-slate-300 rounded px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {bizError && <div className="text-red-600 text-sm">{bizError}</div>}
      {err && <div className="text-red-600 text-sm">{err}</div>}
      {loading && <div className="text-slate-500 text-sm">Loading...</div>}

      <div className="overflow-auto border border-slate-200 rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2 whitespace-nowrap">When</th>
              <th className="text-left px-3 py-2">Actor</th>
              <th className="text-left px-3 py-2">Action</th>
              <th className="text-left px-3 py-2">Entity</th>
              <th className="text-left px-3 py-2">Entity ID</th>
              <th className="text-left px-3 py-2">Device</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5 whitespace-nowrap font-mono text-xs">{e.at}</td>
                <td className="px-3 py-1.5">{e.actor}</td>
                <td className="px-3 py-1.5">{e.action}</td>
                <td className="px-3 py-1.5">{e.entity_type}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{e.entity_id}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{e.device_id}</td>
              </tr>
            ))}
            {pageRows.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  No audit entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <div className="text-slate-500">
            Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of {filtered.length}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="border border-slate-300 rounded px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
            >
              Prev
            </button>
            <span className="self-center">
              Page {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page + 1 >= totalPages}
              className="border border-slate-300 rounded px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
