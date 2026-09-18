// A aplicação de um outcome de dano sobre o estado quente (CMB-08, emenda do ADR 0031).
//
// O `resolveDamage` é PURO: ele decide o número resolvido e o crítico, sem tocar em vida nem
// mana. Este módulo é a etapa SEGUINTE, e a única que escreve recurso — mana shield, HP
// efetivamente removido e leech clampado. Ele opera apenas os runtimes da sessão dona
// (invariante 9), e nada aqui é serializado: o `AppliedDamageOutcome` é efêmero, como o
// `DamageOutcome` que ele estende.
//
// A mana shield deixa de ser opaca dentro de `CharacterRuntime.receiveDamage` (DT-02): ela vira
// um estágio VISÍVEL, com o quanto absorveu no outcome, e é o que permite testar absorção total
// e parcial. O escudo continua valendo até vencer mesmo com a mana em zero, como no Tibia.
//
// O leech usa como base o HP EFETIVAMENTE removido (`healthDamage`), não o resolvido: overkill
// não rende leech, e dano integralmente absorvido pela mana não rende leech nenhum. A reposição
// é limitada ao teto do atacante, e o que o outcome informa é o que de fato entrou — nunca o
// que o modificador prometia.

import { CharacterRuntime } from '../character.js';
import type { MonsterRuntime } from '../monster/monster.js';
import type { DamageOutcome } from './damage.js';

/** Quem pode receber um golpe: personagem (mana shield, leech) ou monstro. */
export type DamageTarget = CharacterRuntime | MonsterRuntime;

/**
 * O outcome do CMB-08: o `DamageOutcome` mais o que a APLICAÇÃO produziu. Efêmero — não entra no
 * snapshot nem no S2C (DT-03); existe para o ruleset dono explicar o golpe e para o teste prender
 * cada etapa.
 */
export interface AppliedDamageOutcome extends DamageOutcome {
  /** Quanto a mana shield absorveu. Zero sem escudo, ou para um alvo que não tem mana. */
  readonly absorbedByMana: number;
  /** O que saiu da VIDA — `min(resolvido − absorvido, vida)`. É o que a barra e o hit mostram. */
  readonly healthDamage: number;
  /** Vida que o atacante de fato repôs pelo life leech, já clampada no teto dele. */
  readonly lifeLeechApplied: number;
  /** Mana que o atacante de fato repôs pelo mana leech, já clampada no teto dele. */
  readonly manaLeechApplied: number;
}

/**
 * Aplica o outcome resolvido sobre o alvo e devolve o que aconteceu de fato.
 *
 * `attacker` é quem recebe o leech — `null` quando não há (ataque de monstro, tique de DOT,
 * campo). `damageTakenScale` é a postura do defensor (`damageTakenScale`), aplicada ANTES do
 * escudo, como o ruleset já fazia: o golpe chega ao alvo já escalado, e o outcome preserva o
 * `resolvedDamage` puro para a auditoria.
 *
 * `extraManaShield` é o Energy Ring (§13.9, SV-16): a condição `mana-shield` OU o anel — uma
 * leitura só, nunca dois absorvedores em fila. Debitar a mana duas vezes pelo mesmo golpe não
 * faz sentido, e o personagem com as duas ativas absorve uma vez, como se tivesse só uma. Quem
 * resolve o anel é o ruleset, via `Inventory.ringEffect`, porque só ele tem o catálogo.
 *
 * O crítico já veio decidido do resolver; aqui não há RNG nenhum, e o custo por golpe é O(1),
 * sem alocação por string nem objeto de debug.
 */
export function applyDamageOutcome(
  target: DamageTarget,
  outcome: DamageOutcome,
  attacker: CharacterRuntime | null,
  damageTakenScale = 1,
  extraManaShield = false,
): AppliedDamageOutcome {
  let remaining = Math.max(0, Math.round(outcome.resolvedDamage * damageTakenScale));
  let absorbedByMana = 0;
  // A mana shield só existe em personagem. Ela absorve até onde a mana alcança; o resto segue
  // para a vida. O escudo NÃO some ao esvaziar a mana — ele vence no prazo, como sempre.
  if (target instanceof CharacterRuntime
    && (target.conditions.hasManaShield() || extraManaShield)) {
    absorbedByMana = Math.min(remaining, target.mana);
    target.mana -= absorbedByMana;
    remaining -= absorbedByMana;
  }
  // `receiveDamage` devolve o APLICADO e nunca deixa a vida negativa. Como `remaining` já pode
  // ser zero, um golpe integralmente absorvido não produz morte nem atribuição.
  const healthDamage = target.receiveDamage(remaining);

  let lifeLeechApplied = 0;
  let manaLeechApplied = 0;
  if (attacker !== null && healthDamage > 0) {
    const modifiers = outcome.intent.modifiers;
    const lifeLeech = modifiers?.lifeLeech ?? 0;
    if (lifeLeech > 0) {
      // `heal` devolve o que REPÔS, então o atacante cheio informa zero — o evento não mente.
      lifeLeechApplied = attacker.heal(Math.floor(healthDamage * lifeLeech));
    }
    const manaLeech = modifiers?.manaLeech ?? 0;
    if (manaLeech > 0) {
      const room = attacker.maxMana - attacker.mana;
      manaLeechApplied = Math.min(Math.floor(healthDamage * manaLeech), Math.max(0, room));
      attacker.mana += manaLeechApplied;
    }
  }

  return {
    ...outcome,
    absorbedByMana,
    healthDamage,
    lifeLeechApplied,
    manaLeechApplied,
  };
}
