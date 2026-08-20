import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthUrl,
  DRIVE_FILE_SCOPE,
  exchangeCode,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  getUserInfo,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  isExpired,
  OAUTH_SCOPES,
  refreshAccessToken,
  revokeToken,
} from './oauth';
import {
  assertNoTokenLeak,
  clearTokens,
  loadTokens,
  resetTokenDb,
  saveTokens,
} from './tokenStore';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetTokenDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildAuthUrl', () => {
  it('produces a well-formed Google auth URL with drive.file scope + PKCE', () => {
    const url = buildAuthUrl({
      clientId: 'cid.apps.googleusercontent.com',
      redirectUri: 'https://app.example.com/oauth/callback',
      state: 'abc123',
      codeChallenge: 'CHALLENGE',
    });
    expect(url.startsWith(GOOGLE_AUTH_ENDPOINT + '?')).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('client_id')).toBe('cid.apps.googleusercontent.com');
    expect(params.get('redirect_uri')).toBe(
      'https://app.example.com/oauth/callback',
    );
    expect(params.get('response_type')).toBe('code');
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('code_challenge')).toBe('CHALLENGE');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('state')).toBe('abc123');
    expect(params.get('prompt')).toBe('consent');
    const scope = params.get('scope') ?? '';
    expect(scope).toContain(DRIVE_FILE_SCOPE);
    for (const s of OAUTH_SCOPES) expect(scope).toContain(s);
  });

  it('rejects missing args', () => {
    expect(() =>
      buildAuthUrl({
        clientId: '',
        redirectUri: 'x',
        state: 's',
        codeChallenge: 'c',
      }),
    ).toThrow(/clientId/);
    expect(() =>
      buildAuthUrl({
        clientId: 'c',
        redirectUri: '',
        state: 's',
        codeChallenge: 'c',
      }),
    ).toThrow(/redirectUri/);
    expect(() =>
      buildAuthUrl({
        clientId: 'c',
        redirectUri: 'r',
        state: '',
        codeChallenge: 'c',
      }),
    ).toThrow(/state/);
    expect(() =>
      buildAuthUrl({
        clientId: 'c',
        redirectUri: 'r',
        state: 's',
        codeChallenge: '',
      }),
    ).toThrow(/codeChallenge/);
  });
});

describe('exchangeCode', () => {
  it('POSTs form body and maps token response to TokenSet', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: 'AT',
        refresh_token: 'RT',
        expires_in: 3600,
        token_type: 'Bearer',
        id_token: 'IDT',
        scope: DRIVE_FILE_SCOPE,
      }),
    );
    const before = Date.now();
    const tokens = await exchangeCode({
      clientId: 'cid',
      clientSecret: 'sec',
      code: 'CODE',
      redirectUri: 'https://x/cb',
      codeVerifier: 'VERIFIER',
    });
    expect(tokens.accessToken).toBe('AT');
    expect(tokens.refreshToken).toBe('RT');
    expect(tokens.idToken).toBe('IDT');
    expect(tokens.tokenType).toBe('Bearer');
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 50);
    expect(tokens.expiresAt).toBeLessThanOrEqual(Date.now() + 3600 * 1000 + 50);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [urlArg, init] = fetchMock.mock.calls[0];
    expect(urlArg).toBe(GOOGLE_TOKEN_ENDPOINT);
    expect(init?.method).toBe('POST');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('CODE');
    expect(body.get('code_verifier')).toBe('VERIFIER');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('sec');
    expect(body.get('redirect_uri')).toBe('https://x/cb');
  });

  it('throws on non-2xx with error_description', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: 'invalid_grant', error_description: 'bad code' }),
    );
    await expect(
      exchangeCode({
        clientId: 'cid',
        clientSecret: 'sec',
        code: 'X',
        redirectUri: 'r',
        codeVerifier: 'v',
      }),
    ).rejects.toThrow(/invalid_grant: bad code/);
  });

  it('throws when response has no access_token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token_type: 'Bearer', expires_in: 1 }),
    );
    await expect(
      exchangeCode({
        clientId: 'cid',
        clientSecret: 'sec',
        code: 'X',
        redirectUri: 'r',
        codeVerifier: 'v',
      }),
    ).rejects.toThrow(/no access_token/);
  });
});

describe('refreshAccessToken', () => {
  it('sends grant_type=refresh_token and preserves old refresh token if none returned', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: 'AT2',
        expires_in: 1800,
        token_type: 'Bearer',
      }),
    );
    const tokens = await refreshAccessToken({
      clientId: 'cid',
      clientSecret: 'sec',
      refreshToken: 'RT-OLD',
    });
    expect(tokens.accessToken).toBe('AT2');
    expect(tokens.refreshToken).toBe('RT-OLD');
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('RT-OLD');
  });

  it('adopts new refresh token if Google rotates it', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: 'AT2',
        refresh_token: 'RT-NEW',
        expires_in: 1800,
        token_type: 'Bearer',
      }),
    );
    const tokens = await refreshAccessToken({
      clientId: 'cid',
      clientSecret: 'sec',
      refreshToken: 'RT-OLD',
    });
    expect(tokens.refreshToken).toBe('RT-NEW');
  });

  it('rejects empty refresh token without hitting network', async () => {
    await expect(
      refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: '' }),
    ).rejects.toThrow(/refreshToken required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on server error', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(500, 'boom'));
    await expect(
      refreshAccessToken({
        clientId: 'c',
        clientSecret: 's',
        refreshToken: 'RT',
      }),
    ).rejects.toThrow(/OAuth refresh failed/);
  });
});

