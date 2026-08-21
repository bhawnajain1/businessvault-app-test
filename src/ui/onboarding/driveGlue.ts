// Onboarding glue between the "Connect Google Drive" button and the Drive
// plumbing. Under GIS this is trivial — connectDrive() opens the popup
// inline and resolves once the user consents. No redirect URI, no callback
// route, no client secret.

import type { CustomerStorageProvider } from '../../storage/CustomerStorageProvider';
import { GoogleDriveStorageProvider } from '../../drive/GoogleDriveStorageProvider';
import { env } from '../../lib/env';
import { hasGoogleClientId } from '../../auth/gis';
import { connectDrive, isDriveConnected } from '../../drive/connectDrive';
import { createDriveApiClient } from '../../drive/google';
import { log } from '../../lib/log';

const PENDING_BUSINESS_ID = 'pending-onboarding';

export async function hasValidDriveTokens(): Promise<boolean> {
  return isDriveConnected(PENDING_BUSINESS_ID);
}

// Kept for API compat with existing Onboarding.tsx caller. Under GIS this
// opens the popup inline and resolves — there is no returnTo redirect.
export interface StartDriveOAuthArgs {
  returnTo: string;
}

export async function startDriveOAuth(_args: StartDriveOAuthArgs): Promise<void> {
  if (!hasGoogleClientId()) {
    throw new Error(
      'Google Drive is not configured. Set VITE_GOOGLE_CLIENT_ID in .env.local and reload.',
    );
  }
  log.info('driveGlue', 'startDriveOAuth (GIS popup)', { businessId: PENDING_BUSINESS_ID });
  await connectDrive({ businessId: PENDING_BUSINESS_ID, prompt: 'consent' });
}

export async function buildDriveProvider(): Promise<CustomerStorageProvider> {
  if (!env.googleClientId) {
    throw new Error(
      'Google Drive not configured. Set VITE_GOOGLE_CLIENT_ID and reload.',
    );
  }
  const api = createDriveApiClient({ businessId: PENDING_BUSINESS_ID });
  const provider = new GoogleDriveStorageProvider({ driveApi: api });
  log.debug('driveGlue', 'connecting provider', { businessId: PENDING_BUSINESS_ID });
  await provider.connect({
    kind: 'google-drive',
    clientId: env.googleClientId,
    scope: 'drive.file',
  });
  return provider;
}
