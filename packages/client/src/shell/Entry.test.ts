import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { Entry, EntryMenuPanel, defaultHuntFor, entryMenuOf, entryReadiness, huntOptionLabel } from './Entry.js';
import type { EntryHunt, EntryOptions } from '../account/api.js';
import { account, INITIAL_ACCOUNT } from '../account/store.js';
import { NO_SERVER_MESSAGE } from '../account/actions.js';

// A tela de entrada (#248, ADR 0029 D7/D8): o design vestido sobre as três fases que a FUN-97
// já tinha. `prerender` roda o componente sem DOM — o `useEffect` de `refresh()` não roda em
// SSR, então nenhum teste aqui bate na rede de verdade.

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(Entry));
  return new Response(prelude).text();
}

beforeEach(() => {
  account.set(() => INITIAL_ACCOUNT);
});

describe('Entry', () => {
  it('checking: só o texto de espera, sem botão (RF-01)', async () => {
    const html = await render();
    expect(html).toContain('Verificando sua sessão');
    expect(html).not.toContain('<button');
  });

  it('anonymous: login sem senha e sem nenhum campo (RF-02)', async () => {
    account.set((state) => ({ ...state, phase: 'anonymous' }));
    const html = await render();
    expect(html).toContain('ENTRAR');
    expect(html).toContain('Criar conta');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('<input');
  });

  it('ready: grade de personagens com vocação colorida e estado traduzido (RF-03)', async () => {
    account.set((state) => ({
      ...state,
      phase: 'ready',
      identity: { accountId: 'a1', email: 'aldric@draconya.gg' },
      characters: [
        { id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'city', sessionId: null },
        { id: 'c2', name: 'Sem Voc', level: 1, xp: 0, gold: 0, vocation: null, state: 'hunt', sessionId: null },
      ],
    }));
    const html = await render();
    expect(html).toContain('Aldric');
    expect(html).toContain('entry-vocation-knight');
    expect(html).toContain('Cavaleiro');
    expect(html).toContain('Lv 12 · na cidade');
    expect(html).toContain('Lv 1 · numa hunt');
    expect(html).toContain('+ NOVO PERSONAGEM');
    expect(html).toContain('Trocar de conta');
  });

  it('ready: personagem sem vocação mostra "—", sem classe de cor (RF-03, caso de borda)', async () => {
    account.set((state) => ({
      ...state,
      phase: 'ready',
      identity: { accountId: 'a1', email: 'aldric@draconya.gg' },
      characters: [
        { id: 'c2', name: 'Sem Voc', level: 1, xp: 0, gold: 0, vocation: null, state: 'hunt', sessionId: null },
      ],
    }));
    const html = await render();
    expect(html).toContain('—');
    expect(html).not.toContain('entry-vocation-');
  });

  it('ready: id de vocação desconhecido mostra o id cru, sem classe de cor (RF-03, caso de borda)', async () => {
    account.set((state) => ({
      ...state,
      phase: 'ready',
      identity: { accountId: 'a1', email: 'aldric@draconya.gg' },
      characters: [
        { id: 'c3', name: 'Novo Voc', level: 1, xp: 0, gold: 0, vocation: 'necromancer', state: 'city', sessionId: null },
      ],
    }));
    const html = await render();
    expect(html).toContain('necromancer');
    expect(html).not.toContain('entry-vocation-necromancer');
  });

  it('erro do servidor em --blood-7, nas duas fases logadas (RF-07)', async () => {
    account.set((state) => ({ ...state, phase: 'anonymous', error: 'Não foi possível falar com o servidor.' }));
    expect(await render()).toContain('class="entry-error"');

    account.set((state) => ({ ...state, phase: 'ready', error: 'Nome inválido: de 2 a 30 letras, espaço, apóstrofo ou hífen.' }));
    expect(await render()).toContain('class="entry-error"');
  });

  it('busy: cartões, o cartão de criar e o botão de entrar ficam desabilitados (RF-08)', async () => {
    account.set((state) => ({
      ...state,
      phase: 'ready',
      busy: true,
      identity: { accountId: 'a1', email: 'aldric@draconya.gg' },
      characters: [
        { id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'city', sessionId: null },
      ],
    }));
    const html = await render();
    // O cartão do personagem, o cartão "+ NOVO PERSONAGEM" e o botão "ENTRAR NO JOGO" são
    // os três `<button disabled` da grade — o botão "Trocar de conta" (`Button` primitivo)
    // não entra nessa contagem porque não desabilita por `busy`.
    const disabledButtons = html.match(/<button[^>]*disabled/g) ?? [];
    expect(disabledButtons.length).toBe(3);
  });
});