describe('revokeToken', () => {
  it('POSTs the token and swallows 400 already-revoked', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(400, 'invalid_token'));
    await expect(revokeToken('T')).resolves.toBeUndefined();
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.get('token')).toBe('T');
  });

  it('no-ops when token empty', async () => {
    await revokeToken('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on unexpected server error', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(500, 'nope'));
    await expect(revokeToken('T')).rejects.toThrow(/OAuth revoke failed/);
  });
});

describe('getUserInfo', () => {
  it('hits the userinfo endpoint with bearer auth and returns identity', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        email: 'a@example.com',
        name: 'Alice',
        sub: '123',
      }),
    );
    const info = await getUserInfo('AT');
    expect(info.email).toBe('a@example.com');
    expect(info.sub).toBe('123');
    expect(fetchMock.mock.calls[0][0]).toBe(GOOGLE_USERINFO_ENDPOINT);
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer AT');
  });

  it('rejects incomplete userinfo payloads', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { name: 'x' }));
    await expect(getUserInfo('AT')).rejects.toThrow(/missing sub\/email/);
  });
});

describe('isExpired', () => {
  it('flags tokens within skew window as expired', () => {
    const token = {
      accessToken: 'x',
      expiresAt: Date.now() + 30_000,
      tokenType: 'Bearer',
    };
    expect(isExpired(token, 60_000)).toBe(true);
    expect(isExpired(token, 0)).toBe(false);
  });
});

describe('PKCE helpers', () => {
  it('generateCodeVerifier returns 43+ url-safe base64 chars', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(/^[A-Za-z0-9_-]+$/.test(v)).toBe(true);
  });

  it('generateCodeChallenge is deterministic S256 of verifier', async () => {
    // Known-answer: RFC 7636 Appendix B
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    const got = await generateCodeChallenge(verifier);
    expect(got).toBe(expected);
  });

  it('generateState returns url-safe string', () => {
    const s = generateState();
    expect(s.length).toBeGreaterThan(0);
    expect(/^[A-Za-z0-9_-]+$/.test(s)).toBe(true);
  });
});

describe('token store + leak guard', () => {
  it('round-trips tokens by businessId', async () => {
    await saveTokens(
      'biz-1',
      {
        accessToken: 'AT',
        refreshToken: 'RT',
        expiresAt: Date.now() + 3600_000,
        tokenType: 'Bearer',
      },
      { email: 'a@x', sub: 'sub-1' },
    );
    const row = await loadTokens('biz-1');
    expect(row?.accessToken).toBe('AT');
    expect(row?.refreshToken).toBe('RT');
    expect(row?.email).toBe('a@x');
    await clearTokens('biz-1');
    expect(await loadTokens('biz-1')).toBeUndefined();
  });

  it('preserves refresh token when refresh flow does not return one', async () => {
    await saveTokens('biz-2', {
      accessToken: 'AT',
      refreshToken: 'RT-ORIG',
      expiresAt: Date.now() + 3600_000,
      tokenType: 'Bearer',
    });
    await saveTokens('biz-2', {
      accessToken: 'AT2',
      expiresAt: Date.now() + 3600_000,
      tokenType: 'Bearer',
    });
    const row = await loadTokens('biz-2');
    expect(row?.accessToken).toBe('AT2');
    expect(row?.refreshToken).toBe('RT-ORIG');
  });

  it('assertNoTokenLeak refuses payloads with token keys', () => {
    expect(() =>
      assertNoTokenLeak({ ok: true, refresh_token: 'x' }, 'csv:invoices'),
    ).toThrow(/refresh_token/);
    expect(() =>
      assertNoTokenLeak({ nested: { accessToken: 'x' } }, 'snapshot'),
    ).toThrow(/accessToken/);
    expect(() =>
      assertNoTokenLeak([{ id_token: 'x' }], 'journal'),
    ).toThrow(/id_token/);
  });

  it('assertNoTokenLeak refuses raw strings that look like tokens', () => {
    expect(() =>
      assertNoTokenLeak('grant: refresh_token=abc', 'readme'),
    ).toThrow(/refresh_token/);
  });

  it('assertNoTokenLeak allows normal business payloads', () => {
    expect(() =>
      assertNoTokenLeak(
        { invoice_number: 'INV-1', lines: [{ item: 'x', qty: 2 }] },
        'csv',
      ),
    ).not.toThrow();
  });
});
