// A API HTTP da party (#197, ADR 0027 decisão 8): formar a party é HTTP, como escolher
// personagem — o personagem está na Cidade e o socket não tem nada a ver com isso. Cada
// chamada leva `characterId`: é o personagem de QUEM fala, e o servidor confere a posse.
//
// Desde o M20 (#402/#403, ADR 0033 decisões 6/7/8) a mesma família de rotas cobre a sala
// pública (`publish`/`unpublish`/`rooms`), o convite reverso (`invites[]` em `mine` e `decline`)
// e a entrada numa party EM CURSO — que devolve um TICKET, não o formulário (D7). O cliente
// manda intenção; quem decide estado, lotação, faixa de level e nó é o `api` (invariante 4).

import { API_URL, ApiError } from '../account/api.js';

export type PartyLifecycle = 'forming' | 'hunting';

export interface PartyMemberView {
  readonly characterId: string;
  readonly name: string;
  readonly approved: boolean;
}

export interface PartyView {
  readonly id: string;
  readonly leaderId: string;
  readonly mode: 'split' | 'shared';
  readonly huntId: string | null;
  readonly difficulty: string | null;
  readonly members: readonly PartyMemberView[];
  /** Sala publicada para "Encontrar Party" (#402): `publish`/`unpublish` mudam isto. */
  readonly published: boolean;
  readonly minLevel: number | null;
  readonly maxLevel: number | null;
  readonly state: PartyLifecycle;
  readonly sessionId: string | null;
}

export interface PartyTicketView {
  readonly ticket: string;
  readonly wsUrl: string;
  readonly expiresAtMs: number;
  readonly sessionId: string;
}

/** A sala pública de "Encontrar Party" (§17–§20), como `GET /api/party/rooms` a devolve. */
export interface RoomView {
  readonly partyId: string;
  readonly huntId: string;
  readonly difficulty: string;
  readonly leader: { readonly characterId: string; readonly name: string; readonly level: number };
  readonly vocations: readonly (string | null)[];
  readonly members: number;
  readonly maxMembers: number;
  readonly minLevel: number;
  readonly maxLevel: number;
  readonly state: PartyLifecycle;
}

/** Um convite pendente para o personagem, do índice reverso que o `/mine` devolve (D8). */
export interface PartyInviteView {
  readonly partyId: string;
  readonly leaderId: string;
  readonly leaderName: string;
  readonly huntId: string | null;
  readonly state: PartyLifecycle;
}

export interface MineView {
  readonly party: PartyView | null;
  readonly ticket: PartyTicketView | null;
  readonly invites: readonly PartyInviteView[];
}

/**
 * D7: `join` numa party em curso devolve um TICKET, não o formulário — o MESMO endpoint HTTP,
 * dois formatos de resposta. O discriminante evita um `ticket: X | null` ambíguo com o de `start`.
 */
export type JoinResult =
  | { readonly kind: 'formed'; readonly party: PartyView }
  | { readonly kind: 'entered'; readonly ticket: PartyTicketView };

const REFUSAL: Record<string, string> = {
  'already-in-party': 'Você já está numa party.',
  'not-invited': 'Você não foi convidado para essa party.',
  full: 'A party está cheia.',
  'party-full': 'A party está cheia.',
  'level-out-of-range': 'Seu level está fora da faixa desta sala.',
  'content-version': 'A sala está numa versão de conteúdo diferente.',
  'session-not-here': 'A sessão da party não está disponível agora.',
  'in-another-party': 'Você está em outra party.',
  'party-not-found': 'Essa party não existe mais.',
  'character-not-found': 'Esse personagem não existe mais.',
  'not-leader': 'Só o líder pode fazer isso.',
  'cannot-kick-self': 'Você não pode expulsar a si mesmo — use sair da party.',
  'target-not-a-member': 'Esse personagem não está mais na party.',
  'not-a-member': 'Você não está nessa party.',
  'nothing-proposed': 'O líder ainda não propôs uma hunt.',
  'not-approved': 'Nem todos aprovaram ainda.',
  'not-enough-members': 'Uma party precisa de pelo menos dois.',
  'not-in-city': 'Alguém da party não está na cidade.',
  'active-limit': 'A conta de alguém já tem o máximo de personagens ativos.',
  'progress-not-settled': 'O progresso de alguém ainda está sendo salvo. Tente de novo.',
  'unknown-hunt': 'Essa hunt não existe.',
  'unknown-difficulty': 'Essa dificuldade não existe para essa hunt.',
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
  });
  if (response.ok) return (await response.json()) as T;
  let code = '';
  try {
    code = ((await response.json()) as { error?: unknown }).error as string;
  } catch {
    code = '';
  }
  throw new ApiError(response.status, REFUSAL[code] ?? `Não foi possível concluir (HTTP ${String(response.status)}${code ? `, ${code}` : ''}).`);
}

