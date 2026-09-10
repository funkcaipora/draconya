import { buildContent, isBlocked } from '@draconya/content';
import type { Content, Progression, RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import type { SkillsState } from '../skills.js';
import type { InventoryState } from '../inventory.js';
import { huntListings } from '../hunt/catalogue.js';
import { statsForLevel, totalXpForLevel } from '../progression.js';
import { Rng } from '../rng.js';
import { MAX_PENDING_DOMAIN_EVENTS, Session } from '../session.js';
import type { SessionSnapshot } from '../session.js';
import {
  HuntRuleset, changeDifficulty, compileExitRules, createHuntSession, huntRulesetFromSnapshot,
} from './hunt.js';
import type { HuntExitRule, HuntView } from './hunt.js';

// Um mapa pequeno, com uma sala e um laço de dez tiles em volta dela. Pequeno de propósito:
// num mapa assim dá para dizer, olhando, onde cada criatura está — e um teste de simulação
// que ninguém consegue conferir a olho é um teste que ninguém confia.
const map = {
  id: 'arena', z: 7,
  grid: ['######', '#....#', '#....#', '#....#', '######'],
};

const route = {
  id: 'arena-loop', mapId: 'arena',
  tiles: [
    { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 1, z: 7 }, { x: 4, y: 1, z: 7 },
    { x: 4, y: 2, z: 7 }, { x: 4, y: 3, z: 7 }, { x: 3, y: 3, z: 7 }, { x: 2, y: 3, z: 7 },
    { x: 1, y: 3, z: 7 }, { x: 1, y: 2, z: 7 },
  ],
  spawnPoints: [{ routeIndex: 4, radius: 2 }],
};

const rat = {
  id: 'rat', name: 'Rat', outfitId: 21, recommendedLevel: 1,
  health: 50, experience: 5, attack: 10, armor: 0,
  attackIntervalMs: 2000, stepDurationMs: 500, aggroRadius: 4, attackRange: 1,
  // Gold fixo por abate: o que os testes de recompensa conferem é a CONTA, não o sorteio —
  // o sorteio tem teste próprio em `loot.test.ts`.
  loot: { gold: { chance: 1, min: 3, max: 3 }, items: [] },
};

/** O mesmo rato, largando uma espada SEMPRE. Chance 1 tira o sorteio da conta (FUN-88). */
const ratWithDrop = {
  ...rat,
  loot: {
    gold: { chance: 1, min: 3, max: 3 },
    items: [{ itemId: 'sword', chance: 1, min: 1, max: 1 }],
  },
};

const hunt = {
  id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
  difficulties: {
    beginner: {
      perSpawnPoint: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 30_000,
    },
    professional: {
      perSpawnPoint: 3, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 10_000,
    },
  },
};

const progression = {
  // HP inicial absurdo de propósito. Subir de level RECALCULA `maxHealth` pela tabela
  // (FUN-34/FUN-37), então um herói com HP inventado no teste perderia a vida toda no
  // primeiro level up. Dar a ele um pool enorme VINDO DA TABELA mantém tudo coerente e deixa
  // dez minutos de hunt caberem sem morrer — o personagem ainda não regenera nada, e é isso
  // que a FUN-38 e as poções vão resolver.
  id: 'baseline', startingHealth: 500_000, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  stepDurationMs: 500,
  regen: { healthPerSecond: 1, manaPerSecond: 1 },
  xp: { base: 20, exponent: 2 },
  deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
};

const combat = {
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: { melee: 1, magic: 0 }, minimumDamageFraction: 0.1,
  // **Esquiva zero neste conteúdo de teste, e é decisão.** Com ela, dano vira função só do
  // tempo decorrido, e a comparação 10 Hz / 1 Hz mede o que ela deveria medir — a matemática
  // do tempo — em vez de medir em que ordem os sorteios caíram. Quem cuida do dodge é
  // `combat/damage.test.ts`, onde ele é o assunto.
  player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 0, dodgeChance: 0 },
};

const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };

// Magia e supply de teste (FUN-74, FUN-77). Números redondos de propósito: `strike` tira 40 de
// um rato de 50, então dois golpes matam e o terceiro é ruído — dá para conferir a olho.
const spells = [
  {
    id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1_000,
    effect: { kind: 'heal', amount: 60 },
  },
  {
    id: 'strike', name: 'Golpe Arcano', manaCost: 15, cooldownMs: 2_000,
    effect: { kind: 'damage', power: 40, range: 3 },
  },
  // Área de raio 2 e poder que MATA um rato de 50 num golpe: é o que faz o teste de "morte no
  // meio da área" ser sobre morte, e não sobre quanto falta de vida.
  {
    id: 'blast', name: 'Explosão', manaCost: 20, cooldownMs: 1_000,
    effect: { kind: 'damage', power: 80, range: 3, area: { radius: 2 } },
  },
];
const supplies = [
  { id: 'health-potion', name: 'Poção de Vida', price: 45, effect: { kind: 'heal', amount: 80 } },
  { id: 'mana-potion', name: 'Poção de Mana', price: 50, effect: { kind: 'mana', amount: 100 } },
];

// Skills de teste (FUN-75). Curva curta de propósito: com base 2 dá para contar os golpes na
// mão e dizer, olhando, em que nível o personagem tem de estar.
const skills = [
  {
    id: 'melee', name: 'Corpo a Corpo', startingLevel: 10,
    curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 },
    damagePerLevel: 0.5,
  },
  {
    id: 'magic', name: 'Magia', startingLevel: 0,
    curve: { base: 100, factor: 1 }, gain: { on: 'spell-cast', pointsPerMana: 1 },
    damagePerLevel: 0,
  },
];

// Uma arma que bate MUITO mais que o desarmado (25): com ela o rato de 50 cai num golpe, e o
// teste consegue medir a diferença sem depender de sorteio.
const items = [
  {
    id: 'sword', name: 'Sword', appearanceId: 3264, kind: 'weapon', slot: 'hand',
    weight: 50, attack: 200,
  },
  {
    id: 'plate', name: 'Plate Armor', appearanceId: 3357, kind: 'armor', slot: 'chest',
    weight: 80, armor: 9,
  },
];

const raw = (over: Partial<RawContent> = {}): RawContent => ({
  monsters: [rat], hunts: [hunt], vocations: [], progression: [progression], combat: [combat],
  stamina: [stamina], spells, supplies, skills, items,
  // O bot é o produto (invariante 11): sem `bot/baseline.json` o conteúdo não monta.
  bot: [{ id: 'baseline', vocabularyVersion: 1, categoryCooldownMs: 1000, advancedFromLevel: 50,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }], maps: [map], routes: [route], ...over,
});

const content = (over: Partial<RawContent> = {}): Content => buildContent(raw(over));

const character = (
  over: Partial<{
    health: number; staminaMs: number; skills: SkillsState; inventory: InventoryState;
  }> = {},
): CharacterRuntime => {
  const stats = statsForLevel(1, null, progression as Progression);
  return new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
    mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
    staminaMs: over.staminaMs ?? stamina.maxMs, staminaUpdatedAtMs: 0,
    goldDelta: 0, alive: true, cooldowns: {},
    capacity: 1_000,
    ...(over.skills === undefined ? {} : { skills: over.skills }),
    ...(over.inventory === undefined ? {} : { inventory: over.inventory }),
  });
};

interface Started {
  readonly session: Session;
  readonly hero: CharacterRuntime;
  readonly ruleset: HuntRuleset;
}

function start(
  options: { difficulty?: 'beginner' | 'professional'; exitRules?: readonly HuntExitRule[];
    health?: number; staminaMs?: number; loaded?: Content; skills?: SkillsState;
    inventory?: InventoryState } = {},
): Started {
  const session = createHuntSession({
    id: 'session-1',
    content: options.loaded ?? content(),
    huntId: 'arena',
    difficulty: options.difficulty ?? 'beginner',
    createdAtMs: 0,
    ...(options.exitRules === undefined ? {} : { exitRules: options.exitRules }),
  });
  const hero = character({
    ...(options.health === undefined ? {} : { health: options.health }),
    ...(options.staminaMs === undefined ? {} : { staminaMs: options.staminaMs }),
    ...(options.skills === undefined ? {} : { skills: options.skills }),
    ...(options.inventory === undefined ? {} : { inventory: options.inventory }),
  });
  session.enter(hero);
  return { session, hero, ruleset: session.ruleset as HuntRuleset };
}

/** Avança `durationMs` em passos de `stepMs`. É como se controla o tempo sem esperar por ele. */
function run(session: Session, durationMs: number, stepMs: number): void {
  const steps = Math.floor(durationMs / stepMs);
  for (let i = 0; i < steps && session.ended === null; i++) session.advanceBy(stepMs);
}

describe('entrada', () => {
  it('cria a instância com o mapa, a rota e os spawns da dificuldade escolhida', () => {
    const { session, hero, ruleset } = start();

    expect(session.ruleset.type).toBe('hunt');
    // Fixada na criação (invariante 7): a hunt termina na versão em que começou.
    expect(session.contentVersion).toBe(content().version);
    // Entrou no começo da rota, não na posição que trouxe da cidade.
    expect(hero.position).toEqual({ x: 1, y: 1, z: 7 });

    session.advanceBy(100);
    expect(ruleset.monsters).toHaveLength(1);
  });

  it('a densidade vem da dificuldade, e ela é dado', () => {
    // Trocar `perSpawnPoint` no JSON tem que mudar a hunt. Se precisasse de código, o formato
    // estaria errado — e é isso que este teste protege.
    const { session, ruleset } = start({ difficulty: 'professional' });
    session.advanceBy(100);
    expect(ruleset.monsters).toHaveLength(3);
  });

  it('recusa um segundo personagem em vez de deixá-lo parado a hunt inteira', () => {
    const { session } = start();
    expect(() => session.enter(character())).toThrow(/um personagem por instância/);
  });

  it('recusa dificuldade que a hunt não define', () => {
    expect(() => createHuntSession({
      id: 's', content: content(), huntId: 'arena', difficulty: 'legendary', createdAtMs: 0,
    })).toThrow(/não define a dificuldade "legendary"/);
  });
});

