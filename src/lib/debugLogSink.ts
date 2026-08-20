// Dev-only: mirror console.log/warn/error to /tmp/bv-debug.log via the vite
// middleware /__bvlog. Batches writes so the HTTP roundtrip cost is minimal
// and preserves message ordering.

const BATCH_MS = 100;
const buffer: string[] = [];
let scheduled = false;

function fmt(level: string, args: unknown[]): string {
  const t = new Date().toISOString();
  const parts = args.map((a) => {
    if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
    if (typeof a === 'object' && a !== null) {
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    }
    return String(a);
  });
  return `${t} [${level}] ${parts.join(' ')}`;
}

function flush(): void {
  scheduled = false;
  if (buffer.length === 0) return;
  const body = buffer.join('\n');
  buffer.length = 0;
  void fetch('/__bvlog', { method: 'POST', body }).catch(() => {
    /* dev-only: swallow */
  });
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(flush, BATCH_MS);
}

export function installDebugLogSink(): void {
  if (typeof window === 'undefined') return;
  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.log = (...args: unknown[]): void => {
    orig.log(...args);
    buffer.push(fmt('log', args));
    schedule();
  };
  console.warn = (...args: unknown[]): void => {
    orig.warn(...args);
    buffer.push(fmt('warn', args));
    schedule();
  };
  console.error = (...args: unknown[]): void => {
    orig.error(...args);
    buffer.push(fmt('error', args));
    schedule();
  };
  window.addEventListener('error', (e) => {
    buffer.push(fmt('window.error', [e.message, e.filename, e.lineno, e.error]));
    schedule();
  });
  window.addEventListener('unhandledrejection', (e) => {
    buffer.push(fmt('unhandledrejection', [e.reason]));
    schedule();
  });
  orig.log('[debugLogSink] installed — mirroring to /tmp/bv-debug.log');
  buffer.push(fmt('log', ['[debugLogSink] installed — mirroring to /tmp/bv-debug.log']));
  schedule();
}
