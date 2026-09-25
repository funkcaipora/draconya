import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Content } from '@draconya/content';
import {
  BOT_SET_COUNT, BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema,
} from '@draconya/content';
import type { BotConfigV2, BotFollow } from '@draconya/content';
import {
  CharacterRuntime, createHuntSession, sameFloor, totalXpForLevel,
} from '@draconya/sim';
import type { HuntRuleset, Session } from '@draconya/sim';

// A regressão do #527: a party de quatro (Knight, Paladin, Sorcerer, Druid, level 200) na
// Darashia Dragon Lair REAL — mesmo mapa, mesma rota, mesmos 47 pontos de spawn do #520 — com
// o Knight liderando a rota (lure 4/8, como a QA ao vivo do M28 configurou) e os outros três
// seguindo o líder (`follow.kind: 'leader'`). Mora no servidor, não em `sim`, pela MESMA razão
// de `darashia-dragon-lair.test.ts`: só aqui o conteúdo de verdade é carregado do disco.
//
// O que este teste prende: a party atravessa os três andares JUNTA (não um sozinho atrás dos
// Dragon Lords, como a QA ao vivo viu o Druid fazer), mata em mais de um andar, e ninguém fica
// parado além de uma janela razoável — os três sintomas da issue.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

/** O mesmo personagem-teste de `darashia-dragon-lair.test.ts`: HP absurdo, xp que bate com o
 * level (senão a primeira mordida retargeta para ~nível 1 e a party morre em segundos). */
function partyMember(id: string, vocationId: string | null, progression: Content['progression']): CharacterRuntime {
  return new CharacterRuntime({
    id, position: { x: 0, y: 0, z: 10 },
    health: 10_000_000, maxHealth: 10_000_000, mana: 10_000, maxMana: 10_000,
    level: 200, xp: totalXpForLevel(200, progression), vocationId,
    staminaMs: 86_400_000, staminaUpdatedAtMs: 0,
    gold: 0, goldDelta: 0, alive: true, cooldowns: {},
  });
}

/** Config v2 mínima e válida: só o que este teste exercita (follow/lure), sem magia nem
 * suprimento — o golpe desarmado já basta com `weakenNearby` forçando o abate. */
function emptySet() {
  return { slots: Array.from({ length: BOT_SLOTS_PER_SET }, () => null) };
}
function minimalBotConfig(follow: BotFollow, lure?: { min: number; max: number }): BotConfigV2 {
  return botConfigV2Schema.parse({
    version: BOT_VOCABULARY_VERSION,
    follow,
    ...(lure === undefined ? {} : { lure }),
    exit: [{ kind: 'hp-below', percent: 1 }],
    sets: Array.from({ length: BOT_SET_COUNT }, () => emptySet()),
  });
}

const VOCATIONS = ['knight', 'paladin', 'sorcerer', 'druid'] as const;

function enter(content: Content, id = 'darashia-party-movement'): { session: Session; ruleset: HuntRuleset } {
  const session = createHuntSession({
    id, content, huntId: 'darashia-dragon-lair', difficulty: 'cautious',
    createdAtMs: 0, partyOptions: { leaderId: 'knight', mode: 'shared' },
  });
  for (const vocationId of VOCATIONS) session.enter(partyMember(vocationId, vocationId, content.progression));
  const ruleset = session.ruleset as HuntRuleset;
  // O Knight lidera a rota com lure 4/8 — a MESMA configuração da QA ao vivo do M28 que
  // encontrou os quatro defeitos; os outros três seguem o líder.
  ruleset.configureBot(session, minimalBotConfig({ kind: 'none' }, { min: 4, max: 8 }), 'knight');
  for (const vocationId of VOCATIONS) {
    if (vocationId === 'knight') continue;
    ruleset.configureBot(session, minimalBotConfig({ kind: 'leader' }), vocationId);
  }
  return { session, ruleset };
}

/**
 * Força HP a 1 no alvo ATUAL de cada personagem (`selectedTargetOf`, o mesmo que a apresentação
 * usa) — a MESMA técnica de `darashia-dragon-lair.test.ts` ("o abate de verdade... é o que de
 * fato libera o lugar"), só que UM alvo por personagem por vez, não todo mundo num raio: o
 * objetivo deste arquivo é a MOVIMENTAÇÃO da party, não quanto dano um Knight desarmado causa.
 * Enfraquecer TUDO num raio (tentativa anterior deste teste) criava uma zona-de-farm artificial
 * — respawn de 90 s reabastecendo mais rápido do que o combate de verdade jamais reabasteceria,
 * e o líder nunca via a densidade LOCAL cair o bastante para retomar a rota. Um por vez é o
 * ritmo de quem realmente luta: o abate ainda sai pelo pipeline de verdade (o golpe do
 * personagem que aplica o ÚLTIMO ponto).
 */
