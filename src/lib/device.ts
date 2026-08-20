import Dexie, { type Table } from 'dexie';
import { ulid } from 'ulid';

export interface DeviceRow {
  id: string;
  deviceId: string;
  createdAt: string;
  userAgent: string;
  platform: string;
  label: string;
}

export interface SettingsRow {
  key: string;
  value: string;
  updatedAt: string;
}

class AppMetaDB extends Dexie {
  devices!: Table<DeviceRow, string>;
  settings!: Table<SettingsRow, string>;

  constructor() {
    super('businessvault_meta');
    this.version(1).stores({
      devices: 'id, deviceId',
      settings: 'key',
    });
  }
}

let dbInstance: AppMetaDB | null = null;

export function metaDb(): AppMetaDB {
  if (!dbInstance) dbInstance = new AppMetaDB();
  return dbInstance;
}

export function __resetMetaDbForTests(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
  }
  dbInstance = null;
  cachedDeviceId = null;
  cachedDeviceLabel = null;
}

let cachedDeviceId: string | null = null;
let cachedDeviceLabel: string | null = null;

function readPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const uaPlatform = nav.userAgentData?.platform;
  if (uaPlatform && uaPlatform.length > 0) return uaPlatform;
  if (navigator.platform && navigator.platform.length > 0) return navigator.platform;
  return 'unknown';
}

function readUserAgent(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  return navigator.userAgent || 'unknown';
}

function friendlyPlatformName(platform: string): string {
  const p = platform.toLowerCase();
  if (p.includes('mac')) return 'MacBook';
  if (p.includes('win')) return 'Windows PC';
  if (p.includes('linux')) return 'Linux PC';
  if (p.includes('android')) return 'Android';
  if (p.includes('iphone')) return 'iPhone';
  if (p.includes('ipad')) return 'iPad';
  if (p.includes('ios')) return 'iOS Device';
  return platform || 'Device';
}

function shortSuffix(deviceId: string): string {
  const tail = deviceId.slice(-4).toLowerCase();
  return tail || Math.random().toString(16).slice(2, 6);
}

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  const db = metaDb();
  const existing = await db.devices.toCollection().first();
  if (existing) {
    cachedDeviceId = existing.deviceId;
    cachedDeviceLabel = existing.label;
    return cachedDeviceId;
  }

  const deviceId = ulid();
  const platform = readPlatform();
  const userAgent = readUserAgent();
  const label = `${friendlyPlatformName(platform)} (${shortSuffix(deviceId)})`;

  const row: DeviceRow = {
    id: deviceId,
    deviceId,
    createdAt: new Date().toISOString(),
    userAgent,
    platform,
    label,
  };
  await db.devices.add(row);

  cachedDeviceId = deviceId;
  cachedDeviceLabel = label;
  return deviceId;
}

export async function getDeviceLabel(): Promise<string> {
  if (cachedDeviceLabel) return cachedDeviceLabel;
  await getDeviceId();
  if (!cachedDeviceLabel) {
    throw new Error('device label unavailable after initialization');
  }
  return cachedDeviceLabel;
}
