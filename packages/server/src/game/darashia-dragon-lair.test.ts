import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Content } from '@draconya/content';
import { CharacterRuntime, createHuntSession, totalXpForLevel } from '@draconya/sim';
import type { HuntRuleset, Session } from '@draconya/sim';

// A Darashia Dragon Lair REAL (#520 fase 2, sobre o mapa/rota do #519): 47 pontos de spawn, cada
// um com o PRÓPRIO `monsterId` e `respawnDelayMs` (o `<spawn>` do Canary, ponto a ponto — não a
// composição sorteada que as outras hunts usam). Este teste mora no servidor, que carrega o
// conteúdo de verdade, como `rotworm-caves.test.ts`.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

/**
 * O personagem level 200 da party (#520): HP absurdamente alto de propósito — este arquivo
 * mede ONDE e QUANTOS monstros nascem, não quanto a party aguenta levar de bola de fogo.
 *
 * **`xp` precisa bater com `level`** (achado depurando este teste): `level: 200` com `xp: 0` é
 * um estado que o jogo real nunca produz, e o motor não confia cegamente no `level` do
 * construtor — algum caminho (o penalidade de morte/`levelForXp`) recalcula o level a partir do
 * xp e RETARGETA (`health`/`maxHealth` voltam para a tabela de progressão) na primeira vez que
 * o personagem toma um golpe: com xp 0 isso colapsa para nível ~1 e ~160 de HP, e a party
 * inteira morre em segundos — o motivo do primeiro rascunho deste teste falhar silenciosamente
 * (`session.ended` virava `'death'` bem antes dos 90 s do respawn). `totalXpForLevel(200, ...)`
 * é o xp que o level 200 REALMENTE tem, e com ele o HP absurdo sobrevive de verdade.
 */
function partyMember(id: string, vocationId: string | null, progression: Content['progression']): CharacterRuntime {
  return new CharacterRuntime({
    id, position: { x: 0, y: 0, z: 10 },
    health: 10_000_000, maxHealth: 10_000_000, mana: 10_000, maxMana: 10_000,
    level: 200, xp: totalXpForLevel(200, progression), vocationId,
    staminaMs: 86_400_000, staminaUpdatedAtMs: 0,
    gold: 0, goldDelta: 0, alive: true, cooldowns: {},
  });
}

function enter(content: Content): { session: Session; ruleset: HuntRuleset } {
  const session = createHuntSession({
    id: 'darashia', content, huntId: 'darashia-dragon-lair', difficulty: 'cautious', createdAtMs: 0,
    partyOptions: { leaderId: 'knight', mode: 'shared' },
  });
  // Knight, Paladin, Sorcerer, Druid — a party de quatro do M28 (docs/product/party.md).
  for (const [id, vocationId] of [
    ['knight', 'knight'], ['paladin', 'paladin'], ['sorcerer', 'sorcerer'], ['druid', 'druid'],
  ] as const) {
    session.enter(partyMember(id, vocationId, content.progression));
  }
  return { session, ruleset: session.ruleset as HuntRuleset };
}

function run(session: Session, durationMs: number, stepMs: number): void {
  for (let t = 0; t < durationMs && session.ended === null; t += stepMs) session.advanceBy(stepMs);
}

