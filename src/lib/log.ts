// Durable structured log — see task #14. End users can export the last N
// hours of logs from Settings when reporting a bug. Two destinations:
//
//   1) IndexedDB `debug_logs` table — always on, capped at MAX_ROWS ring.
//   2) The connected LocalFolderStorageProvider — appends to
//      `logs/YYYY-MM-DD.jsonl` alongside the journal so the file lives with
//      the customer's backup and can be zipped and mailed to support.
//
// Console is mirrored in dev only (import.meta.env.DEV). Production builds
// are silent on the DevTools console but still write both destinations.
//
// Grug: one module, one flush timer, one buffer. No log framework, no
// per-caller loggers, no severity DSL. Callers write:
//     log.info('sync.tick', { pending: 12 });
//     log.error('provider.appendFile', err, { path });

import { db } from '../db';
import type { DebugLogEntry, LogLevel } from '../db/types';
import { getActiveProvider } from '../sync/providerRegistry';

const FLUSH_INTERVAL_MS = 2000;
const FLUSH_BATCH_MAX = 50;
const MAX_ROWS = 5000; // ring-buffer size in IndexedDB
const RETAIN_DAYS = 7; // on-disk retention for logs/*.jsonl

let buffer: DebugLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> | null = null;

function scheduleFlush(): void {
  if (flushTimer || buffer.length === 0) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

function push(level: LogLevel, source: string, msg: string, ctx?: unknown): void {
  const entry: DebugLogEntry = {
    ts: new Date().toISOString(),
    level,
    source,
    msg,
    ctx: ctx == null ? null : redact(ctx as Record<string, unknown>),
  };
  buffer.push(entry);

  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    const fn =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${source}] ${msg}`, ctx ?? '');
  }

  if (buffer.length >= FLUSH_BATCH_MAX) {
    void flush();
  } else {
    scheduleFlush();
  }
}

async function flush(): Promise<void> {
  // If a flush is already running, join it. `exportLogsAsJsonl` and the
  // `beforeunload` handler rely on this — a boolean guard that returned
  // immediately would let export miss the in-flight batch.
  if (flushInFlight) return flushInFlight;
  if (buffer.length === 0) return;
  const toWrite = buffer;
  buffer = [];
  flushInFlight = (async () => {
    try {
      await db.debug_logs.bulkAdd(toWrite);
      const count = await db.debug_logs.count();
      if (count > MAX_ROWS) {
        const excess = count - MAX_ROWS;
        const doomed = await db.debug_logs
          .orderBy('id')
          .limit(excess)
          .primaryKeys();
        await db.debug_logs.bulkDelete(doomed);
      }
      const provider = getActiveProvider() as unknown as {
        appendLogLines?: (lines: string[]) => Promise<void>;
      } | null;
      if (provider?.appendLogLines) {
        try {
          await provider.appendLogLines(toWrite.map((e) => JSON.stringify(e)));
        } catch {
          // Best-effort — Dexie copy is still the source of truth.
        }
      }
    } catch {
      // Requeue at head so the next flush retries. If the DB is closed
      // (test teardown), the retry will also fail — we just drop silently.
      buffer = [...toWrite, ...buffer];
    } finally {
      flushInFlight = null;
      // A caller that appended while we were flushing needs a fresh timer.
      if (buffer.length > 0) scheduleFlush();
    }
  })();
  return flushInFlight;
}

const SENSITIVE_KEY_RE = /token|password|secret|auth|api[_-]?key/i;
// Strips URL query params and long hex/base64 blobs that could contain a
// token — applied to string fields (including Error.stack and Error.message).
const STACK_TOKEN_RE = /([?&](?:access_token|refresh_token|token|code|key)=)[^&\s"]+/gi;
const LONG_TOKEN_RE = /\b[A-Za-z0-9._~+/=-]{40,}\b/g;

function scrubString(s: string): string {
  return s.replace(STACK_TOKEN_RE, '$1<redacted>').replace(LONG_TOKEN_RE, '<redacted>');
}

function redactValue(v: unknown, depth: number): unknown {
  if (depth > 6) return '<truncated>';
  if (v == null) return v;
  if (typeof v === 'string') return scrubString(v);
  if (typeof v !== 'object') return v;
  if (v instanceof Error) {
    return {
      name: v.name,
      message: scrubString(v.message),
      stack: v.stack ? scrubString(v.stack) : undefined,
    };
  }
  if (Array.isArray(v)) return v.map((x) => redactValue(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, sub] of Object.entries(v as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(k)) out[k] = '<redacted>';
    else out[k] = redactValue(sub, depth + 1);
  }
  return out;
}

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  return redactValue(obj, 0) as Record<string, unknown>;
}

export const log = {
  debug(source: string, msg: string, ctx?: unknown): void {
    push('debug', source, msg, ctx);
  },
  info(source: string, msg: string, ctx?: unknown): void {
    push('info', source, msg, ctx);
  },
  warn(source: string, msg: string, ctx?: unknown): void {
    push('warn', source, msg, ctx);
  },
  error(source: string, msg: string, ctx?: unknown): void {
    push('error', source, msg, ctx);
  },
  flush,
};

// Called from main.tsx on startup so unhandled errors land in the log too.
// Rate-limits unhandledrejection to avoid a runaway loop when Dexie itself is
// unhealthy: the log module's own catch throws → beforeunload → export →
// promise rejection → we re-log → repeat.
export function installGlobalErrorCapture(): void {
  if (typeof window === 'undefined') return;
  let rejectionsThisSecond = 0;
  let rejectionsSecondStart = 0;
  window.addEventListener('error', (ev) => {
    log.error('window', ev.message, {
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
      error: ev.error,
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const now = performance.now();
    if (now - rejectionsSecondStart > 1000) {
      rejectionsSecondStart = now;
      rejectionsThisSecond = 0;
    }
    rejectionsThisSecond += 1;
    if (rejectionsThisSecond > 10) return; // amplification guard
    const reason = ev.reason;
    log.error(
      'window',
      'unhandledrejection',
      reason instanceof Error ? { error: reason } : { reason: String(reason) },
    );
  });
  window.addEventListener('beforeunload', () => {
    // IndexedDB writes started here may not complete before unload — the
    // ~2s buffered window is the accepted loss. Users get everything up to
    // the last successful flush (2s granularity).
    void flush();
  });
}

// Export the last `sinceMs` milliseconds of logs as a single jsonl string.
// Consumed by the "Download debug logs" button in Settings.
export async function exportLogsAsJsonl(
  sinceMs: number = 24 * 60 * 60 * 1000,
): Promise<string> {
  await flush();
  const cutoff = new Date(Date.now() - sinceMs).toISOString();
  const rows = await db.debug_logs
    .where('ts')
    .above(cutoff)
    .toArray();
  return rows.map((r) => JSON.stringify(r)).join('\n');
}

export function retainDaysCutoff(): string {
  return new Date(Date.now() - RETAIN_DAYS * 86_400_000).toISOString();
}
