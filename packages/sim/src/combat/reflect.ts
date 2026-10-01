// O reflexo de dano do `combat-v3` (M30-05, #552; Canary `Game::combatChangeHealth`,
// `src/game/game.cpp:7957-7981`).
//
// O mecanismo é o MESMO qualquer que seja a fonte do reflexo — o item vestido pelo jogador
// (#552) ou o `monster.reflects` do monstro (#683) —, e por isso mora aqui, puro, e não dentro de
// quem hospeda a criatura. O que muda com a fonte é só `reflector`:
//
//   - `player` (o Canary pergunta `targetPlayer`): o dano volta como NEUTRO (`COMBAT_NEUTRALDAMAGE`
//     — nenhuma absorção, imunidade ou resistência do atacante o toca), e o reflexo SÓ flat de
//     físico exige o atacante adjacente (`max(dx, dy) < 2`);
//   - `monster`: o dano volta com o TIPO ORIGINAL, a qualquer distância.
//
// O valor é `flat + floor(dano bloqueado × percent / 100)` — o `ceil` do Canary age sobre o valor
// NEGATIVO (`damage.primary.value` já foi reinvertido), o que é um `floor` da magnitude —, com o
// teto `ceil(1 % da vida máxima do atacante)`. A segunda resolução contra o atacante é marcada
// como EXTENSÃO (`damageReflected.extension = true`): nunca reflete de novo, não rola crítico e
// não faz leech — e é o `extension` do intent que `resolveDamage` confere antes de calcular outro
// reflexo, então a recursão é impossível por construção.

import type { CompiledReflect, DamageType } from '@draconya/content';
import type { DamageIntent } from './damage.js';

/**
 * O reflexo do DEFENSOR: a tabela compilada (`compileReflect`, `content`) e quem reflete. Ausente
 * no `Defender` é quem não reflete nada — o caso de todo conteúdo até o #552.
 */
export interface DefenderReflect {
  readonly reflector: 'player' | 'monster';
  readonly table: CompiledReflect;
}

/**
 * O que o reflexo precisa saber do ATACANTE: a vida máxima (o teto de 1 %) e a distância em tiles
 * (`max(dx, dy)`, a exceção do físico flat). Ausente no intent é golpe sem criatura atacante —
 * tique de campo, por exemplo —, e aí não há contra quem refletir (o `if (attacker)` do Canary).
 */
export interface ReflectAttacker {
  readonly maxHealth: number;
  readonly distance: number;
}

/** O dano que volta ao atacante: quanto, de que tipo, e se é neutro (refletido por jogador). */
export interface ReflectedDamage {
  readonly amount: number;
  readonly damageType: DamageType;
  /**
   * Refletido por JOGADOR: o `COMBAT_NEUTRALDAMAGE` do Canary. O Draconya não tem o tipo neutro,
   * então o tipo original fica para a apresentação e esta marca faz a segunda resolução pular
   * absorção, aumento, imunidade e resistência — o que o neutro, sem entrada em tabela nenhuma,
   * pula no Canary. A mitigação percentual e o piso continuam valendo, como para qualquer tipo.
   */
  readonly neutral: boolean;
}

/**
 * O reflexo de UM golpe (#552), sobre o dano já bloqueado. `undefined` quando nada volta: sem
 * reflexo no tipo, físico só flat com o atacante longe (refletor jogador), ou valor zero.
 */
export function resolveReflect(
  blockedDamage: number, damageType: DamageType, reflect: DefenderReflect, attacker: ReflectAttacker,
): ReflectedDamage | undefined {
  const percent = reflect.table.percent[damageType];
  const flat = reflect.table.flat[damageType];
  if (percent <= 0 && flat <= 0) return undefined;
  // `target->getMonster() || type != PHYSICAL || percent > 0 || distance < 2`: só o reflexo
  // FLAT de físico do JOGADOR exige o atacante colado (o `reflectdamage` dos cinco itens).
  if (reflect.reflector === 'player' && damageType === 'physical' && percent <= 0
    && attacker.distance >= 2) {
    return undefined;
  }
  // Conta inteira: `percent` é inteiro, então `floor(d × p / 100)` não herda erro de ponto
  // flutuante (`0,29 × 100` seria 28,999…). O teto é `ceil(maxHealth × 0,01)` do Canary.
  const fromPercent = Math.floor((Math.max(0, blockedDamage) * percent) / 100);
  const limit = Math.ceil(attacker.maxHealth / 100);
  const amount = Math.min(limit, flat + fromPercent);
  if (amount <= 0) return undefined;
  return { amount, damageType, neutral: reflect.reflector === 'player' };
}

/**
 * O intent da SEGUNDA resolução, contra o atacante (#552): a extensão que nunca reflete, sem
 * crítico nem leech (sem `modifiers`), e sem bloqueio por defesa/armadura — os
 * `CombatParams` do Canary para o reflexo não declaram `blockedByArmor`/`blockedByShield`.
 */
export function reflectedDamageIntent(reflected: ReflectedDamage): DamageIntent {
  return {
    rawDamage: reflected.amount,
    source: 'reflect',
    damageType: reflected.damageType,
    blockable: { armor: false, shield: false },
    extension: true,
    ...(reflected.neutral ? { neutral: true } : {}),
  };
}
