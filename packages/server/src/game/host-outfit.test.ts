import { CharacterRuntime, createHuntSession } from '@draconya/sim';
import type { InventoryState } from '@draconya/sim';
import { buildContent, placeholderAppearances } from '@draconya/content';
import type { Content, RawContent } from '@draconya/content';
import type { S2CMessage } from '@draconya/protocol';
import { C2S_SCHEMAS } from '@draconya/protocol';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../log.js';
import { rawTestContent } from '../testing/content.js';
import { SessionHost } from './host.js';
import { FakeSocket } from './testing.js';

// A aparência emprestada no fio (#621, M44-03): o `sim` diz QUEM vestiu o quê (`creature-look-
// changed`), e o hospedeiro o resolve na tabela de aparências — `creature-update` com o id do
// pacote, `object` quando é objeto. Quem entra no meio (`session-state`, `creature-appear`) vê a
// criatura já vestida. Aparência sem linha na tabela é MUDA (invariante 6).

const logger = createLogger('silent', 'test');

const inert = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, recommendedLevel: 1, health: 100_000, experience: 0, attack: 0, armor: 0,
  attackIntervalMs: 2_000, speed: 300, aggroRadius: 0, attackRange: 1, loot: { items: [] }, ...extra,
});
const disguise = (look: Record<string, string>, durationMs: number) => ({
  key: 'outfit', merge: 'strongest', durationMs, effect: { kind: 'outfit', look },
});
/** A defesa que se disfarça: a primeira aplicação cai em ~5 s, dura 1 s. */
const shapeshifter = (look: Record<string, string>) => inert('shapeshifter', {
  aggroRadius: 11,
  defenses: [{ id: 'disguise', cadenceMs: 5_000, chance: 1, condition: disguise(look, 1_000) }],
});

const chameleonRune = {
  id: 'chameleon-rune-test', name: 'Chameleon Rune', price: 210, group: 'support',
  groupCooldownMs: 2_000, cooldownMs: 2_000, requires: { level: 1, magicLevel: 0 },
  effect: { kind: 'chameleon', durationMs: 3_000 },
};

interface World {
  readonly host: SessionHost;
  readonly socket: FakeSocket;
  readonly viewer: ReturnType<SessionHost['attach']>;
  readonly content: Content;
  readonly received: () => readonly S2CMessage[];
  readonly runFor: (ms: number, step?: number) => void;
  readonly state: () => {
    self: { creatureId: number };
    world: {
      creatures: Array<{
        id: number; name: string; appearanceId: number; object?: boolean;
        colors?: { head: number; body: number; legs: number; feet: number }; addons?: number;
      }>;
    };
  };
}

function build(over: {
  monsters: readonly unknown[]; spawn: string; looks?: Record<string, number>;
  supplies?: readonly unknown[]; items?: readonly unknown[]; inventory?: InventoryState;
}): World {
  const base = rawTestContent();
  const withData: RawContent = {
    ...base,
    monsters: over.monsters,
    routes: [{
      ...(base.routes as Record<string, unknown>[])[0], id: 'arena-loop',
      spawnPoints: [{ routeIndex: 2, radius: 1, monsterId: over.spawn, respawnDelayMs: 600_000 }],
    }],
    ...(over.supplies === undefined ? {} : { supplies: over.supplies }),
    ...(over.items === undefined ? {} : { items: over.items }),
  };
  // A tabela é DERIVADA (`placeholderAppearances`), e o teste só acrescenta a linha de `looks`.
  const appearances = { ...placeholderAppearances(withData), looks: over.looks ?? {} };
  const content = buildContent({ ...withData, appearances: [appearances] });
  let now = 0;
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: content.version, logger, now: () => now,
    monsterCatalog: content.monsters, itemCatalog: content.items, appearances,
    playerOutfitId: 128,
    createSession: (characterId) => {
      const session = createHuntSession({
        id: `hunt-${characterId}`, content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      });
      session.enter(new CharacterRuntime({
        id: characterId, position: { x: 1, y: 1, z: 7 }, health: 1_200, maxHealth: 1_200,
        mana: 500, maxMana: 500, level: 8, xp: 0, gold: 1_000, goldDelta: 0, alive: true, cooldowns: {},
        ...(over.inventory === undefined ? {} : { inventory: over.inventory }),
      }));
      return session;
    },
  });
  const socket = new FakeSocket();
  const viewer = host.attach(socket, 'hero');
  const runFor = (ms: number, step = 100): void => {
    for (let t = 0; t < ms; t += step) { now += step; host.cycle(); }
    host.flush();
  };
  const state = () => {
    host.handle(viewer, { type: 'session-attach' });
    host.flush();
    return socket.received().filter((m) => m.type === 'session-state').at(-1) as unknown as ReturnType<World['state']>;
  };
  return { host, socket, viewer, content, received: () => socket.received(), runFor, state };
}