describe('a sessão em si', () => {
  it('percorre a rota enquanto não há monstro ao alcance', () => {
    // Sem ponto de spawn não nasce nada: sobra só o andar.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn });

    run(session, 1000, 100);
    // 500 ms por tile: um segundo de rota são dois tiles, e o primeiro passo sai já no
    // primeiro tick porque os cooldowns começam prontos (FUN-25).
    expect(hero.position).toEqual({ x: 4, y: 1, z: 7 });
  });

  it('para para lutar e retoma a rota depois, do mesmo índice', () => {
    const { session, ruleset, hero } = start();

    run(session, 1000, 100);
    // Parado, lutando: o rato saiu do ponto de spawn e encostou.
    expect(ruleset.monsters).toHaveLength(1);
    expect(session.aggregates.kills).toBe(0);
    const paradoEm = hero.position;
    const indice = ruleset.routeIndex;

    run(session, 3000, 100);
    // Matou e voltou a andar — do índice onde tinha parado, nunca do começo (FUN-42).
    expect(session.aggregates.kills).toBe(1);
    expect(ruleset.routeIndex).toBeGreaterThan(indice);
    expect(hero.position).not.toEqual(paradoEm);
  });

  it('credita XP por abate', () => {
    const { session, hero } = start();
    run(session, 10_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.xp).toBe(session.aggregates.kills * rat.experience);
    expect(session.aggregates.xpGained).toBe(hero.xp);
  });

  it('credita ao matador o gold sorteado da tabela do monstro (FUN-63)', () => {
    // Gold é DELTA no personagem e agregado na sessão, e os dois têm que bater: é o agregado
    // que vira linha de ledger, e um delta que o extrato não leva é gold que some no deploy.
    const { session, hero } = start();
    run(session, 20_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.goldDelta).toBe(session.aggregates.kills * 3);
    expect(session.aggregates.goldGained).toBe(hero.goldDelta);
  });

  it('chance zero nunca credita, e o abate conta do mesmo jeito', () => {
    const stingy = { ...rat, loot: { gold: { chance: 0, min: 1, max: 4 }, items: [] } };
    const { session, hero } = start({ loaded: content({ monsters: [stingy] }) });
    run(session, 20_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.goldDelta).toBe(0);
    expect(session.aggregates.goldGained).toBe(0);
  });

  it('a atribuição de dano atravessa o snapshot, e o abate retomado credita igual', () => {
    // Sem a atribuição no snapshot, o abate depois de uma retomada creditaria só a quem
    // bateu depois dela. Aqui a retomada acontece no MEIO da luta, e o resultado tem que ser
    // o da sessão que nunca caiu.
    const straight = start();
    const interrupted = start();
    // Até o primeiro golpe trocado: o monstro precisa estar ferido, não morto.
    while (interrupted.ruleset.monsters.every((m) => m.contribution.lastHitBy === null)
      && interrupted.session.nowMs < 30_000) {
      straight.session.advanceBy(100);
      interrupted.session.advanceBy(100);
    }
    expect(interrupted.ruleset.monsters.some((m) => m.contribution.lastHitBy === 'hero')).toBe(true);

    const snapshot = interrupted.session.snapshot();
    const resumed = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      new Rng(snapshot.rng),
    );
    run(straight.session, 20_000, 100);
    run(resumed, 20_000, 100);

    expect(resumed.aggregates.kills).toBe(straight.session.aggregates.kills);
    expect(resumed.aggregates.goldGained).toBe(straight.session.aggregates.goldGained);
    expect(resumed.participants[0]?.goldDelta).toBe(straight.hero.goldDelta);
  });

  it('a atribuição do personagem não cresce com os respawns', () => {
    // Cada respawn tem id novo. Sem poda, oito horas de hunt seriam milhares de chaves no
    // mapa do herói, serializadas a cada snapshot.
    const { session, hero, ruleset } = start({ difficulty: 'professional' });
    run(session, 120_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(3);
    expect(hero.contribution.actorCount).toBeLessThanOrEqual(ruleset.monsters.length);
  });

  it('não transforma cada abate em evento notável', () => {
    // `notableEvents` é a lista curta da tela de retorno (§16.2). Uma hunt de oito horas com
    // uma linha por rato não é lista, é log — e ninguém lê log ao voltar.
    const { session } = start({ difficulty: 'professional' });
    run(session, 60_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(1);
    expect(session.notableEvents.filter((e) => e.type === 'kill')).toHaveLength(0);
  });

  it('o monstro morto volta a nascer depois do prazo da hunt, não na hora', () => {
    const { session, ruleset } = start();
    // Até o primeiro abate, e guarda o instante: o prazo conta a partir dele, e prender o
    // teste a um número redondo o faria depender de quantos golpes o herói precisou dar.
    while (session.aggregates.kills === 0 && session.nowMs < 60_000) session.advanceBy(100);
    expect(session.aggregates.kills).toBe(1);
    // Respawn instantâneo faria a rota deixar de importar: o personagem mataria tudo parado
    // num ponto só.
    expect(ruleset.monsters).toHaveLength(0);

    // Ainda dentro dos 30 s da dificuldade: nada nasce, e portanto nada mais morre.
    session.advanceBy(29_000);
    expect(ruleset.monsters).toHaveLength(0);
    expect(session.aggregates.kills).toBe(1);

    // Prazo cumprido: o evento de spawn vence dentro deste avanço.
    session.advanceBy(1_000);
    expect(ruleset.monsters).toHaveLength(1);
  });
});

describe('regeneração (FUN-36)', () => {
  it('recupera por tempo decorrido, sem número por tick', () => {
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn, health: 100 });

    run(session, 30_000, 100);

    // 1 HP/s no conteúdo de teste: trinta segundos são trinta pontos, mais um do primeiro
    // tick — os cooldowns começam PRONTOS (FUN-25), a mesma regra que faz o personagem dar o
    // primeiro passo da rota sem esperar meio segundo parado.
    expect(hero.health).toBe(131);
  });

  it('rende exatamente o mesmo a 10 Hz e a 1 Hz', () => {
    // O erro que este desenho evita: somar `taxa * dtMs / 1000` num acumulador fracionário
    // deriva em ponto flutuante e some com uma unidade a cada dez. Em milissegundos a conta
    // é exata, e a hunt desanexada regenera igual à anexada.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const at = (hz: number): number => {
      const { session, hero } = start({ loaded: semSpawn, health: 100 });
      run(session, 600_000, 1000 / hz);
      return hero.health;
    };
    expect(at(1)).toBe(at(10));
    expect(at(20)).toBe(at(10));
  });

  it('não passa do máximo', () => {
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn });
    run(session, 60_000, 100);
    expect(hero.health).toBe(hero.maxHealth);
  });

  it('morto não regenera', () => {
    // Sem isso, um personagem que caiu voltaria sozinho na hunt em que morreu, e a morte
    // deixaria de encerrar coisa nenhuma.
    const { session, hero } = start({ difficulty: 'professional', health: 12 });
    run(session, 60_000, 100);
    expect(session.ended).toBe('death');
    expect(hero.health).toBe(0);
  });

  it('vale mesmo com stamina zerada: regenerar não é recompensa', () => {
    // O §10.2 diz que o personagem continua podendo morrer, não que ele passa a morrer mais
    // rápido.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, hero } = start({ loaded: semSpawn, health: 100, staminaMs: 0 });
    run(session, 30_000, 100);
    expect(hero.health).toBe(131);
  });

  it('taxa zero não regenera, e não trava o laço de recuperação', () => {
    // Taxa zero não é intervalo infinito: é "não regenera". Sem a saída explícita, o
    // intervalo viraria `Infinity` e o catch-up rodaria até o teto a cada tick.
    const parado = content({
      routes: [{ ...route, spawnPoints: [] }],
      progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    });
    const { session, hero } = start({ loaded: parado, health: 100 });
    run(session, 30_000, 100);
    expect(hero.health).toBe(100);
  });
});

describe('stamina zero', () => {
  it('NÃO encerra a hunt, e bloqueia só a recompensa', () => {
    // A regra que mais parece bug para quem implementa (§10.2). O personagem continua
    // caçando; o que ele deixa de ganhar é XP.
    const { session, hero } = start({ difficulty: 'professional', staminaMs: 0 });

    run(session, 60_000, 100);

    expect(session.ended).toBeNull();
    expect(session.aggregates.kills).toBeGreaterThan(0);
    // O abate conta: o jogador matou, e o extrato mentiria se dissesse que não.
    expect(hero.xp).toBe(0);
    expect(session.aggregates.xpGained).toBe(0);
    // E vale para o loot também (FUN-63): o portão do §10.2 é da recompensa inteira.
    expect(hero.goldDelta).toBe(0);
    expect(session.aggregates.goldGained).toBe(0);
  });

  it('cai 1:1 com o tempo de hunt', () => {
    const { session, hero } = start();
    run(session, 30_000, 100);
    expect(hero.staminaMs).toBe(86_400_000 - 30_000);
  });

  it('avisa UMA vez ao zerar, e a hunt segue', () => {
    // O cenário comum é o jogador ausente: daqui para a frente a hunt queima supply sem
    // gerar nada. Repetir a linha a cada tick encheria a tela de retorno com ela só.
    const { session } = start({ difficulty: 'professional', staminaMs: 5_000 });

    run(session, 60_000, 100);

    expect(session.ended).toBeNull();
    expect(session.notableEvents.filter((e) => e.type === 'stamina-exhausted'))
      .toHaveLength(1);
  });

  it('a hunt rende normalmente enquanto sobra stamina', () => {
    const { session, hero } = start({ difficulty: 'professional' });
    run(session, 60_000, 100);
    expect(hero.xp).toBeGreaterThan(0);
  });
});

describe('level up e penalidade de morte dentro da hunt', () => {
  it('subir de level É evento notável, ao contrário do abate', () => {
    // É a única coisa que aconteceu numa hunt de oito horas que o jogador quer ver ao voltar.
    const { session } = start({ difficulty: 'professional' });
    run(session, 120_000, 100);
    expect(session.notableEvents.filter((e) => e.type === 'level-up').length)
      .toBeGreaterThan(0);
  });

  it('morrer cobra XP, e o extrato conta a perda em vez de escondê-la', () => {
    // O extrato é o que vira linha de ledger: creditar a XP ganha sem descontar a perdida
    // daria ao jogador uma XP que ele não tem.
    const { session, hero } = start({ difficulty: 'professional', health: 12 });
    hero.level = 20;
    hero.xp = totalXpForLevel(20, progression as Progression);

    run(session, 60_000, 100);

    expect(session.ended).toBe('death');
    expect(hero.level).toBe(19);
    expect(session.aggregates.xpGained).toBeLessThan(0);
    expect(session.notableEvents.find((e) => e.type === 'xp-penalty')).toBeDefined();
    expect(session.notableEvents.find((e) => e.type === 'level-down')?.detail).toBe('20 → 19');
  });

  it('Premium paga menos por morrer', () => {
    const cobrança = (premium: boolean): number => {
      const session = createHuntSession({
        id: 's', content: content(), huntId: 'arena', difficulty: 'professional',
        createdAtMs: 0, premium,
      });
      const hero = character({ health: 12 });
      hero.level = 20;
      hero.xp = totalXpForLevel(20, progression as Progression);
      session.enter(hero);
      run(session, 60_000, 100);
      return Number(session.notableEvents.find((e) => e.type === 'xp-penalty')?.detail);
    };
    expect(cobrança(true)).toBeLessThan(cobrança(false));
  });

  it('sair ou ser encerrado por regra NÃO custa XP: quem paga é quem morre', () => {
    const { session, hero } = start({ difficulty: 'professional' });
    hero.level = 20;
    hero.xp = totalXpForLevel(20, progression as Progression);
    const antes = hero.xp;

    run(session, 10_000, 100);
    session.end('manual-exit');

    expect(hero.xp).toBeGreaterThanOrEqual(antes);
    expect(session.notableEvents.find((e) => e.type === 'xp-penalty')).toBeUndefined();
  });
});

describe('encerramento', () => {
  it('por ação manual, com extrato', () => {
    const { session } = start();
    run(session, 10_000, 100);
    const receipt = session.end('manual-exit');

    expect(session.ended).toBe('manual-exit');
    expect(receipt.reason).toBe('manual-exit');
    expect(receipt.aggregates.kills).toBeGreaterThan(0);
    expect(receipt.notableEvents.map((e) => e.type)).toContain('ended');
  });

  it('por regra automática de saída, dizendo QUAL regra', () => {
    // "Sua hunt encerrou por uma regra de saída" sem dizer qual é a mensagem que faz o
    // jogador desconfiar do bot que ele mesmo configurou.
    const rule: HuntExitRule = { id: 'two-kills', when: (view) => view.aggregates.kills >= 2 };
    const { session } = start({ exitRules: [rule] });

    run(session, 60_000, 100);

    expect(session.ended).toBe('exit-rule');
    expect(session.aggregates.kills).toBe(2);
    expect(session.notableEvents.find((e) => e.type === 'exit-rule')?.detail).toBe('two-kills');
  });

  it('por morte, com o extrato registrando a morte', () => {
    // Três ratos, não um: com a regeneração da FUN-36 no lugar, um rato sozinho já não mata
    // um personagem de level 1 — ele apanha, mata, e recupera durante o respawn.
    const { session, hero } = start({ difficulty: 'professional', health: 12 });
    run(session, 60_000, 100);

    expect(hero.alive).toBe(false);
    expect(session.ended).toBe('death');
    expect(session.aggregates.deaths).toBe(1);
    expect(session.notableEvents.map((e) => e.type)).toContain('death');
  });

  it('encerrada, não avança mais', () => {
    const { session, ruleset } = start();
    run(session, 10_000, 100);
    session.end('manual-exit');
    const antes = { ...session.aggregates };
    const monstros = ruleset.monsters.length;

    run(session, 60_000, 100);

    expect(session.aggregates).toEqual(antes);
    expect(ruleset.monsters).toHaveLength(monstros);
  });
});

describe('troca de dificuldade', () => {
  it('encerra a instância e cria outra, em vez de mudar no meio', () => {
    // §14.7: não existe alteração dinâmica. Mudar `perSpawnPoint` no meio deixaria monstros
    // da densidade antiga vivos ao lado dos novos, e o jogador veria uma dificuldade que não
    // é nenhuma das duas.
    const loaded = content();
    const { session, hero } = start({ loaded });
    run(session, 10_000, 100);

    const { session: nova, receipt } = changeDifficulty(session, {
      content: loaded, to: 'professional', newSessionId: 'session-2', nowMs: session.nowMs,
    });

    expect(session.ended).toBe('manual-exit');
    expect(receipt.aggregates.kills).toBeGreaterThan(0);
    expect(receipt.notableEvents.find((e) => e.type === 'difficulty-changed')?.detail)
      .toBe('beginner → professional');

    // Instância NOVA: id novo, agregados zerados, e a densidade da dificuldade nova.
    expect(nova.id).toBe('session-2');
    expect(nova.aggregates.kills).toBe(0);
    expect(nova.participants[0]).toBe(hero);
    nova.advanceBy(100);
    expect((nova.ruleset as HuntRuleset).monsters).toHaveLength(3);
  });
});

