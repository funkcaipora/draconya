import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { TrainingModal } from './TrainingModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue, ItemDefinition, TrainingRegister, TrainingRules } from '../state/hud.js';

// O Treino (#631, ADR 0059). `prerender` roda sem DOM e sem eventos — um clique real não dispara —,
// então o que se prova aqui é o que a tela MOSTRA para cada estado do servidor; a decisão de cada
// clique é função pura em `training-view.ts`, e a fiação prova-se por inspeção do código-fonte.

const HOUR = 3_600_000;

const rules: TrainingRules = {
  perCharge: { tries: 7, manaSpent: 600 },
  bankCapMs: 12 * HOUR, graceMs: 600_000,
  spendCapMs: { free: 6 * HOUR, premium: 12 * HOUR },
  offlineSkills: [
    { skillId: 'sword', name: 'Espada', kind: 'attacks' },
    { skillId: 'magic', name: 'Magic Level', kind: 'mana' },
  ],
};
const weapon = (id: string, name: string, skillId: string, charges: number, buyPrice: number): ItemDefinition => ({
  id, name, appearanceId: 100, weight: 10, slot: null, twoHanded: false, exercise: { skillId, charges }, buyPrice,
});
const items: ItemDefinition[] = [
  weapon('exercise-sword', 'exercise sword', 'sword', 500, 347_222),
  weapon('exercise-rod', 'exercise rod', 'magic', 500, 347_222),
];
const catalogue = (over: Partial<Catalogue> = {}): Catalogue => ({
  hunts: [], monsters: [], ammunition: [], vocations: [], charms: [], vocationLevel: 8,
  bot: { vocabularyVersion: 1, slots: {}, spells: [], supplies: [] },
  items, training: rules,
  ...over,
} as unknown as Catalogue);

const register = (over: Partial<TrainingRegister> = {}): TrainingRegister => ({
  offlineBankMs: 3 * HOUR + 20 * 60_000, offlineSkill: 'sword',
  weapons: [{ instanceId: 'w1', itemId: 'exercise-sword', charges: 431 }], activeInstanceId: null, ...over,
});

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(TrainingModal, { onClose: () => {} }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
});

describe('TrainingModal (#631)', () => {
  it('sem catálogo diz que carrega; com catálogo sem Treino diz que o servidor não tem', async () => {
    expect(await render()).toContain('Carregando');
    hud.set((state) => ({ ...state, catalogue: catalogue({ training: undefined as never }) }));
    expect(await render()).toContain('Este servidor não tem Treino.');
  });

  it('mostra o banco de offline training, o livro com a skill escolhida e os tetos', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue(), training: register() }));
    const html = await render();
    expect(html).toContain('Banco: 3 h 20 min de 12 h');
    // 3 h 20 min de 12 h: a barra enche ~28%.
    expect(html).toContain('width:28%');
    expect(html).toContain('Skill do livro');
    // O livro é o do CONTEÚDO — Espada e Magic Level —, com a escolha atual marcada.
    expect(html).toMatch(/<option value="sword" selected="">Espada<\/option>|<option value="sword"[^>]*selected/);
    expect(html).toContain('Magic Level');
    expect(html).toContain('Nenhuma');
    expect(html).toContain('Carência de 10 min fora');
    expect(html).toContain('6 h (Free)');
    expect(html).toContain('12 h (Premium)');
  });

  it('lista as armas carregadas com as cargas RESTANTES, o que rendem e o botão de treinar', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue(), training: register() }));
    const html = await render();
    expect(html).toContain('Suas exercise weapons');
    expect(html).toContain('431/500 cargas');
    // 431 cargas × 7 tries = 3.017 tries.
    expect(html).toContain('Rende 3.017 tries');
    expect(html).toContain('Treinar');
  });

  it('sem nenhuma arma carregada, diz isso em vez de uma lista vazia', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue(), training: register({ weapons: [] }) }));
    const html = await render();
    expect(html).toContain('Você não carrega nenhuma exercise weapon.');
    expect(html).not.toContain('Treinar');
  });

  it('a loja mostra o preço e a mana gasta do rod, e desabilita o que o gold não cobre', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue(), training: register(), gold: 347_222 }));
    let html = await render();
    expect(html).toContain('Loja de exercise weapons');
    expect(html).toContain('347.222 gold');
    // O rod treina o magic level: rende mana gasta (500 × 600), não tries.
    expect(html).toContain('300.000 de mana gasta');
    expect(html).not.toContain('Gold insuficiente');

    hud.set((state) => ({ ...state, gold: 100 }));
    html = await render();
    expect(html).toContain('Gold insuficiente');
    expect(html).toContain('disabled');
  });

  it('a fiação: cada botão manda a intenção certa, e treinar fecha o modal', async () => {
    const source = await readFile(new URL('./TrainingModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('attemptTrainingIntent(enterTrainingMessage(weapon.instanceId), sendIntent, onClose)');
    expect(source).toContain('attemptTrainingIntent(buyItemMessage(weapon.itemId), sendIntent)');
    expect(source).toContain("attemptTrainingIntent(offlineSkillMessage(value === '' ? null : value), sendIntent)");
  });
});
