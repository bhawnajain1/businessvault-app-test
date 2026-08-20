import {
  buildAuthUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from './oauth';
import { stashPendingAuthorization } from './callbackHandler';
import { loadTokens } from './tokenStore';

export interface BeginDriveOAuthArgs {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  businessId: string;
  returnTo: string;
}

export interface BeginDriveOAuthResult {
  authUrl: string;
}

export async function beginDriveOAuth(args: BeginDriveOAuthArgs): Promise<BeginDriveOAuthResult> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  stashPendingAuthorization({
    state,
    codeVerifier,
    businessId: args.businessId,
    redirectUri: args.redirectUri,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    returnTo: args.returnTo,
    createdAt: Date.now(),
  });

  const authUrl = buildAuthUrl({
    clientId: args.clientId,
    redirectUri: args.redirectUri,
    state,
    codeChallenge,
  });

  return { authUrl };
}

export async function hasStoredDriveTokens(businessId: string): Promise<boolean> {
  const rec = await loadTokens(businessId);
  if (!rec) return false;
  if (!rec.refreshToken) return false;
  return true;
}
