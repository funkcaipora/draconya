// Cliente HTTP fino do `api` para a semente da party de dragões (#526). Fala com o processo
// `api` de verdade (precisa estar de pé) pelas MESMAS rotas que o cliente React usa — dev-login,
// criação de personagem, formação e início de party — nunca escreve o banco por fora disso: são
// exatamente as duas coisas que a issue pede pela API e não por SQL direto.
//
// O `onRequest` do `api` (`packages/server/src/api/server.ts`) recusa qualquer mutação cuja
// origem não bata com `configuration.API_ORIGIN` (o nome é do servidor; na prática é a origem do
// CLIENTE — 5174 neste projeto, ver docs/local-dragon-party.md). Por isso todo request daqui
// carrega o header `Origin` explicitamente, em vez de confiar que um `fetch` de Node não manda
// nenhum (o que hoje também passaria, mas por um caminho não documentado).

export interface DragonPartyApiOptions {
  /** Onde o processo `api` escuta, ex. `http://localhost:3000`. */
  readonly baseUrl: string;
  /** A origem que o `api` espera em `Origin` (a origem do CLIENTE, `API_ORIGIN` no `.env`). */
  readonly clientOrigin: string;
  readonly fetchImpl?: typeof fetch;
}

export interface DragonPartySession {
  readonly accountId: string;
  readonly email: string;
  readonly cookie: string;
}

export class DragonPartyApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`api respondeu ${status}: ${JSON.stringify(body)}`);
    this.name = 'DragonPartyApiError';
  }
}

interface RawResponse {
  readonly status: number;
  readonly body: unknown;
  readonly setCookie: string | null;
}

/** Só o par `name=value` — o resto do `Set-Cookie` (Path, HttpOnly…) não volta num `Cookie`. */
function sessionCookiePair(setCookieHeader: string): string {
  const pair = setCookieHeader.split(';')[0]?.trim();
  if (pair === undefined || !pair.includes('=')) {
    throw new Error(`dragon-party: dev-login não devolveu um cookie de sessão válido: ${setCookieHeader}`);
  }
  return pair;
}

export class DragonPartyApi {
  readonly #baseUrl: string;
  readonly #origin: string;
  readonly #fetch: typeof fetch;

  constructor(options: DragonPartyApiOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#origin = options.clientOrigin;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async #request(
    method: string, path: string, options: { readonly cookie?: string; readonly body?: unknown } = {},
  ): Promise<RawResponse> {
    const headers: Record<string, string> = { origin: this.#origin };
    if (options.cookie !== undefined) headers['cookie'] = options.cookie;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text.length === 0 ? undefined : (JSON.parse(text) as unknown),
      setCookie: response.headers.get('set-cookie'),
    };
  }

  /** `POST /api/auth/dev-login` — só existe com `AUTH_DEV_MODE=true` no `api` (nunca em produção). */
  async devLogin(email: string): Promise<DragonPartySession> {
    const result = await this.#request('POST', '/api/auth/dev-login', { body: { email } });
    if (result.status !== 200 || result.setCookie === null) throw new DragonPartyApiError(result.status, result.body);
    const data = result.body as { accountId: string; email: string };
    return { accountId: data.accountId, email: data.email, cookie: sessionCookiePair(result.setCookie) };
  }

  /**
   * Cria o personagem, ou devolve o id do que já existe com o mesmo nome (idempotente — o nome
   * é único no jogo inteiro, `character_name_unique`). Nasce level 1 sem vocação; quem sobe para
   * o level 200 é `seedCharacterStats`.
   */
  async ensureCharacter(session: DragonPartySession, name: string): Promise<string> {
    const created = await this.#request('POST', '/api/characters', { cookie: session.cookie, body: { name } });
    if (created.status === 201) return (created.body as { id: string }).id;
    if (created.status !== 409) throw new DragonPartyApiError(created.status, created.body);

    const list = await this.#request('GET', '/api/characters', { cookie: session.cookie });
    if (list.status !== 200) throw new DragonPartyApiError(list.status, list.body);
    const found = (list.body as { characters: readonly { id: string; name: string }[] })
      .characters.find((character) => character.name === name);
    if (found === undefined) {
      throw new Error(`dragon-party: "${name}" existe (409) mas não apareceu em GET /api/characters de ${session.email}`);
    }
    return found.id;
  }

  async myParty(session: DragonPartySession, characterId: string): Promise<PartyMineView> {
    const result = await this.#request(
      'GET', `/api/party/mine?characterId=${encodeURIComponent(characterId)}`, { cookie: session.cookie },
    );
    if (result.status !== 200) throw new DragonPartyApiError(result.status, result.body);
    return result.body as PartyMineView;
  }

  async createParty(session: DragonPartySession, characterId: string): Promise<PartyView> {
    const result = await this.#request('POST', '/api/party', { cookie: session.cookie, body: { characterId } });
    if (result.status !== 200) throw new DragonPartyApiError(result.status, result.body);
    return result.body as PartyView;
  }

  async invite(
    session: DragonPartySession, partyId: string, characterId: string, inviteeId: string,
  ): Promise<void> {
    const result = await this.#request(
      'POST', `/api/party/${partyId}/invite`, { cookie: session.cookie, body: { characterId, inviteeId } },
    );
    if (result.status !== 200) throw new DragonPartyApiError(result.status, result.body);
  }

  async join(session: DragonPartySession, partyId: string, characterId: string): Promise<PartyView> {
    const result = await this.#request(
      'POST', `/api/party/${partyId}/join`, { cookie: session.cookie, body: { characterId } },
    );
    if (result.status !== 200) throw new DragonPartyApiError(result.status, result.body);
    return result.body as PartyView;
  }

  async leave(session: DragonPartySession, partyId: string, characterId: string): Promise<void> {
    const result = await this.#request(
      'POST', `/api/party/${partyId}/leave`, { cookie: session.cookie, body: { characterId } },
    );
    if (result.status !== 200) throw new DragonPartyApiError(result.status, result.body);
  }

  async configure(
    session: DragonPartySession, partyId: string, characterId: string,
    patch: { readonly huntId: string; readonly difficulty: string; readonly shareCosts: boolean; readonly splitLoot: boolean },
  ): Promise<{ readonly status: number; readonly body: unknown }> {
    return this.#request(
      'POST', `/api/party/${partyId}/configure`, { cookie: session.cookie, body: { characterId, ...patch } },
    );
  }

  async start(
    session: DragonPartySession, partyId: string, characterId: string,
  ): Promise<{ readonly status: number; readonly body: unknown }> {
    return this.#request('POST', `/api/party/${partyId}/start`, { cookie: session.cookie, body: { characterId } });
  }
}

export interface PartyView {
  readonly id: string;
  readonly leaderId: string;
  readonly state: 'forming' | 'hunting';
  readonly sessionId: string | null;
  readonly members: readonly { readonly characterId: string; readonly name: string }[];
}

export interface PartyMineView {
  readonly party: PartyView | null;
}
