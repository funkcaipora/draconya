// A geometria do cleave (M30-05, #552; Canary `WeaponMelee::useWeapon`,
// `src/items/weapons/weapons.cpp:531-589`).
//
// O golpe corpo a corpo com `cleavePercent` também acerta os DOIS tiles que flanqueiam o alvo,
// perpendiculares à linha atacante → alvo:
//
//   - alvo na mesma coluna (mesmo x): os tiles a leste e a oeste DO ALVO;
//   - alvo na mesma linha (mesmo y): os tiles ao norte e ao sul DO ALVO;
//   - alvo na diagonal: o tile ao lado do alvo no eixo x, um passo EM DIREÇÃO ao atacante, e o
//     tile ao lado no eixo y, também em direção ao atacante — os dois vizinhos do atacante que
//     também são vizinhos do alvo.
//
// A ORDEM é a do Canary (primeiro tile, depois o segundo) e é contrato: cada vítima rola o
// próprio poder com o `Rng` da sessão, e trocar a ordem troca qual sorteio cai em quem.

import type { GridPoint } from '../monster/step.js';

/** Os dois tiles do cleave, na ordem do Canary; `null` com atacante e alvo no mesmo tile. */
export function cleaveTiles(attacker: GridPoint, target: GridPoint): readonly [GridPoint, GridPoint] | null {
  if (attacker.x === target.x && attacker.y === target.y) return null;
  if (target.x === attacker.x) {
    return [{ x: target.x + 1, y: target.y }, { x: target.x - 1, y: target.y }];
  }
  if (target.y === attacker.y) {
    return [{ x: target.x, y: target.y + 1 }, { x: target.x, y: target.y - 1 }];
  }
  return [
    { x: target.x > attacker.x ? target.x - 1 : target.x + 1, y: target.y },
    { x: target.x, y: target.y > attacker.y ? target.y - 1 : target.y + 1 },
  ];
}

/**
 * O poder de UMA vítima do cleave: a rolagem própria de dano da arma, na fração inteira do
 * `cleavePercent` — `(dano × percent) / 100` em inteiro, truncado, como o C++ faz com `int32_t`.
 */
export function cleavePower(power: number, cleavePercent: number): number {
  return Math.trunc((power * cleavePercent) / 100);
}