describe('snapshot', () => {
  it('retoma no mesmo ponto da rota, com os mesmos monstros e os mesmos prazos', () => {
    const loaded = content();
    const { session, ruleset } = start({ loaded });
    run(session, 8000, 100);

    const snapshot = session.snapshot();
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    const depois = retomado.ruleset as HuntRuleset;
    expect(depois.routeIndex).toBe(ruleset.routeIndex);
    expect(depois.monsters.map((m) => m.getState()))
      .toEqual(ruleset.monsters.map((m) => m.getState()));
    expect(retomado.aggregates).toEqual(session.aggregates);
    expect(retomado.participants[0]?.position).toEqual(session.participants[0]?.position);
  });

  it('retomada continua respawnando, e o prazo conta da retomada (FUN-70)', () => {
    // O teste que a FUN-70 pede, e o defeito que ele guarda era TOTAL, não marginal.
    //
    // `SpawnSlot` guardava `respawnAtMs` como instante absoluto derivado do `performance.now()`
    // do processo. Medido: nó A com seis horas de relógio marcava o respawn em 21.802.500; o nó
    // B subia com 5.000 e retomava. O prazo nunca vencia — a hunt rodava, gastava CPU, queimava
    // stamina e não gerava um único monstro, para sempre, sem erro nem log. Só voltaria a
    // funcionar quando o nó B acumulasse ~seis horas de `performance.now()`.
    //
    // O `rebaseClock` do ADR 0018 resolvia metade: reposicionava `lastTickMs` para o `dtMs` não
    // sair negativo, e deixava os instantes absolutos DENTRO do estado do ruleset na linha do
    // tempo antiga. Com relógio lógico (FUN-68) a classe inteira sai, porque não há instante de
    // processo em lugar nenhum — mas isso precisa de teste, não de confiança.
    const loaded = content();
    const { session, ruleset } = start({ loaded });

    // Até o primeiro abate: é o que deixa um respawn PENDENTE quando o snapshot é tirado. Sem
    // pendência, o teste passaria sem exercitar nada.
    while (session.aggregates.kills === 0 && session.nowMs < 60_000) session.advanceBy(100);
    expect(session.aggregates.kills).toBe(1);
    expect(ruleset.monsters).toHaveLength(0);

    // Pelo JSON, porque é assim que ele atravessa o Redis: um instante que só existisse em
    // memória passaria por aqui sem ser notado.
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );
    const depois = retomado.ruleset as HuntRuleset;
    expect(depois.monsters).toHaveLength(0);

    // Ainda dentro dos 30 s da dificuldade: nada nasce.
    retomado.advanceBy(29_000);
    expect(depois.monsters).toHaveLength(0);

    // Prazo cumprido: nasce. É esta linha que falhava com `0 monstros vivos` depois de dez
    // vezes o `respawnDelayMs`.
    retomado.advanceBy(2_000);
    expect(depois.monsters).toHaveLength(1);
  });

  it('não sobrou instante de processo no estado do ruleset (FUN-70)', () => {
    // A varredura que a FUN-70 pede antes de fechar: `respawnAtMs` era o único portador de
    // instante absoluto EM USO, e o mapa `until` de `Cooldowns` era o outro, morto. Se um
    // terceiro aparecer, ele reabre a mesma classe de defeito — e em silêncio.
    //
    // O que a fila da sessão guarda é relativo ao zero dela, então nada aqui pode passar do
    // relógio lógico por mais que a hunt inteira ainda tem pela frente.
    const { session, ruleset } = start();
    run(session, 8000, 100);

    for (const slot of (ruleset.getState()).spawner.slots) {
      expect(Object.keys(slot).sort()).toEqual(['occupantId', 'pointIndex']);
    }
    expect(Object.keys(ruleset.getState().route).sort()).toEqual(['index', 'stopped']);
    for (const monster of ruleset.getState().monsters) {
      expect(monster.cooldowns).toEqual({ until: {} });
    }
  });

  it('recusa retomar num conteúdo que não tem mais a hunt', () => {
    // Retomar na hunt errada é pior que não retomar: seriam monstros de um mapa andando em
    // outro, creditando XP que ninguém sabe de onde veio.
    const loaded = content();
    const { session } = start({ loaded });
    run(session, 1000, 100);

    const outro = buildContent(raw({
      hunts: [{ ...hunt, id: 'other' }], routes: [route], maps: [map],
    }));
    expect(huntRulesetFromSnapshot(session.snapshot(), outro)).toBeNull();
  });
});

describe('taxa de avanço', () => {
  /** Dez minutos de hunt na taxa dada. Tempo controlado: nada aqui espera de verdade. */
  const tenMinutesAt = (
    hz: number, difficulty: 'beginner' | 'professional', loaded?: Content,
  ): { session: Session; hero: CharacterRuntime } => {
    const { session, hero } = start({ difficulty, ...(loaded === undefined ? {} : { loaded }) });
    run(session, 600_000, 1000 / hz);
    return { session, hero };
  };

  const RATES = [1, 2, 5, 10, 20];

  it('rende exatamente o mesmo a 1, 2, 5, 10 e 20 Hz', () => {
    // O TESTE QUE DEFINE O PROJETO, agora numa sessão que de fato simula uma hunt. Se ele
    // quebrar, a hunt desanexada — que é o modo PADRÃO do jogo — deixou de valer o mesmo que
    // a anexada (invariantes 2 e 3).
    //
    // Desde a FUN-68 isto é uma propriedade da ESTRUTURA, e não de cada fórmula ter sido
    // escrita com cuidado: os eventos vencem nos mesmos instantes lógicos seja qual for o
    // tamanho da janela em que são despachados.
    const rendimento = RATES.map((hz) => {
      const { session, hero } = tenMinutesAt(hz, 'beginner');
      return { kills: session.aggregates.kills, xp: session.aggregates.xpGained, heroXp: hero.xp };
    });
    expect(rendimento[0]?.kills).toBeGreaterThan(0);
    for (const resultado of rendimento) expect(resultado).toEqual(rendimento[0]);
  });

  it('com vários monstros disputando o mesmo ponto, rende exatamente o mesmo', () => {
    // Este teste já foi um LIMITE de 5%, e virou igualdade na FUN-68. O motivo do limite era
    // real: com três monstros disputando um ponto, quem está "mais perto" mudava com a
    // granularidade do passo, porque num tick longo todos andavam vários tiles de uma vez
    // antes de alguém reavaliar distância. Com a fila, cada passo acontece no seu instante e
    // a vizinhança é a mesma em qualquer taxa — não sobra folga para o limite cobrir.
    const kills = RATES.map((hz) => tenMinutesAt(hz, 'professional').session.aggregates.kills);
    expect(kills[0]).toBeGreaterThan(0);
    for (const k of kills) expect(k).toBe(kills[0]);
  });

  it('e o dano SOFRIDO também é igual, desde a FUN-68', () => {
    // Este teste já foi um LIMITE, e virou uma igualdade. Vale guardar a história, porque ela
    // é a justificativa da FUN-68.
    //
    // A recompensa sempre foi igual entre taxas; o dano sofrido, não. Medido: 350 a 10 Hz
    // contra 530 a 1 Hz, 1,51× — e 1 Hz é a hunt desanexada, que é o modo PADRÃO do jogo.
    // Quem caçava AFK apanhava metade a mais.
    //
    // A causa era granularidade de ESPAÇO, não de tempo. Num tick de 1 s o personagem andava
    // dois tiles de uma vez, o rato também, e a adjacência era conferida UMA vez no fim: eles
    // passavam mais ticks colados do que passariam a 10 Hz, e é enquanto estão colados que o
    // ataque avança. O tick em lote não tinha como expressar "os dois andaram em t+500 e
    // nesse instante não estavam adjacentes".
    //
    // O comentário anterior dizia que corrigir "pediria subdividir o tick, o que gasta o que
    // cair para 1 Hz economiza". Era uma falsa escolha: o scheduler lógico processa só os
    // eventos que VENCEM, e é mais barato que o laço que ele substituiu.
    //
    // Sem regeneração NESTE cenário, e é decisão: a comparação é sobre granularidade, e um
    // personagem que se cura enquanto apanha mede as duas coisas somadas.
    const semRegen = content({
      progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
    });
    const dano = (hz: number): number => {
      const { hero } = tenMinutesAt(hz, 'beginner', semRegen);
      return hero.maxHealth - hero.health;
    };
    // E não é vácuo: o cenário machuca de verdade nas duas pontas.
    expect(dano(10)).toBeGreaterThan(0);
    for (const hz of RATES) expect(dano(hz)).toBe(dano(10));
  });

  it('desanexada cai para 1 Hz; anexada sobe para 10 (ADR 0003)', () => {
    const { session } = start();
    expect(session.currentHz()).toBe(1);
    session.attach('viewer');
    expect(session.currentHz()).toBe(10);
  });
});

describe('seleção de hunt', () => {
  it('mostra level recomendado e não tem onde guardar XP/h', () => {
    // §14.3. A regra vira ESTRUTURA: um número oficial de XP/h vira a métrica pela qual toda
    // hunt é julgada, e a partir daí só existe uma hunt boa — a do topo da tabela.
    const [listing] = huntListings(content());
    expect(listing).toEqual({
      id: 'arena', name: 'Arena', recommendedLevel: 1,
      difficulties: ['beginner', 'professional'],
    });
  });

  it('ordena por level recomendado, para servir a quem está começando', () => {
    const alta = { ...hunt, id: 'deep', name: 'Deep', recommendedLevel: 50 };
    expect(huntListings(content({ hunts: [alta, hunt] })).map((h) => h.id))
      .toEqual(['arena', 'deep']);
  });
});

describe('eventos de domínio (FUN-69)', () => {
  it('a hunt produz CreatureMoved do bot e dos monstros', () => {
    // `creature-move` não tinha emissor nenhum antes desta issue — nem para o bot, nem para os
    // monstros —, e é por isso que os 42,8 bytes/s medidos na FUN-45 não significavam nada: a
    // hunt não transmitia mundo para viewer algum.
    const { session } = start();
    run(session, 3000, 100);

    const eventos = session.drainEvents();
    expect(eventos.length).toBeGreaterThan(0);
    for (const evento of eventos) {
      expect(evento.kind).toBe('creature-moved');
      expect(evento.durationMs).toBeGreaterThan(0);
      // O andar vem do MAPA, e vai junto: quem lê isto do lado de fora precisa de `z`.
      expect(evento.to.z).toBe(7);
    }
    // Os dois lados do mundo se movem, e os dois são anunciados.
    const quemAndou = new Set(eventos.map((e) => String(e.creatureId)));
    expect(quemAndou.has('hero')).toBe(true);
    expect([...quemAndou].some((id) => id.startsWith('m:'))).toBe(true);
  });

  it('desanexada produz exatamente os mesmos eventos que anexada', () => {
    // O invariante 3 em forma de teste, e é o que o §12 exige em letra: viewer decide quem
    // SERIALIZA, nunca o que acontece. Um `if (temViewer)` no caminho de emissão faria a hunt
    // desanexada divergir sem ninguém ver.
    const semObservador = start();
    run(semObservador.session, 5000, 100);

    const comObservador = start();
    comObservador.session.attach('viewer-1');
    run(comObservador.session, 5000, 100);

    expect(comObservador.session.drainEvents()).toEqual(semObservador.session.drainEvents());
  });

  it('drenar esvazia, porque o que aconteceu não é o que a sessão é', () => {
    const { session } = start();
    run(session, 2000, 100);
    expect(session.drainEvents().length).toBeGreaterThan(0);
    expect(session.drainEvents()).toHaveLength(0);
  });

  it('não entra no snapshot — um passo reentregue viraria passo repetido na tela', () => {
    const { session } = start();
    run(session, 2000, 100);
    expect(Object.keys(session.snapshot())).not.toContain('domainEvents');
    // E a sessão retomada nasce sem nada a anunciar: o que aconteceu já aconteceu.
    const snapshot = session.snapshot();
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );
    expect(retomado.drainEvents()).toHaveLength(0);
  });

  it('sessão que ninguém drena não acumula sem limite', () => {
    // Uma hunt desanexada roda por horas. O teto é da `Session` porque o descarte precisa
    // existir mesmo se o hospedeiro esquecer de drenar — e isto é apresentação, que é
    // perdível. Gameplay não passa por aqui.
    const { session } = start();
    run(session, 600_000, 100);
    expect(session.drainEvents().length).toBeLessThanOrEqual(MAX_PENDING_DOMAIN_EVENTS);
  });
});

describe('movimento com escritor único (FUN-69)', () => {
  it('o walk recebe as razões tipadas, pelo mesmo caminho que o bot e o monstro', () => {
    // O ponto da FUN-69: uma regra de legalidade, três fontes. O jogador é a única fonte com
    // porta própria (`requestMove`); bot e monstro chegam à MESMA `canOccupy` por construção —
    // o passo de rota via `#step`, e o guloso via um `Blocked` derivado dela. O que se afirma
    // aqui é que a porta do jogador devolve a razão certa em cada caso, e que a legalidade
    // compartilhada vale para os monstros no teste seguinte.
    const { session, ruleset, hero } = start();
    session.advanceBy(100);
    const { x, y } = hero.position;

    // A parede logo ao norte: a arena tem y=0 bloqueado inteiro.
    expect(ruleset.requestMove(session, hero.id, { x, y: 0 }))
      .toEqual({ ok: false, reason: y === 1 ? 'tile-blocked' : 'not-adjacent' });
    expect(ruleset.requestMove(session, hero.id, { x: x + 2, y }))
      .toEqual({ ok: false, reason: 'not-adjacent' });
    expect(ruleset.requestMove(session, hero.id, { x, y }))
      .toEqual({ ok: false, reason: 'same-tile' });
    expect(ruleset.requestMove(session, hero.id, { x: -1, y: -1 }))
      .toEqual({ ok: false, reason: 'not-adjacent' });
  });

  it('monstros nunca acabam em parede nem dois no mesmo tile — a legalidade é compartilhada', () => {
    // A prova de que o guloso consulta a mesma `canOccupy`: dez minutos com três ratos
    // disputando um ponto, e nenhum instante com corpo em parede ou dois corpos num tile.
    const loaded = content();
    const { session, ruleset } = start({ difficulty: 'professional', loaded });
    const map = loaded.maps.get('arena');
    if (map === undefined) throw new Error('esperava o mapa');
    for (let i = 0; i < 600; i++) {
      session.advanceBy(1000);
      const tiles = new Set<string>();
      for (const m of ruleset.monsters) {
        expect(isBlocked(map, m.position.x, m.position.y)).toBe(false);
        tiles.add(`${m.position.x},${m.position.y}`);
      }
      expect(tiles.size).toBe(ruleset.monsters.length);
    }
  });

  it('um passo manual sai da rota, e o bot reentra pelo tile mais próximo', () => {
    // Sem isto o walker seguraria um índice que nunca mais fica adjacente, e o personagem
    // ficaria parado para sempre depois do primeiro `walk` — o pior formato de falha.
    const semSpawn = content({ routes: [{ ...route, spawnPoints: [] }] });
    const { session, ruleset, hero } = start({ loaded: semSpawn });
    session.advanceBy(100);                                    // um passo de rota
    const antes = ruleset.routeIndex;

    // Para dentro da sala, fora da rota (que percorre a borda interna).
    const manual = ruleset.requestMove(session, hero.id, { x: 2, y: 2 });
    expect(manual.ok).toBe(true);
    expect(hero.position).toEqual({ x: 2, y: 2, z: 7 });

    // O vencimento seguinte do passo de rota descobre e reentra, em vez de travar.
    run(session, 1000, 100);
    expect(ruleset.routeIndex).not.toBe(antes);
    expect(session.drainEvents().some((e) => e.creatureId === hero.id)).toBe(true);
  });

});

