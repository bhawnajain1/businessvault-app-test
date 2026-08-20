import { db } from '../db';
import type { DriveFileMap } from '../db/types';
import {
  clearResumableSession,
  loadResumableSession,
  saveResumableSession,
  type ResumableSession,
} from './resumableStore';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  version: string;
  parents?: string[];
  md5Checksum?: string;
  size?: string;
}

export interface UploadSmallInput {
  parentId: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array | ArrayBuffer | string;
  metadata?: Record<string, unknown>;
  businessId?: string;
  logicalPath?: string;
}

export interface UploadResumableInput {
  parentId: string;
  name: string;
  mimeType: string;
  blob: Blob;
  metadata?: Record<string, unknown>;
  businessId: string;
  logicalPath: string;
  chunkSize?: number;
  onProgress?: (bytesSent: number, total: number) => void;
}

export interface UpdateFileContentsInput {
  fileId: string;
  mimeType: string;
  bytes: Uint8Array | ArrayBuffer | string;
  ifRevision?: string;
}

export interface ListFolderOpts {
  q?: string;
  pageSize?: number;
  fields?: string;
}

export interface ChangesPage {
  changes: Array<{
    fileId: string;
    removed: boolean;
    file?: DriveFile;
    time?: string;
  }>;
  newStartPageToken?: string;
  nextPageToken?: string;
}

export type TokenProvider = (opts?: { forceRefresh?: boolean }) => Promise<string>;

export class RetriableError extends Error {
  status: number;
  retryAfterMs: number;
  reason?: string;
  constructor(status: number, message: string, retryAfterMs: number, reason?: string) {
    super(message);
    this.name = 'RetriableError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.reason = reason;
  }
}

export class DriveApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, message: string, body: string) {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
    this.body = body;
  }
}

const DRIVE_V3 = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_V3 = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DEFAULT_FIELDS = 'id,name,mimeType,modifiedTime,version,parents,md5Checksum,size';
const DEFAULT_CHUNK = 8 * 1024 * 1024;
const SMALL_UPLOAD_MAX = 5 * 1024 * 1024;

function toDriveFile(raw: Record<string, unknown>): DriveFile {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    mimeType: String(raw.mimeType ?? ''),
    modifiedTime: String(raw.modifiedTime ?? ''),
    version: String(raw.version ?? ''),
    parents: Array.isArray(raw.parents) ? (raw.parents as string[]) : undefined,
    md5Checksum: raw.md5Checksum ? String(raw.md5Checksum) : undefined,
    size: raw.size ? String(raw.size) : undefined,
  };
}

