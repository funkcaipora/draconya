// A regressão do #527 com o bot config REAL (não um mínimo sintético): a mesma party de quatro
// (Knight, Paladin, Sorcerer, Druid, level 200) na Darashia Dragon Lair de verdade — mesmo mapa,
// mesma rota, mesmos 47 pontos de spawn do #520 — mas configurada por `botConfigFor`
// (`dragon-party-plan.ts`), a MESMA função que `dragon-party-seed.ts` usa para semear a party
// que uma QA ao vivo realmente jogou. `packages/server` não pode importar `@draconya/tools`
// (dependência circular: `tools` já depende de `server`) — por isso este teste mora aqui, e não
// junto de `darashia-dragon-lair-party-movement.test.ts`, que usa um bot config sintético
// (`follow`/`lure` mínimos) para os cenários que não precisam da rotação de magia real.
//
// Duas coisas que uma QA ao vivo com ESTE bot config real encontrou e o teste sintético não
// pegou: (1) `botConfigFor` não configura `lure` em NINGUÉM, nem no líder — todo mundo para
// para lutar assim que há alvo ao alcance, exatamente como o sintético SUPUNHA que só o líder
// fizesse; (2) sem lure, o líder para com mais frequência, e os três seguidores convergem para
// `d === 1` dele com mais chance de ocupar o PRÓXIMO tile da rota do líder — o cerco relatado
// numa QA ao vivo em (74,40,z10): Knight na rota indo para oeste, Paladin sentado exatamente no
// próximo tile dele, e ninguém cedia por 2,5+ minutos.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@draconya/content/load';
import type { Content } from '@draconya/content';
import { CharacterRuntime, createHuntSession, totalXpForLevel } from '@draconya/sim';
import type { HuntRuleset, Session } from '@draconya/sim';
import { botConfigFor, type DragonPartyVocation } from './dragon-party-plan.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

const VOCATIONS: readonly DragonPartyVocation[] = ['knight', 'paladin', 'sorcerer', 'druid'];

/** O mesmo personagem-teste de `darashia-dragon-lair.test.ts`: HP absurdo, xp que bate com o
 * level (senão a primeira mordida retargeta para ~nível 1 e a party morre em segundos). */
function partyMember(id: string, vocationId: string, progression: Content['progression']): CharacterRuntime {
  return new CharacterRuntime({
    id, position: { x: 0, y: 0, z: 10 },
    health: 10_000_000, maxHealth: 10_000_000, mana: 10_000, maxMana: 10_000,
    level: 200, xp: totalXpForLevel(200, progression), vocationId,
    staminaMs: 86_400_000, staminaUpdatedAtMs: 0,
    gold: 0, goldDelta: 0, alive: true, cooldowns: {},
  });
}

function enter(content: Content, id: string): { session: Session; ruleset: HuntRuleset } {
  const session = createHuntSession({
    id, content, huntId: 'darashia-dragon-lair', difficulty: 'cautious',
    createdAtMs: 0, partyOptions: { leaderId: 'knight', mode: 'shared' },
  });
  for (const vocationId of VOCATIONS) session.enter(partyMember(vocationId, vocationId, content.progression));
  const ruleset = session.ruleset as HuntRuleset;
  // O MESMO `botConfigFor` que `dragon-party-seed.ts` grava de verdade — sem lure em ninguém
  // (a função não configura `lure` para nenhuma vocação), rotação de magia/suprimento real.
  for (const vocationId of VOCATIONS) {
    ruleset.configureBot(session, botConfigFor(content, vocationId), vocationId);
  }
  return { session, ruleset };
}

/**
 * Força HP a 1 no alvo ATUAL de cada personagem — a mesma técnica de
 * `darashia-dragon-lair-party-movement.test.ts`: mata pelo pipeline de verdade (o golpe do
 * personagem aplica o ÚLTIMO ponto), só ACELERA para não depender do dano real de cada magia.
 */
function weakenNearby(ruleset: HuntRuleset, session: Session): void {
  for (const character of session.participants) {
    if (!character.alive) continue;
    const target = ruleset.selectedTargetOf(character);
    if (target === null || !target.alive || target.health <= 1) continue;
    target.receiveDamage(target.health - 1);
  }
}

interface SweepBounds {
  readonly stepMs: number;
  readonly totalMs: number;
  readonly idleBoundMs: number;
  readonly strandedBoundMs: number;
}

interface SweepResult {
  readonly leaderIdleMs: number;
  readonly maxTogetherBreachMs: number;
  readonly followerArrivedOnLeaderFloorFirst: readonly string[];
  readonly floorsWithKills: readonly number[];
}

