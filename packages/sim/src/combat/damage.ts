// Resolução de dano (FUN-35, §12.2).
//
// O combate aqui é mais simples que o de RPG costuma ser, e a simplicidade é decisão:
//
//   1. ATAQUE DE JOGADOR SEMPRE ACERTA. Não existe rolagem de acerto ofensivo, o que apaga
//      metade da matemática de combate — e apaga junto a frustração de errar sem entender.
//   2. DODGE É DO DEFENSOR, e quando ativa o dano cai para 50%. NÃO zera: um golpe que passa
//      pela defesa ainda machuca, e "esquivei" nunca vira invulnerabilidade.
//
// Nenhum coeficiente mora neste arquivo (§12.1). Todos vêm de `content`.

import type { Combat } from '@draconya/content';
import type { Rng } from '../rng.js';

export type AttackKind = 'melee' | 'magic';

/**
 * Onde o golpe acontece. Bônus de Bestiário são **PvE-only** (§18.5), e o contexto é o que
 * impede a Guild War de herdá-los — a regra fica estrutural em vez de lembrada.
 */
export type CombatContext = 'pve' | 'pvp';

export interface Defender {
  readonly armor: number;
  /** Chance base, em [0, 1]. */
  readonly dodgeChance: number;
  /** Acréscimo que vale SÓ em PvE — Bestiário (§18.5). */
  readonly pveDodgeBonus?: number;
}

export interface Attack {
  readonly power: number;
  readonly kind: AttackKind;
}

export interface DamageResult {
  readonly damage: number;
  readonly dodged: boolean;
  readonly kind: AttackKind;
}

/** Chance de esquiva que de fato vale, dado onde a luta acontece. */
export function effectiveDodge(defender: Defender, context: CombatContext): number {
  const bonus = context === 'pve' ? defender.pveDodgeBonus ?? 0 : 0;
  return Math.min(1, Math.max(0, defender.dodgeChance + bonus));
}

/**
 * Resolve um golpe. Função PURA a menos do RNG, que é o da sessão: semeado e determinístico
 * (FUN-25). `Math.random()` aqui tornaria "por que eu morri" uma pergunta sem resposta.
 */
export function resolveDamage(
  attack: Attack,
  defender: Defender,
  context: CombatContext,
  combat: Combat,
  rng: Rng,
): DamageResult {
  // A rolagem acontece SEMPRE, mesmo com chance zero.
  //
  // Pular quando não há esquiva faria a sequência do gerador depender de um atributo do
  // alvo — e aí dar dodge a um monstro deslocaria todo o loot que vem depois, num efeito
  // que ninguém ligaria à causa. Consumo uniforme é o que mantém a sequência auditável.
  const dodged = rng.chance(effectiveDodge(defender, context));

  const armorEffectiveness = combat.armorEffectiveness[attack.kind];
  const afterArmor = attack.power - defender.armor * armorEffectiveness;
  // Piso: nem a armadura mais alta zera um golpe. Dano zero contra um alvo pesado transforma
  // a luta em impasse silencioso, sem nada na tela dizendo o motivo.
  const floor = attack.power * combat.minimumDamageFraction;
  const beforeDodge = Math.max(floor, afterArmor);

  const damage = dodged ? beforeDodge * combat.dodgeMultiplier : beforeDodge;
  // Arredonda no FIM: arredondar antes do dodge faria 50% de 3 virar 2, e o jogador veria
  // uma esquiva que reduziu um terço.
  return { damage: Math.max(0, Math.round(damage)), dodged, kind: attack.kind };
}
