import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Content } from '@draconya/content';
import { CharacterRuntime, createHuntSession, statsForLevel, totalXpForLevel } from '@draconya/sim';
import type { CarriedItem, HuntRuleset, Session } from '@draconya/sim';

// A esfola (#626) contra o conteúdo REAL: o `sim` fala de fixtures, e é aqui, no servidor que
// carrega o catálogo importado de verdade, que se prende (a) que a tabela gerada do
// `skinning.lua` tem as janelas, os materiais e as ferramentas do Canary, e (b) que uma hunt real
// com a faca na mochila rende as peles na taxa do Lua e sem tocar o RNG de quem não a tem.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

const HERO_LEVEL = 150;
const KNIFE: CarriedItem = { instanceId: 'kit:knife', itemId: 'obsidian-knife', quantity: 1 };

describe('a tabela de esfola gerada do skinning.lua do Canary (#626)', () => {
  it('as duas ferramentas são a obsidian knife (5908) e a blessed wooden stake (5942)', () => {
    const tools = new Set([...real().skinning.values()].map((entry) => entry.toolId));
    expect([...tools].sort()).toEqual(['blessed-wooden-stake', 'obsidian-knife']);
    for (const tool of tools) expect(real().items.get(tool)?.kind).toBe('other');
  });

  it('a chance é a do CREATURE_SKINNING_CHANCE (25 000 de 100 000) em toda entrada', () => {
    expect(real().skinning.size).toBeGreaterThan(50);
    for (const entry of real().skinning.values()) expect(entry.chance, entry.id).toBe(25_000);
  });

  it('o Dragon: pele de dragão verde, nos dois primeiros estágios do cadáver (310 s dos 670 s)', () => {
    const dragon = real().skinning.get('dragon');
    expect(dragon).toMatchObject({ toolId: 'obsidian-knife', materialId: 'green-dragon-leather' });
    expect(dragon?.stages).toEqual([
      { canaryItemId: 5973, durationMs: 10_000 }, { canaryItemId: 4025, durationMs: 300_000 },
    ]);
    expect(real().monsters.get('dragon')?.corpseTtlMs).toBe(670_000);
  });

  it('o Dragon Lord e o Behemoth: red dragon leather e perfect behemoth fang', () => {
    expect(real().skinning.get('dragon-lord')).toMatchObject({
      toolId: 'obsidian-knife', materialId: 'red-dragon-leather',
    });
    expect(real().skinning.get('behemoth')).toMatchObject({
      toolId: 'obsidian-knife', materialId: 'perfect-behemoth-fang',
    });
  });

  it('o Demon e o Vampire: pó, e com a ESTACA — a outra ferramenta', () => {
    expect(real().skinning.get('demon')).toMatchObject({
      toolId: 'blessed-wooden-stake', materialId: 'demon-dust',
    });
    expect(real().skinning.get('vampire')).toMatchObject({
      toolId: 'blessed-wooden-stake', materialId: 'vampire-dust',
    });
  });

  it('o Minotaur e os que compartilham o cadáver dele (5969) têm os MESMOS estágios — é o que o Scavenge compara', () => {
    const minotaur = real().skinning.get('minotaur');
    expect(minotaur?.materialId).toBe('minotaur-leather');
    expect(minotaur?.stages.map((stage) => stage.canaryItemId)).toEqual([5969, 4011]);
    for (const id of ['minotaur-bruiser', 'minotaur-cult-follower', 'depowered-minotaur']) {
      expect(real().skinning.get(id)?.stages, id).toEqual(minotaur?.stages);
    }
    // O Minotaur Archer é outro cadáver (5982) e outro par de estágios.
    expect(real().skinning.get('minotaur-archer')?.stages.map((stage) => stage.canaryItemId)).toEqual([5982, 4052]);
  });

  it('o coelho só se esfola nos 10 s do primeiro estágio, e rende o pé de coelho', () => {
    expect(real().skinning.get('rabbit')).toMatchObject({
      materialId: 'rabbits-foot', stages: [{ canaryItemId: 6017, durationMs: 10_000 }],
    });
  });

  it('nenhum monstro esfolável escapa da janela dentro da vida do cadáver dele', () => {
    for (const entry of real().skinning.values()) {
      const window = entry.stages.reduce((sum, stage) => sum + stage.durationMs, 0);
      const ttl = real().monsters.get(entry.id)?.corpseTtlMs;
      expect(ttl, entry.id).toBeDefined();
      expect(window, entry.id).toBeLessThanOrEqual(ttl as number);
    }
  });

  it('todo material é um item do catálogo: creature product (o Gut lê o flag), menos o pé de coelho', () => {
    const materials = new Set([...real().skinning.values()].map((entry) => entry.materialId));
    for (const id of materials) {
      const item = real().items.get(id);
      expect(item, id).toBeDefined();
      if (id !== 'rabbits-foot') expect(item?.creatureProduct, id).toBe(true);
    }
  });
});