/**
 * Roda uma semente até `totalMs` (ou a hunt terminar antes), forçando abate rápido para não
 * depender do dano real de cada magia, e devolve as mesmas três propriedades que a issue #527
 * cobra: o líder nunca fica parado sem NENHUM monstro ao alcance além do razoável, ninguém fica
 * num andar diferente do líder além do razoável, e há abate em ao menos um andar.
 */
function runSweepSeed(content: Content, seedId: string, bounds: SweepBounds): SweepResult {
  const { session, ruleset } = enter(content, seedId);
  const { stepMs, totalMs, idleBoundMs } = bounds;
  const targetSearchRadius = 8;

  const killsByFloor = new Map<number, number>();
  const lastPosition = new Map<string, { x: number; y: number; z: number }>();
  let leaderIdleMs = 0;
  const togetherBreachSinceMs = new Map<string, number | null>(
    VOCATIONS.filter((v) => v !== 'knight').map((v) => [v, null]),
  );
  let maxTogetherBreachMs = 0;
  const followerArrivedOnLeaderFloorFirst: string[] = [];
  const leaderVisitedFloors = new Set<number>();

  for (let elapsed = 0; elapsed < totalMs && session.ended === null; elapsed += stepMs) {
    weakenNearby(ruleset, session);
    session.advanceBy(stepMs);
    for (const event of session.drainEvents()) {
      if (event.kind !== 'ground-item-appeared') continue;
      killsByFloor.set(event.position.z, (killsByFloor.get(event.position.z) ?? 0) + 1);
    }

    const leader = session.participants.find((p) => p.id === 'knight');
    if (leader === undefined) throw new Error('líder não está mais na sessão');
    leaderVisitedFloors.add(leader.position.z);

    const leaderPrev = lastPosition.get('knight');
    const leaderStalled = leaderPrev !== undefined
      && leaderPrev.x === leader.position.x && leaderPrev.y === leader.position.y
      && leaderPrev.z === leader.position.z;
    const nearbyMonsters = leaderStalled ? ruleset.monsters.filter((m) => m.alive
      && m.position.z === leader.position.z
      && Math.max(Math.abs(m.position.x - leader.position.x), Math.abs(m.position.y - leader.position.y))
        <= targetSearchRadius).length : 1;
    leaderIdleMs = leaderStalled && nearbyMonsters === 0 ? leaderIdleMs + stepMs : 0;
    if (leaderIdleMs > idleBoundMs) {
      console.log(
        `DUMP ${seedId} (${String(stepMs)} ms/passo): líder parado ${String(leaderIdleMs)} ms em`,
        leader.position, 'sem monstro ao alcance; posições',
        session.participants.map((p) => ({
          id: p.id, pos: p.position, target: ruleset.selectedTargetOf(p)?.id ?? null,
        })),
      );
    }
    lastPosition.set('knight', { x: leader.position.x, y: leader.position.y, z: leader.position.z });

    for (const character of session.participants) {
      if (character.id === 'knight') continue;
      const sameFloorAsLeader = character.position.z === leader.position.z;
      if (!sameFloorAsLeader && !leaderVisitedFloors.has(character.position.z)) {
        followerArrivedOnLeaderFloorFirst.push(
          `${character.id} chegou em z${String(character.position.z)} antes do líder `
            + `(${seedId}, t=${String(elapsed)})`,
        );
      }
      const breached = !sameFloorAsLeader;
      const since = togetherBreachSinceMs.get(character.id) ?? null;
      if (breached) {
        const start = since ?? elapsed;
        togetherBreachSinceMs.set(character.id, start);
        maxTogetherBreachMs = Math.max(maxTogetherBreachMs, elapsed - start + stepMs);
      } else {
        togetherBreachSinceMs.set(character.id, null);
      }
    }
  }

  return {
    leaderIdleMs,
    maxTogetherBreachMs,
    followerArrivedOnLeaderFloorFirst,
    floorsWithKills: [...killsByFloor.entries()].filter(([, count]) => count > 0).map(([z]) => z),
  };
}

