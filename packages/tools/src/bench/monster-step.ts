// Custo por monstro por tick (FUN-40).
//
// É o número que a projeção de custo do projeto inteiro usa, e a FUN-46 vai cobrar de novo
// com 5.000 hunts. Medir aqui, cedo e num cenário pequeno, é o que permite perceber uma
// regressão de ordem de grandeza antes de ela virar uma conta de servidor.
//
//   pnpm bench:monster

import { performance } from 'node:perf_hooks';
import { MonsterRuntime, Rng, chooseTarget, decideMonsterAction, type Prey } from '@draconya/sim';
import { BASIC_ABILITY_ID, compileMitigation } from '@draconya/content';
import type { Monster } from '@draconya/content';

/** 48 monstros é a instância cheia que o §17 descreve. */
const MONSTERS = 48;
const PLAYERS = 4;
const TICKS = 10_000;
const DT_MS = 100;

const definition: Monster = {
  id: 'rat', name: 'Rat', outfitId: 21, recommendedLevel: 1,
  health: 20, experience: 5, attack: 6, armor: 0, defense: 0, defenseMitigation: 0,
  damageType: 'physical',
  attackIntervalMs: 2_000, speed: 300, aggroRadius: 8,
  attackRange: 1, leashRadius: 0, blockable: false, loot: { items: [] },
  mitigation: compileMitigation(undefined),
  abilities: [{
    id: BASIC_ABILITY_ID, cadenceMs: 2_000, target: { range: 1 },
    power: { min: 6, max: 6 }, damageType: 'physical',
  }],
  defenses: [],
};

// Grade com paredes espalhadas: caminho livre demais não exercita o desvio, que é o ramo
// mais caro do passo guloso.
const SIZE = 40;
const blocked = (x: number, y: number): boolean =>
  x < 0 || y < 0 || x >= SIZE || y >= SIZE || (x % 7 === 3 && y % 5 !== 0);

const monsters = Array.from({ length: MONSTERS }, (_, i) => new MonsterRuntime({
  id: i + 1,
  monsterId: 'rat',
  position: { x: 2 + (i % 30), y: 2 + Math.floor(i / 30) },
  home: { x: 2 + (i % 30), y: 2 + Math.floor(i / 30) },
  health: 20,
  targetId: null,
  cooldowns: {},
}));
const prey: Prey[] = Array.from({ length: PLAYERS }, (_, i) => ({
  id: `p${i}`, position: { x: 20 + i, y: 20 }, alive: true, health: 100,
}));
// `definition` não declara `targetStrategy` (#541): esta semente nunca é consultada —
// `chooseTarget` só sorteia quando o conteúdo pede a estratégia ponderada.
const rng = Rng.fromSeed('bench-monster-step');

let steps = 0;
let attacks = 0;
const startedAt = performance.now();
for (let tick = 0; tick < TICKS; tick++) {
  // Os jogadores andam, para os monstros não convergirem e ficarem parados atacando.
  for (const [i, p] of prey.entries()) {
    prey[i] = { ...p, position: { x: 5 + ((tick + i * 7) % 30), y: 5 + ((tick >> 3) % 30) } };
  }
  for (const monster of monsters) {
    monster.targetId = chooseTarget(monster, prey, definition, rng, tick * DT_MS);
    const target = prey.find((p) => p.id === monster.targetId) ?? null;
    const action = decideMonsterAction(monster, target, definition, blocked);
    if (action.kind === 'step') {
      // Um passo por decisão desde a FUN-68: quem sabe quantos passos cabem numa janela é a
      // fila de eventos, e a decisão responde só "o que, deste tile".
      monster.position = action.to;
      steps++;
    } else if (action.kind === 'attack') {
      attacks++;
    }
  }
}
const elapsedMs = performance.now() - startedAt;
const perMonsterTickUs = (elapsedMs * 1_000) / (TICKS * MONSTERS);

console.log(`monstros            ${MONSTERS}`);
console.log(`jogadores           ${PLAYERS}`);
console.log(`ticks               ${TICKS.toLocaleString('pt-BR')} a ${DT_MS} ms`);
console.log(`passos / ataques    ${steps.toLocaleString('pt-BR')} / ${attacks.toLocaleString('pt-BR')}`);
console.log(`total               ${elapsedMs.toFixed(1)} ms`);
console.log(`por monstro/tick    ${perMonsterTickUs.toFixed(3)} µs`);
console.log(`instância cheia     ${(perMonsterTickUs * MONSTERS).toFixed(2)} µs por tick`);
console.log(`a 10 Hz             ${(perMonsterTickUs * MONSTERS * 10 / 1_000).toFixed(3)} ms/s de CPU por instância`);
