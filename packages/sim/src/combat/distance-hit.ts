// Chance de acerto à distância (#522, ADR 0037 d.5, `combat-v2`).
//
// Só a DISTÂNCIA rola acerto ofensivo — corpo a corpo continua sem rolagem
// (`player-always-hit-melee`, `combat/weapon-power.ts`). O mecanismo é ORIGINAL do Draconya
// (ADR 0019): reproduz o COMPORTAMENTO de `WeaponDistance::useWeapon` do Canary — as TRÊS
// tabelas por balde que ele modela (75 uma mão, 90 duas mãos, 100), nunca o código.
//
// Três campos "só dado" entram em jogo aqui pela primeira vez:
//
//   - `ammunition.hitChance` (o `it.hitChance` DIRETO do Canary, #522): declarado e ≠ 0, ignora
//     a tabela inteira — a munição/arma de arremesso avulsa com chance fixa (viper star 80%).
//   - `ammunition.maxHitChance` (o `it.maxHitChance` do Canary, #524): seleciona o BALDE — um
//     valor que a tabela não modela (o power bolt declara 91) vira chance fixa também, mas só
//     quando `ammunition.hitChance` não decidiu antes.
//   - `weapon.hitChance` (o bônus/malus da ARMA, #524, ex.: royal crossbow `+3`): soma ao que a
//     munição calculou — tabela ou flat, por qualquer caminho —, sempre.
//
// Distância fora de `tiers`, dentro de um balde RECONHECIDO, é MISS (0%): o `default: chance =
// it.hitChance;` de cada `switch` do Canary, que vale 0 porque só se chega a essa tabela quando
// `it.hitChance` já é 0 — nunca o teto do balde.

import type { Combat, Tilemap } from '@draconya/content';
import { isBlocked } from '@draconya/content';
import type { Rng } from '../rng.js';
import type { WorldPoint } from '../movement.js';

/**
 * A chance de acerto, em PERCENTUAL inteiro `[0,100]`, para um tiro a `distance` tiles com
 * `skillLevel` de distância — ANTES do bônus/malus da arma (`weapon.hitChance`).
 *
 * `ammoHitChance` (o `it.hitChance` direto) tem PRIORIDADE sobre `ammoMaxHitChance` — a mesma
 * ordem do Canary (`WeaponDistance::useWeapon` confere `it.hitChance != 0` antes de entrar na
 * tabela). `ammoMaxHitChance` ausente, ou igual ao `defaultMaxHitChance` da tabela, usa o balde
 * default; um balde sem entrada em `buckets` é chance FIXA; uma distância sem entrada em
 * `tiers`, dentro de um balde reconhecido, é MISS (0), nunca o teto do balde.
 */
export function distanceHitChancePercent(
  distance: number, skillLevel: number, table: NonNullable<Combat['distanceHitChance']>,
  ammoMaxHitChance?: number, ammoHitChance?: number,
): number {
  if (ammoHitChance !== undefined && ammoHitChance !== 0) return ammoHitChance;

  const bucketId = ammoMaxHitChance ?? table.defaultMaxHitChance;
  const bucket = table.buckets.find((candidate) => candidate.maxHitChance === bucketId);
  if (bucket === undefined) return bucketId;

  const tier = bucket.tiers.find((candidate) => candidate.distance === distance);
  if (tier === undefined) return 0;
  const cappedSkill = Math.min(skillLevel, tier.skillCap);
  const percent = Math.trunc(cappedSkill * tier.perSkill) + tier.flat;
  return Math.min(100, Math.max(0, percent));
}

/**
 * Rola o acerto de UM tiro. `weaponHitChanceBonus` é o `weapon.hitChance` do arco/besta (#524):
 * somado ao percentual da munição (tabela, ou qualquer um dos dois caminhos fixos), sempre —
 * nunca uma substituição.
 *
 * A rolagem acontece SEMPRE — mesmo com chance 0 ou 100 — para a sequência de RNG não depender
 * do VALOR da chance, a mesma regra do `blockChance` e do crítico (ADR 0031). Consome exatamente
 * uma fração do `Rng` da sessão.
 */