describe('uma hunt REAL com a faca na mochila esfola no abate (#626)', () => {
  /** A Minotaur Camp real: minotauros por toda a rota, e um herói que não morre. */
  function farm(carrying: readonly CarriedItem[], stepMs: number, seed = 'skin-camp', horizonMs = 600_000) {
    // As TABELAS e os cadáveres são os reais; a vida dos monstros não importa para a esfola, e com
    // uma vida só o herói (sem vocação, punho nu) não morre no meio do teste.
    const content: Content = {
      ...real(),
      monsters: new Map([...real().monsters].map(([id, monster]) => [id, { ...monster, health: 1 }])),
    };
    const session = createHuntSession({
      id: seed, content, huntId: 'minotaur-camp', difficulty: 'default', createdAtMs: 0,
    });
    // A XP acompanha o level: um abate re-deriva o level da XP, e um herói de level 100 com XP zero
    // voltaria ao level 1 (com a vida dele) no primeiro abate.
    const stats = statsForLevel(HERO_LEVEL, null, content.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
      level: HERO_LEVEL, xp: totalXpForLevel(HERO_LEVEL, content.progression),
      goldDelta: 0, alive: true, cooldowns: {}, capacity: stats.capacity,
      inventory: { backpack: [], satchel: [...carrying], equipped: {} },
    });
    session.enter(hero);
    for (let t = 0; t < horizonMs && session.ended === null; t += stepMs) {
      session.advanceBy(stepMs);
      session.drainEvents();
    }
    return { session, hero };
  }

  const leather = (hero: CharacterRuntime): number => [...hero.inventory.items()]
    .filter((item) => item.itemId === 'minotaur-leather').reduce((sum, item) => sum + item.quantity, 0);
  const corpses = (session: Session) => (session.ruleset as HuntRuleset).groundItems;

  it('com a faca as peles saem na taxa do Lua, e a faca não é consumida', () => {
    const { session, hero } = farm([KNIFE], 1_000);
    const kills = session.aggregates.kills;
    expect(kills).toBeGreaterThanOrEqual(40);
    // Só o Minotaur e os seus da rota rendem pele (Pig, Smuggler & cia. não são esfoláveis): a
    // taxa por abate de minotauro é 25 %, então o total é positivo e nunca passa dos abates.
    expect(leather(hero)).toBeGreaterThan(0);
    expect(leather(hero)).toBeLessThanOrEqual(kills);
    expect([...hero.inventory.items()].filter((item) => item.itemId === 'obsidian-knife')).toHaveLength(1);
    // O cadáver esfolado fica marcado.
    expect(corpses(session).some((corpse) => corpse.skinned === true)).toBe(true);
  });

  it('sem a faca nenhuma pele, e o RNG da sessão é o mesmo de antes da esfola existir', () => {
    const without = farm([], 1_000);
    expect(leather(without.hero)).toBe(0);
    expect(corpses(without.session).some((corpse) => corpse.skinned === true)).toBe(false);
    // Repetível: a mesma sessão, os mesmos abates, o mesmo gerador.
    const again = farm([], 1_000);
    expect(again.session.snapshot().rng).toEqual(without.session.snapshot().rng);
    expect(again.session.aggregates.kills).toBe(without.session.aggregates.kills);
  });

  it('a Minotaur Camp esfola igual em 1 Hz e 10 Hz', () => {
    const slow = farm([KNIFE], 1_000, 'skin-hz', 300_000);
    const fast = farm([KNIFE], 100, 'skin-hz', 300_000);
    expect(slow.session.aggregates.kills).toBeGreaterThan(10);
    expect(leather(fast.hero)).toBe(leather(slow.hero));
    expect(fast.session.aggregates.kills).toBe(slow.session.aggregates.kills);
    expect(fast.session.snapshot().rng).toEqual(slow.session.snapshot().rng);
  });
});
