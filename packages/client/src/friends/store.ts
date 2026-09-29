// O estado dos amigos (#403/#404), fora do React (ADR 0007). Espelho de `party/store.ts`: guarda
// a última lista que o servidor devolveu, o que está em curso e a recusa em palavras.
//
// **A store não importa `net/`** (ADR 0007): quem fala HTTP é injetado pela casca
// (`setFriendsClient`), como `setPartyClient` já faz.
//
// Divergência do contrato original do desenho: o `POST /api/friends` mesclado (#403) responde
// `{ ok: true }`, não o `FriendView` novo — então `add` recarrega a lista em vez de anexar uma
// linha que o servidor não devolveu (o cliente nunca fabrica dado — invariante 4).

import { createStore } from '../state/hud.js';
import type { FriendsClient, FriendView } from './api.js';

export interface FriendsState {
  readonly characterId: string | null;
  readonly friends: readonly FriendView[];
  readonly busy: boolean;
  readonly error: string | null;
}

export const INITIAL_FRIENDS: FriendsState = { characterId: null, friends: [], busy: false, error: null };
export const friends = createStore<FriendsState>(INITIAL_FRIENDS);

let client: FriendsClient | null = null;

export function setFriendsClient(next: FriendsClient | null): void {
  client = next;
}

export function setFriendsCharacter(characterId: string | null): void {
  friends.set((state) => (state.characterId === characterId ? state : { ...INITIAL_FRIENDS, characterId }));
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Não foi possível concluir.';
  friends.set((state) => ({ ...state, busy: false, error: message }));
}

export const friendsActions = {
  refresh: async (): Promise<void> => {
    const { characterId } = friends.get();
    if (client === null || characterId === null) return;
    try {
      const list = await client.list(characterId);
      friends.set((state) => ({ ...state, friends: list }));
    } catch (error) {
      fail(error);
    }
  },
  /** `true` quando o servidor aceitou; `false` deixa a frase em `error` e a lista intacta. */
  add: async (name: string): Promise<boolean> => {
    const { characterId } = friends.get();
    if (client === null || characterId === null || name === '') return false;
    friends.set((state) => ({ ...state, busy: true, error: null }));
    try {
      await client.add(characterId, name);
      // O POST não devolve a linha; a lista recarregada é a fonte (nunca anexar por conta própria).
      const list = await client.list(characterId);
      friends.set((state) => ({ ...state, busy: false, friends: list }));
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  },
  remove: async (friendCharacterId: string): Promise<void> => {
    const { characterId } = friends.get();
    if (client === null || characterId === null) return;
    try {
      await client.remove(characterId, friendCharacterId);
      friends.set((state) => ({ ...state, friends: state.friends.filter((friend) => friend.characterId !== friendCharacterId) }));
    } catch (error) {
      fail(error);
    }
  },
};
