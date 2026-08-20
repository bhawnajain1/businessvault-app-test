import { describe, expect, it, beforeEach, vi } from 'vitest';
import Dexie from 'dexie';
import { DriveApiClient, RetriableError } from './driveApiClient';
import { saveResumableSession, loadResumableSession } from './resumableStore';

// The client uses the singleton exported from '../db'. In tests we swap the
// underlying tables by monkey-patching the module's default export. We use a
// minimal Dexie DB here (drive_file_map + kv only) so we don't hit unrelated
// pre-existing schema bugs on other tables.
import * as dbModule from '../db';

function freshDb(): Dexie {
  const inst = new Dexie('bv-drive-' + Math.random().toString(36).slice(2));
  inst.version(1).stores({
    drive_file_map: 'id, business_id, [business_id+logical_path], drive_file_id',
    kv: '&key',
  });
  Object.defineProperty(dbModule, 'db', { value: inst, configurable: true, writable: true });
  return inst;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function errorResponse(status: number, reason?: string, headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({ error: { errors: reason ? [{ reason }] : [], message: `err ${status}` } }),
    { status, headers: { 'content-type': 'application/json', ...headers } },
  );
}

function makeClient(fetchImpl: typeof fetch, token: string = 'tkn-1'): {
  client: DriveApiClient;
  refreshes: number;
} {
  let refreshes = 0;
  let current = token;
  const provider = async (opts?: { forceRefresh?: boolean }): Promise<string> => {
    if (opts?.forceRefresh) {
      refreshes += 1;
      current = 'tkn-refreshed-' + refreshes;
    }
    return current;
  };
  const client = new DriveApiClient({ tokenProvider: provider, fetchImpl });
  return {
    client,
    get refreshes() {
      return refreshes;
    },
  } as { client: DriveApiClient; refreshes: number };
}

describe('DriveApiClient.ensureFolder', () => {
  beforeEach(() => freshDb());

  it('creates folder when list returns empty (cache miss)', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });
      if (url.includes('/files?q=')) {
        return jsonResponse(200, { files: [] });
      }
      if (url.includes('/files?fields=') && init?.method === 'POST') {
        return jsonResponse(200, {
          id: 'F1',
          name: 'Sharma',
          mimeType: 'application/vnd.google-apps.folder',
          modifiedTime: '2026-08-19T00:00:00Z',
          version: '1',
        });
      }
      if (url.includes('/files/F1?fields=')) {
        return jsonResponse(200, {
          id: 'F1',
          name: 'Sharma',
          mimeType: 'application/vnd.google-apps.folder',
          modifiedTime: '2026-08-19T00:00:00Z',
          version: '1',
        });
      }
      throw new Error('unexpected ' + url);
    }) as unknown as typeof fetch;

    const { client } = makeClient(fetchImpl);
    const f = await client.ensureFolder('root', 'Sharma');
    expect(f.id).toBe('F1');
    expect(calls.length).toBe(2);

    // Second call should hit cache and only make a getFileMetadata request.
    const before = calls.length;
    const f2 = await client.ensureFolder('root', 'Sharma');
    expect(f2.id).toBe('F1');
    const newCalls = calls.slice(before);
    expect(newCalls.length).toBe(1);
    expect(newCalls[0].url).toContain('/files/F1?fields=');
  });

  it('returns existing folder when list has a hit', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/files?q=')) {
        return jsonResponse(200, {
          files: [
            {
              id: 'F-EXIST',
              name: 'Sharma',
              mimeType: 'application/vnd.google-apps.folder',
              modifiedTime: '2026-08-19T00:00:00Z',
              version: '3',
            },
          ],
        });
      }
      throw new Error('unexpected ' + url);
    }) as unknown as typeof fetch;

    const { client } = makeClient(fetchImpl);
    const f = await client.ensureFolder('root', 'Sharma');
    expect(f.id).toBe('F-EXIST');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('DriveApiClient.uploadSmall', () => {
  beforeEach(() => freshDb());

  it('posts multipart body and returns file', async () => {
    let seenBody: Uint8Array | null = null;
    let seenContentType = '';
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      expect(url).toContain('uploadType=multipart');
      const headers = new Headers(init?.headers);
      seenContentType = headers.get('content-type') ?? '';
      seenBody = init?.body as Uint8Array;
      return jsonResponse(200, {
        id: 'F-SMALL',
        name: 'a.csv',
        mimeType: 'text/csv',
        modifiedTime: '2026-08-19T00:00:00Z',
        version: '1',
      });
    }) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);
    const f = await client.uploadSmall({
      parentId: 'PARENT',
      name: 'a.csv',
      mimeType: 'text/csv',
      bytes: 'hello',
    });
    expect(f.id).toBe('F-SMALL');
    expect(seenContentType).toMatch(/^multipart\/related; boundary=/);
    expect(seenBody).toBeTruthy();
    const decoded = new TextDecoder().decode(seenBody as unknown as Uint8Array);
    expect(decoded).toContain('"name":"a.csv"');
    expect(decoded).toContain('hello');
  });
});

