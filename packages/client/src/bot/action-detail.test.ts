import { describe, expect, it } from 'vitest';
import type { Combat } from '@draconya/content';
import {
  ACTION_TABS, actionDetail, actionTab, entriesOf, requiredLevel,
} from './action-detail.js';
import type { ActionEntry, DetailContext, SpellEntry } from './action-detail.js';
import type { Catalogue, SupplyDefinition } from '../state/hud.js';

// A tabela da spec de #435 §6, uma linha um `it` (#437). `actionDetail` é PURO: nenhum destes
// testes toca React nem store — o que se prende é a formatação, não a tela.

const SPELL_POWER: Combat['spellPower'] = { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 };

function spell(over: Partial<SpellEntry> & { id: string; name: string }): SpellEntry {
  return {
    manaCost: 0, minLevel: 1, vocationId: null, effect: 'heal', group: 'attack', ...over,
  };
}

function supply(over: Partial<SupplyDefinition> & { id: string; name: string }): SupplyDefinition {
  return {
    price: 0, effect: 'heal', group: 'potion', requires: {}, ...over,
  };
}

const context = (over: Partial<DetailContext> = {}): DetailContext => ({
  level: 8, magicLevel: 0, spellPower: SPELL_POWER, ...over,
});

describe('actionDetail — a tabela da spec §6', () => {
  it('heal com basePower converte a faixa pela fórmula do content (50~69, BP 40/lv 8/ML 0)', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'light-healing', name: 'Light Healing', manaCost: 70, cooldownMs: 1000,
        effect: 'heal', detail: { basePower: 40 },
      }),
    };
    const detail = actionDetail(entry, context());
    expect(detail.rows).toEqual([
      { label: 'Tipo', value: 'Cura' },
      { label: 'Área', value: 'Single' },
      { label: 'Cura', value: '50~69' },
      { label: 'Custo', value: '70 mana' },
      { label: 'Cooldown', value: '1s' },
    ]);
  });

  it('heal com amount fixo (poção) mostra o número cru, sem faixa', () => {
    const entry: ActionEntry = {
      kind: 'supply',
      supply: supply({
        id: 'health-potion', name: 'Health Potion', price: 45, groupCooldownMs: 1000,
        effect: 'heal', detail: { amount: 150 },
      }),
    };
    const detail = actionDetail(entry, context());
    expect(detail.rows).toEqual([
      { label: 'Tipo', value: 'Cura' },
      { label: 'Área', value: 'Single' },
      { label: 'Cura', value: '150' },
      { label: 'Custo', value: '45 gold' },
      { label: 'Cooldown', value: '1s' },
    ]);
  });

  it('heal com amountRange (a poção do Tibia) mostra min~max, sem passar por spellPowerRange (#524)', () => {
    const entry: ActionEntry = {
      kind: 'supply',
      supply: supply({
        id: 'strong-health-potion', name: 'Strong Health Potion', price: 115, groupCooldownMs: 1000,
        effect: 'heal', detail: { amountRange: { min: 250, max: 350 } },
      }),
    };
    const detail = actionDetail(entry, context());
    expect(detail.rows).toEqual([
      { label: 'Tipo', value: 'Cura' },
      { label: 'Área', value: 'Single' },
      { label: 'Cura', value: '250~350' },
      { label: 'Custo', value: '115 gold' },
      { label: 'Cooldown', value: '1s' },
    ]);
  });

  it('mana com amountRange mostra min~max', () => {
    const entry: ActionEntry = {
      kind: 'supply',
      supply: supply({
        id: 'strong-mana-potion', name: 'Strong Mana Potion', price: 150, groupCooldownMs: 1000,
        effect: 'mana', detail: { amountRange: { min: 115, max: 185 } },
      }),
    };
    const detail = actionDetail(entry, context());
    expect(detail.rows).toEqual([
      { label: 'Tipo', value: 'Mana' },
      { label: 'Área', value: 'Single' },
      { label: 'Mana', value: '115~185' },
      { label: 'Custo', value: '150 gold' },
      { label: 'Cooldown', value: '1s' },
    ]);
  });

  it('a poção de espírito mostra Cura E Mana, duas linhas do mesmo uso (`alsoMana`, #524)', () => {
    const entry: ActionEntry = {
      kind: 'supply',
      supply: supply({
        id: 'great-spirit-potion', name: 'Great Spirit Potion', price: 225, groupCooldownMs: 1000,
        effect: 'heal',
        detail: {
          amountRange: { min: 250, max: 350 },
          alsoMana: { amountRange: { min: 100, max: 200 } },
        },
      }),
    };
    const detail = actionDetail(entry, context());
    expect(detail.rows).toEqual([
      { label: 'Tipo', value: 'Cura' },
      { label: 'Área', value: 'Single' },
      { label: 'Cura', value: '250~350' },
      { label: 'Mana', value: '100~200' },
      { label: 'Custo', value: '225 gold' },
      { label: 'Cooldown', value: '1s' },
    ]);
  });

  it('`alsoMana` com amount fixo (não faixa) também mostra a linha Mana', () => {
    const entry: ActionEntry = {
      kind: 'supply',
      supply: supply({
        id: 'fixed-spirit', name: 'Fixed Spirit', price: 1, groupCooldownMs: 1000,
        effect: 'heal', detail: { amount: 300, alsoMana: { amount: 150 } },
      }),
    };
    const detail = actionDetail(entry, context());
    expect(detail.rows).toContainEqual({ label: 'Mana', value: '150' });
  });

  it('mana com amount fixo', () => {
    const entry: ActionEntry = {
      kind: 'supply',
      supply: supply({
        id: 'mana-potion', name: 'Mana Potion', price: 20, groupCooldownMs: 1000,
        effect: 'mana', detail: { amount: 100 },
      }),
    };
    const detail = actionDetail(entry, context());
    expect(detail.rows).toEqual([
      { label: 'Tipo', value: 'Mana' },
      { label: 'Área', value: 'Single' },
      { label: 'Mana', value: '100' },
      { label: 'Custo', value: '20 gold' },
      { label: 'Cooldown', value: '1s' },
    ]);
  });

  it('damage com basePower, range e tipo de dano', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'ice-wave', name: 'Ice Wave', manaCost: 40, cooldownMs: 2000,
        effect: 'damage', detail: { basePower: 45, range: 3, damageType: 'ice' },
      }),
    };
    const detail = actionDetail(entry, context());
    expect(detail.rows).toEqual([
      { label: 'Tipo', value: 'Dano' },
      { label: 'Área', value: 'Single' },
      { label: 'Tipo de dano', value: 'Gelo' },
      { label: 'Dano', value: '56~77' },
      { label: 'Custo', value: '40 mana' },
      { label: 'Cooldown', value: '2s' },
    ]);
  });

  it('área circle r=1 vira 3x3', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'fireball', name: 'Fireball', effect: 'damage',
        detail: { basePower: 10, area: { shape: 'circle', radius: 1, centered: 'target' } },
      }),
    };
    expect(actionDetail(entry, context()).rows).toContainEqual({ label: 'Área', value: '3x3' });
  });

  it('runa com área circle r=3 (7x7), tipo de dano e custo em gold', () => {
    const entry: ActionEntry = {
      kind: 'supply',
      supply: supply({
        id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, groupCooldownMs: 2000,
        effect: 'damage',
        detail: {
          basePower: 60, range: 4, damageType: 'ice',
          area: { shape: 'circle', radius: 3, centered: 'target' },
        },
      }),
    };
    const detail = actionDetail(entry, context());
    expect(detail.rows).toEqual([
      { label: 'Tipo', value: 'Dano' },
      { label: 'Área', value: '7x7' },
      { label: 'Tipo de dano', value: 'Gelo' },
      { label: 'Dano', value: '75~103' },
      { label: 'Custo', value: '14 gold' },
      { label: 'Cooldown', value: '2s' },
    ]);
  });

  it('área wave vira "Onda N"', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'great-fireball', name: 'Great Fireball', effect: 'damage',
        detail: { basePower: 10, area: { shape: 'wave', length: 5 } },
      }),
    };
    expect(actionDetail(entry, context()).rows).toContainEqual({ label: 'Área', value: 'Onda 5' });
  });

  it('área beam vira "Feixe N"', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'divine-missile', name: 'Divine Missile', effect: 'damage',
        detail: { basePower: 10, area: { shape: 'beam', length: 8 } },
      }),
    };
    expect(actionDetail(entry, context()).rows).toContainEqual({ label: 'Área', value: 'Feixe 8' });
  });

  it('área cleave vira "Frontal 3"', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'exura-vis', name: 'Exura Vis', effect: 'damage',
        detail: { basePower: 10, area: { shape: 'cleave' } },
      }),
    };
    expect(actionDetail(entry, context()).rows).toContainEqual({ label: 'Área', value: 'Frontal 3' });
  });

  it('damage-over-time mostra "N a cada Xs por Ys"', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'poison-field', name: 'Poison Field', effect: 'damage-over-time',
        detail: { amount: 20, intervalMs: 2000, durationMs: 10_000 },
      }),
    };
    expect(actionDetail(entry, context()).rows).toContainEqual(
      { label: 'Dano', value: '20 a cada 2s por 10s' },
    );
  });

  it('heal-over-time mostra a mesma forma, rotulada Cura', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'recovery', name: 'Recovery', effect: 'heal-over-time',
        detail: { amount: 20, intervalMs: 2000, durationMs: 10_000 },
      }),
    };
    expect(actionDetail(entry, context()).rows).toContainEqual(
      { label: 'Cura', value: '20 a cada 2s por 10s' },
    );
  });

  it('haste mostra Efeito "Velocidade +N% por Ys", vírgula em segundos fracionários', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'haste', name: 'Haste', effect: 'haste',
        detail: { speedPercent: 30, durationMs: 33_000 },
      }),
    };
    expect(actionDetail(entry, context()).rows).toContainEqual(
      { label: 'Efeito', value: 'Velocidade +30% por 33s' },
    );
  });

  it('buff mostra Efeito "Postura por Ns"', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({ id: 'protector', name: 'Protector', effect: 'buff', detail: { durationMs: 1500 } }),
    };
    expect(actionDetail(entry, context()).rows).toContainEqual(
      { label: 'Efeito', value: 'Postura por 1,5s' },
    );
  });

  it('mana-shield mostra Efeito "Escudo de mana por Ns"', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'mana-shield', name: 'Mana Shield', effect: 'mana-shield', detail: { durationMs: 60_000 },
      }),
    };
    expect(actionDetail(entry, context()).rows).toContainEqual(
      { label: 'Efeito', value: 'Escudo de mana por 60s' },
    );
  });

  it('sem detail (nó antigo): Tipo pelo effect cru; Área, Tipo de dano e valor OMITIDOS', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({ id: 'unknown-spell', name: 'Unknown', effect: 'haste' }),
    };
    const detail = actionDetail(entry, context());
    expect(detail.rows).toEqual([
      { label: 'Tipo', value: 'Suporte' },
      { label: 'Custo', value: '0 mana' },
    ]);
  });

  it('cooldown OMITIDO sem cooldownMs, mesmo com detail presente', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({ id: 'no-cooldown', name: 'No Cooldown', effect: 'heal', detail: { amount: 10 } }),
    };
    expect(actionDetail(entry, context()).rows.some((row) => row.label === 'Cooldown')).toBe(false);
  });

  it('basePower sem spellPower no contexto: só a linha de valor some, o resto continua', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'light-healing', name: 'Light Healing', manaCost: 70, cooldownMs: 1000,
        effect: 'heal', detail: { basePower: 40 },
      }),
    };
    const detail = actionDetail(entry, context({ spellPower: undefined }));
    expect(detail.rows).toEqual([
      { label: 'Tipo', value: 'Cura' },
      { label: 'Área', value: 'Single' },
      { label: 'Custo', value: '70 mana' },
      { label: 'Cooldown', value: '1s' },
    ]);
  });

  it('cooldownMs sem group nem groupCooldownMs mostra só o próprio', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'utamo-vita', name: 'Utamo Vita', effect: 'mana-shield',
        cooldownMs: 2000, detail: { durationMs: 60_000 },
      }),
    };
    expect(actionDetail(entry, context()).rows).toContainEqual({ label: 'Cooldown', value: '2s' });
  });

  it('cooldownMs igual a groupCooldownMs NÃO soma o sufixo do grupo (correção de revisão)', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'exori', name: 'Exori', effect: 'damage', group: 'attack',
        cooldownMs: 2000, groupCooldownMs: 2000, detail: { basePower: 10 },
      }),
    };
    expect(actionDetail(entry, context()).rows).toContainEqual({ label: 'Cooldown', value: '2s' });
  });

  it('cooldownMs com group e groupCooldownMs soma o sufixo do grupo', () => {
    const entry: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'heal-friend', name: 'Heal Friend', effect: 'heal', group: 'healing',
        cooldownMs: 1000, groupCooldownMs: 2000, detail: { amount: 30 },
      }),
    };
    expect(actionDetail(entry, context()).rows).toContainEqual(
      { label: 'Cooldown', value: '1s · grupo cura 2s' },
    );
  });

  it('description do catálogo é usada quando presente; senão cai no fallback fixo por Tipo', () => {
    const withDescription: ActionEntry = {
      kind: 'spell',
      spell: spell({
        id: 'haste', name: 'Haste', effect: 'haste', description: 'Aumenta a velocidade.',
        detail: { speedPercent: 30, durationMs: 33_000 },
      }),
    };
    expect(actionDetail(withDescription, context()).description).toBe('Aumenta a velocidade.');

    const heal: ActionEntry = { kind: 'spell', spell: spell({ id: 'heal', name: 'Heal', effect: 'heal' }) };
    const mana: ActionEntry = {
      kind: 'supply', supply: supply({ id: 'mana', name: 'Mana', effect: 'mana' }),
    };
    const damage: ActionEntry = { kind: 'spell', spell: spell({ id: 'dmg', name: 'Dmg', effect: 'damage' }) };
    const support: ActionEntry = { kind: 'spell', spell: spell({ id: 'buff', name: 'Buff', effect: 'buff' }) };
    expect(actionDetail(heal, context()).description).toBe('Recupera pontos de vida.');
    expect(actionDetail(mana, context()).description).toBe('Recupera pontos de mana.');
    expect(actionDetail(damage, context()).description).toBe('Causa dano ao alvo.');
    expect(actionDetail(support, context()).description).toBe('Aplica um efeito temporário.');
  });

  it('requirement: "Lv. X+" para magia; "Lv. X+ · ML Y+" quando o suprimento exige magic level', () => {
    const spellEntry: ActionEntry = { kind: 'spell', spell: spell({ id: 's', name: 'S', minLevel: 14 }) };
    expect(actionDetail(spellEntry, context()).requirement).toBe('Lv. 14+');

    const supplyEntry: ActionEntry = {
      kind: 'supply',
      supply: supply({ id: 'r', name: 'R', requires: { level: 30, magicLevel: 4 } }),
    };
    expect(actionDetail(supplyEntry, context()).requirement).toBe('Lv. 30+ · ML 4+');

    const noRequires: ActionEntry = { kind: 'supply', supply: supply({ id: 'p', name: 'P' }) };
    expect(actionDetail(noRequires, context()).requirement).toBe('Lv. 1+');
  });
});

