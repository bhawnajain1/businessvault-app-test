export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const OAUTH_SCOPES: readonly string[] = [
  DRIVE_FILE_SCOPE,
  'openid',
  'email',
  'profile',
];

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
  idToken?: string;
  scope?: string;
}

export interface BuildAuthUrlArgs {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint?: string;
  prompt?: 'none' | 'consent' | 'select_account';
}

export function buildAuthUrl(args: BuildAuthUrlArgs): string {
  if (!args.clientId) throw new Error('buildAuthUrl: clientId required');
  if (!args.redirectUri) throw new Error('buildAuthUrl: redirectUri required');
  if (!args.state) throw new Error('buildAuthUrl: state required');
  if (!args.codeChallenge) throw new Error('buildAuthUrl: codeChallenge required');

  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256',
    prompt: args.prompt ?? 'consent',
  });
  if (args.loginHint) params.set('login_hint', args.loginHint);
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
}

interface GoogleErrorResponse {
  error: string;
  error_description?: string;
}

function nowMs(): number {
  return Date.now();
}

function tokenResponseToSet(
  body: GoogleTokenResponse,
  previousRefreshToken?: string,
): TokenSet {
  const expiresInMs = Math.max(0, (body.expires_in ?? 0) * 1000);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? previousRefreshToken,
    expiresAt: nowMs() + expiresInMs,
    tokenType: body.token_type ?? 'Bearer',
    idToken: body.id_token,
    scope: body.scope,
  };
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as GoogleErrorResponse;
    return parsed.error_description
      ? `${parsed.error}: ${parsed.error_description}`
      : parsed.error;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

export interface ExchangeCodeArgs {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export async function exchangeCode(args: ExchangeCodeArgs): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: args.codeVerifier,
  });

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`OAuth token exchange failed: ${await readError(res)}`);
  }
  const payload = (await res.json()) as GoogleTokenResponse;
  if (!payload.access_token) {
    throw new Error('OAuth token exchange returned no access_token');
  }
  return tokenResponseToSet(payload);
}

export interface RefreshAccessTokenArgs {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export async function refreshAccessToken(
  args: RefreshAccessTokenArgs,
): Promise<TokenSet> {
  if (!args.refreshToken) {
    throw new Error('refreshAccessToken: refreshToken required');
  }
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    refresh_token: args.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`OAuth refresh failed: ${await readError(res)}`);
  }
  const payload = (await res.json()) as GoogleTokenResponse;
  if (!payload.access_token) {
    throw new Error('OAuth refresh returned no access_token');
  }
  return tokenResponseToSet(payload, args.refreshToken);
}

export async function revokeToken(token: string): Promise<void> {
  if (!token) return;
  const res = await fetch(GOOGLE_REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  });
  // Google returns 200 on success, 400 for already-revoked/invalid — both fine to swallow.
  if (!res.ok && res.status !== 400) {
    throw new Error(`OAuth revoke failed: ${await readError(res)}`);
  }
}

export interface GoogleUserInfo {
  email: string;
  name: string;
  sub: string;
  picture?: string;
}

export async function getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`OAuth userinfo failed: ${await readError(res)}`);
  }
  const payload = (await res.json()) as {
    email?: string;
    name?: string;
    sub?: string;
    picture?: string;
  };
  if (!payload.sub || !payload.email) {
    throw new Error('OAuth userinfo missing sub/email');
  }
  return {
    email: payload.email,
    name: payload.name ?? '',
    sub: payload.sub,
    picture: payload.picture,
  };
}

export function isExpired(token: TokenSet, skewMs: number = 60_000): boolean {
  return nowMs() + skewMs >= token.expiresAt;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(byteLength: number = 32): string {
  // 32 random bytes → 43 base64url chars, meets RFC 7636 43..128 range.
  if (byteLength < 32) throw new Error('generateCodeVerifier: need >=32 bytes');
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  const verifier = base64UrlEncode(buf);
  if (verifier.length < 43) {
    throw new Error('generateCodeVerifier: verifier too short');
  }
  return verifier;
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

export function generateState(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}