// 10 min lógicos, 30 sementes — o mesmo orçamento de
// `darashia-dragon-lair-party-movement.test.ts`, só que com o bot config REAL (#527, pedido
// numa QA ao vivo depois que o sintético não reproduziu o cerco perto de (74,40,z10)).
describe('a party de dragões (bot config REAL) atravessa os três andares JUNTA (#527)', () => {
  const SEED_COUNT = 30;
  const TOTAL_MS = 10 * 60_000;
  const IDLE_BOUND_MS = 480_000;
  const STRANDED_BOUND_MS = 8 * 60_000;

  it.each(Array.from({ length: SEED_COUNT }, (_unused, i) => i))('semente %i, 5000 ms/passo (20 Hz aproximado)', (seedIndex) => {
    const result = runSweepSeed(real(), `dragon-party-real-5000-${String(seedIndex)}`, {
      stepMs: 5_000, totalMs: TOTAL_MS, idleBoundMs: IDLE_BOUND_MS, strandedBoundMs: STRANDED_BOUND_MS,
    });

    expect(result.leaderIdleMs, `semente ${String(seedIndex)}: líder parado além do razoável`)
      .toBeLessThanOrEqual(IDLE_BOUND_MS);
    expect(result.maxTogetherBreachMs, `semente ${String(seedIndex)}: seguidor longe do líder além do razoável`)
      .toBeLessThanOrEqual(STRANDED_BOUND_MS);
    expect(
      result.followerArrivedOnLeaderFloorFirst.length,
      `semente ${String(seedIndex)}: seguidor foi sozinho para outro andar repetidamente: `
        + `${JSON.stringify(result.followerArrivedOnLeaderFloorFirst)}`,
    ).toBeLessThanOrEqual(30);
    expect(result.floorsWithKills.length, `semente ${String(seedIndex)}: nenhum abate`)
      .toBeGreaterThanOrEqual(1);
  });

  // **INVARIANTE 3 (#527, pedido numa QA ao vivo depois de 037fe29): a hunt desanexada tica a
  // ~1 Hz (ADR 0003/0020) — a MESMA propriedade tem que valer nesse ritmo, não só nos 5000 ms
  // "rápido" acima.** `Session.advanceBy` consome `dtMs` e a fila de eventos vence no instante
  // exato, não "por tick" (invariante 2) — então em princípio o resultado NÃO deveria depender
  // de quantas vezes `advanceBy` é chamado para cobrir o mesmo tempo lógico. Rodar a MESMA
  // varredura a 1000 ms/passo é o que prova isso, em vez de supor.
  it.each(Array.from({ length: SEED_COUNT }, (_unused, i) => i))('semente %i, 1000 ms/passo (1 Hz, ritmo desanexado)', (seedIndex) => {
    const result = runSweepSeed(real(), `dragon-party-real-1000-${String(seedIndex)}`, {
      stepMs: 1_000, totalMs: TOTAL_MS, idleBoundMs: IDLE_BOUND_MS, strandedBoundMs: STRANDED_BOUND_MS,
    });

    expect(result.leaderIdleMs, `semente ${String(seedIndex)} a 1 Hz: líder parado além do razoável`)
      .toBeLessThanOrEqual(IDLE_BOUND_MS);
    expect(result.maxTogetherBreachMs, `semente ${String(seedIndex)} a 1 Hz: seguidor longe do líder além do razoável`)
      .toBeLessThanOrEqual(STRANDED_BOUND_MS);
    expect(
      result.followerArrivedOnLeaderFloorFirst.length,
      `semente ${String(seedIndex)} a 1 Hz: seguidor foi sozinho para outro andar repetidamente: `
        + `${JSON.stringify(result.followerArrivedOnLeaderFloorFirst)}`,
    ).toBeLessThanOrEqual(30);
    expect(result.floorsWithKills.length, `semente ${String(seedIndex)} a 1 Hz: nenhum abate`)
      .toBeGreaterThanOrEqual(1);
  });
});

/**
 * Comparação DIRETA 1 Hz × 20 Hz, no mesmo espírito de
 * `packages/sim/src/monster/ability.test.ts` ("invariância de frequência com tudo junto",
 * #518) — a prova mais forte da propriedade: não "as duas ficam dentro de um teto razoável",
 * mas "as duas terminam EXATAMENTE no mesmo estado". Sem `weakenNearby`: forçar dano de dentro
 * do laço de teste, uma vez por CHAMADA de `advanceBy`, seria o PRÓPRIO teste introduzindo
 * dependência de frequência que a simulação não tem — a comparação vale só se nada fora da fila
 * de eventos decide o resultado. `session.enter` é determinístico (mesmo id, mesma ordem de
 * entrada, mesmo `Rng.fromSeed`), então as duas sessões partem do mesmo estado inicial.
 */
describe('a party de dragões (bot config REAL) dá o MESMO resultado a 1 Hz e a 20 Hz (#527)', () => {
  it('posição, vida e andar de cada personagem batem exatamente nas duas frequências', () => {
    const content = real();
    const totalMs = 5 * 60_000;
    const snapshotAt = (stepMs: number) => {
      const { session } = enter(content, 'dragon-party-real-freq-invariance');
      for (let elapsed = 0; elapsed < totalMs && session.ended === null; elapsed += stepMs) {
        session.advanceBy(stepMs);
      }
      return session.participants.map((p) => ({
        id: p.id, alive: p.alive, position: p.position, health: p.health, mana: p.mana,
      }));
    };

    const at1Hz = snapshotAt(1_000);
    const at20Hz = snapshotAt(50);
    expect(at1Hz).toEqual(at20Hz);
  });
});