// --- as cinco categorias do bot (FUN-84) -----------------------------------------------------

import type { BotAction, BotConfig } from '@draconya/content';
import {
  BOT_VOCABULARY_VERSION, botConfigSchema, botExitRuleSchema, botTargetingSchema,
} from '@draconya/content';

const botConfig = (over: Partial<BotConfig> = {}): BotConfig =>
  // Pelo SCHEMA, e não por literal: é o schema que sabe preencher `targeting` e o que vier
  // depois dele. Um literal aqui obriga toda fixture a acompanhar cada campo novo com default,
  // que é trabalho que o parse já faz — e do jeito que a produção faz.
  botConfigSchema.parse({
    version: BOT_VOCABULARY_VERSION,
    heal: [], potion: [], attack: [], rune: [], support: [],
    ...over,
  });

/** Um atuador que anota o que foi pedido, e diz se executou. */
const recorder = (executes = true) => {
  const done: BotAction[] = [];
  return {
    done,
    perform(action: BotAction) { if (executes) done.push(action); return executes; },
  };
};

const withBot = (config: BotConfig, actuator?: { perform(a: BotAction): boolean }) => {
  const loaded = content();
  const session = createHuntSession({
    id: 'bot-session', content: loaded, huntId: 'arena', difficulty: 'beginner',
    createdAtMs: 0,
    botConfig: config,
    ...(actuator === undefined ? {} : { actuator }),
  });
  const hero = character();
  session.enter(hero);
  return { session, hero };
};

describe('cadência das cinco categorias (FUN-84)', () => {
  const scheduled = (session: Session): readonly string[] =>
    (session.ruleset.getState?.() as { botScheduled?: readonly string[] }).botScheduled ?? [];

  it('personagem SEM bot não agenda categoria nenhuma', () => {
    // O custo de cinco eventos por segundo por hunt só pode existir para quem configurou. Até
    // a FUN-81 isso é todo mundo, e uma fila com evento inerte é custo puro.
    const { session } = start();
    session.advanceBy(5_000);
    expect(scheduled(session)).toEqual([]);
  });

  it('categoria VAZIA não entra na fila, mesmo com bot configurado', () => {
    // Só `heal` tem regra. As outras quatro não custam evento nenhum — e o recusador mantém a
    // categoria engatilhada, então o que se vê é exatamente quem foi agendado.
    const { session } = withBot(botConfig({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'x' } }],
    }), recorder());
    expect(scheduled(session)).toEqual(['heal']);
  });

  it('o estado de "agendada" sobrevive ao snapshot — senão é ação DOBRADA', () => {
    // O evento pendente da categoria está na fila serializada. Restaurar como engatilhada
    // faria o próximo `#armBot` agendar um segundo, e a categoria agiria duas vezes por
    // cooldown. É a mesma invariante do golpe do personagem, e ela já quebrou uma vez lá.
    const { session } = withBot(botConfig({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'x' } }],
    }), recorder());

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as { ruleset: unknown };
    expect((snapshot.ruleset as { botScheduled: readonly string[] }).botScheduled)
      .toEqual(['heal']);
  });

  it('uma cura que executa NÃO atrasa o ataque: as categorias são independentes', () => {
    // §13.4: sem prioridade global. Se uma categoria bloqueasse a outra, o bot pararia de
    // atacar toda vez que curasse — que é a razão de serem eventos separados na fila.
    const actuator = recorder();
    const { session } = withBot(botConfig({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'cure' } }],
      attack: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'bolt' } }],
    }), actuator);

    session.advanceBy(50);

    expect(actuator.done.map((a) => (a.kind === 'spell' ? a.spellId : '')))
      .toEqual(expect.arrayContaining(['cure', 'bolt']));
  });

  it('duas regras válidas na mesma categoria executam SÓ a primeira', () => {
    const actuator = recorder();
    const { session } = withBot(botConfig({
      heal: [
        { when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'forte' } },
        { when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'fraca' } },
      ],
    }), actuator);

    session.advanceBy(50);

    expect(actuator.done).toHaveLength(1);
    expect(actuator.done[0]).toEqual({ kind: 'spell', spellId: 'forte' });
  });

  it('o cooldown de categoria conta a partir da AÇÃO, e vem do conteúdo', () => {
    // §13.5: 1 s por categoria. O número mora em `bot/baseline.json`, não em código.
    const actuator = recorder();
    const { session } = withBot(botConfig({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'cure' } }],
    }), actuator);

    session.advanceBy(50);
    expect(actuator.done).toHaveLength(1);
    // Antes de fechar o segundo, nada de novo.
    session.advanceBy(800);
    expect(actuator.done).toHaveLength(1);
    // Passado o cooldown, a categoria volta.
    session.advanceBy(300);
    expect(actuator.done).toHaveLength(2);
  });

  it('atuador que RECUSA não consome o cooldown da categoria', () => {
    // Sem mana, sem supply: a ação não aconteceu, e a categoria não pode ficar um segundo
    // parada por ter tentado. Ela engatilha e volta quando o mundo mudar.
    const actuator = recorder(false);
    const { session } = withBot(botConfig({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'cure' } }],
    }), actuator);

    session.advanceBy(2_000);

    expect(actuator.done).toHaveLength(0);
  });

  it('o mesmo resultado a 1 Hz e a 10 Hz, com as cinco configuradas', () => {
    // O contrato do invariante 3 aplicado ao bot: quem caça desanexado configurou o mesmo bot,
    // e ele precisa render o mesmo.
    const todas = botConfig({
      heal: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'h' } }],
      potion: [{ when: { kind: 'mana', op: '<=', percent: 100 }, do: { kind: 'supply', supplyId: 'p' } }],
      attack: [{ when: { kind: 'targets', op: '>=', count: 0 }, do: { kind: 'spell', spellId: 'a' } }],
      rune: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'item', itemId: 'r' } }],
      support: [{ when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 's' } }],
    });
    const run = (stepMs: number) => {
      const actuator = recorder();
      const { session } = withBot(todas, actuator);
      for (let at = stepMs; at <= 60_000; at += stepMs) session.advanceBy(stepMs);
      return actuator.done.length;
    };

    expect(run(1_000)).toBe(run(100));
  });
});

// --- o atuador embutido: magia e supply (FUN-74, FUN-77) -------------------------------------

/**
 * Uma hunt com bot e SEM atuador injetado — quem executa é a própria hunt.
 *
 * Mana e gold entram por aqui porque o conteúdo de teste nasceu antes de existir magia: o
 * `progression` compartilhado dá 0 de mana, e mexer nele mudaria os stats de todos os testes
 * acima. Um conteúdo próprio custa quatro linhas e não move nada de lugar.
 */
const withSpells = (
  config: BotConfig,
  over: {
    health?: number; mana?: number; gold?: number;
    spells?: readonly unknown[]; supplies?: readonly unknown[]; monsters?: boolean;
  } = {},
  difficulty: 'beginner' | 'professional' = 'beginner',
) => {
  // **Regeneração zerada, e é decisão.** Aqui o assunto é quanto a magia cura e quanto o
  // supply repõe; com 1 HP/s no meio, toda asserção absoluta viraria "mais ou menos isso", e
  // um teste que ninguém consegue conferir a olho é um teste que ninguém confia. Quem cuida
  // da regeneração é o bloco dela, onde ela é o assunto.
  const loaded = buildContent(raw({
    progression: [{
      ...progression, startingMana: 200, regen: { healthPerSecond: 0, manaPerSecond: 0 },
    }],
    ...(over.monsters === false ? { routes: [{ ...route, spawnPoints: [] }] } : {}),
    ...(over.spells === undefined ? {} : { spells: over.spells }),
    ...(over.supplies === undefined ? {} : { supplies: over.supplies }),
  }));
  const session = createHuntSession({
    id: 'spell-session', content: loaded, huntId: 'arena', difficulty,
    createdAtMs: 0, botConfig: config,
  });
  const stats = statsForLevel(1, null, loaded.progression);
  const hero = new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
    mana: over.mana ?? stats.maxMana, maxMana: stats.maxMana,
    level: 1, xp: 0, vocationId: null,
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
    gold: over.gold ?? 1_000, goldDelta: 0, alive: true, cooldowns: {},
  });
  session.enter(hero);
  return { session, hero, ruleset: session.ruleset as HuntRuleset };
};

const healRule = (percent: number) => ({
  when: { kind: 'hp' as const, op: '<=' as const, percent },
  do: { kind: 'spell' as const, spellId: 'heal' },
});

describe('magia (FUN-74)', () => {
  it('a cura repõe HP e debita mana, e os dois números vêm do CONTEÚDO', () => {
    // Mudar quanto a cura cura é editar JSON. Se um destes dois números aparecesse em código,
    // o balanceamento teria virado tarefa de quem mexe em `sim`.
    const { session, hero } = withSpells(
      botConfig({ heal: [healRule(50)] }), { health: 1_000, monsters: false },
    );

    session.advanceBy(50);

    expect(hero.health).toBe(1_060);
    expect(hero.mana).toBe(180);
  });

  it('sem mana a cura é RECUSADA, e a categoria não fica parada por causa disso', () => {
    // Recusar não é falhar: a hunt segue, e o slot volta a valer no instante em que houver
    // mana. Uma exceção aqui derrubaria a sessão por uma regra que o jogador escreveu certa.
    const { session, hero } = withSpells(
      botConfig({ heal: [healRule(50)] }), { health: 1_000, mana: 5, monsters: false },
    );

    session.advanceBy(2_000);

    expect(hero.health).toBe(1_000);
    expect(hero.mana).toBe(5);
  });

  it('o cooldown é POR MAGIA, e a categoria VOLTA no vencimento dele — não fica dormindo', () => {
    // Duas afirmações, e elas são a mesma mecânica vista dos dois lados.
    //
    // Categoria a 1 s, magia a 4 s: em doze segundos saem QUATRO curas — nos instantes 0,
    // 4 000, 8 000 e 12 000 —, e não doze. Quem tratasse o cooldown da categoria como se fosse
    // o da magia veria doze.
    //
    // E as três recusas entre uma cura e a seguinte não podem ENGATILHAR a categoria. Uma
    // categoria engatilhada só acorda quando o mundo muda, e aqui o mundo não muda: sem ponto
    // de spawn não há monstro, e a regeneração está zerada. Se a volta dependesse do mundo,
    // sairia UMA cura e mais nenhuma.
    const lenta = [
      { ...spells[0], cooldownMs: 4_000 },
      spells[1],
    ];
    const { session, hero } = withSpells(
      botConfig({ heal: [healRule(100)] }),
      { health: 1_000, spells: lenta, monsters: false },
    );

    run(session, 12_100, 100);

    expect(hero.mana).toBe(200 - 4 * 20);
  });

  it('a magia de ataque mata o monstro, e o abate credita quem lançou', () => {
    // O dano de magia passa pela MESMA atribuição do golpe (`recordDamage`) e pelo MESMO
    // pipeline de morte. Se não passasse, o rato morreria sem dono e a recompensa evaporaria —
    // que é o formato de defeito que ninguém liga à causa.
    const { session, hero } = withSpells(botConfig({
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'strike' },
      }],
    }));

    run(session, 20_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
    // Loot fixo de 3 por rato: o gold ganho tem que bater com os abates.
    expect(session.aggregates.goldGained).toBe(session.aggregates.kills * 3);
    expect(hero.xp).toBeGreaterThan(0);
  });

  it('magia que sumiu do conteúdo não derruba a hunt: a regra só não faz nada', () => {
    // `validateBotConfig` recusa isto na ENTRADA. Sobra o conteúdo mudar sob uma sessão em
    // voo, e aí a resposta certa é a hunt continuar — quem estava caçando não perde a sessão
    // por um arquivo que alguém renomeou.
    const { session, hero } = withSpells(botConfig({
      heal: [{
        when: { kind: 'hp', op: '<=', percent: 100 },
        do: { kind: 'spell', spellId: 'nao-existe' },
      }],
    }), { health: 1_000, monsters: false });

    expect(() => run(session, 3_000, 100)).not.toThrow();
    expect(hero.mana).toBe(200);
  });
});