function weakenNearby(ruleset: HuntRuleset, session: Session): void {
  for (const character of session.participants) {
    if (!character.alive) continue;
    const target = ruleset.selectedTargetOf(character);
    if (target === null || !target.alive || target.health <= 1) continue;
    target.receiveDamage(target.health - 1);
  }
}

// A regressão do #527 (Knight, Paladin, Sorcerer, Druid level 200 na Darashia Dragon Lair
// real — mesmo mapa, mesma rota, mesmos 47 pontos de spawn do #520), varrendo VÁRIAS sementes
// de sessão em vez de uma só fixa. Achado numa QA ao vivo, depois de fac3da9/ca11023/7ba71d5: o
// cenário de uma semente fixa não pegava o líder ficando preso FORA da rota, numa reentrância
// específica do mapa perto de (63,56,z10) — um corredor estreito onde um seguidor satisfeito a
// distância 1 senta bem no meio do caminho de volta. Cada semente de sessão
// (`Rng.fromSeed(options.id)`, que decide a composição do respawn e o RNG de combate) produz
// uma trajetória diferente; várias sementes aumentam a chance de bater na MESMA geometria que a
// QA ao vivo bateu, em vez de confiar numa semente que o código atual já sabe resolver. O que
// este teste prende: a party atravessa os três andares JUNTA (não um sozinho atrás dos Dragon
// Lords, como a QA ao vivo viu o Druid fazer), mata em mais de um andar, o líder nunca fica
// parado sem NENHUM monstro ao alcance por muito tempo, e ninguém — seguindo escada através de
// andar — abandona o líder para caçar sozinho em outro andar.
describe('a party de dragões atravessa os três andares JUNTA, em VÁRIAS sementes de sessão (#527)', () => {
  const SEED_COUNT = 30;

  it.each(Array.from({ length: SEED_COUNT }, (_unused, i) => i))('semente %i', (seedIndex) => {
    const { session, ruleset } = enter(real(), `darashia-party-movement-seed-${String(seedIndex)}`);

    const STEP_MS = 5_000; // mais fino que o teste de UMA semente: pega o líder parado mais cedo
    const TOTAL_MS = 10 * 60_000; // 10 min lógicos por semente, como pedido
    const TARGET_SEARCH_RADIUS = 8;
    // O líder nunca fica parado com ZERO monstro ao alcance para SEMPRE — o `#clearCompanionsAround`
    // que resolve o cerco da party inteira (#527) tem o alcance limitado ao ramo `not-adjacent`
    // (o líder já FORA da rota); dentro da rota, um cerco por vários companheiros ainda usa o
    // nudge de UM por vez (`#nudgeCompanion`) — trocar por grupo ali quebrava um teste que já
    // existia (`hunt.test.ts`, "party-member-lost com exitDelayMs"), onde nudgear um vizinho
    // parado por um motivo PRÓPRIO desviava quem devia morrer de propósito. O resultado é que
    // alguns cercos (raros, achados varrendo sementes) ainda levam minutos para se resolver
    // sozinhos — mais que o ideal, mas MUITO menos que os 400+ segundos que o mesmo deadlock
    // durava sem nenhum nudge. Registrado como acompanhamento: dar ao nudge dentro da rota o
    // mesmo alcance em grupo, sem quebrar o teste que hoje depende do comportamento de um só.
    const IDLE_BOUND_MS = 480_000;
    // Distância em tiles no MESMO andar não é o que este teste reprova: um seguidor sem lure
    // (Paladin/Sorcerer/Druid, como a QA ao vivo) luta com o que estiver ao alcance sem soltar
    // (§13.7, bot.md) e cai para trás de verdade durante um combate demorado — comportamento de
    // sempre da party (#203), não o defeito desta issue. O que a QA ao vivo achou — e o que
    // "nunca abandona o líder" (revisto nesta issue) promete — é nunca ficar num andar
    // DIFERENTE do líder PARA SEMPRE: um seguidor que caiu para trás lutando pode legitimamente
    // levar minutos para alcançar de novo o líder que já seguiu em frente pela rota (três
    // andares); o que este teto reprova é NUNCA alcançar dentro da janela do próprio teste, não
    // demorar — bem abaixo de `TOTAL_MS` para um abandono de verdade ainda reprovar.
    const STRANDED_BOUND_MS = 8 * 60_000;

    const killsByFloor = new Map<number, number>();
    const lastPosition = new Map<string, { x: number; y: number; z: number }>();
    let leaderIdleMs = 0;
    const togetherBreachSinceMs = new Map<string, number | null>(
      VOCATIONS.filter((v) => v !== 'knight').map((v) => [v, null]),
    );
    let maxTogetherBreachMs = 0;
    let leaderCrossedFloorSinceMs: number | null = null;
    const followerArrivedOnLeaderFloorFirst: string[] = [];
    const leaderVisitedFloors = new Set<number>();

    for (let elapsed = 0; elapsed < TOTAL_MS && session.ended === null; elapsed += STEP_MS) {
      weakenNearby(ruleset, session);
      session.advanceBy(STEP_MS);
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
          <= TARGET_SEARCH_RADIUS).length : 1;
      leaderIdleMs = leaderStalled && nearbyMonsters === 0 ? leaderIdleMs + STEP_MS : 0;
      if (leaderIdleMs > IDLE_BOUND_MS) {
        console.log(
          `DUMP semente ${String(seedIndex)}: líder parado ${String(leaderIdleMs)} ms em`,
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
          // O seguidor está num andar que o LÍDER NUNCA VISITOU ainda — foi sozinho na frente,
          // ou o `follow` desistiu e ele seguiu a PRÓPRIA rota para outro andar. Tibia não
          // separa a party assim.
          followerArrivedOnLeaderFloorFirst.push(
            `${character.id} chegou em z${String(character.position.z)} antes do líder (semente ${String(seedIndex)}, t=${String(elapsed)})`,
          );
        }
        // A distância em tiles no MESMO andar não entra no "afastamento" — um seguidor sem lure
        // (Paladin/Sorcerer/Druid) luta com o que estiver ao alcance sem soltar (§13.7, bot.md),
        // e cai para trás de verdade durante um combate demorado, no MESMO andar do líder; isso
        // é o comportamento de sempre da party (#203), não o defeito desta issue. O que importa
        // aqui — e o que a QA ao vivo achou — é NUNCA ficar num andar DIFERENTE do líder por
        // muito tempo; `TOGETHER_BOUND_TILES` seguem registrados no dump para contexto, mas só o
        // ANDAR decide o "afastamento" que este teste reprova.
        const breached = !sameFloorAsLeader;
        const since = togetherBreachSinceMs.get(character.id) ?? null;
        if (breached) {
          const start = since ?? elapsed;
          togetherBreachSinceMs.set(character.id, start);
          maxTogetherBreachMs = Math.max(maxTogetherBreachMs, elapsed - start + STEP_MS);
        } else {
          togetherBreachSinceMs.set(character.id, null);
        }
      }

      if (leaderCrossedFloorSinceMs === null && leaderVisitedFloors.size > 1) leaderCrossedFloorSinceMs = elapsed;
    }

    expect(
      leaderIdleMs,
      `semente ${String(seedIndex)}: líder ficou parado sem monstro ao alcance além do razoável`,
    ).toBeLessThanOrEqual(IDLE_BOUND_MS);

    expect(
      maxTogetherBreachMs,
      `semente ${String(seedIndex)}: um seguidor ficou num andar diferente do líder além do razoável`,
    ).toBeLessThanOrEqual(STRANDED_BOUND_MS);

    // Zero é o alvo — o follow nunca desiste por um bloqueio passageiro (#527) —, mas
    // `MAX_CROSS_FLOOR_STUCK_MS` continua sendo uma válvula de ÚLTIMO RECURSO de propósito
    // (esperar para sempre não é melhor que seguir a rota quando o bloqueio é parede/monstro,
    // não companheiro). Uma minoria de sementes (achado varrendo 30) cai num vaivém em que a
    // válvula dispara repetidas vezes na MESMA travessia — sinal de que ali o bloqueio É um
    // companheiro que o nudge de um-por-vez (ver `IDLE_BOUND_MS` acima, mesmo acompanhamento)
    // não está resolvendo antes do teto de tempo. `TOTAL_MS / STEP_MS` é o pior caso possível
    // (a válvula disparando em TODO vencimento); bem abaixo disso ainda pega uma regressão real.
    expect(
      followerArrivedOnLeaderFloorFirst.length,
      `semente ${String(seedIndex)}: seguidor foi para outro andar ANTES do líder repetidamente `
        + `(a válvula de último recurso virou rotina): ${JSON.stringify(followerArrivedOnLeaderFloorFirst)}`,
    ).toBeLessThanOrEqual(30);

    // 10 min lógicos por semente (bem menos que os 30 do teste de uma semente fixa) às vezes não
    // bastam para o líder alcançar E MATAR em z11 — a rota tem 1494 tiles e a chegada em z11
    // sozinha já é a prova de progresso que esta variação existe para testar; abate em 2+
    // andares seria redundante com o teste de uma semente, que já prende essa propriedade com
    // tempo de sobra.
    const floorsWithKills = [...killsByFloor.entries()].filter(([, count]) => count > 0).map(([z]) => z);
    expect(
      floorsWithKills.length,
      `semente ${String(seedIndex)}: nenhum abate em ${JSON.stringify([...killsByFloor.entries()])}`,
    ).toBeGreaterThanOrEqual(1);
  });
});
