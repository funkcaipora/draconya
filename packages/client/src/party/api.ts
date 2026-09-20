// A API HTTP da party (#197, ADR 0027 decisão 8): formar a party é HTTP, como escolher
// personagem — o personagem está na Cidade e o socket não tem nada a ver com isso. Cada
// chamada leva `characterId`: é o personagem de QUEM fala, e o servidor confere a posse.
//
// Desde a #501 a sala tem COMPOSIÇÃO POR VOCAÇÃO (`vocationTargets`, vocação → TOTAL desejado,
// incluindo quem já está) e level mínimo; a busca de salas FILTRA no servidor pela elegibilidade
// do candidato (`rooms` leva `characterId`, e `huntId` quando há filtro); a aprovação pré-start
// não existe mais — o líder configura (`configure`), publica (`publish`, sem corpo) e inicia.
// A entrada numa party EM CURSO continua devolvendo um TICKET (D7).

import { API_URL, ApiError } from '../account/api.js';

export type PartyLifecycle = 'forming' | 'hunting';

export interface PartyMemberView {
  readonly characterId: string;
  readonly name: string;
}

export interface PartyView {
  readonly id: string;
  readonly leaderId: string;
  /** Espelho derivado dos dois eixos (ADR 0035 D1), mantido no fio para a rolagem (DT-08). */
  readonly mode: 'split' | 'shared';
  readonly huntId: string | null;
  readonly difficulty: string | null;
  /** Level mínimo da sala; `maxLevel` saiu do contrato (#501, DT-03). */
  readonly minLevel: number | null;
  /** Vocação → TOTAL desejado, incluindo quem já está (RF-05). */
  readonly vocationTargets: Readonly<Record<string, number>>;
  /** Os DOIS eixos são independentes (ADR 0035 d.1): cada um liga e desliga sozinho. */
  readonly shareCosts: boolean;
  readonly splitLoot: boolean;
  /** Vagas restantes por vocação, contadas pelo servidor sobre o estado REAL. */
  readonly openSlots: Readonly<Record<string, number>>;
  readonly members: readonly PartyMemberView[];
  /** Sala publicada para "Encontrar Party": `publish`/`unpublish` mudam isto. */
  readonly published: boolean;
  readonly state: PartyLifecycle;
  readonly sessionId: string | null;
}

export interface PartyTicketView {
  readonly ticket: string;
  readonly wsUrl: string;
  readonly expiresAtMs: number;
  readonly sessionId: string;
}

/** A sala pública de "Encontrar Party", como `GET /api/party/rooms` a devolve — só ELEGÍVEIS. */
export interface RoomView {
  readonly partyId: string;
  readonly huntId: string;
  readonly difficulty: string;
  readonly leader: { readonly characterId: string; readonly name: string; readonly level: number };
  readonly vocations: readonly (string | null)[];
  readonly vocationTargets: Readonly<Record<string, number>>;
  /** Vagas restantes por vocação — o que o jogador olha para escolher, não só members/max. */
  readonly openSlots: Readonly<Record<string, number>>;
  readonly members: number;
  readonly maxMembers: number;
  readonly minLevel: number;
  readonly state: PartyLifecycle;
}

/** O convite tradicional: aponta para uma party que já existe. */
export interface PartyInviteView {
  readonly partyId: string;
  readonly leaderId: string;
  readonly leaderName: string;
  readonly huntId: string | null;
  readonly state: PartyLifecycle;
}

/**
 * O convite SOCIAL (RF-09 do servidor): NÃO aponta para party — a party nasce, se precisar,
 * no aceite. A sub-issue C (#502) acrescenta a apresentação e a ação dele; aqui só a forma
 * que o `/mine` já manda.
 */
export interface SocialInviteView {
  readonly inviteId: string;
  readonly leaderId: string;
  readonly leaderName: string;
  readonly createdAtMs: number;
}

/** A union que o `invites[]` do `/mine` devolve desde a #501: escolha por presença de campo. */
export type MineInvite = PartyInviteView | SocialInviteView;

export interface MineView {
  readonly party: PartyView | null;
  readonly ticket: PartyTicketView | null;
  readonly invites: readonly MineInvite[];
}

/**
 * D7: `join` numa party em curso devolve um TICKET, não o formulário — o MESMO endpoint HTTP,
 * dois formatos de resposta. O discriminante evita um `ticket: X | null` ambíguo com o de `start`.
 */
export type JoinResult =
  | { readonly kind: 'formed'; readonly party: PartyView }
  | { readonly kind: 'entered'; readonly ticket: PartyTicketView };

/** A configuração COMPLETA da sala — o que o configure-then-start do `HuntsModal` manda. */
export interface PartyConfigInput {
  readonly huntId: string;
  readonly difficulty: string;
  readonly minLevel: number;
  readonly vocationTargets: Readonly<Record<string, number>>;
  readonly shareCosts: boolean;
  readonly splitLoot: boolean;
}

