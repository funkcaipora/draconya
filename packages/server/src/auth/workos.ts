// Integração estreita com Hosted AuthKit usando os contratos HTTP oficiais do WorkOS.

import { z } from 'zod';

export interface ExternalIdentity {
  readonly externalAuthId: string;
  readonly email: string;
  readonly workosSessionId: string;
}

export interface IdentityProvider {
  authorizationUrl(state: string, screen: 'sign-in' | 'sign-up'): string;
  exchangeCode(code: string, request: { ip?: string; userAgent?: string }): Promise<ExternalIdentity>;
  logoutUrl(workosSessionId: string, returnTo: string): string;
}

export interface WorkOsProviderOptions {
  readonly apiKey: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

const AuthenticationResponse = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.string().email(),
  }),
  access_token: z.string().min(1),
});

export class WorkOsIdentityProvider implements IdentityProvider {
  readonly #apiKey: string;
  readonly #clientId: string;
  readonly #redirectUri: string;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: WorkOsProviderOptions) {
    if (!Number.isSafeInteger(options.timeoutMs ?? 10_000) || (options.timeoutMs ?? 10_000) <= 0) {
      throw new Error('WorkOS timeout must be a positive integer');
    }
    this.#apiKey = options.apiKey;
    this.#clientId = options.clientId;
    this.#redirectUri = options.redirectUri;
    this.#fetcher = options.fetcher ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  authorizationUrl(state: string, screen: 'sign-in' | 'sign-up'): string {
    const url = new URL('https://api.workos.com/user_management/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.#clientId);
    url.searchParams.set('redirect_uri', this.#redirectUri);
    url.searchParams.set('provider', 'authkit');
    url.searchParams.set('screen_hint', screen);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(
    code: string,
    request: { ip?: string; userAgent?: string },
  ): Promise<ExternalIdentity> {
    const payload: Record<string, string> = {
      client_id: this.#clientId,
      client_secret: this.#apiKey,
      grant_type: 'authorization_code',
      code,
    };
    if (request.ip !== undefined) payload['ip_address'] = request.ip;
    if (request.userAgent !== undefined) payload['user_agent'] = request.userAgent;

    const response = await this.#fetcher('https://api.workos.com/user_management/authenticate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      // Não propagar body: pode conter detalhes de autenticação e não ajuda o cliente.
      throw new Error(`WorkOS authentication failed with HTTP ${response.status}`);
    }
    const parsed = AuthenticationResponse.parse(await response.json());
    const workosSessionId = sessionIdFromAccessToken(parsed.access_token);
    if (workosSessionId === undefined) {
      throw new Error('WorkOS authentication returned an access token without a session id');
    }
    return { externalAuthId: parsed.user.id, email: parsed.user.email, workosSessionId };
  }

  logoutUrl(workosSessionId: string, returnTo: string): string {
    const url = new URL('https://api.workos.com/user_management/sessions/logout');
    url.searchParams.set('session_id', workosSessionId);
    url.searchParams.set('return_to', returnTo);
    return url.toString();
  }
}

/**
 * O token chegou diretamente do endpoint de troca do WorkOS sobre TLS, então aqui só extraímos
 * o `sid` para logout; isto NÃO é validação de JWT e nunca deve ser usado para autorizar request.
 */
function sessionIdFromAccessToken(token: string): string | undefined {
  const payload = token.split('.')[1];
  if (payload === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const sid = (parsed as Record<string, unknown>)['sid'];
    return typeof sid === 'string' && sid !== '' ? sid : undefined;
  } catch {
    return undefined;
  }
}
