// E2E de combate pelo socket (M24-12, #477; RF-01, RF-02, RF-03, RF-06).
//
// O `sim` prova a matemática e a ordem dos eventos no domínio (`packages/sim/.../e2e.test.ts`).
// Aqui o que se prova é o CANAL: que a sequência que o Canary + OTClient v8 observam chega
// montada e na ordem certa — `target-changed` → `missile` → 37 `effect` → `creature-hit` — e que
// o motivo da recusa da runa viaja em palavras até o cliente.
//
// Tempo dirigido pelo relógio injetado, nunca dormido (invariante 2 e o harness de `host.test`).
// O conteúdo é o de teste, mas a DEFINIÇÃO da Avalanche é a real, importada de `content/`.

import {
  CharacterRuntime, HuntRuleset, createHuntSession, resolveDeath, statsForLevel, totalXpForLevel,
} from '@draconya/sim';
import {
  botConfigSchema, buildContent, migrateBotConfigV1,
} from '@draconya/content';
import type { Appearances, BotConfig, BotConfigV2, RawContent } from '@draconya/content';
import type { S2CMessage } from '@draconya/protocol';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../log.js';
import { SessionHost } from './host.js';
import { FakeSocket } from './testing.js';
import { createBotConfigValidator } from './sessions.js';
import { TEST_CITY_MAP, TEST_HUNT, TEST_PROGRESSION, rawTestContent } from '../testing/content.js';
import realAvalancheRune from '../../../content/data/supplies/avalanche-rune.json';

const logger = createLogger('silent', 'test');

// A arena grande o bastante para a runa de alcance 8 e a área de 37 tiles. Laço de 2×2 para o
// herói não sair de perto do ponto em que o teste arruma os monstros.
const MAP = {
  id: 'arena', z: 7,
  grid: [
    '########################',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '########################',
  ],
};

const ROUTE = {
  id: 'arena-loop', mapId: 'arena',
  tiles: [
    { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 2, y: 2, z: 7 }, { x: 1, y: 2, z: 7 },
  ],
  spawnPoints: [{ routeIndex: 2, radius: 1 }],
};

/** A tabela de aparências (invariante 6): a Avalanche projeta o míssil 29 e estoura o efeito 41. */
const RUNE_LOOK = { 'avalanche-rune': { effect: 41, missile: 29 } };

/**
 * As skills que as famílias de arma de teste referenciam, mais a `magic`. Sem a definição de
 * `magic` no conteúdo, `#runeScaling` lê zero e a runa recusaria por magic level mesmo com a
 * skill do personagem no nível certo — o gate é conteúdo, então o conteúdo precisa tê-lo.
 */
const SKILLS = [
  { id: 'melee', name: 'Corpo a Corpo', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.5 },
  { id: 'distance', name: 'Distância', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'distance-hit', points: 1 }, damagePerLevel: 0 },
  { id: 'magic', name: 'Magia', startingLevel: 0, curve: { base: 100, factor: 1 }, gain: { on: 'spell-cast', pointsPerMana: 1 }, damagePerLevel: 0 },
];

const RUNE_RULE = {
  when: { kind: 'targets' as const, op: '>=' as const, count: 1 },
  do: { kind: 'supply' as const, supplyId: 'avalanche-rune' },
};

/** A v1 que o jogador salvaria: o host a migra para v2 no `bot-config`. */
const runeBot = (): BotConfig => botConfigSchema.parse({
  version: 1, heal: [], potion: [], attack: [], support: [], rune: [RUNE_RULE],
});

/** A v2 direta, com o slot ocupado — é ela que o `slot-state` precisa ler. */
const runeSlotBot = (): BotConfigV2 => migrateBotConfigV1({
  version: 1, heal: [], potion: [], attack: [], support: [], rune: [RUNE_RULE],
});

const ofType = <T extends S2CMessage['type']>(messages: readonly S2CMessage[], type: T) =>
  messages.filter((m): m is Extract<S2CMessage, { type: T }> => m.type === type);

/**
 * Uma hunt de verdade no host, com a runa real e o herói no level/magic level que o teste pedir.
 * O bot entra por `bot` (na criação) ou pelo socket; a regra de `targets >= 1` é a mesma.
 */