const updates = (world: World) => world.received().filter((m) => m.type === 'creature-update');
const ratOutfit = (world: World): number => world.content.monsters.get('rat')?.outfitId ?? -1;
const ownOutfit = (world: World, id: string): number => world.content.monsters.get(id)?.outfitId ?? -1;

describe('creature-update: o monstro que se disfarça (#621)', () => {
  const monsters = [inert('rat', { illusionable: true }), shapeshifter({ monsterId: 'rat' })];
  // As cores e os addons do outfit (#620) são parte do que a condição troca: o monstro que imita
  // o outro veste os DELE, e quem volta ao próprio os recebe de volta.
  const ratPaint = { head: 78, body: 69, legs: 58, feet: 76 };
  const ownPaint = { head: 1, body: 2, legs: 3, feet: 4 };
  const painted = [
    inert('rat', { illusionable: true, outfit: { ...ratPaint, addons: 2 } }),
    {
      ...shapeshifter({ monsterId: 'rat' }),
      outfit: { ...ownPaint, addons: 1 },
    },
  ];

  it('veste o outfit do OUTRO monstro e volta ao dele quando o prazo vence — o id do pacote, resolvido aqui', () => {
    const world = build({ monsters, spawn: 'shapeshifter' });
    world.runFor(5_600);
    const id = world.state().world.creatures.find((creature) => creature.name === 'shapeshifter')?.id ?? -1;
    expect(id).toBeGreaterThan(0);
    // Só chegou a primeira troca: o monstro imitou o rato (`outfitId` do catálogo, nunca do `sim`).
    // Sem `outfit` declarado os dois vestem o neutro do Canary (tudo 0), que o catálogo manda sempre.
    const neutral = { head: 0, body: 0, legs: 0, feet: 0 };
    expect(updates(world)).toEqual([
      { type: 'creature-update', id, appearanceId: ratOutfit(world), colors: neutral },
    ]);

    world.runFor(1_000);
    expect(updates(world)).toEqual([
      { type: 'creature-update', id, appearanceId: ratOutfit(world), colors: neutral },
      { type: 'creature-update', id, appearanceId: ownOutfit(world, 'shapeshifter'), colors: neutral },
    ]);
  });

  it('a ilusão leva as cores e os addons do monstro imitado, e o fim devolve os do próprio', () => {
    // Mutação que mata: `#lookFor` devolver só o `appearanceId` — o cliente manteria as cores e os
    // addons do dono sobre o desenho do outro (e, ao voltar, perderia os dele).
    const world = build({ monsters: painted, spawn: 'shapeshifter' });
    world.runFor(5_600);
    const id = world.state().world.creatures.find((creature) => creature.name === 'shapeshifter')?.id ?? -1;
    expect(updates(world)).toEqual([
      { type: 'creature-update', id, appearanceId: ratOutfit(world), colors: ratPaint, addons: 2 },
    ]);
    // Quem reanexa no meio da ilusão vê as mesmas cores e addons — e NÃO os do dono.
    expect(world.state().world.creatures.find((creature) => creature.id === id))
      .toMatchObject({ appearanceId: ratOutfit(world), colors: ratPaint, addons: 2 });

    world.runFor(1_000);
    expect(updates(world).at(-1)).toEqual({
      type: 'creature-update', id, appearanceId: ownOutfit(world, 'shapeshifter'), colors: ownPaint, addons: 1,
    });
    expect(world.state().world.creatures.find((creature) => creature.id === id))
      .toMatchObject({ appearanceId: ownOutfit(world, 'shapeshifter'), colors: ownPaint, addons: 1 });
  });

  it('quem reanexa no MEIO da ilusão vê o monstro já vestido — o estado mora na condição do sim', () => {
    const world = build({ monsters, spawn: 'shapeshifter' });
    world.runFor(5_600);
    const creature = world.state().world.creatures.find((candidate) => candidate.name === 'shapeshifter');
    expect(creature?.appearanceId).toBe(ratOutfit(world));
    // E depois que acaba, o mesmo pedido devolve a aparência própria.
    world.runFor(1_000);
    expect(world.state().world.creatures.find((candidate) => candidate.name === 'shapeshifter')?.appearanceId)
      .toBe(ownOutfit(world, 'shapeshifter'));
  });

  it('o outfit de objeto sai com `object: true` e o id de `appearances.looks`; sem a linha, é MUDO', () => {
    const worm = build({
      monsters: [inert('rat', { illusionable: true }), shapeshifter({ objectKey: 'fallen-tree' })],
      spawn: 'shapeshifter', looks: { 'fallen-tree': 3976 },
    });
    worm.runFor(5_600);
    const id = worm.state().world.creatures.find((creature) => creature.name === 'shapeshifter')?.id ?? -1;
    expect(updates(worm)).toEqual([{ type: 'creature-update', id, appearanceId: 3976, object: true }]);
    expect(worm.state().world.creatures.find((creature) => creature.name === 'shapeshifter'))
      .toMatchObject({ appearanceId: 3976, object: true });

    const mute = build({
      monsters: [inert('rat', { illusionable: true }), shapeshifter({ objectKey: 'fallen-tree' })],
      spawn: 'shapeshifter', looks: {},
    });
    mute.runFor(5_600);
    // A condição vale no `sim` (o monstro segue disfarçado por dentro), mas o cliente nunca é
    // avisado de uma aparência que a tabela não tem — a criatura continua como estava.
    expect(updates(mute)).toEqual([]);
    expect(mute.state().world.creatures.find((creature) => creature.name === 'shapeshifter')?.appearanceId)
      .toBe(ownOutfit(mute, 'shapeshifter'));
  });
});

