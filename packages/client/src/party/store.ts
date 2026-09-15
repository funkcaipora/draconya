// O estado da party ANTES da hunt (#197), fora do React (ADR 0007).
//
// É um formulário que mora no servidor (`PartyStore`, em Redis); aqui fica a última cópia
// que ele devolveu, o que está em curso, e a recusa em palavras. Quando o `start` acontece —
// pelo líder aqui, ou por outro membro, descoberto no polling de `mine` — chega um ticket, e
// entrar na hunt é oferecer o ticket à conexão e reconectar: o mesmo `connect` de sempre.
//
// **A store não importa `net/`** (ADR 0007): quem manda é injetado por `setPartyClient` e
// `setEnterHunt`, como a do bot recebe o remetente.

import { createStore } from '../state/hud.js';
import type { PartyClient, PartyView } from './api.js';

export interface PartyState {
  /** Quem sou — o personagem selecionado; sem ele nada aqui faz sentido. */
  readonly characterId: string | null;
  readonly party: PartyView | null;
  readonly busy: boolean;
  readonly error: string | null;
  /** O `start` aconteceu e o ticket foi oferecido à conexão: a tela some enquanto reconecta. */
  readonly entering: boolean;
}

export const INITIAL_PARTY: PartyState = {
  characterId: null, party: null, busy: false, error: null, entering: false,
};

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

export const partyActions = {
  create: () => run((api, me) => api.create(me)),
  invite: (inviteeId: string) => run(async (api, me) => {
    const current = party.get().party;
    if (current === null) return null;
    await api.invite(current.id, me, inviteeId);
    return undefined;
  }),
  join: (partyId: string) => run((api, me) => api.join(partyId, me)),
  leave: () => run(async (api, me) => {
    const current = party.get().party;
    if (current !== null) await api.leave(current.id, me);
    return null;
  }),
  propose: (proposal: { huntId: string; difficulty: string; mode: 'split' | 'shared' }) => run((api, me) => {
    const current = party.get().party;
    return current === null ? Promise.resolve(null) : api.propose(current.id, me, proposal);
  }),
  approve: () => run((api, me) => {
    const current = party.get().party;
    return current === null ? Promise.resolve(null) : api.approve(current.id, me);
  }),
  start: () => run(async (api, me) => {
    const current = party.get().party;
    if (current === null) return null;
    const started = await api.start(current.id, me);
    if (started.ticket !== null) enter(started.ticket.wsUrl);
    return null;
  }),
  /**
   * O polling (#197, DT-01): enquanto há party, pergunta ao servidor a cada 2 s. Quando vem
   * um ticket, outro membro iniciou — e é hora de entrar.
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
      party.set((state) => (state.entering ? state : { ...state, party: mine.party }));
    } catch (error) {
      fail(error);
    }
  },
};

function enter(wsUrl: string): void {
  party.set((state) => ({ ...state, party: null, busy: false, entering: true }));
  enterHunt?.(wsUrl);
}

/** A hunt começou de verdade (chegou o `session-state` de uma hunt): a tela de party fecha. */
export function partyEntered(): void {
  party.set((state) => (state.entering ? { ...state, entering: false } : state));
}
