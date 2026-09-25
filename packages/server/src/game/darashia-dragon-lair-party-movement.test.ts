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

function enter(content: Content): { session: Session; ruleset: HuntRuleset } {
  const session = createHuntSession({
    id: 'darashia-party-movement', content, huntId: 'darashia-dragon-lair', difficulty: 'cautious',
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

describe('a party de dragões atravessa os três andares JUNTA (#527)', () => {
  it('segue o líder através de escada, mata em mais de um andar, e ninguém fica parado além do razoável', () => {
    const { session, ruleset } = enter(real());

    const STEP_MS = 10_000;
    const TOTAL_MS = 30 * 60_000; // 30 min de tempo LÓGICO — rápido de rodar, o mapa tem 1494 tiles de rota
    // Seguidor sem lure configurado (Paladin/Sorcerer/Druid, como a QA ao vivo) luta com QUALQUER
    // coisa ao alcance sem soltar — sem lure não há `MAX_LURE_HOLD_MS`/`LURE_FORCE_WALK_MS` (só o
    // Knight tem lure aqui) —, e um trecho denso pode prender um deles em combate genuíno por
    // vários minutos de tempo lógico. O bound aqui não é "nunca para" — é "nunca para PARA
    // SEMPRE": bem abaixo do TOTAL_MS, para um deadlock de verdade ainda reprovar o teste.
    const STALL_BOUND_MS = 20 * 60_000;
    const STRANDED_BOUND_MS = 20 * 60_000; // ninguém preso em andar DIFERENTE do líder pelo resto da hunt
    // O líder nunca fica parado com ZERO monstros ao alcance de busca por mais que uns poucos
    // vencimentos (#527, achado na QA ao vivo em cima do #539/#538 integrados: a party toda
    // ficou de 90 a 200+ segundos parada em (64,55,z10), lure MIN 4 · MAX 8, nenhum monstro a
    // menos de 14 tiles — os dragões nos PRÓPRIOS pontos, fora do raio de busca). Um caçador do
    // Tibia não fica parado olhando para o vazio; ele anda e puxa a próxima leva. A janela aqui
    // é bem mais curta que `STALL_BOUND_MS`: parar por um vencimento enquanto pondera é normal,
    // parar por mais de um minuto lógico sem NADA para lutar não é.
    const IDLE_WITH_NOTHING_TO_FIGHT_BOUND_MS = 60_000;
    const TARGET_SEARCH_RADIUS = 8;

    const killsByFloor = new Map<number, number>();
    const visitedFloors = new Map<string, Set<number>>(VOCATIONS.map((v) => [v, new Set<number>()]));
    const lastPosition = new Map<string, { x: number; y: number; z: number }>();
    const stalledSinceMs = new Map<string, number>(VOCATIONS.map((v) => [v, 0]));
    const strandedSinceMs = new Map<string, number>(VOCATIONS.map((v) => [v, 0]));
    let maxStalledMs = 0;
    let maxStrandedMs = 0;
    let leaderIdleWithNothingToFightMs = 0;
    let maxLeaderIdleWithNothingToFightMs = 0;

    for (let elapsed = 0; elapsed < TOTAL_MS && session.ended === null; elapsed += STEP_MS) {
      weakenNearby(ruleset, session);
      session.advanceBy(STEP_MS);
      for (const event of session.drainEvents()) {
        if (event.kind !== 'ground-item-appeared') continue;
        killsByFloor.set(event.position.z, (killsByFloor.get(event.position.z) ?? 0) + 1);
      }

      const leader = session.participants.find((p) => p.id === 'knight');
      if (leader === undefined) throw new Error('líder não está mais na sessão');

      for (const character of session.participants) {
        const { id, position } = character;
        visitedFloors.get(id)?.add(position.z);

        const previous = lastPosition.get(id);
        const stalled = previous !== undefined
          && previous.x === position.x && previous.y === position.y && previous.z === position.z;
        const stalledMs = (stalled ? (stalledSinceMs.get(id) ?? 0) : 0) + (stalled ? STEP_MS : 0);
        stalledSinceMs.set(id, stalledMs);
        maxStalledMs = Math.max(maxStalledMs, stalledMs);

        if (id === 'knight') {
          const nearbyMonsters = stalled ? ruleset.monsters.filter((m) => m.alive
            && m.position.z === position.z
            && Math.max(Math.abs(m.position.x - position.x), Math.abs(m.position.y - position.y))
              <= TARGET_SEARCH_RADIUS).length : 1;
          leaderIdleWithNothingToFightMs = stalled && nearbyMonsters === 0
            ? leaderIdleWithNothingToFightMs + STEP_MS
            : 0;
          maxLeaderIdleWithNothingToFightMs = Math.max(
            maxLeaderIdleWithNothingToFightMs, leaderIdleWithNothingToFightMs,
          );
        }
        lastPosition.set(id, { x: position.x, y: position.y, z: position.z });

        const strandedNow = id !== 'knight' && !sameFloor(position.z, leader.position.z);
        const strandedMs = strandedNow ? (strandedSinceMs.get(id) ?? 0) + STEP_MS : 0;
        strandedSinceMs.set(id, strandedMs);
        maxStrandedMs = Math.max(maxStrandedMs, strandedMs);
      }
    }

    // 1) a rota progrediu através dos três andares — não só o líder: os QUATRO chegam em z10 e
    //    z11 (as duas pernas longas da rota), porque o follow através de escada (#527) é o que
    //    corrige o Druid indo sozinho para o meio dos Dragon Lords na QA ao vivo. z12 é um
    //    desvio curto (~40 dos 1494 tiles da rota, só 4 pontos de spawn); exigir que os QUATRO
    //    cheguem lá dentro da MESMA passada por z12 do líder seria testar sorte de sincronismo,
    //    não a propriedade que a issue pede — então para z12 basta a PARTY (qualquer um) ter
    //    chegado, e o líder é quem a rota garante que passa por lá sempre.
    for (const vocationId of VOCATIONS) {
      const visited = visitedFloors.get(vocationId) ?? new Set<number>();
      expect(visited.has(10), `${vocationId} nunca esteve em z10`).toBe(true);
      expect(visited.has(11), `${vocationId} nunca chegou em z11`).toBe(true);
    }
    expect(visitedFloors.get('knight')?.has(12), 'o líder nunca chegou em z12').toBe(true);

    // 2) matou em mais de um andar — não só onde a party nasceu.
    const floorsWithKills = [...killsByFloor.entries()].filter(([, count]) => count > 0).map(([z]) => z);
    expect(floorsWithKills.length, `abates só em ${JSON.stringify([...killsByFloor.entries()])}`).toBeGreaterThanOrEqual(2);

    // 3) ninguém ficou parado (posição idêntica) além da janela — nem o líder "PARADO NA ROTA"
    //    para sempre por achar que tem gente ao alcance que não tem (#527, lure cross-floor).
    expect(maxStalledMs, 'alguém ficou parado além do razoável').toBeLessThanOrEqual(STALL_BOUND_MS);

    // 4) ninguém ficou preso num andar diferente do líder além da janela — o "regroup limitado"
    //    que o design da party pretende: o líder não espera para sempre, mas quem segue também
    //    não fica abandonado para sempre num andar errado.
    expect(maxStrandedMs, 'alguém ficou preso longe do andar do líder além do razoável')
      .toBeLessThanOrEqual(STRANDED_BOUND_MS);

    // 5) o líder nunca fica parado com ZERO monstros ao alcance de busca por mais que uns
    //    poucos vencimentos — achado na QA ao vivo (#527): a party parava "PARADA NA ROTA" com
    //    os dragões nos próprios pontos, fora de alcance, e nada ao alcance para justificar a
    //    parada. O líder tem que puxar a próxima leva, não esperar ela vir sozinha.
    expect(
      maxLeaderIdleWithNothingToFightMs,
      'o líder ficou parado sem NENHUM monstro ao alcance além do razoável',
    ).toBeLessThanOrEqual(IDLE_WITH_NOTHING_TO_FIGHT_BOUND_MS);
  });
});
