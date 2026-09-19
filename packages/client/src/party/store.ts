// O estado da party ANTES da hunt (#197), fora do React (ADR 0007).
//
// É um formulário que mora no servidor (`PartyStore`, em Redis); aqui fica a última cópia
// que ele devolveu, o que está em curso, e a recusa em palavras. Quando o `start` acontece —
// pelo líder aqui, ou por outro membro, descoberto no polling de `mine` — chega um ticket, e
// entrar na hunt é oferecer o ticket à conexão e reconectar: o mesmo `connect` de sempre.
//
// **A store não importa `net/`** (ADR 0007): quem manda é injetado por `setPartyClient` e
// `setEnterHunt`, como a do bot recebe o remetente.
//
// M20 (#402/#403, ADR 0033 D7/D8): `join` numa party EM CURSO devolve um ticket — a entrada é o
// MESMO caminho de `start`, e é por isso que `acceptInvite` converge nele. `invites[]` é do
// `/mine`, que agora roda em qualquer tela (o `Shell` é o dono do polling, DT-01).

import { createStore } from '../state/hud.js';
import type { JoinResult, PartyClient, PartyInviteView, PartyView, RoomView } from './api.js';

export interface PartyState {
  /** Quem sou — o personagem selecionado; sem ele nada aqui faz sentido. */
  readonly characterId: string | null;
  readonly party: PartyView | null;
  readonly busy: boolean;
  readonly error: string | null;
  /** O `start` aconteceu e o ticket foi oferecido à conexão: a tela some enquanto reconecta. */
  readonly entering: boolean;
  /** Na fila do matchmaking (#199), esperando alguém compatível. */
  readonly seeking: boolean;
  /** Convites visíveis a QUALQUER personagem selecionado (D7/D8) — não só a quem está sem party. */
  readonly invites: readonly PartyInviteView[];
}

export const INITIAL_PARTY: PartyState = {
  characterId: null, party: null, busy: false, error: null, entering: false, seeking: false, invites: [],
};

/** O ritmo do polling de `/mine` (DT-01: agora é do Shell, não de `PartyPanel`). */
export const PARTY_POLL_MS = 2_000;

export const party = createStore<PartyState>(INITIAL_PARTY);

let client: PartyClient | null = null;
let enterHunt: ((wsUrl: string) => void) | null = null;

export function setPartyClient(next: PartyClient | null): void {
  client = next;
}

/** Quem leva o ticket à conexão e reconecta. Injetado pela casca, que tem o `net/`. */
export function setEnterHunt(next: ((wsUrl: string) => void) | null): void {
  enterHunt = next;
}

export function setPartyCharacter(characterId: string | null): void {
  party.set((state) => (state.characterId === characterId ? state : { ...INITIAL_PARTY, characterId }));
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Não foi possível concluir.';
  party.set((state) => ({ ...state, busy: false, error: message }));
}

async function run(action: (api: PartyClient, characterId: string) => Promise<PartyView | null | void>): Promise<void> {
  const { characterId } = party.get();
  if (client === null || characterId === null) return;
  party.set((state) => ({ ...state, busy: true, error: null }));
  try {
    const result = await action(client, characterId);
    party.set((state) => ({ ...state, busy: false, ...(result === undefined ? {} : { party: result }) }));
  } catch (error) {
    fail(error);
  }
}

/**
 * D7: o `join` de uma party em curso devolve um ticket. Oferecê-lo à conexão é o MESMO `enter()`
 * de `start` — nenhum caminho novo de socket — e o formulário some porque a party virou a hunt.
 */
function enterOrForm(result: JoinResult): PartyView | null {
  if (result.kind === 'entered') {
    enter(result.ticket.wsUrl);
    return null;
  }
  return result.party;
}

