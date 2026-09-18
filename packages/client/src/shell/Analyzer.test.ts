import { createElement, type ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { Analyzer, Events } from './Analyzer.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { AnalyzerState, Aggregates, Catalogue } from '../state/hud.js';

/** A árvore em HTML, sem DOM, como em `Inventory.test.ts`. */
async function render(element: ReactElement): Promise<string> {
  const { prelude } = await prerender(element);
  return new Response(prelude).text();
}

/** Os agregados de fixture usados pelos testes da janela. Todos os opcionais da FUN-78
    presentes, para o teste "—" desligá-los um a um em vez de partir de um objeto incompleto. */
const aggregates: Aggregates = {
  durationMs: 3_600_000, xpGained: 1_000, goldGained: 500, goldSpent: 200, kills: 10, deaths: 0,
  itemsLooted: 25, suppliesUsed: 4, bestBasicHit: 120, bestSpellHit: 340,
};

/** Monta `hud.analyzer` como uma sessão de hunt ativa, pronta para `<Analyzer open />`. */
function setActiveAnalyzer(overrides: Partial<AnalyzerState> = {}): void {
  hud.set((state) => ({
    ...state,
    analyzer: {
      sessionType: 'hunt', aggregates, notableEvents: [], receivedAtMs: 0, ended: false,
      ...overrides,
    },
  }));
}

const catalogue: Catalogue = {
  hunts: [{ id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1, difficulties: ['cautious'], difficultyDetails: [], outfitIds: [], lootDrops: 0, monsters: [], loot: [] }],
  monsters: [{ id: 'rat', name: 'Rato' }],
  ammunition: [], vocations: [], vocationLevel: 8,
  bot: {
    vocabularyVersion: 1, slots: {},
    spells: [], supplies: [{ id: 'mana-potion', name: 'Poção de Mana', price: 50, effect: 'mana', requires: {} }],
  },
  items: [],
  bestiary: { milestones: [10_000], xpBonusPercentPerMilestone: 1 },
};

const events = [
  { atMs: 0, type: 'entered-hunt', detail: 'rat-cellars/cautious' },
  { atMs: 1_000, type: 'supply-unaffordable', detail: 'mana-potion' },
  { atMs: 2_000, type: 'bestiary-milestone', detail: 'rat/1' },
];

beforeEach(() => { hud.set(() => INITIAL_HUD); });

describe('os eventos notáveis com os nomes do CATÁLOGO (FUN-110, FUN-113)', () => {
  it('hunt, supply e monstro saem com nome, e o marco com o bônus do catálogo', async () => {
    // Mutação que mata: apagar `monsters`, `supplies`, `hunts` ou `percentPerMilestone` da
    // montagem de `names` em `Events` — o evento sairia com o id cru.
    hud.set((state) => ({ ...state, catalogue }));
    const html = await render(createElement(Events, { events }));
    expect(html).toContain('Entrou em Rat Cellars · Cauteloso');
    expect(html).toContain('Gold acabou para Poção de Mana');
    expect(html).toContain('Bestiário: Rato · marco 1 (+1 % XP)');
  });

  it('sem catálogo os ids ficam no lugar dos nomes, e o marco sai sem bônus', async () => {
    const html = await render(createElement(Events, { events }));
    expect(html).toContain('Entrou em rat-cellars · Cauteloso');
    expect(html).toContain('Bestiário: rat · marco 1');
    expect(html).not.toContain('% XP');
  });
});

// #315: o analisador é `FloatingWindow` (RF-01), com duas caixas "Sessão"/"Por hora"
// (RF-02/RF-03), "—" para campo opcional ausente (RF-04), e nada fora de sessão (RF-06).

describe('Analyzer — caixa "Sessão" (RF-02)', () => {
  it('mostra as dez linhas fixas, com os valores batendo com `Aggregates`', async () => {
    setActiveAnalyzer();
    const html = await render(createElement(Analyzer, { open: true }));
    // Mutação que mata: trocar um `Line label=".." value={aggregates.X}` por outro campo, ou
    // esquecer um deles — cada par rótulo/valor é conferido junto, não a lista de rótulos.
    expect(html).toContain('<span>Tempo</span><b>1 h 0 min</b>');
    expect(html).toContain('<span>XP</span><b>1.000</b>');
    expect(html).toContain('<span>Gold</span><b>500 gp</b>');
    expect(html).toContain('<span>Gastos</span><b>200 gp</b>');
    expect(html).toContain('<span>Saldo</span><b>300 gp</b>'); // goldGained - goldSpent
    expect(html).toContain('<span>Mortos</span><b>10</b>');
    expect(html).toContain('<span>Loot</span><b>25</b>');
    expect(html).toContain('<span>Supplies</span><b>4</b>');
    expect(html).toContain('<span>Maior golpe</span><b>120</b>');
    expect(html).toContain('<span>Maior magia</span><b>340</b>');
  });

  it('"Mortes" só aparece com `deaths > 0`, com a classe de perigo (DT-05)', async () => {
    setActiveAnalyzer();
    const zero = await render(createElement(Analyzer, { open: true }));
    expect(zero).not.toContain('Mortes');
    expect(zero).not.toContain('analyzer-line-danger');

    setActiveAnalyzer({ aggregates: { ...aggregates, deaths: 2 } });
    const withDeaths = await render(createElement(Analyzer, { open: true }));
    expect(withDeaths).toContain('<span>Mortes</span><b>2</b>');
    expect(withDeaths).toContain('analyzer-line-danger');
  });

  it('campo opcional ausente mostra "—", nunca "0" (regressão FUN-78)', async () => {
    setActiveAnalyzer({
      aggregates: {
        ...aggregates,
        itemsLooted: undefined,
        suppliesUsed: undefined,
        bestBasicHit: undefined,
        bestSpellHit: undefined,
      },
    });
    const html = await render(createElement(Analyzer, { open: true }));
    expect(html).toContain('<span>Loot</span><b>—</b>');
    expect(html).toContain('<span>Supplies</span><b>—</b>');
    expect(html).toContain('<span>Maior golpe</span><b>—</b>');
    expect(html).toContain('<span>Maior magia</span><b>—</b>');
    expect(html).not.toMatch(/Loot<\/span><b>0</);
    expect(html).not.toMatch(/Supplies<\/span><b>0</);
  });
});

describe('Analyzer — caixa "Por hora" (RF-03)', () => {
  it('mostra só as cinco linhas que já tinham taxa, com `perHour`', async () => {
    // `durationMs: 3_600_000` (1 h exata): a taxa bate com o valor absoluto, o que prova que é
    // `perHour(valor, elapsedMs)` e não o valor cru repetido com "/h" colado.
    setActiveAnalyzer();
    const html = await render(createElement(Analyzer, { open: true }));
    expect(html).toContain('<span>XP</span><b>1.000/h</b>');
    expect(html).toContain('<span>Gold</span><b>500 gp/h</b>');
    expect(html).toContain('<span>Gastos</span><b>200 gp/h</b>');
    expect(html).toContain('<span>Saldo</span><b>300 gp/h</b>');
    expect(html).toContain('<span>Mortos</span><b>10/h</b>');
    // Loot, Supplies, Maior golpe e Maior magia nunca tiveram taxa — "Loot/h" nunca existiu.
    expect(html).not.toContain('Loot/h');
    expect(html).not.toContain('Supplies/h');
    expect(html).not.toContain('golpe/h');
    expect(html).not.toContain('magia/h');
  });
});

describe('Analyzer — janela flutuante (#315, RF-01..RF-06)', () => {
  it('nasce como FloatingWindow na posição do kit corrigida pelo topo, com o botão de expandir', async () => {
    setActiveAnalyzer();
    const html = await render(createElement(Analyzer, { open: true }));

    // RF-02/DT-02: o `y:12` do kit somado à altura do topo (65) dá 77.
    expect(html).toContain('left:250px');
    expect(html).toContain('top:77px');
    // RF-01: a raiz é a FloatingWindow, não um `Panel dock`.
    expect(html).toContain('floating-window');
    expect(html).not.toContain('ui-panel--collapsed');
    // RF-06: a ação abre o modal expandido.
    expect(html).toContain('title="Abrir completo"');
  });

  it('o cabeçalho mostra "Sessão hh:mm:ss" e nunca "Próximo level" (RF-04, RF-05)', async () => {
    setActiveAnalyzer({ aggregates: { ...aggregates, durationMs: 253_000 }, ended: true });
    const html = await render(createElement(Analyzer, { open: true }));

    expect(html).toContain('Sessão 00:04:13');
    expect(html).not.toContain('Próximo level');
  });

  it('fechada (sem `forceOpen`, sessão não terminada) o HTML é vazio (RF-03)', async () => {
    setActiveAnalyzer();
    expect(await render(createElement(Analyzer, { open: false }))).toBe('');
  });

  it('sem sessão (`aggregates: null`) ou na Cidade, o HTML é vazio mesmo aberta', async () => {
    setActiveAnalyzer({ aggregates: null });
    expect(await render(createElement(Analyzer, { open: true }))).toBe('');

    setActiveAnalyzer({ sessionType: 'city' });
    expect(await render(createElement(Analyzer, { open: true }))).toBe('');
  });
});