describe('supply (FUN-77)', () => {
  const potionRule = (supplyId: string, percent: number) => ({
    when: { kind: 'hp' as const, op: '<=' as const, percent },
    do: { kind: 'supply' as const, supplyId },
  });

  it('a poção repõe vida, debita gold do saldo e entra no goldSpent do extrato', () => {
    // §20.1: poção não é item físico — usar debita gold direto. O extrato leva o gasto ao
    // ledger junto com o ganho (invariante 10), e é por isso que o agregado existe.
    const { session, hero } = withSpells(
      botConfig({ potion: [potionRule('health-potion', 50)] }),
      { health: 1_000, gold: 100, monsters: false },
    );

    session.advanceBy(50);

    expect(hero.health).toBe(1_080);
    expect(hero.goldDelta).toBe(-45);
    expect(session.aggregates.goldSpent).toBe(45);
  });

  it('a poção de mana repõe MANA, e sai da mesma categoria', () => {
    const { session, hero } = withSpells(
      botConfig({ potion: [{
        when: { kind: 'mana', op: '<=', percent: 50 },
        do: { kind: 'supply', supplyId: 'mana-potion' },
      }] }),
      { mana: 20, gold: 500, monsters: false },
    );

    session.advanceBy(50);

    expect(hero.mana).toBe(120);
    expect(session.aggregates.goldSpent).toBe(50);
  });

  it('sem gold, a poção é recusada e o saldo NUNCA fica negativo', () => {
    // A garantia é a ordem: o débito é recusado antes, não corrigido depois. Um delta negativo
    // aqui viraria uma linha de ledger que tira gold que o personagem não tem.
    const { session, hero } = withSpells(
      botConfig({ potion: [potionRule('health-potion', 100)] }),
      { health: 1_000, gold: 44, monsters: false },
    );

    run(session, 5_000, 100);

    expect(hero.goldDelta).toBe(0);
    expect(session.aggregates.goldSpent).toBe(0);
    expect(hero.health).toBe(1_000);
  });

  it('o gold que acabou vira UMA linha no extrato, e não uma por tentativa', () => {
    // §20.3 sem a regra de saída: a hunt continua, sem poção, e o personagem pode morrer. Isso
    // é comportamento, não erro — mas quem estava ausente precisa encontrar o motivo na tela
    // de retorno. Uma linha por tentativa encheria a lista curta até ela deixar de ser lista,
    // que é a mesma razão pela qual o aviso de stamina sai uma vez só.
    const { session } = withSpells(
      botConfig({ potion: [potionRule('health-potion', 100)] }),
      { health: 1_000, gold: 0, monsters: false },
    );

    run(session, 10_000, 100);

    const avisos = session.notableEvents.filter((e) => e.type === 'supply-unaffordable');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.detail).toBe('health-potion');
  });

  it('o aviso sobrevive ao snapshot: retomar não repete a notícia', () => {
    const { session } = withSpells(
      botConfig({ potion: [potionRule('health-potion', 100)] }),
      { health: 1_000, gold: 0, monsters: false },
    );
    session.advanceBy(100);

    const state = session.ruleset.getState?.() as { warnedNoGold?: boolean };
    expect(state.warnedNoGold).toBe(true);
  });

  it('o gold ganho na hunt já dá para gastar na hunt, sem passar pelo banco', () => {
    // Idle-first: exigir que o loot passasse pelo banco antes de virar poção faria a poção só
    // chegar depois de encerrar a sessão. O saldo é o de entrada MAIS o delta, e é por isso
    // que `balanceOf` soma os dois em vez de olhar só o que veio da tabela.
    //
    // O personagem entra com ZERO e a poção custa exatamente o loot de um rato: a primeira
    // tentativa é recusada, e a que vem depois do primeiro abate passa. Se o saldo ignorasse o
    // delta, nenhuma passaria nunca.
    const barata = [{ ...supplies[0], price: 3 }, supplies[1]];
    const { session, hero } = withSpells(botConfig({
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'strike' },
      }],
      potion: [potionRule('health-potion', 100)],
    }), { health: 1_000, gold: 0, supplies: barata });

    run(session, 20_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(session.aggregates.goldSpent).toBeGreaterThan(0);
    // Nunca gastou mais do que ganhou: o saldo não fica negativo em nenhum instante.
    expect(hero.gold + hero.goldDelta).toBeGreaterThanOrEqual(0);
  });
});

describe('a equivalência entre taxas vale para magia e supply também', () => {
  it('1 Hz e 10 Hz dão o MESMO resultado, com cura, poção e magia de dano', () => {
    // É o teste que mais importa deste pacote, aplicado ao que esta issue acrescentou. Se
    // divergir, alguém pôs decisão de jogo fora da fila de eventos — e o cooldown de magia é
    // exatamente o lugar onde um acumulador entraria sem ninguém notar.
    const completo = botConfig({
      heal: [healRule(90)],
      potion: [{
        when: { kind: 'mana', op: '<=', percent: 40 },
        do: { kind: 'supply', supplyId: 'mana-potion' },
      }],
      attack: [{
        when: { kind: 'targets', op: '>=', count: 1 },
        do: { kind: 'spell', spellId: 'strike' },
      }],
    });

    const at = (stepMs: number) => {
      const { session, hero } = withSpells(completo, { health: 2_000, gold: 10_000 });
      run(session, 120_000, stepMs);
      return {
        kills: session.aggregates.kills,
        goldGained: session.aggregates.goldGained,
        goldSpent: session.aggregates.goldSpent,
        xp: hero.xp,
        health: hero.health,
        mana: hero.mana,
        goldDelta: hero.goldDelta,
      };
    };

    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    // E o cenário precisa ter EXERCITADO o que diz exercitar: um empate de zeros passaria por
    // equivalência sem provar nada. Foi assim que a FUN-67 atravessou um teste vazio.
    expect(rapido.kills).toBeGreaterThan(0);
    expect(rapido.goldSpent).toBeGreaterThan(0);
  });
});

// --- alvo e postura (FUN-85) -----------------------------------------------------------------

// Uma sala grande, e uma rota em anel no meio dela. A sala do resto deste arquivo tem 4×3 —
// nela tudo está a três tiles de tudo, e postura não teria como ser distinguida de rota.
//
//     0 1 2 3 4 5 6 7 8 9
//   0 # # # # # # # # # #
//   1 # . . . . . . . . #
//   2 # . . . . . . . . #
//   3 # . . . . . . . . #      ← a rota corre por aqui
//   4 # . . . . . . . . #
//   5 # . . . . . . . . #      ← e volta por aqui
//   6 # # # # # # # # # #
const salaGrande = {
  id: 'salao', z: 7,
  grid: ['##########', '#........#', '#........#', '#........#', '#........#', '#........#',
    '##########'],
};

/** O anel. O índice 0 é (4,3) — o meio —, e o índice 10 é (4,5), dois tiles ABAIXO dele. */
const anel = {
  id: 'salao-anel', mapId: 'salao',
  tiles: [
    { x: 4, y: 3, z: 7 }, { x: 5, y: 3, z: 7 }, { x: 6, y: 3, z: 7 }, { x: 7, y: 3, z: 7 },
    { x: 8, y: 3, z: 7 }, { x: 8, y: 4, z: 7 }, { x: 8, y: 5, z: 7 }, { x: 7, y: 5, z: 7 },
    { x: 6, y: 5, z: 7 }, { x: 5, y: 5, z: 7 }, { x: 4, y: 5, z: 7 }, { x: 3, y: 5, z: 7 },
    { x: 2, y: 5, z: 7 }, { x: 1, y: 5, z: 7 }, { x: 1, y: 4, z: 7 }, { x: 1, y: 3, z: 7 },
    { x: 2, y: 3, z: 7 }, { x: 3, y: 3, z: 7 },
  ],
  // `radius: 1` com o tile do centro livre coloca o monstro EXATAMENTE em (4,5):
  // `tilesAround` entrega o centro primeiro, e é isso que torna a posição previsível.
  spawnPoints: [{ routeIndex: 10, radius: 1 }],
};

/**
 * Um monstro que fica ONDE NASCEU: `aggroRadius: 0` faz `chooseTarget` nunca achar alvo, e sem
 * alvo não há passo nem golpe. É o que permite afirmar a posição do personagem sem que a
 * decisão do monstro entre na conta — aqui o assunto é a postura, não a IA dele.
 */
const poste = {
  ...rat, id: 'post', name: 'Poste', aggroRadius: 0, health: 40,
};

/**
 * O mesmo poste, com vida que não acaba.
 *
 * Existe porque duas perguntas diferentes precisam de alvos diferentes: "ele volta para a rota
 * quando o alvo morre" exige um monstro que morra, e "ele PARA ao alcance em vez de tentar
 * pisar em cima" exige um que não morra — senão o teste mede o depois da morte e passa por
 * acidente, que foi como ele passou da primeira vez que o escrevi.
 */
const posteEterno = { ...poste, id: 'post-tank', name: 'Poste Eterno', health: 1_000_000 };

const huntSalao = {
  id: 'salao', name: 'Salão', recommendedLevel: 1, mapId: 'salao', routeId: 'salao-anel',
  difficulties: {
    beginner: {
      perSpawnPoint: 1, composition: [{ monsterId: 'post', weight: 1 }], respawnDelayMs: 600_000,
    },
    professional: {
      perSpawnPoint: 1, composition: [{ monsterId: 'post-tank', weight: 1 }],
      respawnDelayMs: 600_000,
    },
    // Ratos de verdade — que andam, agroam e renascem. É o cenário movimentado que a
    // equivalência entre taxas precisa para não medir um empate de zeros.
    hero: {
      perSpawnPoint: 2, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 5_000,
    },
  },
};

const withPosture = (
  over: Record<string, unknown>,
  difficulty: 'beginner' | 'professional' | 'hero' = 'beginner',
) => {
  const loaded = buildContent(raw({
    monsters: [rat, poste, posteEterno], hunts: [hunt, huntSalao],
    maps: [map, salaGrande], routes: [route, anel],
  }));
  const session = createHuntSession({
    id: 'postura', content: loaded, huntId: 'salao', difficulty, createdAtMs: 0,
    botConfig: botConfig({ targeting: botTargetingSchema.parse(over) }),
  });
  const hero = character();
  session.enter(hero);
  return { session, hero, ruleset: session.ruleset as HuntRuleset };
};

