// A API HTTP da party (#197, ADR 0027 decisão 8): formar a party é HTTP, como escolher
// personagem — o personagem está na Cidade e o socket não tem nada a ver com isso. Cada
// chamada leva `characterId`: é o personagem de QUEM fala, e o servidor confere a posse.

import { API_URL, ApiError } from '../account/api.js';

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
}

export interface PartyTicketView {
  readonly ticket: string;
  readonly wsUrl: string;
  readonly expiresAtMs: number;
  readonly sessionId: string;
}

export interface MineView {
  readonly party: PartyView | null;
  readonly ticket: PartyTicketView | null;
}

const REFUSAL: Record<string, string> = {
  'already-in-party': 'Você já está numa party.',
  'not-invited': 'Você não foi convidado para essa party.',
  full: 'A party está cheia.',
  'in-another-party': 'Você está em outra party.',
  'party-not-found': 'Essa party não existe mais.',
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

export interface PartyClient {
  create(characterId: string): Promise<PartyView>;
  mine(characterId: string): Promise<MineView>;
  invite(partyId: string, characterId: string, inviteeId: string): Promise<void>;
  join(partyId: string, characterId: string): Promise<PartyView>;
  leave(partyId: string, characterId: string): Promise<void>;
  kick(partyId: string, characterId: string, targetId: string): Promise<PartyView>;
  propose(partyId: string, characterId: string, proposal: { huntId: string; difficulty: string; mode: 'split' | 'shared' }): Promise<PartyView>;
  approve(partyId: string, characterId: string): Promise<PartyView>;
  start(partyId: string, characterId: string): Promise<{ sessionId: string; ticket: PartyTicketView | null }>;
  /** O matchmaking (#199): entra na fila e casa na hora, ou fica esperando (`party: null`). */
  seek(characterId: string): Promise<{ party: PartyView | null }>;
  stopSeeking(characterId: string): Promise<void>;
}

export const partyApi: PartyClient = {
  create: (characterId) => post('/api/party', { characterId }),
  mine: (characterId) => call(`/api/party/mine?characterId=${encodeURIComponent(characterId)}`),
  invite: async (partyId, characterId, inviteeId) => { await post(`/api/party/${partyId}/invite`, { characterId, inviteeId }); },
  join: (partyId, characterId) => post(`/api/party/${partyId}/join`, { characterId }),
  leave: async (partyId, characterId) => { await post(`/api/party/${partyId}/leave`, { characterId }); },
  kick: (partyId, characterId, targetId) => post(`/api/party/${partyId}/kick`, { characterId, targetId }),
  propose: (partyId, characterId, proposal) => post(`/api/party/${partyId}/propose`, { characterId, ...proposal }),
  approve: (partyId, characterId) => post(`/api/party/${partyId}/approve`, { characterId }),
  start: (partyId, characterId) => post(`/api/party/${partyId}/start`, { characterId }),
  seek: (characterId) => post('/api/matchmaking/join', { characterId }),
  stopSeeking: async (characterId) => { await post('/api/matchmaking/leave', { characterId }); },
};