export function rollDistanceHit(
  distance: number, skillLevel: number, table: NonNullable<Combat['distanceHitChance']>,
  rng: Rng, ammoMaxHitChance?: number, ammoHitChance?: number, weaponHitChanceBonus?: number,
): boolean {
  const basePercent = distanceHitChancePercent(distance, skillLevel, table, ammoMaxHitChance, ammoHitChance);
  const percent = Math.min(100, Math.max(0, basePercent + (weaponHitChanceBonus ?? 0)));
  return rng.chance(percent / 100);
}

// --- destino do tiro que ERRA (#555) -------------------------------------------------------
//
// `WeaponDistance::useWeapon` (Canary `src/items/weapons/weapons.cpp:830-855`): no erro, e só
// quando o atirador NÃO está a até 1 tile do alvo (`!Position::areInRange<1,1,0>` guarda o
// desvio inteiro), o projétil vai para um tile sorteado entre nove candidatos — os 8 vizinhos
// MAIS o próprio tile do alvo — embaralhados, e o primeiro deles com chão e sem bloqueio
// "sólido e imóvel" (`TILESTATE_IMMOVABLEBLOCKSOLID`) vence; sem candidato nenhum, o destino
// não muda. O Draconya não tem essa segunda camada de bloqueio — `isBlocked` (parede + fora do
// mapa) já é o bloqueio único do jogo — e reproduz o MECANISMO (ADR 0037 d.1/d.3: "igual ao
// Tibia" já é argumento sozinho para mecânica de jogo) com uma FORMA diferente de sorteio: em
// vez de embaralhar os 9 e tomar o primeiro válido, filtram-se os ANDÁVEIS primeiro e sorteia-se
// um índice uniforme entre eles — mesma distribuição, uma rolagem por tiro errado, e o padrão
// que o resto do `sim` já usa para escolher entre opções (`rng.integer`, nunca `shuffle`).

/**
 * Os NOVE candidatos do Canary — 8 vizinhos + o próprio tile do alvo —, na ordem de
 * `WeaponDistance::useWeapon`. A ordem não decide o RESULTADO (o sorteio é por índice uniforme
 * nos ANDÁVEIS, não por varredura sequencial), só documenta a origem dos deslocamentos.
 */
const MISS_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

/**
 * O destino visual de um tiro que ERROU (#555). Adjacente ao alvo (`tiles <= 1`, a distância
 * Chebyshev do atirador), o Canary não redireciona — o destino continua sendo o alvo, o mesmo
 * `to` de antes desta issue. A mais de 1 tile, sorteia com `rng` um tile ANDÁVEL entre os nove
 * do quadro 3×3 centrado no alvo (o dele próprio incluso, como no Canary); sem nenhum andável
 * no quadro (parede fechando todo o entorno — não deveria acontecer em jogo, o do próprio alvo
 * é sempre andável, é onde o monstro está), o destino cai de volta no alvo.
 *
 * A ordem de RNG é CONTRATO (ADR 0031): UMA rolagem, sempre que o redirecionamento se aplica —
 * nunca quando `tiles <= 1`, nem quando o tiro acertou (o chamador só invoca isto no erro).
 * `candidates` já vem FILTRADO pelos andáveis antes do sorteio, então o número de rolagens não
 * depende de quantos tiles do quadro são parede — só de o tiro ter errado e a distância ser > 1.
 */
export function missShotTile(
  map: Tilemap, tiles: number, target: WorldPoint, rng: Rng,
): WorldPoint {
  if (tiles <= 1) return target;
  const candidates = MISS_OFFSETS
    .map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy, z: target.z }))
    .filter((tile) => !isBlocked(map, tile.x, tile.y, tile.z));
  if (candidates.length === 0) return target;
  return candidates[rng.integer(0, candidates.length - 1)] as WorldPoint;
}
