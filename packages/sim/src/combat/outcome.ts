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
// que o modificador prometia. A FÓRMULA (M30-04, #551) e a divisão por `targetsAffected` moram
// em `applyLeech`/`calculateLeechAmount` (`combat/modifiers.ts`) — a peça compartilhada com a
// magia em área, que não passa por este `DamageOutcome`.

import { CharacterRuntime } from '../character.js';
import type { MonsterRuntime } from '../monster/monster.js';
import type { DamageOutcome } from './damage.js';
import { applyLeech } from './modifiers.js';

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
  /**
   * Quantos alvos a MESMA ação de dano atingiu (M30-04, #551, `damage.affected` do Canary):
   * default `1`, o golpe de alvo único de sempre — nesse caso `calculateLeechAmount` reduz à
   * identidade (`(0,1×1+0,9)/1 = 1`), e o v1/v2/v3 continuam bit a bit. A magia em área
   * (`HuntRuleset#applyHits`) passa o total de alvos da MESMA mira.
   */
  targetsAffected = 1,
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
    // `heal`/`mana` devolvem o que de fato REPÔS, então o atacante cheio informa zero — o
    // evento não mente. A fórmula é `calculateLeechAmount` (`combat/modifiers.ts`, M30-04):
    // NÃO uma divisão simples por `targetsAffected` — ver o comentário dela.
    ({ lifeLeechApplied, manaLeechApplied } = applyLeech(
      attacker, healthDamage, outcome.intent.modifiers, targetsAffected,
    ));
  }

  // As cargas de bloqueio do `combat-v3` (#548): o resolver só CALCULA o estado novo
  // (`outcome.blockCharge`); esta é a única etapa que ESCREVE recurso, e é aqui que ele volta
  // para o dono (invariante 9). Ausente é `combat-v1`/`v2`; imunidade ou origem que não
  // bloqueia nada devolvem o MESMO estado de entrada — a escrita é um no-op nesses casos.
  if (outcome.blockCharge !== undefined) target.blockCharge = outcome.blockCharge;

  return {
    ...outcome,
    absorbedByMana,
    healthDamage,
    lifeLeechApplied,
    manaLeechApplied,
  };
}