describe('actionTab — as três abas (RF-03)', () => {
  it('magia é sempre Magias', () => {
    const entry: ActionEntry = { kind: 'spell', spell: spell({ id: 's', name: 'S' }) };
    expect(actionTab(entry)).toBe('Magias');
  });

  it('suprimento de ataque é Runas; o resto é Itens', () => {
    const rune: ActionEntry = { kind: 'supply', supply: supply({ id: 'r', name: 'R', group: 'attack' }) };
    const potion: ActionEntry = { kind: 'supply', supply: supply({ id: 'p', name: 'P', group: 'potion' }) };
    expect(actionTab(rune)).toBe('Runas');
    expect(actionTab(potion)).toBe('Itens');
  });

  it('ACTION_TABS é a ordem fixa da imagem', () => {
    expect(ACTION_TABS).toEqual(['Magias', 'Runas', 'Itens']);
  });
});

describe('entriesOf — por level exigido e depois por nome', () => {
  const catalogue: Catalogue = {
    hunts: [], monsters: [], ammunition: [], vocations: [], vocationLevel: 0, items: [],
    bot: {
      vocabularyVersion: 2,
      spells: [
        spell({ id: 'b', name: 'Beta', minLevel: 20 }),
        spell({ id: 'a', name: 'Alpha', minLevel: 10 }),
        spell({ id: 'c', name: 'Charlie', minLevel: 10 }),
      ],
      supplies: [
        supply({ id: 'rune', name: 'Rune', group: 'attack' }),
        supply({ id: 'potion', name: 'Potion', group: 'potion' }),
      ],
    },
  };

  it('ordena por minLevel e depois por nome', () => {
    const entries = entriesOf(catalogue, 'Magias');
    expect(entries.map((entry) => (entry.kind === 'spell' ? entry.spell.id : entry.supply.id)))
      .toEqual(['a', 'c', 'b']);
    expect(entries.map(requiredLevel)).toEqual([10, 10, 20]);
  });

  it('Runas só traz supply de group attack; Itens traz o resto', () => {
    expect(entriesOf(catalogue, 'Runas').map((entry) => (entry.kind === 'supply' ? entry.supply.id : null)))
      .toEqual(['rune']);
    expect(entriesOf(catalogue, 'Itens').map((entry) => (entry.kind === 'supply' ? entry.supply.id : null)))
      .toEqual(['potion']);
  });

  it('filtra magias por vocationId e preserva magias universais (vocationId null)', () => {
    const vocCatalogue: Catalogue = {
      ...catalogue,
      bot: {
        ...catalogue.bot,
        spells: [
          spell({ id: 'universal', name: 'Universal', minLevel: 1, vocationId: null }),
          spell({ id: 'haste-knight', name: 'Haste', minLevel: 14, vocationId: 'knight' }),
          spell({ id: 'haste-sorcerer', name: 'Haste', minLevel: 14, vocationId: 'sorcerer' }),
          spell({ id: 'buzz', name: 'Buzz', minLevel: 1, vocationId: 'sorcerer' }),
        ],
      },
    };

    const knightEntries = entriesOf(vocCatalogue, 'Magias', 'knight');
    expect(knightEntries.map((e) => (e.kind === 'spell' ? e.spell.id : null)))
      .toEqual(['universal', 'haste-knight']);

    const sorcererEntries = entriesOf(vocCatalogue, 'Magias', 'sorcerer');
    expect(sorcererEntries.map((e) => (e.kind === 'spell' ? e.spell.id : null)))
      .toEqual(['buzz', 'universal', 'haste-sorcerer']);

    const unvocatedEntries = entriesOf(vocCatalogue, 'Magias', null);
    expect(unvocatedEntries.map((e) => (e.kind === 'spell' ? e.spell.id : null)))
      .toEqual(['universal']);
  });

  it('filtra suprimentos por vocationId — string, lista, e o suprimento universal (#524, kit level 200)', () => {
    // O mesmo defeito da magia sem filtro, para poção: sem isto a tela oferece a Strong Health
    // Potion (Knight/Paladin) a um Sorcerer, que configura uma ação que o servidor sempre recusa.
    const vocCatalogue: Catalogue = {
      ...catalogue,
      bot: {
        ...catalogue.bot,
        supplies: [
          supply({ id: 'universal-potion', name: 'Universal Potion', group: 'potion', vocationId: null }),
          supply({
            id: 'strong-health-potion', name: 'Strong Health Potion', group: 'potion',
            vocationId: ['knight', 'paladin'],
          }),
          supply({ id: 'great-spirit-potion', name: 'Great Spirit Potion', group: 'potion', vocationId: 'paladin' }),
        ],
      },
    };

    // As três têm o mesmo `requiredLevel` (sem `requires.level`, cai em 1): o desempate é por
    // nome — "Great Spirit" < "Strong Health" < "Universal".
    const knightEntries = entriesOf(vocCatalogue, 'Itens', 'knight');
    expect(knightEntries.map((e) => (e.kind === 'supply' ? e.supply.id : null)))
      .toEqual(['strong-health-potion', 'universal-potion']);

    const paladinEntries = entriesOf(vocCatalogue, 'Itens', 'paladin');
    expect(paladinEntries.map((e) => (e.kind === 'supply' ? e.supply.id : null)))
      .toEqual(['great-spirit-potion', 'strong-health-potion', 'universal-potion']);

    const sorcererEntries = entriesOf(vocCatalogue, 'Itens', 'sorcerer');
    expect(sorcererEntries.map((e) => (e.kind === 'supply' ? e.supply.id : null)))
      .toEqual(['universal-potion']);

    // Sem `vocationId` no chamador (contexto sem personagem): NENHUM filtro, tudo aparece.
    const unfiltered = entriesOf(vocCatalogue, 'Itens');
    expect(unfiltered.map((e) => (e.kind === 'supply' ? e.supply.id : null)))
      .toEqual(['great-spirit-potion', 'strong-health-potion', 'universal-potion']);
  });
});
