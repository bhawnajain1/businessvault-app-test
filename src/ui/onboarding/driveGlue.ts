/**
 * Thin glue between the onboarding UI and the Google Drive plumbing.
 *
 * We keep this out of Onboarding.tsx so the component doesn't grow a
 * hard dependency on the (in-progress) DriveApiClient wiring — the
 * onboarding flow itself needs to compile and run today with just the
 * local-folder path exercised.
 *
 * When a real DriveApiClient factory lands under src/drive/google/, wire
 * it into buildDriveProvider() below.
 */

import type { CustomerStorageProvider } from '../../storage/CustomerStorageProvider';
import { GoogleDriveStorageProvider, type DriveApiClient } from '../../drive/GoogleDriveStorageProvider';
import { env } from '../../lib/env';
import { beginDriveOAuth, hasStoredDriveTokens } from '../../drive/provider';

const PENDING_BUSINESS_ID = 'pending-onboarding';

function redirectUri(): string {
  // Callback route is /oauth/callback; wire it in App.tsx when the drive
  // callback page is added. For now we keep the URI in one place.
  const origin = window.location.origin;
  return `${origin}/oauth/callback`;
}

export async function hasValidDriveTokens(): Promise<boolean> {
  return hasStoredDriveTokens(PENDING_BUSINESS_ID);
}

export interface StartDriveOAuthArgs {
  returnTo: string;
}

export async function startDriveOAuth(args: StartDriveOAuthArgs): Promise<void> {
  if (!env.googleClientId) {
    throw new Error(
      'Google Drive is not configured. Set VITE_GOOGLE_CLIENT_ID (and VITE_GOOGLE_CLIENT_SECRET) and reload.',
    );
  }
  const { authUrl } = await beginDriveOAuth({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: redirectUri(),
    businessId: PENDING_BUSINESS_ID,
    returnTo: args.returnTo,
  });
  window.location.assign(authUrl);
}

export async function buildDriveProvider(): Promise<CustomerStorageProvider> {
  // The concrete DriveApiClient implementation is being brought up in
  // src/drive/google/; until it's exported we throw a helpful message so
  // users can still take the "local folder" path during onboarding.
  const factory = await tryImportDriveApiFactory();
  if (!factory) {
    throw new Error(
      'Google Drive client is not yet available in this build. ' +
        'Use the "Use a local folder instead" option for now.',
    );
  }
  const api: DriveApiClient = await factory();
  const provider = new GoogleDriveStorageProvider({ driveApi: api });
  await provider.connect({
    kind: 'google-drive',
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: redirectUri(),
    scope: 'drive.file',
  });
  return provider;
}

async function tryImportDriveApiFactory(): Promise<(() => Promise<DriveApiClient>) | null> {
  // Kept as a variable so TypeScript doesn't statically resolve — the concrete
  // Drive API client module doesn't exist yet in every branch.
  const modulePath = '../../drive/google/index';
  try {
    const mod: unknown = await import(/* @vite-ignore */ modulePath);
    const m = mod as { createDriveApiClient?: () => Promise<DriveApiClient> };
    return typeof m.createDriveApiClient === 'function' ? m.createDriveApiClient : null;
  } catch {
    return null;
  }
}