const post = <T>(path: string, body: Record<string, unknown>): Promise<T> =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body) });

/** O ticket cru do `join` em curso: o `api` devolve o `sessionId` fora do ticket (D7). */
interface RunningJoin {
  readonly sessionId: string;
  readonly ticket: { readonly ticket: string; readonly wsUrl: string; readonly expiresAtMs: number };
}

export interface PartyClient {
  create(characterId: string): Promise<PartyView>;
  mine(characterId: string): Promise<MineView>;
  invite(partyId: string, characterId: string, inviteeId: string): Promise<void>;
  join(partyId: string, characterId: string): Promise<JoinResult>;
  leave(partyId: string, characterId: string): Promise<void>;
  kick(partyId: string, characterId: string, targetId: string): Promise<PartyView>;
  propose(partyId: string, characterId: string, proposal: { huntId: string; difficulty: string; mode: 'split' | 'shared' }): Promise<PartyView>;
  approve(partyId: string, characterId: string): Promise<PartyView>;
  start(partyId: string, characterId: string): Promise<{ sessionId: string; ticket: PartyTicketView | null }>;
  /** O matchmaking (#199): entra na fila e casa na hora, ou fica esperando (`party: null`). */
  seek(characterId: string): Promise<{ party: PartyView | null }>;
  stopSeeking(characterId: string): Promise<void>;
  /** Publica a sala do líder com a faixa de level (§17–§20). */
  publish(partyId: string, characterId: string, range: { minLevel: number; maxLevel: number }): Promise<PartyView>;
  /** Despublica a sala. O `api` responde `{ ok: true }`, não o formulário. */
  unpublish(partyId: string, characterId: string): Promise<void>;
  /** As salas publicadas AGORA. O `api` embrulha a lista em `{ rooms }`. */
  rooms(): Promise<readonly RoomView[]>;
  /** O convidado recusa o convite sem liderança nenhuma (D8). */
  decline(partyId: string, characterId: string): Promise<void>;
}

export const partyApi: PartyClient = {
  create: (characterId) => post('/api/party', { characterId }),
  mine: (characterId) => call(`/api/party/mine?characterId=${encodeURIComponent(characterId)}`),
  invite: async (partyId, characterId, inviteeId) => { await post(`/api/party/${partyId}/invite`, { characterId, inviteeId }); },
  join: async (partyId, characterId) => {
    const response = await post<PartyView | RunningJoin>(`/api/party/${partyId}/join`, { characterId });
    // D7: party em curso devolve `{ sessionId, ticket }`; formando devolve o `PartyView`.
    if ('ticket' in response) {
      return {
        kind: 'entered',
        ticket: {
          ticket: response.ticket.ticket,
          wsUrl: response.ticket.wsUrl,
          expiresAtMs: response.ticket.expiresAtMs,
          sessionId: response.sessionId,
        },
      };
    }
    return { kind: 'formed', party: response };
  },
  leave: async (partyId, characterId) => { await post(`/api/party/${partyId}/leave`, { characterId }); },
  kick: (partyId, characterId, targetId) => post(`/api/party/${partyId}/kick`, { characterId, targetId }),
  propose: (partyId, characterId, proposal) => post(`/api/party/${partyId}/propose`, { characterId, ...proposal }),
  approve: (partyId, characterId) => post(`/api/party/${partyId}/approve`, { characterId }),
  start: (partyId, characterId) => post(`/api/party/${partyId}/start`, { characterId }),
  seek: (characterId) => post('/api/matchmaking/join', { characterId }),
  stopSeeking: async (characterId) => { await post('/api/matchmaking/leave', { characterId }); },
  publish: (partyId, characterId, range) => post(`/api/party/${partyId}/publish`, { characterId, ...range }),
  unpublish: async (partyId, characterId) => { await post(`/api/party/${partyId}/unpublish`, { characterId }); },
  rooms: async () => (await call<{ rooms: RoomView[] }>('/api/party/rooms')).rooms,
  decline: async (partyId, characterId) => { await post(`/api/party/${partyId}/decline`, { characterId }); },
};