describe('entryReadiness (R1-14)', () => {
  it('checking: tom warn e texto "Conectando…"', () => {
    expect(entryReadiness({ phase: 'checking', error: null })).toEqual({
      tone: 'warn',
      label: 'Conectando…',
    });
  });

  it('anonymous ou ready sem erro: tom ok e texto "Pronto para entrar"', () => {
    expect(entryReadiness({ phase: 'anonymous', error: null })).toEqual({
      tone: 'ok',
      label: 'Pronto para entrar',
    });
    expect(entryReadiness({ phase: 'ready', error: null })).toEqual({
      tone: 'ok',
      label: 'Pronto para entrar',
    });
  });

  it('sem resposta do servidor: tom danger; recusa da API: continua ok', () => {
    expect(
      entryReadiness({ phase: 'anonymous', error: NO_SERVER_MESSAGE }),
    ).toEqual({
      tone: 'danger',
      label: 'Sem conexão com o servidor.',
    });
    // O servidor RESPONDEU com uma recusa (nome inválido, limite de personagens, login
    // recusado) — não é falta de conexão. A frase já aparece em `.entry-error`.
    expect(
      entryReadiness({ phase: 'ready', error: 'Nome inválido: de 2 a 30 letras, espaço, apóstrofo ou hífen.' }),
    ).toEqual({
      tone: 'ok',
      label: 'Pronto para entrar',
    });
  });
});