export const partyActions = {
  create: () => run((api, me) => api.create(me)),
  invite: (inviteeId: string) => run(async (api, me) => {
    const current = party.get().party;
    if (current === null) return null;
    await api.invite(current.id, me, inviteeId);
    return undefined;
  }),
  /** "Entrar por id" (formação) E "aceitar convite" convergem aqui — D7: o MESMO endpoint
   *  devolve o formulário ou um ticket, dependendo do estado da party do outro lado. */
  join: (partyId: string) => run(async (api, me) => enterOrForm(await api.join(partyId, me))),
  acceptInvite: (partyId: string) => run(async (api, me) => {
    const result = enterOrForm(await api.join(partyId, me));
    party.set((state) => ({ ...state, invites: state.invites.filter((invite) => invite.partyId !== partyId) }));
    return result;
  }),
  declineInvite: (partyId: string) => run(async (api, me) => {
    await api.decline(partyId, me);
    party.set((state) => ({ ...state, invites: state.invites.filter((invite) => invite.partyId !== partyId) }));
    return undefined;
  }),
  leave: () => run(async (api, me) => {
    const current = party.get().party;
    if (current !== null) await api.leave(current.id, me);
    return null;
  }),
  kick: (targetId: string) => run((api, me) => {
    const current = party.get().party;
    return current === null ? Promise.resolve(null) : api.kick(current.id, me, targetId);
  }),
  propose: (proposal: { huntId: string; difficulty: string; mode: 'split' | 'shared' }) => run((api, me) => {
    const current = party.get().party;
    return current === null ? Promise.resolve(null) : api.propose(current.id, me, proposal);
  }),
  approve: () => run((api, me) => {
    const current = party.get().party;
    return current === null ? Promise.resolve(null) : api.approve(current.id, me);
  }),
  publish: (range: { minLevel: number; maxLevel: number }) => run((api, me) => {
    const current = party.get().party;
    return current === null ? Promise.resolve(null) : api.publish(current.id, me, range);
  }),
  /** O `api` responde `{ ok: true }`; a cópia local reflete o que o servidor acabou de fazer. */
  unpublish: () => run(async (api, me) => {
    const current = party.get().party;
    if (current === null) return null;
    await api.unpublish(current.id, me);
    return { ...current, published: false, minLevel: null, maxLevel: null };
  }),
  start: () => run(async (api, me) => {
    const current = party.get().party;
    if (current === null) return null;
    const started = await api.start(current.id, me);
    if (started.ticket !== null) enter(started.ticket.wsUrl);
    return null;
  }),
  /** O matchmaking (#199): entra na fila; casou na hora ou espera (e o polling vê chegar). */
  seek: () => run(async (api, me) => {
    const { party: formed } = await api.seek(me);
    party.set((state) => ({ ...state, seeking: formed === null }));
    return formed;
  }),
  stopSeeking: () => run(async (api, me) => {
    await api.stopSeeking(me);
    party.set((state) => ({ ...state, seeking: false }));
    return undefined;
  }),
  /**
   * O polling (#197, DT-01): agora é do `Shell`, rodando SEMPRE que há personagem — o convite
   * precisa aparecer em qualquer tela (D7). Pergunta ao servidor a cada 2 s: um ticket significa
   * que outro membro iniciou (ou que o convite aceito virou hunt); `invites[]` alimenta o diálogo.
   */
  refresh: async (): Promise<void> => {
    const { characterId } = party.get();
    if (client === null || characterId === null) return;
    try {
      const mine = await client.mine(characterId);
      if (mine.ticket !== null) {
        enter(mine.ticket.wsUrl);
        return;
      }
      party.set((state) => (state.entering
        ? state
        : { ...state, party: mine.party, seeking: state.seeking && mine.party === null, invites: mine.invites }));
    } catch (error) {
      fail(error);
    }
  },
};

/**
 * Sala pública (#402): lida sob demanda pela aba "Encontrar Party", NUNCA por `run`/`busy` — são
 * OUTRAS parties, não a desta sessão, e marcar `busy` a cada tick de 2 s travaria os botões da
 * própria formação por causa de uma listagem que não muda o estado dela.
 *
 * Falha de rede vira lista vazia, nunca exceção: é leitura de fundo, e travar a tela com erro
 * vermelho a cada 2 s de instabilidade seria pior que uma lista momentaneamente vazia.
 */
export async function fetchRooms(): Promise<readonly RoomView[]> {
  if (client === null) return [];
  try {
    return await client.rooms();
  } catch {
    return [];
  }
}

function enter(wsUrl: string): void {
  party.set((state) => ({ ...state, party: null, busy: false, entering: true }));
  enterHunt?.(wsUrl);
}

/** A hunt começou de verdade (chegou o `session-state` de uma hunt): a tela de party fecha. */
export function partyEntered(): void {
  party.set((state) => (state.entering ? { ...state, entering: false } : state));
}