describe('postura: o primeiro caso em que o personagem sai da rota por decisão própria', () => {
  // O personagem nasce em (4,3) e o monstro nasce em (4,5): dois tiles ABAIXO, fora do alcance
  // de ataque (1) e dentro do raio de visão (8). A rota, do índice 0, vai para a DIREITA — então
  // "andou pela rota" e "andou atrás do alvo" apontam para lados diferentes, e um teste consegue
  // distinguir os dois.
  it('stand percorre a rota e IGNORA o alvo fora de alcance — o comportamento de sempre', () => {
    const { session, hero, ruleset } = withPosture({ posture: { kind: 'stand' } });

    session.advanceBy(10);

    expect(ruleset.monsters[0]?.position).toEqual({ x: 4, y: 5, z: 7 });
    // Índice 1 da rota. Andou para a direita, de costas para o monstro.
    expect(hero.position).toEqual({ x: 5, y: 3, z: 7 });
  });

  it('follow anda ATRÁS do alvo, pelo mesmo sistema de movimento', () => {
    const { session, hero } = withPosture({ posture: { kind: 'follow' } });

    session.advanceBy(10);

    expect(hero.position).toEqual({ x: 4, y: 4, z: 7 });
  });

  it('follow PARA ao alcance, e não fica tentando pisar em cima do alvo', () => {
    // Alvo que não morre, de propósito: meio minuto de vencimentos de passo com o monstro
    // sempre ali. Se ele continuasse perseguindo depois de alcançar, tentaria ocupar o tile do
    // monstro a cada passo — `movement.ts` recusa, mas a tentativa em si é o bot batendo a
    // cabeça na parede para sempre, e o teste não veria diferença se o alvo tivesse morrido.
    const { session, hero, ruleset } = withPosture({ posture: { kind: 'follow' } }, 'professional');

    run(session, 30_000, 100);

    expect(ruleset.monsters[0]?.alive).toBe(true);
    expect(hero.position).toEqual({ x: 4, y: 4, z: 7 });
    // E ficou batendo o tempo todo: parar de andar não é parar de lutar.
    expect(ruleset.monsters[0]?.health).toBeLessThan(1_000_000);
  });

  it('keep-distance RECUA quando o alvo está perto demais', () => {
    // Distância pedida 3, distância real 2: ele anda para trás, não para frente. É a única
    // postura que produz passo na direção oposta à do alvo.
    const { session, hero } = withPosture({ posture: { kind: 'keep-distance', tiles: 3 } });

    session.advanceBy(10);

    expect(hero.position).toEqual({ x: 4, y: 2, z: 7 });
  });

  it('keep-distance FICA PARADO na distância pedida — não volta a percorrer a rota', () => {
    // Voltar para a rota ao chegar na distância certa faria o personagem oscilar entre manter
    // distância e seguir o laço, e de fora isso parece o bot travado.
    const { session, hero } = withPosture(
      { posture: { kind: 'keep-distance', tiles: 2 } }, 'professional',
    );

    run(session, 10_000, 100);

    expect(hero.position).toEqual({ x: 4, y: 3, z: 7 });
  });

  it('morto o alvo, o personagem VOLTA para a rota', () => {
    // A postura só manda enquanto há alvo. Sem alvo, `#holdPosture` devolve `false` e o passo
    // volta a ser o da rota — que é o caminho de sempre, incluindo o `rejoinNearest` de quem
    // saiu dela.
    const { session, hero, ruleset } = withPosture({ posture: { kind: 'follow' } });
    const naRota = (p: { x: number; y: number }) =>
      anel.tiles.some((t) => t.x === p.x && t.y === p.y);

    run(session, 30_000, 100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(ruleset.monsters.filter((m) => m.alive)).toHaveLength(0);

    run(session, 10_000, 100);
    expect(naRota(hero.position)).toBe(true);
  });

  it('ignorar o único monstro faz a hunt inteira virar caminhada', () => {
    // O bot não ataca, e a postura não tem atrás de quem ir: ele percorre a rota e pronto. É
    // o mesmo efeito de não haver monstro, e é o que "ignorar" tem que significar.
    const { session, ruleset } = withPosture({
      posture: { kind: 'follow' }, ignore: ['post'],
    });

    run(session, 30_000, 100);

    expect(session.aggregates.kills).toBe(0);
    expect(ruleset.monsters[0]?.health).toBe(40);
    expect(ruleset.monsters[0]?.position).toEqual({ x: 4, y: 5, z: 7 });
  });
});

describe('a equivalência entre taxas vale para a postura também', () => {
  it('1 Hz e 10 Hz dão o MESMO resultado com o personagem perseguindo o alvo', () => {
    // Postura é MOVIMENTO, e movimento é a coisa que mais quebrou equivalência neste projeto:
    // o 1,51× de dano sofrido da FUN-68 saía exatamente de o personagem atravessar vários
    // tiles num tick longo. Perseguir acrescenta um passo por vencimento fora da rota, e ele
    // precisa cair no mesmo instante lógico nas duas taxas.
    const at = (stepMs: number) => {
      const { session, hero, ruleset } = withPosture(
        { posture: { kind: 'follow' }, policy: 'lowest-hp' }, 'hero',
      );
      run(session, 120_000, stepMs);
      return {
        kills: session.aggregates.kills,
        xp: hero.xp,
        health: hero.health,
        position: { ...hero.position },
        vivos: ruleset.monsters.filter((m) => m.alive).length,
        posicoes: ruleset.monsters.map((m) => `${m.monsterId}@${m.position.x},${m.position.y}`),
      };
    };

    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    // E o cenário exercitou o que diz exercitar: um empate de zeros passaria por equivalência
    // sem provar nada, que foi como a FUN-67 atravessou um teste vazio.
    expect(rapido.kills).toBeGreaterThan(0);
  });
});

// --- regras de saída do jogador (FUN-86) -----------------------------------------------------

/** Uma hunt sem monstro nenhum: aqui o assunto é quando ela ENCERRA, não o que acontece nela. */
const withExit = (
  exit: readonly Record<string, unknown>[],
  over: { health?: number; gold?: number; goldDelta?: number } = {},
) => {
  const loaded = buildContent(raw({
    routes: [{ ...route, spawnPoints: [] }],
    progression: [{ ...progression, regen: { healthPerSecond: 0, manaPerSecond: 0 } }],
  }));
  const session = createHuntSession({
    id: 'saida', content: loaded, huntId: 'arena', difficulty: 'beginner', createdAtMs: 0,
    // Pelo schema, como a configuração do jogador chega: é ele que valida o percentual e
    // recusa um `kind` que o vocabulário não conhece.
    botConfig: botConfig({ exit: exit.map((r) => botExitRuleSchema.parse(r)) }),
  });
  const stats = statsForLevel(1, null, loaded.progression);
  const hero = new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
    mana: stats.maxMana, maxMana: stats.maxMana, level: 1, xp: 0, vocationId: null,
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
    gold: over.gold ?? 500, goldDelta: over.goldDelta ?? 0, alive: true, cooldowns: {},
  });
  session.enter(hero);
  return { session, hero };
};

/** O motivo que o extrato registrou, ou `null`. É a resposta a "por que minha hunt acabou?". */
const motivo = (session: Session): string | null =>
  session.notableEvents.find((e) => e.type === 'exit-rule')?.detail ?? null;

describe('regras de saída (FUN-86)', () => {
  it('sem regra nenhuma, a hunt não encerra sozinha', () => {
    // O default é lista vazia, e lista vazia tem que ser o comportamento de antes desta issue.
    const { session } = withExit([], { health: 1 });
    run(session, 10_000, 100);
    expect(session.ended).toBeNull();
  });

  it('hp-below encerra por `exit-rule`, e o extrato diz QUAL regra foi', () => {
    // "Sua hunt encerrou por uma regra de saída", sem dizer qual, é a mensagem que faz o
    // jogador desconfiar do bot que ele mesmo configurou.
    const { session } = withExit([{ kind: 'hp-below', percent: 50 }], { health: 100 });

    run(session, 5_000, 100);

    expect(session.ended).toBe('exit-rule');
    expect(motivo(session)).toBe('hp-below-50');
  });

  it('o percentual entra no id: duas regras de HP são distinguíveis no extrato', () => {
    const { session } = withExit([{ kind: 'hp-below', percent: 20 }], { health: 100 });
    run(session, 5_000, 100);
    expect(motivo(session)).toBe('hp-below-20');
  });

  it('hp-below NÃO dispara acima do limite', () => {
    // 60% de vida contra uma regra de 50%: a hunt continua. O `<` estrito importa — com `<=`,
    // uma regra de 100% encerraria a hunt de quem está com a vida cheia.
    const stats = statsForLevel(1, null, buildContent(raw()).progression);
    const { session } = withExit(
      [{ kind: 'hp-below', percent: 50 }], { health: Math.round(stats.maxHealth * 0.6) },
    );
    run(session, 5_000, 100);
    expect(session.ended).toBeNull();
  });

  it('out-of-gold encerra quando o saldo zera — e é SALDO, não delta', () => {
    // Entrou com 40 e gastou 40 na sessão: o delta é -40 e o saldo é zero. Olhar só para o
    // delta faria a regra disparar em quem tem mil de gold e gastou um.
    const { session } = withExit([{ kind: 'out-of-gold' }], { gold: 40, goldDelta: -40 });
    run(session, 5_000, 100);
    expect(session.ended).toBe('exit-rule');
    expect(motivo(session)).toBe('out-of-gold');
  });

  it('out-of-gold não dispara com saldo positivo, mesmo tendo gastado', () => {
    const { session } = withExit([{ kind: 'out-of-gold' }], { gold: 500, goldDelta: -400 });
    run(session, 5_000, 100);
    expect(session.ended).toBeNull();
  });

  it('SEM a regra, gold zerado deixa a hunt correr — é o §20.3 da FUN-77', () => {
    // As duas metades do §20.3 num teste só: sem a regra o personagem fica, sem conseguir
    // pagar supply, e pode morrer. Com ela (teste acima), sai.
    const { session } = withExit([], { gold: 0, goldDelta: 0 });
    run(session, 10_000, 100);
    expect(session.ended).toBeNull();
  });

  it('party-member-lost é INERTE numa hunt de um, e nunca dispara sozinha', () => {
    // Party é F3. A regra entra no vocabulário agora para a configuração salva não mudar de
    // forma depois — e um jogador que a marque hoje não pode ver a hunt encerrar por causa
    // dela. É o teste que a issue pede explicitamente.
    const { session } = withExit([{ kind: 'party-member-lost' }], { health: 1 });
    run(session, 30_000, 100);
    expect(session.ended).toBeNull();
  });

  it('a primeira regra que vale encerra, e é a dela que vai para o extrato', () => {
    const { session } = withExit(
      [{ kind: 'out-of-gold' }, { kind: 'hp-below', percent: 90 }],
      { health: 10, gold: 0 },
    );
    run(session, 5_000, 100);
    expect(motivo(session)).toBe('out-of-gold');
  });

  it('encerra por `exit-rule`, nunca por `manual-exit` — o extrato tem que dizer a verdade', () => {
    // O jogador não pediu para sair; a regra dele decidiu. Trocar os dois é o extrato mentindo
    // sobre quem encerrou, e é o que a issue proíbe em letra.
    const { session } = withExit([{ kind: 'hp-below', percent: 99 }], { health: 1 });
    run(session, 5_000, 100);
    expect(session.ended).toBe('exit-rule');
  });
});

describe('os predicados de saída, isolados (FUN-86)', () => {
  // Testar a closure direto é o que permite montar casos que a hunt inteira não produz — um
  // participante morto ao lado de um vivo, por exemplo, que numa hunt de um é impossível
  // porque a morte do único personagem encerra a sessão antes.
  const view = (participants: readonly CharacterRuntime[]): HuntView => ({
    elapsedMs: 0,
    aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
    participants,
    monstersAlive: 0,
  });

  const alguem = (over: Partial<{
    id: string; health: number; maxHealth: number; gold: number; goldDelta: number; alive: boolean;
  }> = {}): CharacterRuntime => new CharacterRuntime({
    id: over.id ?? 'hero', position: { x: 1, y: 1, z: 7 },
    health: over.health ?? 100, maxHealth: over.maxHealth ?? 100,
    mana: 0, maxMana: 0, level: 1, xp: 0, vocationId: null,
    staminaMs: null, staminaUpdatedAtMs: 0,
    gold: over.gold ?? 0, goldDelta: over.goldDelta ?? 0,
    alive: over.alive ?? true, cooldowns: {},
  });

  const only = (rule: Record<string, unknown>) =>
    (compileExitRules([botExitRuleSchema.parse(rule)])[0] as HuntExitRule);

  it('hp-below compara ESTRITAMENTE: 100% de vida não dispara uma regra de 100%', () => {
    // Com `<=`, quem configurasse "sair abaixo de 100%" veria a hunt encerrar no instante em
    // que entrasse — de vida cheia, sem ter tomado um golpe.
    const cheio = only({ kind: 'hp-below', percent: 100 });
    expect(cheio.when(view([alguem({ health: 100, maxHealth: 100 })]))).toBe(false);
    expect(cheio.when(view([alguem({ health: 99, maxHealth: 100 })]))).toBe(true);
  });

  it('hp-below no limite exato não dispara', () => {
    const meio = only({ kind: 'hp-below', percent: 50 });
    expect(meio.when(view([alguem({ health: 50, maxHealth: 100 })]))).toBe(false);
    expect(meio.when(view([alguem({ health: 49, maxHealth: 100 })]))).toBe(true);
  });

  it('hp-below não dispara sobre personagem morto — a morte já encerrou por conta dela', () => {
    // Sem isto, a mesma sessão registraria morte E regra de saída, e o extrato teria dois
    // motivos para um encerramento só.
    const meio = only({ kind: 'hp-below', percent: 50 });
    expect(meio.when(view([alguem({ health: 0, alive: false })]))).toBe(false);
  });

  it('hp-below com maxHealth zero não divide por zero — devolve falso', () => {
    const meio = only({ kind: 'hp-below', percent: 50 });
    expect(meio.when(view([alguem({ health: 0, maxHealth: 0 })]))).toBe(false);
  });

  it('out-of-gold olha o SALDO — entrada mais delta —, nunca só o delta', () => {
    const semGold = only({ kind: 'out-of-gold' });
    // Gastou 400 de 500: delta negativo, saldo positivo. Não é hora de sair.
    expect(semGold.when(view([alguem({ gold: 500, goldDelta: -400 })]))).toBe(false);
    // Gastou tudo: saldo zero.
    expect(semGold.when(view([alguem({ gold: 400, goldDelta: -400 })]))).toBe(true);
    // Ganhou na hunt: saldo positivo mesmo tendo entrado sem nada.
    expect(semGold.when(view([alguem({ gold: 0, goldDelta: 30 })]))).toBe(false);
  });

  it('party-member-lost ignora o PRÓPRIO personagem, mesmo morto', () => {
    // O laço começa no segundo participante de propósito. Sem isso, o personagem que morre
    // sozinho encerraria por "membro da party morreu" em vez de por morte — o extrato daria o
    // motivo errado, e ele é o que o jogador lê ao voltar.
    const semParty = only({ kind: 'party-member-lost' });
    expect(semParty.when(view([alguem({ alive: false })]))).toBe(false);
    expect(semParty.when(view([alguem()]))).toBe(false);
  });

  it('party-member-lost dispara quando um COMPANHEIRO cai — o dia em que party existir', () => {
    const semParty = only({ kind: 'party-member-lost' });
    const eu = alguem({ id: 'hero' });
    const amigo = alguem({ id: 'friend', alive: false });
    expect(semParty.when(view([eu, amigo]))).toBe(true);
  });

  it('lista vazia compila para lista vazia — nada avaliado, nada custa', () => {
    expect(compileExitRules([])).toEqual([]);
  });
});

// --- a configuração sobrevive ao snapshot e à troca ao vivo (FUN-81) -------------------------