/**
 * O patch do `/configure` (RF-02): cada eixo muda sozinho, e só o que veio é aplicado — é por
 * isso que os DOIS toggles de "Minha Party" mandam patch de UM eixo cada, sem afetar o outro.
 */
export type PartyConfigPatch = Partial<PartyConfigInput>;

const REFUSAL: Record<string, string> = {
  'already-in-party': 'Você já está numa party.',
  'not-invited': 'Você não foi convidado para essa party.',
  full: 'A party está cheia.',
  'party-full': 'A party está cheia.',
  'content-version': 'A sala está numa versão de conteúdo diferente.',
  'session-not-here': 'A sessão da party não está disponível agora.',
  'in-another-party': 'Você está em outra party.',
  'party-not-found': 'Essa party não existe mais.',
  'character-not-found': 'Esse personagem não existe mais.',
  'not-leader': 'Só o líder pode fazer isso.',
  'cannot-kick-self': 'Você não pode expulsar a si mesmo — use sair da party.',
  'target-not-a-member': 'Esse personagem não está mais na party.',
  'not-a-member': 'Você não está nessa party.',
  'nothing-proposed': 'Configure a caçada antes disso.',
  'not-configured': 'Configure o level mínimo antes de abrir as vagas.',
  'not-enough-members': 'Uma party precisa de pelo menos dois.',
  'not-in-city': 'Alguém da party não está na cidade.',
  'active-limit': 'A conta de alguém já tem o máximo de personagens ativos.',
  'progress-not-settled': 'O progresso de alguém ainda está sendo salvo. Tente de novo.',
  'unknown-hunt': 'Essa hunt não existe.',
  'unknown-difficulty': 'Essa dificuldade não existe para essa hunt.',
  'unknown-vocation': 'A composição tem uma vocação desconhecida.',
  'composition-too-large': 'A composição passa do limite de membros.',
  'room-not-eligible': 'Você não pode entrar nesta sala.',
  'no-vocation-slot': 'Nenhuma vaga para a sua vocação nesta sala.',
  'inviter-in-hunt': 'Quem convida precisa estar fora da caçada.',
  'inviter-unavailable': 'Quem convidou não pode mais receber você.',
  'invite-not-found': 'Esse convite não existe mais.',
  'invite-expired': 'Esse convite expirou.',
  'invite-self': 'Você não pode convidar a si mesmo.',
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

/** A query da busca de salas: `characterId` é OBRIGATÓRIO — quem filtra a elegibilidade é o `api`. */
export interface RoomsQuery {
  readonly characterId: string;
  readonly huntId?: string;
}

export interface PartyClient {
  create(characterId: string): Promise<PartyView>;
  mine(characterId: string): Promise<MineView>;
  invite(partyId: string, characterId: string, inviteeId: string): Promise<void>;
  join(partyId: string, characterId: string): Promise<JoinResult>;
  leave(partyId: string, characterId: string): Promise<void>;
  kick(partyId: string, characterId: string, targetId: string): Promise<PartyView>;
  /** O patch do líder: só o que veio é aplicado (RF-02). */
  configure(partyId: string, characterId: string, patch: PartyConfigPatch): Promise<PartyView>;
  /** Publica a sala SEM corpo: o que se publica é o estado que o `configure` gravou (RF-03). */
  publish(partyId: string, characterId: string): Promise<PartyView>;
  /** Despublica a sala. O `api` responde `{ ok: true }`, não o formulário. */
  unpublish(partyId: string, characterId: string): Promise<void>;
  start(partyId: string, characterId: string): Promise<{ sessionId: string; ticket: PartyTicketView | null }>;
  /** O matchmaking (#199): entra na fila e casa na hora, ou fica esperando (`party: null`). */
  seek(characterId: string): Promise<{ party: PartyView | null }>;
  stopSeeking(characterId: string): Promise<void>;
  /** As salas ELEGÍVEIS para este personagem, AGORA. O `api` embrulha a lista em `{ rooms }`. */
  rooms(query: RoomsQuery): Promise<readonly RoomView[]>;
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
  configure: (partyId, characterId, patch) => post(`/api/party/${partyId}/configure`, { characterId, ...patch }),
  publish: (partyId, characterId) => post(`/api/party/${partyId}/publish`, { characterId }),
  unpublish: async (partyId, characterId) => { await post(`/api/party/${partyId}/unpublish`, { characterId }); },
  start: (partyId, characterId) => post(`/api/party/${partyId}/start`, { characterId }),
  seek: (characterId) => post('/api/matchmaking/join', { characterId }),
  stopSeeking: async (characterId) => { await post('/api/matchmaking/leave', { characterId }); },
  rooms: (query) => {
    const params = new URLSearchParams({ characterId: query.characterId });
    if (query.huntId !== undefined) params.set('huntId', query.huntId);
    return call<{ rooms: RoomView[] }>(`/api/party/rooms?${params.toString()}`).then((data) => data.rooms);
  },
  decline: async (partyId, characterId) => { await post(`/api/party/${partyId}/decline`, { characterId }); },
};
