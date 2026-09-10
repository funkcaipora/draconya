// A API HTTP da conta e dos personagens (FUN-97).
//
// **É HTTP puro, e não passa pelo socket.** Escolher personagem acontece ANTES de existir
// sessão de jogo: o socket só abre depois, com o ticket que a escolha rende (FUN-12). Mandar
// isso por socket exigiria um socket antes de haver quem conectar.
//
// `credentials: 'include'` em TODA chamada. A sessão é um cookie httpOnly (ADR 0012), e sem ele
// tudo responde 401 — com o sintoma parecendo "não estou logado" em vez de "esqueci o cookie".

/**
 * A origem da API.
 *
 * Vazio significa MESMA ORIGEM, que é o deploy do ADR 0022 — cliente, API e socket atrás do
 * mesmo domínio. O `??` só cai no default quando a variável não existe: string vazia é uma
 * escolha, e trocá-la por `localhost` quebraria produção.
 */
export const API_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3000';

/** O personagem como a API o devolve. Só o que a tela de entrada lê. */
export interface CharacterSummary {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly xp: number;
  readonly gold: number;
  readonly vocation: string | null;
  /** Onde ele está agora — `city`, `hunt`, … O diretório manda (FUN-30). */
  readonly state: string;
  readonly sessionId: string | null;
}

export interface Identity {
  readonly accountId: string;
  readonly email: string | null;
}

/** Recusa da API já em palavras que o jogador entende. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const REFUSAL: Record<string, string> = {
  'name-taken': 'Esse nome já existe. Escolha outro.',
  'invalid-name': 'Nome inválido: de 2 a 30 letras, espaço, apóstrofo ou hífen.',
  'invalid-body': 'Nome inválido: de 2 a 30 letras, espaço, apóstrofo ou hífen.',
  unauthenticated: 'Sua sessão expirou. Entre de novo.',
  'character-not-found': 'Esse personagem não existe mais.',
  'character-in-session': 'Esse personagem está numa sessão. Saia dela antes.',
  'progress-not-settled': 'O progresso anterior ainda está sendo salvo. Tente de novo.',
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    // A sessão é cookie httpOnly, e pode estar noutra origem em desenvolvimento.
    credentials: 'include',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
  });
  if (response.ok) return (await response.json()) as T;

  // O corpo de erro é `{ error: <código> }`. Traduzir aqui, e não na tela, é o que mantém a
  // mensagem igual venha ela de onde vier — e o código cru aparece quando não há tradução,
  // que é melhor que "algo deu errado".
  let code = '';
  try {
    code = ((await response.json()) as { error?: unknown }).error as string;
  } catch {
    code = '';
  }
  throw new ApiError(
    response.status,
    REFUSAL[code] ?? `Não foi possível concluir (HTTP ${response.status}${code ? `, ${code}` : ''}).`,
  );
}

/** Quem está logado, ou `null` quando ninguém. 401 não é erro aqui: é a resposta. */
export async function whoAmI(): Promise<Identity | null> {
  const response = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include' });
  if (response.status === 401) return null;
  if (!response.ok) throw new ApiError(response.status, 'Não foi possível falar com o servidor.');
  return (await response.json()) as Identity;
}

export async function listCharacters(): Promise<readonly CharacterSummary[]> {
  return (await call<{ characters: readonly CharacterSummary[] }>('/api/characters')).characters;
}

export async function createCharacter(name: string): Promise<CharacterSummary> {
  return call<CharacterSummary>('/api/characters', {
    method: 'POST', body: JSON.stringify({ name }),
  });
}

/**
 * Escolhe o personagem. **Liquida o progresso pendente** antes de devolver (FUN-56), então o
 * que a tela mostra depois disto é o número que o banco tem, e não o de antes da última hunt.
 */
export async function selectCharacter(id: string): Promise<CharacterSummary> {
  return call<CharacterSummary>(`/api/characters/${id}/select`, { method: 'POST' });
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
}

/** Manda para o WorkOS. É navegação de verdade: o retorno vem pelo callback com o cookie. */
export function beginLogin(register = false): void {
  window.location.href = `${API_URL}/api/auth/${register ? 'register' : 'login'}`;
}