describe('DriveApiClient auth refresh', () => {
  beforeEach(() => freshDb());

  it('refreshes on 401 and retries exactly once', async () => {
    let calls = 0;
    let refreshCalls = 0;
    let current = 'tkn-1';
    const tokens: string[] = [];
    const provider = async (opts?: { forceRefresh?: boolean }): Promise<string> => {
      if (opts?.forceRefresh) {
        refreshCalls += 1;
        current = 'tkn-2';
      }
      return current;
    };
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      tokens.push(auth);
      if (calls === 1) return new Response('unauth', { status: 401 });
      return jsonResponse(200, {
        id: 'F-OK',
        name: 'x',
        mimeType: 'application/vnd.google-apps.folder',
        modifiedTime: '2026-08-19T00:00:00Z',
        version: '1',
      });
    }) as unknown as typeof fetch;
    const client = new DriveApiClient({ tokenProvider: provider, fetchImpl });
    const f = await client.getFileMetadata('X');
    expect(f.id).toBe('F-OK');
    expect(calls).toBe(2);
    expect(refreshCalls).toBe(1);
    expect(tokens[0]).toBe('Bearer tkn-1');
    expect(tokens[1]).toBe('Bearer tkn-2');
  });

  it('does not retry a second 401', async () => {
    let calls = 0;
    const provider = async (): Promise<string> => 'tkn';
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return new Response('nope', { status: 401 });
    }) as unknown as typeof fetch;
    const client = new DriveApiClient({ tokenProvider: provider, fetchImpl });
    await expect(client.getFileMetadata('X')).rejects.toThrow();
    expect(calls).toBe(2); // initial + one refresh retry
  });
});

describe('DriveApiClient retriable errors', () => {
  beforeEach(() => freshDb());

  it('throws RetriableError on 429 with Retry-After', async () => {
    const fetchImpl = vi.fn(async () =>
      errorResponse(429, 'rateLimitExceeded', { 'retry-after': '7' }),
    ) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);
    await expect(client.getFileMetadata('X')).rejects.toMatchObject({
      name: 'RetriableError',
      status: 429,
      retryAfterMs: 7000,
    });
  });

  it('throws RetriableError on 403 userRateLimitExceeded', async () => {
    const fetchImpl = vi.fn(async () =>
      errorResponse(403, 'userRateLimitExceeded'),
    ) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);
    await expect(client.getFileMetadata('X')).rejects.toBeInstanceOf(RetriableError);
  });

  it('does NOT wrap ordinary 403 in RetriableError', async () => {
    const fetchImpl = vi.fn(async () =>
      errorResponse(403, 'insufficientFilePermissions'),
    ) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);
    const err = await client.getFileMetadata('X').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(RetriableError);
  });
});