function hunt(options: {
  gold?: number; level?: number; magicLevel?: number; monsterCount?: number;
  bot?: BotConfig | BotConfigV2; ratHealth?: number;
} = {}) {
  const raw = rawTestContent();
  const shaped: RawContent = {
    ...raw,
    maps: [MAP, TEST_CITY_MAP],
    routes: [ROUTE],
    supplies: [...(raw.supplies ?? []), realAvalancheRune],
    skills: SKILLS,
    progression: [{
      ...TEST_PROGRESSION, startingMana: 2_000,
      regen: { healthPerSecond: 0, manaPerSecond: 0 },
    }],
    monsters: (raw.monsters as Array<Record<string, unknown>>).map((monster) =>
      monster['id'] === 'rat' ? { ...monster, attack: 0, health: options.ratHealth ?? 100_000 } : monster),
    ...(options.monsterCount === undefined
      ? {}
      : {
        hunts: [{
          ...TEST_HUNT,
          difficulties: {
            cautious: { ...TEST_HUNT.difficulties.cautious, monsterCount: options.monsterCount },
          },
        }],
      }),
  };
  const content = buildContent(shaped);
  const appearances = {
    ...(content.appearances as Appearances),
    supplies: { ...(content.appearances?.supplies ?? {}), ...RUNE_LOOK },
  };
  const level = options.level ?? 1;
  const stats = statsForLevel(level, null, content.progression);
  const skills = options.magicLevel === undefined
    ? undefined
    : { magic: { level: options.magicLevel, points: 0 } };
  let now = 0;
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: content.version, logger, now: () => now,
    monsterCatalog: content.monsters, skillCatalog: content.skills, appearances,
    acceptBotConfig: createBotConfigValidator(content),
    createSession: (characterId) => {
      const session = createHuntSession({
        id: `hunt-${characterId}`, content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
        ...(options.bot === undefined ? {} : { botConfig: options.bot }),
      });
      session.enter(new CharacterRuntime({
        id: characterId, position: { x: 1, y: 1, z: 7 },
        health: stats.maxHealth, maxHealth: stats.maxHealth,
        mana: stats.maxMana, maxMana: stats.maxMana,
        level, xp: options.level === undefined ? 0 : totalXpForLevel(level, content.progression),
        gold: options.gold ?? 0, goldDelta: 0, alive: true, cooldowns: {},
        staminaMs: 86_400_000 - 30_000, staminaUpdatedAtMs: 0,
        ...(skills === undefined ? {} : { skills }),
      }));
      return session;
    },
  });
  const socket = new FakeSocket();
  const viewer = host.attach(socket, 'hero');
  const runFor = (ms: number, step = 100) => {
    for (let t = 0; t < ms; t += step) { now += step; host.cycle(); }
    host.flush();
  };
  const send = async (message: Parameters<typeof host.handle>[1]) => {
    host.handle(viewer, message);
    await Promise.resolve();
    host.flush();
  };
  // O cliente pede o mundo já no attach: é o `session-state` que dá id numérico às criaturas.
  host.handle(viewer, { type: 'session-attach' });
  host.flush();
  const hero = () => host.sessionFor('hero')?.participants[0] as CharacterRuntime;
  const session = () => host.sessionFor('hero') as ReturnType<typeof createHuntSession>;
  const ruleset = () => session().ruleset as HuntRuleset;
  return { host, socket, viewer, runFor, send, hero, session, ruleset, now: () => now, content };
}

/** Re-pede o estado completo e devolve os ids numéricos dos ratos já nascidos. */
function ratIds(fixture: ReturnType<typeof hunt>): readonly number[] {
  fixture.host.handle(fixture.viewer, { type: 'session-attach' });
  fixture.host.flush();
  const state = ofType(fixture.socket.received(), 'session-state').at(-1);
  if (state === undefined) throw new Error('sem session-state');
  return state.world.creatures.filter((creature) => creature.name === 'Rat').map((creature) => creature.id);
}