describe('a configuração do bot atravessa o snapshot (FUN-81)', () => {
  const curar = botConfig({
    heal: [{ when: { kind: 'hp', op: '<=', percent: 90 }, do: { kind: 'spell', spellId: 'heal' } }],
    targeting: botTargetingSchema.parse({ policy: 'lowest-hp', ignore: ['rat'] }),
    exit: [botExitRuleSchema.parse({ kind: 'hp-below', percent: 10 })],
  });

  /**
   * Pool de vida REALISTA aqui, ao contrário do resto do arquivo.
   *
   * O `progression` compartilhado dá 500.000 de HP inicial para uma hunt de dez minutos caber
   * sem morrer, e com ele um herói com 1.000 de vida está a 0,2% do máximo — a regra de saída
   * `hp-below: 10` encerraria a sessão em 250 ms, antes de qualquer snapshot. Foi exatamente o
   * que aconteceu na primeira versão destes testes: eles falharam por causa da fixture, não do
   * código. Com 1.000 de teto, "metade da vida" quer dizer metade.
   */
  const comBot = (health = 500) => {
    const loaded = buildContent(raw({
      progression: [{
        ...progression, startingHealth: 1_000, startingMana: 200,
        regen: { healthPerSecond: 0, manaPerSecond: 0 },
      }],
    }));
    const session = createHuntSession({
      id: 'snap-bot', content: loaded, huntId: 'arena', difficulty: 'beginner', createdAtMs: 0,
      botConfig: curar,
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 1_000, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);
    return { session, hero, loaded };
  };

  it('a hunt retomada CONTINUA com o bot — antes disto ela voltava sem nenhum', () => {
    // O defeito que este teste fecha: `huntRulesetFromSnapshot` montava o ruleset sem bot, e a
    // hunt retomada seguia andando e matando com o ataque básico. Nada PARECIA quebrado — o
    // que sumia era a cura, e o jogador descobria pelo personagem morto.
    const { session, loaded } = comBot();
    session.advanceBy(5_000);

    // Pelo JSON, porque é assim que ele atravessa o Redis.
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    const antes = retomado.participants[0]?.mana ?? 0;
    run(retomado, 5_000, 100);
    // Curou: a mana desceu. Sem bot, ela ficaria parada onde estava.
    expect(retomado.participants[0]?.mana).toBeLessThan(antes);
  });

  it('o targeting configurado sobrevive: ignorar continua ignorando depois da retomada', () => {
    const { session, loaded } = comBot();
    run(session, 10_000, 100);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );
    const abatesAoRetomar = retomado.aggregates.kills;

    run(retomado, 30_000, 100);

    // `ignore: ['rat']` e a hunt só tem rato: o personagem não bate em ninguém.
    expect(retomado.aggregates.kills).toBe(abatesAoRetomar);
  });

  it('as regras de saída voltam junto — o extrato continua sabendo por que encerrou', () => {
    const { session, hero, loaded } = comBot();
    session.advanceBy(250);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    // Derruba o personagem abaixo dos 10% que a regra pede. Só depois de retomar: se a regra
    // não tivesse voltado, ele ficaria caçando com 5% de vida até morrer.
    const eu = retomado.participants[0] as CharacterRuntime;
    eu.health = Math.round(hero.maxHealth * 0.05);
    run(retomado, 2_000, 100);

    expect(retomado.ended).toBe('exit-rule');
    expect(retomado.notableEvents.find((e) => e.type === 'exit-rule')?.detail)
      .toBe('hp-below-10');
  });

  it('snapshot SEM configuração continua legível — é o de antes desta issue', () => {
    // Campo opcional, sem bump de formato. Ausente significa "sem bot", que é o que aquelas
    // sessões de fato tinham.
    const { session, loaded } = comBot();
    session.advanceBy(250);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    delete (snapshot.ruleset as { botConfig?: unknown }).botConfig;

    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, loaded) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );
    const antes = retomado.participants[0]?.mana ?? 0;
    run(retomado, 5_000, 100);

    expect(retomado.participants[0]?.mana).toBe(antes);
    expect(retomado.ended).toBeNull();
  });
});