function escapeQ(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function parseRetryAfter(h: string | null): number {
  if (!h) return 0;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(h);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return 0;
}

async function readErrorReason(res: Response): Promise<{ text: string; reason?: string }> {
  const text = await res.text().catch(() => '');
  let reason: string | undefined;
  if (text) {
    try {
      const parsed = JSON.parse(text) as {
        error?: { errors?: Array<{ reason?: string }>; message?: string };
      };
      reason = parsed.error?.errors?.[0]?.reason;
    } catch {
      // ignore
    }
  }
  return { text, reason };
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isRateLimit403(reason: string | undefined): boolean {
  return reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
}

type FetchLike = typeof fetch;

export interface DriveApiClientOptions {
  tokenProvider: TokenProvider;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export class DriveApiClient {
  private tokenProvider: TokenProvider;
  private fetchImpl: FetchLike;

  constructor(opts: DriveApiClientOptions) {
    this.tokenProvider = opts.tokenProvider;
    this.fetchImpl =
      opts.fetchImpl ??
      ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  }

  private async authedFetch(
    url: string,
    init: RequestInit = {},
    opts: { skipAuthRetry?: boolean } = {},
  ): Promise<Response> {
    const token = await this.tokenProvider();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const res = await this.fetchImpl(url, { ...init, headers });
    if (res.status === 401 && !opts.skipAuthRetry) {
      const refreshed = await this.tokenProvider({ forceRefresh: true });
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set('Authorization', `Bearer ${refreshed}`);
      return this.fetchImpl(url, { ...init, headers: retryHeaders });
    }
    return res;
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.authedFetch(url, init);
    if (res.ok) {
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) return (await res.json()) as T;
      return (await res.text()) as unknown as T;
    }
    const { text, reason } = await readErrorReason(res);
    if (isRetriableStatus(res.status) || (res.status === 403 && isRateLimit403(reason))) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      throw new RetriableError(res.status, `Drive ${res.status} ${reason ?? ''}`.trim(), retryAfter, reason);
    }
    throw new DriveApiError(res.status, `Drive ${res.status}`, text);
  }

  async ensureFolder(parentId: string | 'root', name: string): Promise<DriveFile> {
    const parent = parentId === 'root' ? 'root' : parentId;
    const logicalPath = `__folder__:${parent}/${name}`;

    const cached = await this.readCachedMap('__any__', logicalPath);
    if (cached) {
      try {
        return await this.getFileMetadata(cached.drive_file_id);
      } catch (err) {
        if (err instanceof DriveApiError && err.status === 404) {
          await db.drive_file_map.delete(cached.id);
        } else {
          throw err;
        }
      }
    }

    const q =
      `mimeType='${FOLDER_MIME}' and trashed=false and ` +
      `name='${escapeQ(name)}' and '${escapeQ(parent)}' in parents`;
    const listUrl =
      `${DRIVE_V3}/files?q=${encodeURIComponent(q)}&fields=` +
      encodeURIComponent(`files(${DEFAULT_FIELDS})`) +
      `&pageSize=1`;
    const listed = await this.request<{ files?: Array<Record<string, unknown>> }>(listUrl);
    let folder: DriveFile;
    if (listed.files && listed.files.length > 0) {
      folder = toDriveFile(listed.files[0]);
    } else {
      const body = JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] });
      const created = await this.request<Record<string, unknown>>(
        `${DRIVE_V3}/files?fields=${encodeURIComponent(DEFAULT_FIELDS)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        },
      );
      folder = toDriveFile(created);
    }
    await this.writeCachedMap('__any__', logicalPath, folder);
    return folder;
  }

  async ensurePath(pathSegments: string[]): Promise<DriveFile> {
    if (pathSegments.length === 0) {
      throw new Error('ensurePath requires at least one segment');
    }
    let parent: string | 'root' = 'root';
    let leaf: DriveFile | null = null;
    for (const seg of pathSegments) {
      leaf = await this.ensureFolder(parent, seg);
      parent = leaf.id;
    }
    return leaf as DriveFile;
  }

  async uploadSmall(input: UploadSmallInput): Promise<DriveFile> {
    const body = typeof input.bytes === 'string' ? new TextEncoder().encode(input.bytes) : input.bytes;
    const bodyLen = body instanceof Uint8Array ? body.byteLength : (body as ArrayBuffer).byteLength;
    if (bodyLen > SMALL_UPLOAD_MAX) {
      throw new Error(`uploadSmall payload ${bodyLen} exceeds 5MB; use uploadResumable`);
    }
    const metadata = {
      name: input.name,
      mimeType: input.mimeType,
      parents: [input.parentId],
      ...(input.metadata ?? {}),
    };
    const boundary = 'bv-boundary-' + Math.random().toString(36).slice(2);
    const enc = new TextEncoder();
    const head =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const headBytes = enc.encode(head);
    const tailBytes = enc.encode(tail);
    const bodyBytes =
      body instanceof Uint8Array ? body : new Uint8Array(body as ArrayBuffer);
    const merged = new Uint8Array(headBytes.byteLength + bodyBytes.byteLength + tailBytes.byteLength);
    merged.set(headBytes, 0);
    merged.set(bodyBytes, headBytes.byteLength);
    merged.set(tailBytes, headBytes.byteLength + bodyBytes.byteLength);
    const url =
      `${DRIVE_UPLOAD_V3}/files?uploadType=multipart&fields=` +
      encodeURIComponent(DEFAULT_FIELDS);
    const raw = await this.request<Record<string, unknown>>(url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: merged,
    });
    const file = toDriveFile(raw);
    if (input.businessId && input.logicalPath) {
      await this.writeCachedMap(input.businessId, input.logicalPath, file);
    }
    return file;
  }

  async uploadResumable(input: UploadResumableInput): Promise<DriveFile> {
    const chunkSize = input.chunkSize ?? DEFAULT_CHUNK;
    const total = input.blob.size;
    const persistedKey = `${input.parentId}/${input.name}`;

    let session = await loadResumableSession(input.businessId, persistedKey);
    let uploadUrl = session?.uploadUrl ?? null;
    let bytesSent = 0;

    if (uploadUrl) {
      const probe = await this.authedFetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes */${total}` },
      });
      if (probe.status === 200 || probe.status === 201) {
        const raw = (await probe.json()) as Record<string, unknown>;
        await clearResumableSession(input.businessId, persistedKey);
        const file = toDriveFile(raw);
        await this.writeCachedMap(input.businessId, input.logicalPath, file);
        return file;
      }
      if (probe.status === 308) {
        const range = probe.headers.get('range');
        if (range) {
          const m = range.match(/bytes=0-(\d+)/);
          if (m) bytesSent = Number(m[1]) + 1;
        }
      } else if (probe.status === 404 || probe.status === 410) {
        uploadUrl = null;
        await clearResumableSession(input.businessId, persistedKey);
      } else if (!probe.ok) {
        const { text, reason } = await readErrorReason(probe);
        if (isRetriableStatus(probe.status) || (probe.status === 403 && isRateLimit403(reason))) {
          throw new RetriableError(
            probe.status,
            `Drive resumable probe ${probe.status}`,
            parseRetryAfter(probe.headers.get('retry-after')),
            reason,
          );
        }
        throw new DriveApiError(probe.status, `Drive resumable probe ${probe.status}`, text);
      }
    }

    if (!uploadUrl) {
      const metadata = {
        name: input.name,
        mimeType: input.mimeType,
        parents: [input.parentId],
        ...(input.metadata ?? {}),
      };
      const initRes = await this.authedFetch(
        `${DRIVE_UPLOAD_V3}/files?uploadType=resumable&fields=` +
          encodeURIComponent(DEFAULT_FIELDS),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': input.mimeType,
            'X-Upload-Content-Length': String(total),
          },
          body: JSON.stringify(metadata),
        },
      );
      if (!initRes.ok) {
        const { text, reason } = await readErrorReason(initRes);
        if (isRetriableStatus(initRes.status) || (initRes.status === 403 && isRateLimit403(reason))) {
          throw new RetriableError(
            initRes.status,
            `Drive resumable init ${initRes.status}`,
            parseRetryAfter(initRes.headers.get('retry-after')),
            reason,
          );
        }
        throw new DriveApiError(initRes.status, `Drive resumable init ${initRes.status}`, text);
      }
      uploadUrl = initRes.headers.get('location');
      if (!uploadUrl) throw new Error('Drive resumable init missing Location header');
      session = {
        uploadUrl,
        parentId: input.parentId,
        name: input.name,
        mimeType: input.mimeType,
        size: total,
        createdAt: new Date().toISOString(),
      };
      await saveResumableSession(input.businessId, persistedKey, session);
      bytesSent = 0;
    }

    while (bytesSent < total) {
      const end = Math.min(total, bytesSent + chunkSize);
      const chunk = input.blob.slice(bytesSent, end);
      const range = `bytes ${bytesSent}-${end - 1}/${total}`;
      const res = await this.authedFetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': range },
        body: chunk,
      });
      if (res.status === 200 || res.status === 201) {
        const raw = (await res.json()) as Record<string, unknown>;
        await clearResumableSession(input.businessId, persistedKey);
        input.onProgress?.(total, total);
        const file = toDriveFile(raw);
        await this.writeCachedMap(input.businessId, input.logicalPath, file);
        return file;
      }
      if (res.status === 308) {
        const rangeHeader = res.headers.get('range');
        if (rangeHeader) {
          const m = rangeHeader.match(/bytes=0-(\d+)/);
          if (m) bytesSent = Number(m[1]) + 1;
          else bytesSent = end;
        } else {
          bytesSent = end;
        }
        input.onProgress?.(bytesSent, total);
        continue;
      }
      const { text, reason } = await readErrorReason(res);
      if (isRetriableStatus(res.status) || (res.status === 403 && isRateLimit403(reason))) {
        throw new RetriableError(
          res.status,
          `Drive resumable chunk ${res.status}`,
          parseRetryAfter(res.headers.get('retry-after')),
          reason,
        );
      }
      throw new DriveApiError(res.status, `Drive resumable chunk ${res.status}`, text);
    }
    throw new Error('Drive resumable upload finished loop without a final response');
  }

  async updateFileContents(input: UpdateFileContentsInput): Promise<DriveFile> {
    const body =
      typeof input.bytes === 'string'
        ? new TextEncoder().encode(input.bytes)
        : input.bytes;
    const url =
      `${DRIVE_UPLOAD_V3}/files/${encodeURIComponent(input.fileId)}?uploadType=media&fields=` +
      encodeURIComponent(DEFAULT_FIELDS);
    const headers: Record<string, string> = { 'Content-Type': input.mimeType };
    if (input.ifRevision) headers['If-Match'] = input.ifRevision;
    const raw = await this.request<Record<string, unknown>>(url, {
      method: 'PATCH',
      headers,
      body: body as BodyInit,
    });
    return toDriveFile(raw);
  }

  async downloadFile(fileId: string): Promise<Blob> {
    const url = `${DRIVE_V3}/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await this.authedFetch(url);
    if (!res.ok) {
      const { text, reason } = await readErrorReason(res);
      if (isRetriableStatus(res.status) || (res.status === 403 && isRateLimit403(reason))) {
        throw new RetriableError(
          res.status,
          `Drive download ${res.status}`,
          parseRetryAfter(res.headers.get('retry-after')),
          reason,
        );
      }
      throw new DriveApiError(res.status, `Drive download ${res.status}`, text);
    }
    return await res.blob();
  }

  async getFileMetadata(fileId: string): Promise<DriveFile> {
    const url =
      `${DRIVE_V3}/files/${encodeURIComponent(fileId)}?fields=` +
      encodeURIComponent(DEFAULT_FIELDS);
    const raw = await this.request<Record<string, unknown>>(url);
    return toDriveFile(raw);
  }

  async listFolder(parentId: string, opts: ListFolderOpts = {}): Promise<DriveFile[]> {
    const pageSize = opts.pageSize ?? 200;
    const fields = opts.fields ?? `files(${DEFAULT_FIELDS}),nextPageToken`;
    const baseQ = `'${escapeQ(parentId)}' in parents and trashed=false`;
    const q = opts.q ? `${baseQ} and (${opts.q})` : baseQ;

    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams();
      params.set('q', q);
      params.set('pageSize', String(pageSize));
      params.set('fields', fields);
      if (pageToken) params.set('pageToken', pageToken);
      const url = `${DRIVE_V3}/files?${params.toString()}`;
      const page = await this.request<{
        files?: Array<Record<string, unknown>>;
        nextPageToken?: string;
      }>(url);
      for (const f of page.files ?? []) out.push(toDriveFile(f));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  async startChangesToken(): Promise<string> {
    const url = `${DRIVE_V3}/changes/startPageToken`;
    const raw = await this.request<{ startPageToken: string }>(url);
    return raw.startPageToken;
  }

  async listChanges(pageToken: string): Promise<ChangesPage> {
    const params = new URLSearchParams();
    params.set('pageToken', pageToken);
    params.set('pageSize', '100');
    params.set('includeRemoved', 'true');
    params.set(
      'fields',
      `changes(fileId,removed,time,file(${DEFAULT_FIELDS})),newStartPageToken,nextPageToken`,
    );
    const raw = await this.request<{
      changes?: Array<{
        fileId?: string;
        removed?: boolean;
        time?: string;
        file?: Record<string, unknown>;
      }>;
      newStartPageToken?: string;
      nextPageToken?: string;
    }>(`${DRIVE_V3}/changes?${params.toString()}`);
    return {
      changes: (raw.changes ?? []).map((c) => ({
        fileId: String(c.fileId ?? c.file?.id ?? ''),
        removed: Boolean(c.removed),
        file: c.file ? toDriveFile(c.file) : undefined,
        time: c.time,
      })),
      newStartPageToken: raw.newStartPageToken,
      nextPageToken: raw.nextPageToken,
    };
  }

  private async readCachedMap(
    businessId: string,
    logicalPath: string,
  ): Promise<DriveFileMap | undefined> {
    return db.drive_file_map
      .where('[business_id+logical_path]')
      .equals([businessId, logicalPath])
      .first();
  }

  private async writeCachedMap(
    businessId: string,
    logicalPath: string,
    file: DriveFile,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const existing = await this.readCachedMap(businessId, logicalPath);
    const row: DriveFileMap = {
      id: existing?.id ?? `${businessId}::${logicalPath}`,
      business_id: businessId,
      logical_path: logicalPath,
      drive_file_id: file.id,
      drive_version: file.version,
      modified_time: file.modifiedTime,
      checksum: file.md5Checksum ?? existing?.checksum ?? '',
      size_bytes: file.size ? Number(file.size) : (existing?.size_bytes ?? 0),
      updated_at: nowIso,
    };
    await db.drive_file_map.put(row);
  }
}

export type { ResumableSession };
