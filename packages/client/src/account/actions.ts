// As ações da tela de entrada (FUN-97).
//
// Separadas do componente porque são testáveis sem React: o que importa aqui é a SEQUÊNCIA —
// perguntar quem é, listar, criar, escolher — e o que cada recusa deixa na tela.

import { account } from './store.js';
import * as api from './api.js';
import { ApiError } from './api.js';

/**
 * A frase de "sem conexão": o `else` de `attempt` a usa quando a chamada nem chegou a
 * responder. `Entry.tsx` (`entryReadiness`) compara contra ela para distinguir essa falha de
 * uma recusa da API (o servidor respondeu, só que com "não").
 */
export const NO_SERVER_MESSAGE = 'Não foi possível falar com o servidor.';

/** Roda a chamada mostrando "ocupado" e traduzindo a recusa. `null` quando ela falhou. */
async function attempt<T>(run: () => Promise<T>): Promise<T | null> {
  account.set((state) => ({ ...state, busy: true, error: null }));
  try {
    return await run();
  } catch (error) {
    // Erro sem mensagem própria vira uma frase, e não um objeto vazio na tela: o jogador
    // precisa saber que falhou mesmo quando ninguém previu o caso.
    const message = error instanceof ApiError
      ? error.message
      : NO_SERVER_MESSAGE;
    account.set((state) => ({ ...state, error: message }));
    return null;
  } finally {
    account.set((state) => ({ ...state, busy: false }));
  }
}

/**
 * Descobre quem está logado e carrega os personagens.
 *
 * 401 não é erro: é a resposta "ninguém". Tratá-lo como falha mostraria uma mensagem vermelha
 * para quem só ainda não entrou.
 */
export async function refresh(): Promise<void> {
  const identity = await attempt(api.whoAmI);
  if (identity === null || identity === undefined) {
    account.set((state) => ({
      ...state, phase: 'anonymous', identity: null, characters: [],
    }));
    return;
  }
  const characters = await attempt(api.listCharacters);
  account.set((state) => ({
    ...state, phase: 'ready', identity, characters: characters ?? [],
  }));
}

export async function create(name: string): Promise<void> {
  const created = await attempt(() => api.createCharacter(name.trim()));
  if (created === null) return;
  account.set((state) => ({ ...state, characters: [...state.characters, created] }));
}

/**
 * Escolhe com quem jogar.
 *
 * `select` na API **liquida o progresso pendente** antes de responder (FUN-56), então o que
 * entra em jogo é o personagem que o banco tem — e não o de antes da última hunt.
 */
export async function play(id: string): Promise<void> {
  const chosen = await attempt(() => api.selectCharacter(id));
  if (chosen === null) return;
  account.set((state) => ({
    ...state,
    characters: state.characters.map((c) => (c.id === chosen.id ? chosen : c)),
    playing: chosen.id,
  }));
}

export async function signOut(): Promise<void> {
  await attempt(api.logout);
  account.set((state) => ({
    ...state, phase: 'anonymous', identity: null, characters: [], playing: null,
  }));
}
