import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create, huntInsteadOfWaiting, leaveGame, loadEntryOptions, play, refresh, signOut } from './actions.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import { INITIAL_ACCOUNT, account } from './store.js';

const identity = { accountId: 'a1', email: 'jogador@exemplo.com' };
const hero = {
  id: 'c1', name: 'Tharion', level: 8, xp: 900, gold: 300,
  vocation: null, state: 'city', sessionId: null,
};

/** Um `fetch` que responde por rota, e anota o que foi chamado. */
function server(routes: Record<string, () => Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = Object.keys(routes).find((path) => url.includes(path));
    if (route === undefined) throw new Error(`rota não esperada: ${url}`);
    return Promise.resolve(routes[route]!());
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

beforeEach(() => {
  account.set(() => INITIAL_ACCOUNT);
  hud.set(() => INITIAL_HUD);
  vi.unstubAllGlobals();
});

describe('descobrir quem entrou (FUN-97)', () => {
  it('carrega identidade e personagens numa passada', async () => {
    server({
      '/api/auth/me': () => json(identity),
      '/api/characters': () => json({ characters: [hero] }),
    });

    await refresh();

    expect(account.get().phase).toBe('ready');
    expect(account.get().identity).toEqual(identity);
    expect(account.get().characters).toEqual([hero]);
  });

  it('401 é a RESPOSTA "ninguém", não uma falha', async () => {
    // Tratar 401 como erro mostraria uma mensagem vermelha para quem só ainda não entrou — e
    // é o estado de toda primeira visita.
    server({ '/api/auth/me': () => json({ error: 'unauthenticated' }, 401) });

    await refresh();

    expect(account.get().phase).toBe('anonymous');
    expect(account.get().error).toBeNull();
  });

  it('manda o cookie em TODA chamada', async () => {
    // A sessão é um cookie httpOnly (ADR 0012). Sem `credentials: 'include'` tudo responde
    // 401, e o sintoma parece "não estou logado" em vez de "esqueci o cookie".
    const calls = server({
      '/api/auth/me': () => json(identity),
      '/api/characters': () => json({ characters: [] }),
    });

    await refresh();

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.init?.credentials === 'include')).toBe(true);
  });

  it('servidor fora do ar vira frase na tela, não objeto vazio', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));

    await refresh();

    expect(account.get().phase).toBe('anonymous');
    expect(account.get().error).toContain('servidor');
  });
});

describe('criar personagem (FUN-97)', () => {
  it('acrescenta o criado à lista, sem recarregar tudo', async () => {
    server({
      '/api/characters': () => json(hero, 201),
    });
    account.set((state) => ({ ...state, phase: 'ready', identity }));

    await create('Tharion');

    expect(account.get().characters).toEqual([hero]);
    expect(account.get().error).toBeNull();
  });

  it('nome tomado vira TEXTO, e a lista não muda', async () => {
    // "Algo deu errado" faz o jogador tentar o mesmo nome de novo. O motivo é o que resolve.
    server({ '/api/characters': () => json({ error: 'name-taken' }, 409) });

    await create('Tharion');

    expect(account.get().error).toContain('nome já existe');
    expect(account.get().characters).toEqual([]);
  });

  it('nome inválido diz a REGRA, não o código', async () => {
    server({ '/api/characters': () => json({ error: 'invalid-name' }, 400) });

    await create('x');

    expect(account.get().error).toContain('2 a 30');
  });

  it('recusa sem código conhecido ainda diz que falhou', async () => {
    // Um código novo no servidor não pode virar tela em silêncio: o jogador precisa saber que
    // não aconteceu, mesmo quando ninguém previu o caso.
    server({ '/api/characters': () => json({ error: 'algo-novo' }, 400) });

    await create('Tharion');

    expect(account.get().error).toContain('algo-novo');
  });
});

describe('escolher com quem jogar (FUN-97)', () => {
  it('escolher é o que troca a tela pelo jogo', async () => {
    // `playing` é o que `main.tsx` lê para decidir entre a entrada e o jogo. Antes desta
    // issue, quem decidia era a query string — e por isso ninguém entrava no staging.
    server({ '/select': () => json({ ...hero, level: 9 }) });

    await play('c1');

    expect(account.get().playing).toBe('c1');
  });

  it('usa o personagem que o SELECT devolveu, e não o da lista', async () => {
    // `select` liquida o progresso pendente antes de responder (FUN-56). Ficar com o da
    // listagem mostraria o personagem de antes da última hunt — encolhido, inclusive.
    server({ '/select': () => json({ ...hero, level: 12, gold: 4_200 }) });
    account.set((state) => ({ ...state, phase: 'ready', characters: [hero] }));

    await play('c1');

    expect(account.get().characters[0]).toMatchObject({ level: 12, gold: 4_200 });
  });

  it('recusa NÃO entra em jogo', async () => {
    // Entrar com um personagem que o servidor recusou deixaria o socket batendo numa porta
    // fechada, com a tela dizendo que está tudo bem.
    server({ '/select': () => json({ error: 'character-not-found' }, 404) });

    await play('c1');

    expect(account.get().playing).toBeNull();
    expect(account.get().error).toContain('não existe');
  });
});