describe('trocar a configuração no meio da hunt (FUN-81)', () => {
  it('a regra nova passa a valer NA HORA, sem esperar a próxima hunt', () => {
    // Esperar a próxima hunt seria o jogador corrigir a regra de cura enquanto o personagem
    // morre. A configuração é dado puro: recompilar não tem risco nenhum.
    const loaded = buildContent(raw({
      routes: [{ ...route, spawnPoints: [] }],
      progression: [{
        ...progression, startingMana: 200, regen: { healthPerSecond: 0, manaPerSecond: 0 },
      }],
    }));
    const session = createHuntSession({
      id: 'troca', content: loaded, huntId: 'arena', difficulty: 'beginner', createdAtMs: 0,
      botConfig: botConfig(),
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: 1_000, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);

    run(session, 3_000, 100);
    expect(hero.mana).toBe(200); // sem regra de cura, nada aconteceu

    (session.ruleset as HuntRuleset).configureBot(session, botConfig({
      heal: [{
        when: { kind: 'hp', op: '<=', percent: 90 }, do: { kind: 'spell', spellId: 'heal' },
      }],
    }));
    run(session, 1_000, 100);

    expect(hero.mana).toBeLessThan(200);
  });

  it('trocar a configuração troca também as regras de SAÍDA', () => {
    // Deixar as antigas valendo faria a hunt encerrar por uma regra que o jogador acabou de
    // apagar — e o extrato diria o nome de uma regra que já não existe.
    const loaded = buildContent(raw({ routes: [{ ...route, spawnPoints: [] }] }));
    const session = createHuntSession({
      id: 'troca-saida', content: loaded, huntId: 'arena', difficulty: 'beginner',
      createdAtMs: 0,
      botConfig: botConfig({ exit: [botExitRuleSchema.parse({ kind: 'hp-below', percent: 99 })] }),
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: 10, maxHealth: stats.maxHealth, mana: 0, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);

    // Apaga a regra ANTES de ela ser avaliada — o primeiro `EXIT_RULES` vence em 250 ms.
    (session.ruleset as HuntRuleset).configureBot(session, botConfig());
    run(session, 5_000, 100);

    expect(session.ended).toBeNull();
  });
});

// --- skills sobem pelo USO (FUN-75) ----------------------------------------------------------

describe('skills sobem pelo uso, e a curva é conteúdo (FUN-75)', () => {
  const skillDe = (hero: CharacterRuntime, id: string) =>
    hero.skills.getState()[id] ?? null;

  it('cada golpe conta um ponto, e o nível sobe pelo que a curva diz', () => {
    // Curva de base 2: dois golpes fecham um nível. Contar acerto cheio em vez de golpe faria
    // a skill subir mais devagar contra alvo blindado, que é o oposto de "sobe pelo uso".
    //
    // Dificuldade `professional` (três ratos) e um minuto: sem isso o personagem passa metade
    // do tempo esperando respawn, e o teste mediria a densidade da hunt em vez da curva.
    const { session, hero } = start({ difficulty: 'professional' });

    run(session, 60_000, 100);

    const melee = skillDe(hero, 'melee');
    expect(melee).not.toBeNull();
    expect(melee?.level).toBeGreaterThan(10);
  });

  it('a skill ESCALA o dano — quem treinou mata mais no mesmo tempo', () => {
    // Duas hunts idênticas, mesma semente, mesmo cenário: só o nível de skill do personagem
    // muda. A primeira versão deste teste só afirmava que a skill subiu, e passava igual com
    // a escala arrancada — um teste que não distingue os dois lados não protege nenhum.
    //
    // `damagePerLevel: 0.5` neste conteúdo de teste, alto de propósito: com skill 30 o poder
    // vai de 25 para 275, e um rato de 50 cai num golpe em vez de dois.
    const cru = start({ difficulty: 'professional' });
    run(cru.session, 60_000, 100);

    const treinado = start({
      difficulty: 'professional', skills: { melee: { level: 30, points: 0 } },
    });
    run(treinado.session, 60_000, 100);

    expect(treinado.session.aggregates.kills)
      .toBeGreaterThan(cru.session.aggregates.kills);
  });

  it('magia sobe por MANA GASTA, não por lançamento', () => {
    // §9.4, modelo do Tibia. Por lançamento, a forma ótima de subir magia seria lançar mil
    // vezes a magia mais barata, e o jogo viraria macro de spam.
    //
    // O teste afirma o NÚMERO, e isso é o ponto: a primeira versão dele só checava "subiu
    // algo", e passava igual com a magia rendendo um ponto por lançamento. Um teste que passa
    // dos dois lados da decisão não protege a decisão.
    const { session, hero } = withSpells(botConfig({
      heal: [healRule(100)],
    }), { health: 1_000, monsters: false });

    run(session, 10_000, 100);

    // Mana 200, cura de 20: dez curas até acabar. Por mana gasta são 200 pontos; por
    // lançamento seriam 10. Com curva de 100, a diferença é nível 2 contra nível 0.
    const magic = skillDe(hero, 'magic');
    expect(magic).toEqual({ level: 2, points: 0 });
    expect(hero.mana).toBe(0);
  });

  it('magia RECUSADA não rende skill — não gastou mana, não praticou', () => {
    // Sem mana, a cura é recusada. Contar a tentativa faria "praticar" virar "tentar", e o
    // caminho ótimo passaria a ser spammar sem mana.
    const { session, hero } = withSpells(
      botConfig({ heal: [healRule(100)] }), { health: 1_000, mana: 0, monsters: false },
    );

    run(session, 10_000, 100);

    expect(skillDe(hero, 'magic')).toBeNull();
  });

  it('subir de nível vira evento notável — é o que o jogador quer ver ao voltar', () => {
    // §16.2: a lista curta da tela de retorno. Numa hunt de oito horas, subir uma skill é uma
    // das poucas coisas que aconteceram que valem uma linha.
    const { session } = start({ difficulty: 'professional' });
    run(session, 60_000, 100);

    const subiu = session.notableEvents.filter((e) => e.type === 'skill-up');
    expect(subiu.length).toBeGreaterThan(0);
    expect(subiu[0]?.detail).toMatch(/^melee\/\d+$/);
  });

  it('as skills atravessam o snapshot', () => {
    const { session, hero } = start({ difficulty: 'professional' });
    run(session, 60_000, 100);
    const antes = hero.skills.getState();

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    expect(retomado.participants[0]?.skills.getState()).toEqual(antes);
  });

  it('personagem SEM skills gravadas começa no nível inicial, e não quebra', () => {
    // É o personagem de antes desta issue. Campo opcional, sem bump de formato.
    const { session, hero } = start();
    run(session, 5_000, 100);
    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    delete (snapshot.participants[0] as { skills?: unknown }).skills;

    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    expect(retomado.participants[0]?.skills.getState()).toEqual({});
    expect(() => run(retomado, 5_000, 100)).not.toThrow();
  });

  it('1 Hz e 10 Hz sobem a MESMA skill — uso é evento, não tick', () => {
    // O que o invariante 2 proíbe é grandeza dependente do TEMPO somada por tick. Aqui o que
    // se soma é uso, e uso é evento na fila: um golpe que vence, uma magia que sai.
    const at = (stepMs: number) => {
      const { session, hero } = start({ difficulty: 'professional' });
      run(session, 120_000, stepMs);
      return { skills: hero.skills.getState(), kills: session.aggregates.kills };
    };

    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    expect(rapido.skills['melee']?.level).toBeGreaterThan(10);
  });
});

// --- magia em área dentro da hunt (FUN-92) ---------------------------------------------------

describe('magia em área (FUN-92)', () => {
  const explodir = botConfig({
    attack: [{
      when: { kind: 'targets', op: '>=', count: 1 },
      do: { kind: 'spell', spellId: 'blast' },
    }],
  });

  it('atinge TODOS os monstros no raio, não só o alvo', () => {
    // Dificuldade `professional` põe três ratos perto do mesmo ponto de spawn. Um `blast` de
    // raio 2 pega mais de um, e o teste mede isso pelos abates: com alvo único seriam três
    // lançamentos para três ratos.
    const { session } = withSpells(explodir, { mana: 200 }, 'professional');

    run(session, 20_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
  });

  it('uma morte no meio da área NÃO perde os alvos seguintes', () => {
    // O defeito que este teste fecha: `#onMonsterDied` troca `#monsters` por um array filtrado,
    // então resolver morte durante a varredura seria varrer um array sendo substituído — e os
    // alvos depois do que morreu ficariam de fora. Colher primeiro, aplicar depois.
    //
    // `blast` mata um rato de 50 num golpe (poder 80): com três ratos no raio, o primeiro
    // morre e os outros dois PRECISAM levar o dano da mesma rolagem.
    const { session, ruleset } = withSpells(explodir, { mana: 200 }, 'professional');

    // Um único vencimento da categoria de ataque, no instante zero.
    session.advanceBy(50);

    // Morto sai da lista (`#onMonsterDied` a filtra), então o abate se conta pelo agregado.
    const mortos = session.aggregates.kills;
    const feridos = ruleset.monsters.filter((m) => m.alive && m.health < 50).length;
    // Ou morreram, ou saíram feridos — o que não pode é um deles sair intacto tendo estado no
    // raio de uma explosão que matou o vizinho.
    expect(mortos).toBeGreaterThan(0);
    expect(mortos + feridos).toBeGreaterThan(1);
  });

  it('o mesmo lançamento com a mesma semente dá o MESMO resultado', () => {
    // A ordem em que os alvos entram na mira decide qual rolagem cai em quem. Ela é a ordem da
    // lista de monstros, que é a de nascimento — e por isso é reproduzível.
    const estado = () => {
      const { session, ruleset } = withSpells(explodir, { mana: 200 }, 'professional');
      session.advanceBy(50);
      return ruleset.monsters.map((m) => `${m.id}:${m.health}`);
    };
    expect(estado()).toEqual(estado());
  });

  it('1 Hz e 10 Hz dão o mesmo resultado com magia de área', () => {
    const at = (stepMs: number) => {
      const { session, hero, ruleset } = withSpells(explodir, { mana: 2_000 }, 'professional');
      run(session, 60_000, stepMs);
      return {
        kills: session.aggregates.kills,
        mana: hero.mana,
        vivos: ruleset.monsters.map((m) => `${m.monsterId}:${m.health}`),
      };
    };
    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    expect(rapido.kills).toBeGreaterThan(0);
  });
});

describe('o alcance da magia é o DELA, não o da arma (FUN-92)', () => {
  it('uma magia de alcance 3 alcança de onde o corpo a corpo não alcança', () => {
    // Era um defeito desde a FUN-74, e só apareceu quando o teste de área foi escrito: a mira
    // usava `#attackTarget`, que para no alcance do GOLPE (1 neste conteúdo). A conferência de
    // alcance dentro de `castSpell` nunca era a restrição que mordia, porque a seleção já
    // tinha mordido antes — uma magia de alcance 3 se comportava como uma de alcance 1.
    //
    // O cenário: personagem parado no meio do salão, alvo eterno dois tiles abaixo, sem se
    // mexer (`aggroRadius: 0`). Fora do alcance da arma, dentro do da magia.
    const loaded = buildContent(raw({
      monsters: [rat, poste, posteEterno], hunts: [hunt, huntSalao],
      maps: [map, salaGrande], routes: [route, anel],
      progression: [{ ...progression, startingMana: 500 }],
    }));
    const session = createHuntSession({
      id: 'alcance', content: loaded, huntId: 'salao', difficulty: 'professional',
      createdAtMs: 0,
      botConfig: botConfig({
        attack: [{
          when: { kind: 'targets', op: '>=', count: 0 },
          do: { kind: 'spell', spellId: 'strike' },
        }],
      }),
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);
    const ruleset = session.ruleset as HuntRuleset;

    // Um único vencimento. Nele o monstro nasce, o personagem dá um passo de rota e o bot
    // lança — tudo no instante zero, e nessa ordem, pela prioridade dos eventos.
    session.advanceBy(50);

    const alvo = ruleset.monsters[0] as { position: { x: number; y: number }; health: number };
    const tiles = Math.max(
      Math.abs(hero.position.x - alvo.position.x),
      Math.abs(hero.position.y - alvo.position.y),
    );
    // O cenário precisa ser o que ele diz ser: FORA do alcance do golpe (1), DENTRO do da
    // magia (3). Sem esta afirmação, o teste passaria com o personagem colado no monstro.
    expect(tiles).toBeGreaterThan(combat.player.attackRange);
    expect(tiles).toBeLessThanOrEqual(3);
    expect(alvo.health).toBeLessThan(1_000_000);
  });
});

// --- a arma equipada decide o dano (FUN-82) --------------------------------------------------

describe('equipamento no combate (FUN-82)', () => {
  const comEspada: InventoryState = {
    backpack: [],
    equipped: { hand: { instanceId: 'i1', itemId: 'sword', quantity: 1 } },
  };
  const comArmadura: InventoryState = {
    backpack: [],
    equipped: { chest: { instanceId: 'i2', itemId: 'plate', quantity: 1 } },
  };

  it('quem está armado mata mais no mesmo tempo', () => {
    // `combat.player.attackPower` deixou de ser "o ataque do personagem" e passou a ser o do
    // personagem SEM arma. A espada deste conteúdo bate 200 contra os 25 do punho: o rato de
    // 50 cai num golpe em vez de dois.
    const desarmado = start({ difficulty: 'professional' });
    run(desarmado.session, 60_000, 100);

    const armado = start({ difficulty: 'professional', inventory: comEspada });
    run(armado.session, 60_000, 100);

    expect(armado.session.aggregates.kills)
      .toBeGreaterThan(desarmado.session.aggregates.kills);
  });

  it('a armadura vestida SOMA à do conteúdo, e o personagem apanha menos', () => {
    // Somar, e não substituir: `combat.player.armor` é a resistência do corpo. Substituir faria
    // vestir a primeira armadura deixar o personagem mais frágil se ela valesse menos.
    const nu = start({ difficulty: 'professional', health: 5_000 });
    run(nu.session, 60_000, 100);

    const vestido = start({
      difficulty: 'professional', health: 5_000, inventory: comArmadura,
    });
    run(vestido.session, 60_000, 100);

    expect(vestido.hero.health).toBeGreaterThan(nu.hero.health);
  });

  it('o inventário atravessa o snapshot', () => {
    const { session } = start({ difficulty: 'professional', inventory: comEspada });
    run(session, 5_000, 100);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, content()) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    expect(retomado.participants[0]?.inventory.equippedAt('hand')?.itemId).toBe('sword');
  });

  it('personagem SEM inventário gravado continua batendo com o desarmado', () => {
    // É o personagem de antes desta issue. Campo opcional, sem bump de formato.
    const { session, hero } = start({ difficulty: 'professional' });
    run(session, 10_000, 100);

    expect(hero.inventory.backpack).toEqual([]);
    expect(session.aggregates.kills).toBeGreaterThan(0);
  });

  it('capacidade ZERO é reposta na entrada, pela tabela', () => {
    // Zero é o que um personagem gravado antes do inventário traz, e zero quer dizer "não
    // carrega nada" — travaria a mochila de quem já jogava. A reposição é só para esse caso:
    // quem chega com capacidade própria a mantém.
    const loaded = content();
    const session = createHuntSession({
      id: 'capacidade', content: loaded, huntId: 'arena', difficulty: 'beginner',
      createdAtMs: 0,
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const antigo = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null, staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    expect(antigo.capacity).toBe(0);

    session.enter(antigo);

    expect(antigo.capacity).toBe(stats.capacity);
  });

  it('a capacidade acompanha o LEVEL', () => {
    // Sem isto, subir de level daria vida e mana e deixaria a mochila do mesmo tamanho — e o
    // jogador descobriria pelo item que não coube, sem nada ligando uma coisa à outra.
    const um = statsForLevel(1, null, progression as Progression).capacity;
    const dez = statsForLevel(10, null, progression as Progression).capacity;
    expect(dez).toBeGreaterThan(um);

    const { session, hero } = start();
    session.advanceBy(10);
    hero.xp = totalXpForLevel(10, progression as Progression);
    run(session, 30_000, 100);

    expect(hero.level).toBeGreaterThan(1);
    expect(hero.capacity).toBe(
      statsForLevel(hero.level, null, progression as Progression).capacity,
    );
  });
});

// --- loot de item por abate (FUN-88) ---------------------------------------------------------

describe('o item cai, e vai para algum lugar (FUN-88)', () => {
  /**
   * A capacidade vem da TABELA e é recalculada a cada level up (FUN-82) — então ela não pode
   * ser fixada no personagem e esquecida: a primeira subida de level a sobrescreve.
   *
   * A primeira versão deste helper fazia exatamente isso, e os testes falharam por culpa da
   * fixture. Fixar `capacityPerLevel: 0` e escolher a inicial é o que torna o número estável
   * durante o teste, sem lutar contra o motor.
   */
  const comDrop = (over: {
    capacity?: number; staminaMs?: number; catalog?: boolean;
  } = {}) => {
    const loaded = buildContent(raw({
      monsters: [ratWithDrop],
      progression: [{
        ...progression, startingCapacity: over.capacity ?? 10_000, capacityPerLevel: 0,
      }],
    }));
    const session = createHuntSession({
      // Conteúdo com o catálogo VAZIO simula o que muda debaixo de uma sessão em voo: a
      // espada existia quando a hunt abriu e não existe mais.
      content: over.catalog === false ? { ...loaded, items: new Map() } : loaded,
      id: 'drop', huntId: 'arena', difficulty: 'professional', createdAtMs: 0,
    });
    const stats = statsForLevel(1, null, loaded.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
      level: 1, xp: 0, vocationId: null,
      staminaMs: over.staminaMs ?? stamina.maxMs, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
      capacity: stats.capacity,
    });
    session.enter(hero);
    return { session, hero, ruleset: session.ruleset as HuntRuleset };
  };

  it('o item entra na MOCHILA quando cabe', () => {
    const { session, hero } = comDrop();
    run(session, 60_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.inventory.backpack.length).toBe(session.aggregates.kills);
    expect(hero.lootBox).toEqual([]);
  });

  it('o id da instância é DETERMINÍSTICO, e é o que torna a inserção idempotente', () => {
    // `sessionId:n`. Reprocessar o extrato insere a mesma chave primária e não faz nada — a
    // idempotência do invariante 10 obtida por identidade previsível, sem conferência.
    const { session, hero } = comDrop();
    run(session, 60_000, 100);

    for (const [n, item] of hero.inventory.backpack.entries()) {
      expect(item.instanceId).toBe(`drop:${n}`);
    }
  });

  it('o que NÃO cabe vai para a Caixa de Loot da Sessão', () => {
    // Capacidade para uma espada só (peso 50). A segunda não cabe e não se perde: ela vai para
    // a caixa, que é o §21.6 em uma linha.
    // Capacidade para uma espada só (peso 50).
    const { session, hero } = comDrop({ capacity: 50 });
    run(session, 60_000, 100);

    expect(hero.inventory.backpack).toHaveLength(1);
    expect(hero.lootBox.length).toBeGreaterThan(0);
    // E os ids continuam únicos entre a mochila e a caixa: o contador é um só.
    const todos = [...hero.inventory.backpack, ...hero.lootBox].map((i) => i.instanceId);
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('a mochila cheia vira UMA linha no extrato, não uma por item', () => {
    // Uma por item encheria a lista curta da tela de retorno até ela deixar de ser lista. O
    // que o jogador precisa saber é que a mochila encheu.
    const { session } = comDrop({ capacity: 50 });
    run(session, 60_000, 100);

    expect(session.notableEvents.filter((e) => e.type === 'backpack-full')).toHaveLength(1);
  });

  it('com stamina ZERO não cai item nenhum, como não cai gold (§10.2)', () => {
    // O portão da recompensa já existia para gold e XP; itens entram por ele também. O abate
    // continua contando: o jogador matou, e o extrato mentiria se dissesse que não.
    const { session, hero } = comDrop({ staminaMs: 0 });
    run(session, 60_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.inventory.backpack).toEqual([]);
    expect(hero.lootBox).toEqual([]);
  });

  it('item que sumiu do catálogo não vira instância fantasma', () => {
    // `buildContent` recusa loot de item inexistente no boot, então isto só acontece com o
    // conteúdo mudando sob uma sessão EM VOO. A resposta certa é não entregar nada — uma
    // instância de um item que não existe não pode ser desenhada, equipada nem vendida, e o
    // contador de instâncias não pode avançar por ela.
    const { session, hero } = comDrop({ catalog: false });
    run(session, 60_000, 100);

    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.inventory.backpack).toEqual([]);
    expect(hero.lootBox).toEqual([]);
    // E não queimou identidade: o contador não avança por um item que não vai existir.
    expect(hero.lootSeq).toBe(0);
  });

  it('a caixa e o contador atravessam o snapshot', () => {
    const { session, hero } = comDrop({ capacity: 50 });
    run(session, 60_000, 100);
    const antes = { caixa: hero.lootBox.length, seq: hero.lootSeq };
    expect(antes.caixa).toBeGreaterThan(0);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const retomado = Session.fromSnapshot(
      snapshot,
      huntRulesetFromSnapshot(snapshot, buildContent(raw({ monsters: [ratWithDrop] }))) as HuntRuleset,
      Rng.fromSeed(snapshot.id),
    );

    const voltou = retomado.participants[0] as CharacterRuntime;
    expect(voltou.lootBox).toHaveLength(antes.caixa);
    // O contador precisa voltar: recomeçar geraria o mesmo id de novo, e como a inserção é
    // idempotente por id, o item novo seria descartado por parecer repetido.
    expect(voltou.lootSeq).toBe(antes.seq);
  });

  it('o aviso de mochila cheia NÃO se repete depois da retomada', () => {
    const { session } = comDrop({ capacity: 50 });
    run(session, 60_000, 100);

    const snapshot = JSON.parse(JSON.stringify(session.snapshot())) as SessionSnapshot;
    const estado = snapshot.ruleset as { warnedFullBackpack?: boolean };
    expect(estado.warnedFullBackpack).toBe(true);
  });

  it('1 Hz e 10 Hz largam os MESMOS itens', () => {
    // A ordem dos sorteios é contrato (FUN-63), e acrescentar destino não muda sorteio.
    const at = (stepMs: number) => {
      const { session, hero } = comDrop();
      run(session, 120_000, stepMs);
      return {
        kills: session.aggregates.kills,
        mochila: hero.inventory.backpack.map((i) => `${i.instanceId}/${i.itemId}`),
        caixa: hero.lootBox.length,
      };
    };
    const rapido = at(100);
    expect(at(1_000)).toEqual(rapido);
    expect(rapido.mochila.length).toBeGreaterThan(0);
  });
});
