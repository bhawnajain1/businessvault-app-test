import { db } from '../db';
import { enqueue } from './syncQueue';
import type { WriteSnapshotInput } from '../storage/CustomerStorageProvider';

// Spec §13: daily snapshot after activity, monthly on 1st, financial-year on
// Apr 1 (India). Uses chained setTimeout so it survives a process kill —
// every fire re-checks manifest.lastSnapshot before enqueueing (idempotent).

export interface SnapshotSchedulerDeps {
  buildSnapshot: (
    businessId: string,
    kind: 'daily' | 'monthly' | 'annual',
    asOf: Date,
  ) => Promise<WriteSnapshotInput>;
  clock?: () => Date;
  hourOfDay?: number; // local hour to fire daily (default 23 = 11pm)
  minuteOfHour?: number;
  isFinancialYearStart?: (d: Date) => boolean;
}

export interface SnapshotSchedulerHandle {
  stop: () => void;
  fireNow: () => Promise<void>;
}

const iso = (d: Date): string => d.toISOString();
const day = (d: Date): string => d.toISOString().slice(0, 10);

// India FY = Apr 1 -> Mar 31.
const isFyStartIndia = (d: Date): boolean =>
  d.getMonth() === 3 && d.getDate() === 1; // April is month 3 (0-indexed)

const isFirstOfMonth = (d: Date): boolean => d.getDate() === 1;

interface LastSnapshotState {
  daily: string | null; // YYYY-MM-DD
  monthly: string | null; // YYYY-MM
  annual: string | null; // YYYY
}

const KV_KEY = 'sync.lastSnapshotState';

async function loadState(): Promise<LastSnapshotState> {
  const row = await db.kv.get(KV_KEY);
  if (row && row.value && typeof row.value === 'object') {
    return row.value as LastSnapshotState;
  }
  return { daily: null, monthly: null, annual: null };
}

async function saveState(s: LastSnapshotState, now: Date): Promise<void> {
  await db.kv.put({ key: KV_KEY, value: s, updated_at: iso(now) });
}

function msUntilNextFire(
  now: Date,
  hour: number,
  minute: number,
): number {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function startSnapshotScheduler(
  deps: SnapshotSchedulerDeps,
): SnapshotSchedulerHandle {
  const clock = deps.clock ?? ((): Date => new Date());
  const hour = deps.hourOfDay ?? 23;
  const minute = deps.minuteOfHour ?? 0;
  const isFyStart = deps.isFinancialYearStart ?? isFyStartIndia;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fireOnce = async (): Promise<void> => {
    if (stopped) return;
    const now = clock();
    const state = await loadState();
    const businesses = await db.businesses.toArray();

    for (const b of businesses) {
      // Daily — once per calendar day, after activity.
      const today = day(now);
      if (state.daily !== today) {
        const input = await deps.buildSnapshot(b.id, 'daily', now);
        await enqueue({
          businessId: b.id,
          kind: 'snapshot',
          payload: { input },
        });
        state.daily = today;
      }
      // Monthly — first of the month.
      const monthKey = today.slice(0, 7);
      if (isFirstOfMonth(now) && state.monthly !== monthKey) {
        const input = await deps.buildSnapshot(b.id, 'monthly', now);
        await enqueue({
          businessId: b.id,
          kind: 'snapshot',
          payload: { input },
        });
        state.monthly = monthKey;
      }
      // Annual — India FY start (Apr 1).
      const yearKey = today.slice(0, 4);
      if (isFyStart(now) && state.annual !== yearKey) {
        const input = await deps.buildSnapshot(b.id, 'annual', now);
        await enqueue({
          businessId: b.id,
          kind: 'snapshot',
          payload: { input },
        });
        state.annual = yearKey;
      }
    }

    await saveState(state, now);
  };

  const loop = (): void => {
    if (stopped) return;
    void fireOnce().finally(() => {
      if (stopped) return;
      const nextIn = msUntilNextFire(clock(), hour, minute);
      timer = setTimeout(loop, nextIn);
    });
  };

  // Schedule first fire at the next boundary. First tick also catches up
  // any missed daily snapshot (fireOnce is idempotent per calendar day).
  const initialDelay = msUntilNextFire(clock(), hour, minute);
  timer = setTimeout(loop, initialDelay);

  return {
    stop: (): void => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    fireNow: fireOnce,
  };
}