describe('sair (FUN-97)', () => {
  it('volta para anônimo e esquece quem estava jogando', async () => {
    server({ '/api/auth/logout': () => new Response(null, { status: 204 }) });
    account.set((state) => ({
      ...state, phase: 'ready', identity, characters: [hero], playing: 'c1',
    }));

    await signOut();

    expect(account.get()).toMatchObject({
      phase: 'anonymous', identity: null, characters: [], playing: null,
    });
  });
});

describe('por onde a primeira sessão nasce (OW-23, #846)', () => {
  it('sem pedir nada, entra pelo MUNDO — o default, e o pedido de sempre', async () => {
    server({ '/select': () => json(hero) });

    await play('c1');

    expect(account.get().entry).toBe('world');
  });

  it('"Caçar (idle)" guarda a hunt escolhida, que vai no ticket', async () => {
    server({ '/select': () => json(hero) });

    await play('c1', { hunt: 'rat-cellars' });

    expect(account.get()).toMatchObject({ playing: 'c1', entry: { hunt: 'rat-cellars' } });
  });

  it('a recusa do select não guarda o `entry`: o jogador continua na escolha', async () => {
    server({ '/select': () => json({ error: 'character-not-found' }, 404) });

    await play('c1', { hunt: 'rat-cellars' });

    expect(account.get().playing).toBeNull();
    expect(account.get().entry).toBe('world');
  });
});

describe('o menu de entrada do servidor (OW-23, #846)', () => {
  it('guarda a flag e as hunts que o servidor ofereceu', async () => {
    const calls = server({
      '/api/entry-options': () => json({
        openWorld: true, hunts: [{ id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1 }],
      }),
    });

    await loadEntryOptions();

    expect(account.get().entryOptions).toEqual({
      openWorld: true, hunts: [{ id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1 }],
    });
    expect(calls[0]?.init?.credentials).toBe('include');
  });

  it('um servidor sem a rota (404) é "sem menu": a tela cai no botão único, sem erro vermelho', async () => {
    server({ '/api/entry-options': () => json({ error: 'not-found' }, 404) });

    await loadEntryOptions();

    expect(account.get().entryOptions).toBeNull();
    expect(account.get().error).toBeNull();
  });

  it('servidor fora do ar também é "sem menu" — um enfeite não pode custar a entrada', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));

    await loadEntryOptions();

    expect(account.get().entryOptions).toBeNull();
    expect(account.get().error).toBeNull();
  });

  it('corpo torto (o que não é o contrato) é "sem menu", não um menu pela metade', async () => {
    server({ '/api/entry-options': () => json({ openWorld: 'sim', hunts: 3 }) });

    await loadEntryOptions();

    expect(account.get().entryOptions).toBeNull();
  });

  it('a lista de personagens NÃO depende dele: refresh não chama a rota do menu', async () => {
    const calls = server({
      '/api/auth/me': () => json(identity),
      '/api/characters': () => json({ characters: [hero] }),
    });

    await refresh();

    expect(calls.some((call) => call.url.includes('entry-options'))).toBe(false);
  });
});

describe('caçar em vez de esperar na fila (OW-23, #846)', () => {
  it('troca o `entry` para a hunt, e o personagem continua o mesmo', () => {
    account.set((state) => ({ ...state, playing: 'c1', entry: 'world' }));

    huntInsteadOfWaiting('rotworm-caves');

    expect(account.get()).toMatchObject({ playing: 'c1', entry: { hunt: 'rotworm-caves' } });
  });
});

describe('sair do jogo e voltar à escolha (OW-23, #846)', () => {
  it('esquece o personagem, volta o `entry` ao mundo e zera o HUD do que saiu', async () => {
    const calls = server({
      '/api/auth/me': () => json(identity),
      '/api/characters': () => json({ characters: [{ ...hero, state: 'offline' }] }),
    });
    account.set((state) => ({
      ...state, phase: 'ready', identity, characters: [hero], playing: 'c1', entry: { hunt: 'rat-cellars' },
    }));
    hud.set((state) => ({ ...state, characterId: 'c1', gold: 999, level: 40 }));

    leaveGame();
    // O que o jogador vê na escolha do próximo personagem: nunca o ouro do que acabou de sair.
    expect(account.get()).toMatchObject({ playing: null, entry: 'world' });
    expect(hud.get()).toBe(INITIAL_HUD);

    await vi.waitFor(() => { expect(account.get().characters[0]?.state).toBe('offline'); });
    // Recarrega a lista: o estado de cada personagem mudou com a saída.
    expect(calls.map((call) => call.url).some((url) => url.includes('/api/characters'))).toBe(true);
  });
});
