import { describe, expect, it } from 'vitest';
import { WorkOsIdentityProvider } from './workos.js';

function jwt(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

describe('WorkOsIdentityProvider', () => {
  it('builds hosted AuthKit URLs with state and screen hint', () => {
    const provider = new WorkOsIdentityProvider({
      apiKey: 'sk_test', clientId: 'client_1', redirectUri: 'http://localhost:3000/api/auth/callback',
      fetcher: async () => new Response(null, { status: 500 }),
    });
    const url = new URL(provider.authorizationUrl('state-1', 'sign-up'));
    expect(url.origin).toBe('https://api.workos.com');
    expect(url.searchParams.get('provider')).toBe('authkit');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('screen_hint')).toBe('sign-up');
  });

  it('exchanges the code and extracts sid only for logout metadata', async () => {
    let sent: unknown;
    let requestOptions: RequestInit | undefined;
    const provider = new WorkOsIdentityProvider({
      apiKey: 'sk_test', clientId: 'client_1', redirectUri: 'http://localhost/callback',
      fetcher: async (_input, init) => {
        requestOptions = init;
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          user: { id: 'user_1', email: 'hero@example.com' },
          access_token: jwt({ sid: 'session_1' }),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await expect(provider.exchangeCode('code-1', { ip: '127.0.0.1' })).resolves.toEqual({
      externalAuthId: 'user_1', email: 'hero@example.com', workosSessionId: 'session_1',
    });
    expect(sent).toMatchObject({
      client_id: 'client_1', client_secret: 'sk_test', grant_type: 'authorization_code',
      code: 'code-1', ip_address: '127.0.0.1',
    });
    expect(requestOptions?.redirect).toBe('error');
    expect(requestOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a successful response without a WorkOS session id', async () => {
    const provider = new WorkOsIdentityProvider({
      apiKey: 'sk_test', clientId: 'client_1', redirectUri: 'http://localhost/callback',
      fetcher: async () => new Response(JSON.stringify({
        user: { id: 'user_1', email: 'hero@example.com' },
        access_token: jwt({ sub: 'user_1' }),
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    await expect(provider.exchangeCode('code-1', {})).rejects.toThrow(/session id/);
  });

  it('does not expose a provider error response body', async () => {
    const provider = new WorkOsIdentityProvider({
      apiKey: 'sk_test', clientId: 'client_1', redirectUri: 'http://localhost/callback',
      fetcher: async () => new Response('secret upstream details', { status: 401 }),
    });

    await expect(provider.exchangeCode('bad-code', {})).rejects.toThrow(
      'WorkOS authentication failed with HTTP 401',
    );
  });
});
