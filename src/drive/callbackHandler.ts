import { exchangeCode, getUserInfo, type TokenSet } from './oauth';
import { saveTokens } from './tokenStore';

// PKCE + state are stashed here just before `buildAuthUrl` navigation.
// sessionStorage (not localStorage) so a closed tab doesn't leave a
// verifier lying around across sessions.
const SESSION_KEY = 'bv.oauth.pending';

export interface PendingAuthorization {
  state: string;
  codeVerifier: string;
  businessId: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  returnTo?: string;
  createdAt: number;
}

export function stashPendingAuthorization(pending: PendingAuthorization): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(pending));
}

export function loadPendingAuthorization(): PendingAuthorization | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingAuthorization;
  } catch {
    return null;
  }
}

export function clearPendingAuthorization(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export function parseCallbackParams(search: string): CallbackParams {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  return {
    code: params.get('code') ?? undefined,
    state: params.get('state') ?? undefined,
    error: params.get('error') ?? undefined,
    errorDescription: params.get('error_description') ?? undefined,
  };
}

export interface CallbackResult {
  tokens: TokenSet;
  identity: { email: string; sub: string; name: string };
  redirectTo: string;
}

export interface HandleCallbackArgs {
  search: string; // window.location.search
  pending?: PendingAuthorization | null;
}

export async function handleOAuthCallback(
  args: HandleCallbackArgs,
): Promise<CallbackResult> {
  const params = parseCallbackParams(args.search);
  if (params.error) {
    throw new Error(
      `Google OAuth returned error: ${params.error}${params.errorDescription ? `: ${params.errorDescription}` : ''}`,
    );
  }
  if (!params.code || !params.state) {
    throw new Error('OAuth callback missing code/state');
  }

  const pending = args.pending ?? loadPendingAuthorization();
  if (!pending) {
    throw new Error('OAuth callback: no pending authorization found');
  }
  if (pending.state !== params.state) {
    throw new Error('OAuth callback: state mismatch (possible CSRF)');
  }

  const tokens = await exchangeCode({
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    code: params.code,
    redirectUri: pending.redirectUri,
    codeVerifier: pending.codeVerifier,
  });

  const identity = await getUserInfo(tokens.accessToken);
  await saveTokens(pending.businessId, tokens, {
    email: identity.email,
    sub: identity.sub,
  });
  clearPendingAuthorization();

  return {
    tokens,
    identity,
    redirectTo: pending.returnTo ?? '/settings/backup',
  };
}
