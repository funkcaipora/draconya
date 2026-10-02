// As ações da tela de entrada (FUN-97).
//
// Separadas do componente porque são testáveis sem React: o que importa aqui é a SEQUÊNCIA —
// perguntar quem é, listar, criar, escolher — e o que cada recusa deixa na tela.

import { account } from './store.js';
import * as api from './api.js';
import { ApiError } from './api.js';
import type { TicketEntry } from './api.js';
import { hud, INITIAL_HUD } from '../state/hud.js';

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
 *
 * `entry` é por onde a primeira sessão nasce (#846, OW-23): o mundo — o default, e o pedido de sempre — ou uma
 * hunt idle direta. Vai no ticket, que o servidor confere; quem já tem sessão a reencontra e ele é ignorado.
 */
export async function play(id: string, entry: TicketEntry = 'world'): Promise<void> {
  const chosen = await attempt(() => api.selectCharacter(id));
  if (chosen === null) return;
  account.set((state) => ({
    ...state,
    characters: state.characters.map((c) => (c.id === chosen.id ? chosen : c)),
    playing: chosen.id,
    entry,
  }));
}

/**
 * Carrega o menu de entrada deste servidor (#846, OW-23): a flag do mundo aberto e as hunts diretas.
 *
 * Fora de `refresh` de propósito: é enfeite da escolha de personagem, e uma resposta que não vem não pode
 * custar a lista de personagens nem pintar um erro vermelho. Sem resposta, `entryOptions` fica `null` e a
 * tela mostra o botão único de sempre.
 */
export async function loadEntryOptions(): Promise<void> {
  const options = await api.fetchEntryOptions();
  account.set((state) => ({ ...state, entryOptions: options }));
}

/**
 * Pede "caçar agora" a quem espera na fila do mundo cheio (#846, OW-23): a próxima conexão pede o ticket com
 * `entry: { hunt }`, e a hunt idle não passa pela fila nem tem teto (ADR 0060 d.6b). O personagem continua o
 * mesmo — só muda por onde a primeira sessão dele nasce.
 */
export function huntInsteadOfWaiting(huntId: string): void {
  account.set((state) => ({ ...state, entry: { hunt: huntId } }));
}

/**
 * Volta à escolha de personagem: o jogador saiu do jogo (o logout aceito, #846) ou desistiu da fila.
 *
 * Zera o HUD — o que ele guarda é do personagem que acabou de sair, e o próximo a entrar não pode ver o
 * ouro e o inventário de outro na primeira tela. O mundo (`state/world.ts`) não precisa: o `instance-enter`
 * da próxima sessão o limpa por inteiro. Recarrega a lista, porque o estado de cada personagem mudou.
 */
export function leaveGame(): void {
  hud.set(() => INITIAL_HUD);
  account.set((state) => ({ ...state, playing: null, entry: 'world' }));
  void refresh();
}

export async function signOut(): Promise<void> {
  await attempt(api.logout);
  account.set((state) => ({
    ...state, phase: 'anonymous', identity: null, characters: [], playing: null,
  }));
}

/**
 * Tenta iniciar o login: se o servidor estiver em dev mode, retorna `'dev'` para que a UI
 * mostre o campo de e-mail. Senão, navega para o WorkOS.
 */
export async function tryLogin(register = false): Promise<'dev' | 'navigating' | null> {
  return attempt(() => api.beginLogin(register));
}

/**
 * Login em dev mode: manda o e-mail, recebe o cookie, e recarrega a lista de personagens.
 */
export async function devLogin(email: string): Promise<void> {
  const identity = await attempt(() => api.devLogin(email));
  if (identity === null) return;
  const characters = await attempt(api.listCharacters);
  account.set((state) => ({
    ...state, phase: 'ready', identity, characters: characters ?? [],
  }));
}