describe('DriveApiClient.uploadResumable', () => {
  beforeEach(() => freshDb());

  it('happy path: initiates session, uploads one chunk, clears session', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('uploadType=resumable') && init?.method === 'POST') {
        return new Response('', {
          status: 200,
          headers: { location: 'https://upload.example/session-1' },
        });
      }
      if (url === 'https://upload.example/session-1' && init?.method === 'PUT') {
        return jsonResponse(200, {
          id: 'F-RES',
          name: 'big.bin',
          mimeType: 'application/octet-stream',
          modifiedTime: '2026-08-19T00:00:00Z',
          version: '1',
        });
      }
      throw new Error('unexpected ' + url);
    }) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);
    const blob = new Blob([new Uint8Array(1024).fill(7)]);
    const progress: Array<[number, number]> = [];
    const f = await client.uploadResumable({
      businessId: 'B1',
      logicalPath: 'attachments/big.bin',
      parentId: 'P1',
      name: 'big.bin',
      mimeType: 'application/octet-stream',
      blob,
      onProgress: (s, t) => progress.push([s, t]),
    });
    expect(f.id).toBe('F-RES');
    expect(progress.at(-1)).toEqual([1024, 1024]);
    const persisted = await loadResumableSession('B1', 'P1/big.bin');
    expect(persisted).toBeNull();
  });

  it('resumes from a previously-persisted uploadUrl', async () => {
    const calls: Array<{ url: string; method?: string; range?: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const range = new Headers(init?.headers).get('content-range') ?? '';
      calls.push({ url, method: init?.method, range });
      if (url === 'https://upload.example/resume-me' && range.startsWith('bytes */')) {
        // Server says 500 of 1000 bytes already stored.
        return new Response('', { status: 308, headers: { range: 'bytes=0-499' } });
      }
      if (url === 'https://upload.example/resume-me' && init?.method === 'PUT') {
        return jsonResponse(200, {
          id: 'F-RESUMED',
          name: 'big.bin',
          mimeType: 'application/octet-stream',
          modifiedTime: '2026-08-19T00:00:00Z',
          version: '2',
        });
      }
      throw new Error('unexpected ' + url);
    }) as unknown as typeof fetch;
    await saveResumableSession('B1', 'P1/big.bin', {
      uploadUrl: 'https://upload.example/resume-me',
      parentId: 'P1',
      name: 'big.bin',
      mimeType: 'application/octet-stream',
      size: 1000,
      createdAt: new Date().toISOString(),
    });
    const { client } = makeClient(fetchImpl);
    const blob = new Blob([new Uint8Array(1000).fill(3)]);
    const f = await client.uploadResumable({
      businessId: 'B1',
      logicalPath: 'attachments/big.bin',
      parentId: 'P1',
      name: 'big.bin',
      mimeType: 'application/octet-stream',
      blob,
    });
    expect(f.id).toBe('F-RESUMED');
    // First call should be probe (bytes */1000); second should send bytes 500-999.
    expect(calls[0].range).toBe('bytes */1000');
    expect(calls[1].range).toBe('bytes 500-999/1000');
    const persisted = await loadResumableSession('B1', 'P1/big.bin');
    expect(persisted).toBeNull();
  });

  it('probe returning 200 completes immediately without re-uploading', async () => {
    await saveResumableSession('B1', 'P1/done.bin', {
      uploadUrl: 'https://upload.example/already-done',
      parentId: 'P1',
      name: 'done.bin',
      mimeType: 'application/octet-stream',
      size: 100,
      createdAt: new Date().toISOString(),
    });
    let putCount = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://upload.example/already-done' && init?.method === 'PUT') {
        putCount += 1;
        return jsonResponse(200, {
          id: 'F-DONE',
          name: 'done.bin',
          mimeType: 'application/octet-stream',
          modifiedTime: '2026-08-19T00:00:00Z',
          version: '9',
        });
      }
      throw new Error('unexpected ' + url);
    }) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);
    const f = await client.uploadResumable({
      businessId: 'B1',
      logicalPath: 'attachments/done.bin',
      parentId: 'P1',
      name: 'done.bin',
      mimeType: 'application/octet-stream',
      blob: new Blob([new Uint8Array(100)]),
    });
    expect(f.id).toBe('F-DONE');
    expect(putCount).toBe(1);
  });
});
