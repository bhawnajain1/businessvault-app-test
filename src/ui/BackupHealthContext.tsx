import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { db } from '../db';
import type { BackupHealth, BackupHealthStatus } from '../sync/syncWorker';

const HEALTH_KV_KEY = 'sync.backupHealth';
const POLL_MS = 2_000;

const DEFAULT_HEALTH: BackupHealth = {
  status: 'HEALTHY',
  pending: 0,
  lastEventSyncAt: null,
  lastFullSnapshotAt: null,
  updatedAt: new Date(0).toISOString(),
};

export interface BackupHealthContextValue {
  health: BackupHealth;
  setHealth: (h: BackupHealth) => void;
}

const Ctx = createContext<BackupHealthContextValue | null>(null);

export interface BackupHealthProviderProps {
  children: ReactNode;
  initialHealth?: BackupHealth;
  pollIntervalMs?: number;
}

// The sync worker persists BackupHealth into db.kv under 'sync.backupHealth'
// on every state change (see syncWorker.emit()). We poll that row so the
// header cloud indicator reflects the truth even if the worker instance
// lives in a different module (or later, a web worker).
export function BackupHealthProvider(props: BackupHealthProviderProps) {
  const [health, setHealth] = useState<BackupHealth>(
    props.initialHealth ?? DEFAULT_HEALTH,
  );
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const readOnce = async (): Promise<void> => {
      try {
        const row = await db.kv.get(HEALTH_KV_KEY);
        if (cancelled.current) return;
        if (row && row.value && typeof row.value === 'object') {
          setHealth(row.value as BackupHealth);
        }
      } catch {
        // Dexie not initialised yet, or storage locked; skip this tick.
      }
    };
    void readOnce();
    const id = setInterval(() => {
      void readOnce();
    }, props.pollIntervalMs ?? POLL_MS);
    return () => {
      cancelled.current = true;
      clearInterval(id);
    };
  }, [props.pollIntervalMs]);

  const value = useMemo<BackupHealthContextValue>(
    () => ({ health, setHealth }),
    [health],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useBackupHealth(): BackupHealth {
  const v = useContext(Ctx);
  return v ? v.health : DEFAULT_HEALTH;
}

export function useSetBackupHealth(): (h: BackupHealth) => void {
  const v = useContext(Ctx);
  if (!v) return () => undefined;
  return v.setHealth;
}

export type { BackupHealth, BackupHealthStatus };
