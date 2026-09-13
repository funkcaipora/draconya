import { createElement, type ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { Bestiary, BestiaryBody } from './Bestiary.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { BestiaryConfig, Catalogue } from '../state/hud.js';

/**
 * A árvore em HTML, sem DOM, como em `Inventory.test.ts`: `prerender` roda a função do
 * componente e pula os efeitos. É `react-dom/static`, e não `react-dom/server`, por causa do
 * lint de fronteira: o glob `server` casa com o subpath do React também.
 */
async function render(element: ReactElement): Promise<string> {
  const { prelude } = await prerender(element);
  return new Response(prelude).text();
}

const config: BestiaryConfig = {
  milestones: [10_000, 25_000, 50_000, 100_000, 200_000],
  xpBonusPercentPerMilestone: 1,
};

const rat = { id: 'rat', name: 'Rat' };
const monsters = [rat, { id: 'bat', name: 'Bat' }];

const catalogue = (over: Partial<Catalogue> = {}): Catalogue => ({
  hunts: [],
  monsters,
  ammunition: [], vocations: [], vocationLevel: 8,
  bot: {
    vocabularyVersion: 1, advancedFromLevel: 50, slots: {},
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [], supplies: [],
  },
  items: [],
  bestiary: config,
  ...over,
});

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
});

describe('o corpo do Bestiário (FUN-113)', () => {
  it('lista cada monstro do catálogo com a contagem, o próximo marco e os marcos', async () => {
    // É o aceite da issue: "o painel lista o rato com a contagem e o próximo marco". O
    // morcego não tem entrada no contador, e isso é ZERO — o `sim` não grava zero.
    const html = await render(createElement(BestiaryBody, {
      monsters, counts: { rat: 1_234 }, config,
    }));

    expect(html).toContain('Rat');
    expect(html).toContain('1.234');
    expect(html).toContain('próximo marco 10.000');
    expect(html).toContain('marcos 0/5');
    expect(html).toContain('Bat');
    expect(html).toContain('>0<');
    expect(html).toContain('Bônus de XP PvE: +0 %');
  });

  it('no marco, o bônus é GLOBAL e o próximo é o seguinte', async () => {
    // Um marco no rato e dois no morcego são +3 % — em qualquer monstro (DT-01). Mutação que
    // mata: somar só os marcos do monstro da linha, ou só os do primeiro.
    const html = await render(createElement(BestiaryBody, {
      monsters, counts: { rat: 10_000, bat: 25_000 }, config,
    }));

    expect(html).toContain('Bônus de XP PvE: +3 %');
    expect(html).toContain('marcos 1/5');
    expect(html).toContain('próximo marco 25.000');
    expect(html).toContain('marcos 2/5');
    expect(html).toContain('próximo marco 50.000');
  });

  it('depois do último marco, o próximo é "—"', async () => {
    const html = await render(createElement(BestiaryBody, {
      monsters: [rat], counts: { rat: 200_000 }, config,
    }));

    expect(html).toContain('próximo marco —');
    expect(html).toContain('marcos 5/5');
  });

  it('sem marcos no catálogo mostra só a contagem — "—", e não "0/0"', async () => {
    // Servidor sem Bestiário configurado: zero marcos é uma afirmação, e ele não a fez.
    const html = await render(createElement(BestiaryBody, {
      monsters: [rat], counts: { rat: 50_000 }, config: null,
    }));

    expect(html).toContain('50.000');
    expect(html).toContain('próximo marco —');
    expect(html).toContain('marcos —');
    expect(html).not.toContain('Bônus');
  });
});

describe('a janela do Bestiário (FUN-113)', () => {
  it('sem catálogo diz que carrega; num servidor sem monstros, que não há Bestiário', async () => {
    // A janela existe sempre que a barra do topo a abriu (FUN-115) — sumir deixava o botão
    // aceso sem nada acontecer. Um nó anterior à FUN-113 manda o catálogo sem monstros e nunca
    // manda `bestiary`: uma lista vazia com "+0 %" afirmaria um Bestiário que ele não tem, e a
    // frase não.
    const loading = await render(createElement(Bestiary));
    expect(loading).toContain('Bestiário');
    expect(loading).toContain('Carregando…');

    hud.set((state) => ({ ...state, catalogue: catalogue({ monsters: [] }) }));
    const absent = await render(createElement(Bestiary));
    expect(absent).toContain('Este servidor não tem Bestiário.');
    expect(absent).not.toContain('Bônus');
    expect(absent).not.toContain('próximo marco');
  });

  it('nasce aberta, com o bônus na primeira linha do corpo (FUN-115)', async () => {
    // Quem decide se a janela EXISTE é a barra do topo; uma janela que abre minimizada é uma
    // janela que abre vazia. Aberta, o bônus é a primeira linha do corpo e o cabeçalho não o
    // repete — dizer o mesmo número duas vezes na mesma janela.
    hud.set((state) => ({ ...state, catalogue: catalogue(), bestiary: { rat: 25_000 } }));
    const html = await render(createElement(Bestiary));

    expect(html).toContain('Bestiário');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Bônus de XP PvE: +2 %');
    expect(html).not.toContain('+2 % XP');
    expect(html).toContain('próximo marco');
  });

  it('antes do primeiro `bestiary` a contagem vale ZERO: com marcos, o bônus diz +0 %', async () => {
    // O attach ainda está em voo e o mapa não chegou: a tela não pode inventar contagem, mas
    // também não pode sumir com o bônus — e zero é a resposta certa para os dois. Mutação
    // que mata: `bonus` virar `null` sempre que `counts` for `null`.
    hud.set((state) => ({ ...state, catalogue: catalogue(), bestiary: null }));
    const html = await render(createElement(Bestiary));

    expect(html).toContain('Bestiário');
    expect(html).toContain('Bônus de XP PvE: +0 %');
  });

  it('sem marcos no catálogo a janela fica sem bônus — não há o que calcular', async () => {
    // A chave AUSENTE, como `apply.ts` a deixa quando o servidor não mandou.
    const { bestiary: _absent, ...withoutMilestones } = catalogue();
    hud.set((state) => ({ ...state, catalogue: withoutMilestones as Catalogue }));
    const html = await render(createElement(Bestiary));

    expect(html).toContain('Bestiário');
    expect(html).not.toContain('Bônus');
  });
});
