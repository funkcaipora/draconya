// O estado da ENTRADA: quem está logado e quais personagens existem (FUN-97).
//
// Store própria, e não uma fatia do HUD, pela mesma razão que o HUD é separado do mundo
// (ADR 0007): são ritmos diferentes. A lista de personagens muda três vezes numa sessão; o HP
// muda sessenta vezes por segundo. Juntar os dois faria a lista redesenhar por causa da mana.
//
// Ela também vive num momento diferente: aqui ainda não há sessão de jogo nenhuma.

import { createStore } from '../state/hud.js';
import type { CharacterSummary, Identity } from './api.js';

export type AccountPhase =
  /** Ainda perguntando ao servidor quem é. */
  | 'checking'
  /** Ninguém logado. */
  | 'anonymous'
  /** Logado, com a lista carregada. */
  | 'ready';

export interface AccountState {
  readonly phase: AccountPhase;
  readonly identity: Identity | null;
  readonly characters: readonly CharacterSummary[];
  /**
   * Quem foi escolhido para jogar, ou `null` enquanto ninguém foi.
   *
   * É o que troca a tela de entrada pelo jogo — e o que a URL fazia sozinha antes desta issue.
   */
  readonly playing: string | null;
  /** A última recusa da API, em palavras. `null` quando não há nada a dizer. */
  readonly error: string | null;
  /** Uma chamada em curso: a tela desabilita o que não pode ser clicado duas vezes. */
  readonly busy: boolean;
}

export const INITIAL_ACCOUNT: AccountState = {
  phase: 'checking',
  identity: null,
  characters: [],
  playing: null,
  error: null,
  busy: false,
};

export const account = createStore<AccountState>(INITIAL_ACCOUNT);
