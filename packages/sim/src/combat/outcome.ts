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
// em `applyLeech`/`calculateLeechAmount` (`combat/modifiers.ts`); a magia em área passa o total
// de alvos da MESMA mira por `targetsAffected` (`HuntRuleset#applyHits`).
//
// `manadrain` (#547, M29-07) é o ÚNICO tipo que este estágio desvia da vida: ele resolve contra
// a MANA do alvo (`manaDamage`), nunca contra `healthDamage`, e por isso pula a mana shield (que
// converteria vida em mana — aqui já é mana) e o leech (a base é o HP removido, que fica em
// zero). `lifedrain` e `drown` são dano de vida comum e não tocam este desvio.

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
  /**
   * O que saiu da MANA por um golpe `manadrain` (#547, M29-07) — `min(resolvido, mana)`. Zero
   * para qualquer outro tipo, e zero para um alvo sem mana (todo `MonsterRuntime`). É o número
   * que o hit flutuante mostra quando `damageType === 'manadrain'`, no lugar do `healthDamage`
   * (que fica em zero: manadrain NUNCA mexe na vida).
   */
  readonly manaDamage: number;
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
  const scaled = Math.max(0, Math.round(outcome.resolvedDamage * damageTakenScale));

  // Manadrain (#547, M29-07; Canary `Game::combatChangeMana`, `game.cpp:9176`): dreno de MANA,
  // nunca de vida. A mana shield NÃO entra — ela converte vida em mana, e aqui já é mana o que
  // sai, então "absorver" duas vezes não faz sentido — e não há leech: a base do leech é o HP
  // efetivamente removido, que fica em ZERO neste golpe (a "correção sobre o inventário" da
  // issue: lifedrain e manadrain não curam quem ataca). Um alvo sem mana — todo `MonsterRuntime`
  // (monstro não tem mana no Draconya), e um `CharacterRuntime` já vazio — não perde nada, o
  // mesmo `manaLoss <= 0` que o Canary já trata como "nada aconteceu" (`return true` sem
  // `drainMana`). As cargas de bloqueio (#548) continuam voltando ao dono normalmente: o estágio
  // de `blockHit` já rodou por cima do `rawDamage` antes de chegar aqui, manadrain incluso.
  if (outcome.damageType === 'manadrain') {
    const currentMana = target instanceof CharacterRuntime ? target.mana : 0;
    const manaDamage = Math.min(currentMana, scaled);
    if (target instanceof CharacterRuntime) target.mana -= manaDamage;
    if (outcome.blockCharge !== undefined) target.blockCharge = outcome.blockCharge;
    return {
      ...outcome, absorbedByMana: 0, healthDamage: 0, manaDamage,
      lifeLeechApplied: 0, manaLeechApplied: 0,
    };
  }

  let remaining = scaled;
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
    manaDamage: 0,
    lifeLeechApplied,
    manaLeechApplied,
  };
}
