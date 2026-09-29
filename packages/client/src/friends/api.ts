// Amigos é o mínimo do §21 (ADR 0035 decisão 8): adicionar por nome, listar com online/onde e
// remover. MESMO padrão de `party/api.ts` — `call`/`post` locais e o `REFUSAL` local: cada
// `api.ts` é dono do seu dicionário (não há helper HTTP compartilhado no repositório; ver
// `party/api.ts` e `account/api.ts`).
//
// Sem pedido de amizade nem bloqueio: o kit desenha as abas, e elas esperam o épico social. A
// amizade é unidirecional (#403). O cliente só manda intenção (invariante 4).

import { API_URL, ApiError } from '../account/api.js';

export interface FriendView {
  readonly characterId: string;
  readonly name: string;
  readonly vocationId: string | null;
  readonly level: number;
  readonly online: boolean;
  /** `'city'` na Cidade viva, `'hunt'` fora dela, `null` offline. O diretório manda (#403). */
  readonly where: 'city' | 'hunt' | null;
}

const REFUSAL: Record<string, string> = {
  'character-not-found': 'Não existe personagem com esse nome.',
  'already-friends': 'Vocês já são amigos.',
  'cannot-friend-self': 'Você não pode se adicionar.',
  unauthenticated: 'Sua sessão expirou. Entre de novo.',
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

export interface FriendsClient {
  list(characterId: string): Promise<readonly FriendView[]>;
  add(characterId: string, name: string): Promise<void>;
  remove(characterId: string, friendCharacterId: string): Promise<void>;
}

export const friendsApi: FriendsClient = {
  list: (characterId) => call(`/api/friends?characterId=${encodeURIComponent(characterId)}`),
  add: async (characterId, name) => { await call('/api/friends', { method: 'POST', body: JSON.stringify({ characterId, name }) }); },
  remove: async (characterId, friendCharacterId) => {
    await call(`/api/friends/${encodeURIComponent(friendCharacterId)}`, { method: 'DELETE', body: JSON.stringify({ characterId }) });
  },
};