describe('seleção de personagem em duas etapas (R1-16)', () => {
  it('ready com 2 personagens, sem seleção: conta de ◇ = 2, ◆ ausente, sem classe selected, botão ENTRAR NO JOGO disabled', async () => {
    account.set((state) => ({
      ...state,
      phase: 'ready',
      identity: { accountId: 'a1', email: 'aldric@draconya.gg' },
      characters: [
        { id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'city', sessionId: null },
        { id: 'c2', name: 'Sem Voc', level: 1, xp: 0, gold: 0, vocation: null, state: 'hunt', sessionId: null },
      ],
    }));
    const html = await render();
    const hollowMatches = html.match(/◇/g) ?? [];
    const filledMatches = html.match(/◆/g) ?? [];
    expect(hollowMatches.length).toBe(2);
    expect(filledMatches.length).toBe(0);
    expect(html).not.toContain('entry-character-card--selected');
    expect(html).toContain('ENTRAR NO JOGO');
    expect(html).toContain('Selecione um personagem para continuar.');
    const enterButtonMatch = html.match(/<button[^>]*class="[^"]*entry-enter-button[^"]*"[^>]*>/);
    expect(enterButtonMatch).not.toBeNull();
    expect(enterButtonMatch?.[0]).toContain('disabled');
  });

  it('play() só é chamado dentro de CharacterGrid, uma vez por PORTA, e nunca em CharacterCard', async () => {
    // O que se prende: o clique no cartão só SELECIONA. A intenção sai de um botão do rodapé — o único de
    // sempre, ou, com o mundo aberto (#846, OW-23), "Entrar no mundo" e "CAÇAR" (a hunt idle direta). Três
    // chamadas, as três nas props que `CharacterGrid` passa; nenhuma no cartão nem fora da grade.
    const source = await readFile(new URL('./Entry.tsx', import.meta.url), 'utf8');
    const matches = source.match(/void play\(/g) ?? [];
    expect(matches.length).toBe(3);
    const characterCardIndex = source.indexOf('function CharacterCard');
    const createFormIndex = source.indexOf('function CreateForm');
    const characterGridIndex = source.indexOf('function CharacterGrid');
    const entryIndex = source.indexOf('function Entry()');

    expect(characterCardIndex).toBeGreaterThan(-1);
    expect(characterGridIndex).toBeGreaterThan(-1);
    expect(entryIndex).toBeGreaterThan(-1);
    // Nada entre o início do cartão e o do formulário de criação — o corpo do `CharacterCard` — chama `play`
    // (o comentário dele, sim, o menciona: só a CHAMADA conta).
    expect(source.slice(characterCardIndex, createFormIndex)).not.toMatch(/void play\(/);
    for (const match of source.matchAll(/void play\(/g)) {
      expect(match.index).toBeGreaterThan(characterGridIndex);
      expect(match.index).toBeLessThan(entryIndex);
    }
  });
});

describe('o menu de entrada do mundo aberto (OW-23, #846)', () => {
  const hunts: readonly EntryHunt[] = [
    { id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1 },
    { id: 'rotworm-caves', name: 'Rotworm Caves', recommendedLevel: 20 },
    { id: 'dragon-lair', name: 'Dragon Lair', recommendedLevel: 60 },
  ];
  const on: EntryOptions = { openWorld: true, hunts };

  describe('entryMenuOf: quando as duas portas existem', () => {
    it('com o mundo aberto, hunts e um personagem em repouso: o menu, com as hunts do servidor', () => {
      expect(entryMenuOf(on, { sessionId: null })).toEqual({ kind: 'menu', hunts });
    });

    it('sem resposta do servidor (null) ou com a flag desligada: o botão único de sempre', () => {
      // Mutação que mata: mostrar o menu sem checar a flag — "Caçar (idle)" mandaria `entry: { hunt }` a um
      // servidor que o IGNORA e o jogador cairia na Cidade, sem a hunt que escolheu.
      expect(entryMenuOf(null, { sessionId: null })).toEqual({ kind: 'single' });
      expect(entryMenuOf({ openWorld: false, hunts: [] }, { sessionId: null })).toEqual({ kind: 'single' });
      expect(entryMenuOf({ openWorld: false, hunts }, { sessionId: null })).toEqual({ kind: 'single' });
    });

    it('sem nenhuma hunt a oferecer, só há o mundo: botão único', () => {
      expect(entryMenuOf({ openWorld: true, hunts: [] }, { sessionId: null })).toEqual({ kind: 'single' });
    });

    it('quem JÁ tem sessão a reencontra: o `entry` seria ignorado, e o menu prometeria o que o servidor não faz', () => {
      expect(entryMenuOf(on, { sessionId: 's-1' })).toEqual({ kind: 'single' });
    });

    it('sem personagem selecionado não há o que oferecer', () => {
      expect(entryMenuOf(on, undefined)).toEqual({ kind: 'single' });
    });
  });

  describe('defaultHuntFor: a hunt que o seletor já traz marcada', () => {
    it('a de maior level recomendado que o personagem alcança', () => {
      expect(defaultHuntFor(hunts, 25)?.id).toBe('rotworm-caves');
      expect(defaultHuntFor(hunts, 60)?.id).toBe('dragon-lair');
      expect(defaultHuntFor(hunts, 1)?.id).toBe('rat-cellars');
    });

    it('nenhuma ao alcance: a mais fácil, e a ordem do servidor desempata', () => {
      const hard: EntryHunt[] = [
        { id: 'b', name: 'B', recommendedLevel: 50 },
        { id: 'a', name: 'A', recommendedLevel: 30 },
        { id: 'c', name: 'C', recommendedLevel: 30 },
      ];
      expect(defaultHuntFor(hard, 5)?.id).toBe('a');
    });

    it('lista vazia não tem hunt', () => {
      expect(defaultHuntFor([], 10)).toBeNull();
    });
  });

  it('o rótulo do seletor é o nome e o level recomendado, como a lista do jogo', () => {
    expect(huntOptionLabel(hunts[1]!)).toBe('Rotworm Caves · level 20+');
  });

  describe('EntryMenuPanel', () => {
    async function panel(over: { choosingHunt?: boolean; huntId?: string | null; busy?: boolean; level?: number } = {}) {
      const { prelude } = await prerender(createElement(EntryMenuPanel, {
        hunts, level: over.level ?? 25, busy: over.busy ?? false, choosingHunt: over.choosingHunt ?? false,
        huntId: over.huntId ?? null,
        onToggleHunt: () => {}, onPickHunt: () => {}, onWorld: () => {}, onHunt: () => {},
      }));
      return new Response(prelude).text();
    }

    it('oferece "Entrar no mundo" e "Caçar (idle)", e explica a diferença', async () => {
      const html = await panel();
      expect(html).toContain('ENTRAR NO MUNDO');
      expect(html).toContain('CAÇAR (IDLE)');
      expect(html).toContain('exige você presente');
      expect(html).toContain('continua rodando com o navegador fechado');
      // O seletor só abre com "Caçar (idle)".
      expect(html).not.toContain('aria-label="Caçada idle"');
    });

    it('aberta, lista as hunts com o level e marca a que o personagem alcança', async () => {
      const html = await panel({ choosingHunt: true, level: 25 });
      expect(html).toContain('aria-label="Caçada idle"');
      for (const hunt of hunts) expect(html).toContain(huntOptionLabel(hunt));
      expect(html).toMatch(/<option value="rotworm-caves" selected/);
      expect(html).toContain('CAÇAR');
    });

    it('a escolha do jogador vence a que o level sugere', async () => {
      const html = await panel({ choosingHunt: true, level: 25, huntId: 'dragon-lair' });
      expect(html).toMatch(/<option value="dragon-lair" selected/);
    });

    it('ocupado desabilita os botões, para a intenção não sair duas vezes', async () => {
      const html = await panel({ busy: true });
      expect((html.match(/<button[^>]*disabled/g) ?? []).length).toBe(2);
    });
  });

  it('o estado do personagem em repouso e no mundo tem texto, e não sai cru', async () => {
    account.set((state) => ({
      ...state,
      phase: 'ready',
      identity: { accountId: 'a1', email: 'aldric@draconya.gg' },
      characters: [
        { id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'offline', sessionId: null },
        { id: 'c2', name: 'Bruna', level: 30, xp: 0, gold: 0, vocation: 'druid', state: 'world', sessionId: 's-2' },
      ],
    }));
    const html = await render();
    // Mutação que mata: o `STATE_TEXT` de antes — `offline` e `world` saíram como o id cru do estado.
    expect(html).toContain('Lv 12 · em repouso');
    expect(html).toContain('Lv 30 · no mundo');
    expect(html).not.toContain('· offline');
  });

  it('sem o menu carregado a tela é a de sempre: o botão único "ENTRAR NO JOGO"', async () => {
    account.set((state) => ({
      ...state,
      phase: 'ready',
      identity: { accountId: 'a1', email: 'a@d.gg' },
      characters: [{ id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'city', sessionId: null }],
      entryOptions: null,
    }));
    const html = await render();
    expect(html).toContain('ENTRAR NO JOGO');
    expect(html).not.toContain('ENTRAR NO MUNDO');
  });
});
