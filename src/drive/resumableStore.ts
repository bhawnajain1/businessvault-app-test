import { db } from '../db';

const KEY_PREFIX = 'drive:resumable:';

export interface ResumableSession {
  uploadUrl: string;
  parentId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

function key(businessId: string, logicalKey: string): string {
  return `${KEY_PREFIX}${businessId}:${logicalKey}`;
}

export async function saveResumableSession(
  businessId: string,
  logicalKey: string,
  session: ResumableSession,
): Promise<void> {
  await db.kv.put({
    key: key(businessId, logicalKey),
    value: session,
    updated_at: new Date().toISOString(),
  });
}

export async function loadResumableSession(
  businessId: string,
  logicalKey: string,
): Promise<ResumableSession | null> {
  const row = await db.kv.get(key(businessId, logicalKey));
  return row ? ((row.value as ResumableSession) ?? null) : null;
}

export async function clearResumableSession(
  businessId: string,
  logicalKey: string,
): Promise<void> {
  await db.kv.delete(key(businessId, logicalKey));
}