describe('combate E2E pelo socket (M24-12, #477)', () => {
  it('RF-01: a Avalanche real vira target-changed, UM míssil (29) e 37 efeitos (41) por uso', () => {
    // O ciclo de aparência que o OTClient desenha: alvo confirmado, projétil do conjurador ao
    // primeiro alvo, e a forma INTEIRA (37 tiles) estourando — um míssil por uso, nunca um por
    // tile, e os efeitos depois dele. O gold debita pelo preço real (14).
    const fixture = hunt({ gold: 10_000, level: 30, magicLevel: 4, bot: runeBot() });
    fixture.runFor(200);
    const [ratId] = ratIds(fixture);
    if (ratId === undefined) throw new Error('faltou rato');
    const rat = fixture.ruleset().monsters[0];
    if (rat === undefined) throw new Error('faltou rato');
    rat.position = { x: fixture.hero().position.x + 8, y: fixture.hero().position.y };
    fixture.runFor(2_500);

    const all = fixture.socket.received();
    // O alvo aparece na tela, com o id do servidor.
    expect(ofType(all, 'target-changed').some((m) => m.creatureId === ratId)).toBe(true);

    // `supply-used` é evento de DOMÍNIO, não mensagem S2C: o host o traduz em `missile` +
    // `effect`. Um míssil por uso é, portanto, a contagem de usos no fio.
    const missiles = ofType(all, 'missile').filter((m) => m.missileId === 29);
    const effects = ofType(all, 'effect').filter((e) => e.effectId === 41);
    const spellHits = ofType(all, 'creature-hit').filter((h) => h.kind === 'spell');
    const casts = missiles.length;
    expect(casts).toBeGreaterThan(0);
    // 37 tiles por uso, um alvo só: 37 efeitos por uso.
    expect(effects).toHaveLength(37 * casts);
    expect(spellHits.length).toBeGreaterThanOrEqual(casts);
    // O míssil precede os efeitos do uso dele.
    const missileAt = all.indexOf(missiles[0] as S2CMessage);
    const effectAt = all.indexOf(effects[0] as S2CMessage);
    expect(effectAt).toBeGreaterThan(missileAt);
    // Gold pelo preço real, uma vez por uso.
    expect(fixture.hero().goldDelta).toBe(-14 * casts);
  });

  it('RF-02: com magic level 3 o slot-state explica "Magic level insuficiente.", e nada é gasto', () => {
    // O alvo aparece; a runa não sai porque o requisito REAL (ML 4) não é atingido. O motivo
    // chega em PALAVRAS no `slot-state` — o cliente o mostra no tooltip do slot.
    const fixture = hunt({ gold: 10_000, level: 30, magicLevel: 3, bot: runeSlotBot() });
    fixture.runFor(200);
    const [ratId] = ratIds(fixture);
    if (ratId === undefined) throw new Error('faltou rato');
    const rat = fixture.ruleset().monsters[0];
    if (rat === undefined) throw new Error('faltou rato');
    rat.position = { x: fixture.hero().position.x + 8, y: fixture.hero().position.y };
    fixture.runFor(500);

    const all = fixture.socket.received();
    expect(ofType(all, 'target-changed').some((m) => m.creatureId === ratId)).toBe(true);
    // O motivo específico está no fio, não o genérico "ação indisponível".
    const slots = ofType(all, 'slot-state').flatMap((m) => m.slots);
    expect(slots.some((slot) => slot.state === 'blocked' && slot.reason === 'Magic level insuficiente.'))
      .toBe(true);
    expect(slots.some((slot) => slot.reason === 'Essa ação não pode ser usada agora.')).toBe(false);
    // E nenhuma runa foi usada — nem míssil, nem gold.
    expect(ofType(all, 'missile').filter((m) => m.missileId === 29)).toHaveLength(0);
    expect(fixture.hero().goldDelta).toBe(0);
  });

  it('RF-06: A → B antes do ack fica com B, e um seq atrasado é ignorado em silêncio', () => {
    // A alternância rápida chega com "latência" simulada pelo relógio: o `seq` mais novo vence e
    // o antigo não volta a confirmar A. É o outro lado do que o cliente reconcilia (#471).
    const fixture = hunt({ level: 30, magicLevel: 4, monsterCount: 2 });
    fixture.runFor(200);
    const [aId, bId] = ratIds(fixture);
    if (aId === undefined || bId === undefined) throw new Error('faltam ratos');

    fixture.host.handle(fixture.viewer, { type: 'select-target', creatureId: aId, seq: 1 });
    fixture.runFor(300);
    fixture.host.handle(fixture.viewer, { type: 'select-target', creatureId: bId, seq: 2 });
    fixture.runFor(50);

    const confirmed = ofType(fixture.socket.received(), 'target-changed').filter((m) => m.seq !== undefined);
    expect(confirmed.at(-1)?.seq).toBe(2);
    expect(confirmed.at(-1)?.creatureId).toBe(bId);

    // Um seq anterior ao processado é atrasado: nenhuma nova confirmação para A.
    const before = ofType(fixture.socket.received(), 'target-changed').length;
    fixture.host.handle(fixture.viewer, { type: 'select-target', creatureId: aId, seq: 0 });
    fixture.runFor(50);
    expect(ofType(fixture.socket.received(), 'target-changed')).toHaveLength(before);
  });

  it('RF-06: alvo morre no meio da troca — o servidor confirma o próximo vivo, sem crash', () => {
    const fixture = hunt({ level: 30, magicLevel: 4, monsterCount: 2 });
    fixture.runFor(200);
    const [aId, bId] = ratIds(fixture);
    if (aId === undefined || bId === undefined) throw new Error('faltam ratos');
    const monsters = fixture.ruleset().monsters;
    const a = monsters[0];
    const b = monsters[1];
    if (a === undefined || b === undefined) throw new Error('faltam ratos');
    a.position = { x: fixture.hero().position.x + 2, y: fixture.hero().position.y };
    b.position = { x: fixture.hero().position.x + 3, y: fixture.hero().position.y };
    fixture.runFor(200);

    // O jogador troca A → B (seq 1 → seq 2) e, ANTES de o ack de B resolver, B morre.
    fixture.host.handle(fixture.viewer, { type: 'select-target', creatureId: aId, seq: 1 });
    fixture.runFor(50);
    fixture.host.handle(fixture.viewer, { type: 'select-target', creatureId: bId, seq: 2 });
    fixture.runFor(50);
    b.receiveDamage(b.health);
    resolveDeath(fixture.session(), { kind: 'monster', monster: b });
    expect(() => fixture.runFor(200)).not.toThrow();

    // O servidor confirma o próximo vivo (A) — a troca para B não vira um alvo morto na tela.
    const confirmed = ofType(fixture.socket.received(), 'target-changed').filter((m) => m.seq !== undefined);
    expect(confirmed.at(-1)?.creatureId).toBe(bId);
    expect(ofType(fixture.socket.received(), 'target-changed').at(-1)?.creatureId).toBe(aId);
  });

  it('RF-03: dois alvos dentro da área — 37 efeitos e um golpe por alvo, sem dobrar a forma', () => {
    // A forma é uma só, com dois alvos dentro dela: os efeitos continuam sendo 37 (o tile com
    // criatura não ganha um segundo), e saem dois `creature-hit` por uso.
    const fixture = hunt({ gold: 10_000, level: 30, magicLevel: 4, monsterCount: 2, bot: runeBot() });
    fixture.runFor(200);
    const monsters = fixture.ruleset().monsters;
    const [a, b] = monsters;
    if (a === undefined || b === undefined) throw new Error('faltam ratos');
    a.position = { x: fixture.hero().position.x + 8, y: fixture.hero().position.y };
    b.position = { x: a.position.x, y: a.position.y + 1 };
    fixture.runFor(2_500);

    const all = fixture.socket.received();
    const casts = ofType(all, 'missile').filter((m) => m.missileId === 29).length;
    const effects = ofType(all, 'effect').filter((e) => e.effectId === 41);
    const spellHits = ofType(all, 'creature-hit').filter((h) => h.kind === 'spell');
    expect(casts).toBeGreaterThan(0);
    expect(effects).toHaveLength(37 * casts);
    // Dois alvos por uso — a área colheu os dois.
    expect(spellHits).toHaveLength(2 * casts);
  });
});