describe('creature-update: a Chameleon Rune do jogador (#621)', () => {
  const inventory: InventoryState = {
    backpack: [{ instanceId: 'w1', itemId: 'worm', quantity: 1 }], satchel: [], equipped: {},
  };
  const setup = () => build({
    monsters: [inert('rat', { illusionable: true })], spawn: 'rat',
    supplies: [chameleonRune], items: [{ id: 'worm', name: 'Worm', kind: 'other', weight: 1, value: 0 }],
    inventory,
  });

  it('`use-item-on` com `target: { instanceId }` veste a aparência do ITEM, como objeto, e expira', () => {
    const world = setup();
    const self = world.state().self.creatureId;
    world.host.handle(world.viewer, {
      type: 'use-item-on', ref: { supplyId: 'chameleon-rune-test' }, seq: 1, target: { instanceId: 'w1' },
    });
    world.runFor(200);
    const wormArt = world.content.items.get('worm')?.appearanceId ?? -1;
    expect(updates(world)).toEqual([{ type: 'creature-update', id: self, appearanceId: wormArt, object: true }]);

    // Os 3 s da runa de teste: o herói volta ao outfit dele, com as cores que o ticket levaria.
    world.runFor(3_000);
    expect(updates(world).at(-1)).toEqual({ type: 'creature-update', id: self, appearanceId: 128 });
  });

  it('um item que o personagem não tem é recusado em palavras, sem troca nenhuma', () => {
    const world = setup();
    world.host.handle(world.viewer, {
      type: 'use-item-on', ref: { supplyId: 'chameleon-rune-test' }, seq: 1, target: { instanceId: 'ghost' },
    });
    world.runFor(200);
    expect(updates(world)).toEqual([]);
    const result = world.received().find((message) => message.type === 'use-result');
    expect(result).toMatchObject({ type: 'use-result', ok: false, reason: 'Não é possível.' });
  });

  it('o schema do fio aceita a instância como mira em `use-slot`, `use-item` e `use-item-on`', () => {
    const target = { instanceId: 'w1' };
    expect(C2S_SCHEMAS['use-slot'].safeParse({ set: 0, slot: 0, target }).success).toBe(true);
    expect(C2S_SCHEMAS['use-item'].safeParse({ ref: { supplyId: 'x' }, seq: 0, target }).success).toBe(true);
    expect(C2S_SCHEMAS['use-item-on'].safeParse({ ref: { supplyId: 'x' }, seq: 0, target }).success).toBe(true);
  });
});
