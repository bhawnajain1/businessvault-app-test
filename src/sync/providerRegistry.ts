import type { CustomerStorageProvider } from '../storage/CustomerStorageProvider';

// Small runtime seam so UI code (Settings → Data & Backup, Cloud indicator,
// Export My Business) can talk to the currently-active storage provider
// without importing GoogleDriveStorageProvider directly.
//
// Boot code (bootstrap.ts) sets the provider once after OAuth / connect.
// If it's unset the UI treats the app as DISCONNECTED (spec §30).

let active: CustomerStorageProvider | null = null;

export function setActiveProvider(p: CustomerStorageProvider | null): void {
  active = p;
}

export function getActiveProvider(): CustomerStorageProvider | null {
  return active;
}