describe('a Darashia Dragon Lair real (#520 fase 2)', () => {
  it('os 47 pontos nascem o monstro EXATO da rota: 19 Dragon em z10, 28 Dragon Lord em z11/z12', () => {
    // `monsterCount: 47` — o mesmo tanto de `spawnPoints` — é deliberado (ver o `_open` da
    // hunt): cada lugar cobre exatamente um ponto, e cada ponto já diz o próprio monstro. Sem
    // isso o `Spawner` cobriria só um SUBCONJUNTO dos pontos, espalhado pelo laço.
    const { session, ruleset } = enter(real());
    run(session, 30_000, 100);

    const alive = ruleset.monsters.filter((m) => m.alive);
    expect(alive).toHaveLength(47);

    const dragons = alive.filter((m) => m.monsterId === 'dragon');
    const lords = alive.filter((m) => m.monsterId === 'dragon-lord');
    expect(dragons).toHaveLength(19);
    expect(lords).toHaveLength(28);

    // Dragon só em z10; Dragon Lord em z11 (24) e z12 (4) — exatamente como o Canary spawna.
    expect(dragons.every((m) => m.position.z === 10)).toBe(true);
    expect(lords.filter((m) => m.position.z === 11)).toHaveLength(24);
    expect(lords.filter((m) => m.position.z === 12)).toHaveLength(4);
    expect(lords.every((m) => m.position.z === 11 || m.position.z === 12)).toBe(true);
  });

  it('cada monstro nasce no tile do PRÓPRIO ponto (raio 1) — as coordenadas do Canary, não um ponto genérico', () => {
    // Confere logo ao nascer, ANTES de qualquer passo (o teste é sobre onde ele NASCE, não onde
    // ele anda depois — trinta segundos de perseguição já teriam movido metade do bando).
    const { session, ruleset } = enter(real());
    run(session, 1_000, 100);
    const alive = ruleset.monsters.filter((m) => m.alive);

    const firstPoint = { x: 38, y: 7, z: 10 }; // spawnPoints[0].at, data/routes/darashia-dragon-lair.json
    const nearFirst = alive.find((m) => m.monsterId === 'dragon'
      && Math.abs(m.position.x - firstPoint.x) <= 1 && Math.abs(m.position.y - firstPoint.y) <= 1
      && m.position.z === firstPoint.z);
    expect(nearFirst).toBeDefined();

    const z12Lords = alive.filter((m) => m.monsterId === 'dragon-lord' && m.position.z === 12);
    expect(z12Lords).toHaveLength(4);
  });

  it('o respawn de UM ponto acontece 90 s depois do abate — nem antes, com o MESMO monstro do ponto', () => {
    // A party tem HP absurdo, mas ataca de verdade (o combate do conteúdo real) — em pouco
    // tempo mata algum dragão perto da entrada por conta própria. O abate de VERDADE (pelo
    // pipeline inteiro, `resolveDeath`/`#onMonsterDied`) é o que de fato libera o lugar e agenda
    // o respawn; escrever `monster.receiveDamage` à mão SÓ zera o HP, sem passar pelo pipeline —
    // por isso este teste espera o abate ACONTECER, via `ground-item-appeared` (FUN-123).
    const { session, ruleset } = enter(real());
    // A ÂNCORA é a posição de NASCIMENTO (o `at` do ponto), não a de morte: um Dragon persegue
    // a party antes de cair, então a posição do `ground-item-appeared` já pode estar alguns
    // tiles longe do ponto — e é NO PONTO, não onde ele morreu, que o respawn acontece.
    run(session, 100, 100);
    const spawned = ruleset.monsters.find((m) => m.alive);
    if (spawned === undefined) throw new Error('sem monstro nascido');
    const trackedId = spawned.id;
    const homePosition = { ...spawned.position };
    const monsterId = spawned.monsterId;
    const nearHome = (m: (typeof ruleset.monsters)[number]): boolean =>
      m.alive && m.monsterId === monsterId
      && Math.abs(m.position.x - homePosition.x) <= 1 && Math.abs(m.position.y - homePosition.y) <= 1
      && m.position.z === homePosition.z;

    // Deixa a party engajar e o alvo escolhido chegar perto de morrer, depois esvazia o HP DELE
    // (pelo `id` rastreado, não "o primeiro vivo") para 1 — o próximo golpe da party o mata pelo
    // PIPELINE de verdade, sem esperar minutos de dano desarmado contra 1000+ de HP.
    let killedAtMs: number | null = null;
    let elapsedMs = 0;
    for (; elapsedMs < 60_000 && killedAtMs === null; elapsedMs += 100) {
      const stillTracked = ruleset.monsters.find((m) => m.id === trackedId);
      if (stillTracked !== undefined && stillTracked.alive && stillTracked.health > 1) {
        stillTracked.receiveDamage(stillTracked.health - 1);
      }
      session.advanceBy(100);
      for (const event of session.drainEvents()) {
        if (event.kind !== 'ground-item-appeared') continue;
        if (event.monsterId !== monsterId) continue;
        // Confere que É o rastreado: mais de um Dragon pode morrer perto da entrada, e só o
        // ID rastreado conta para "instante 0" dos 90 s deste teste.
        if (ruleset.monsters.some((m) => m.id === trackedId && m.alive)) continue;
        killedAtMs = elapsedMs;
        break;
      }
    }
    if (killedAtMs === null) throw new Error('o alvo rastreado não morreu em 60 s');
    expect(ruleset.monsters.some(nearHome)).toBe(false);

    // Ainda dentro dos 90 s do `spawntime` do ponto: o lugar continua vazio.
    run(session, 80_000, 100);
    expect(ruleset.monsters.some(nearHome)).toBe(false);

    // No vencimento (90 000 ms desde o abate), o lugar volta a ocupar — com o MESMO `monsterId`
    // (#519: o ponto declara o monstro, não a composição sorteada) na MESMA vizinhança. Margem
    // de 25 s além dos 90 para o `SPAWN_RETRY_MS` de 1 s achar tile livre mesmo se o primeiro
    // estiver ocupado no instante exato do vencimento.
    run(session, 25_000, 100);
    expect(ruleset.monsters.some(nearHome)).toBe(true);
  });
});
