// Resolução de dano (FUN-35, §12.2; contrato de compatibilidade no ADR 0031, CMB-02).
//
// O combate aqui é mais simples que o de RPG costuma ser, e a simplicidade é decisão:
//
//   1. ATAQUE DE JOGADOR SEMPRE ACERTA. Não existe rolagem de acerto ofensivo, o que apaga
//      metade da matemática de combate — e apaga junto a frustração de errar sem entender.
//   2. DODGE É DO DEFENSOR, e quando ativa o dano cai para 50%. NÃO zera: um golpe que passa
//      pela defesa ainda machuca, e "esquivei" nunca vira invulnerabilidade.
//
// Nenhum coeficiente mora neste arquivo (§12.1). Todos vêm de `content`.
//
// Desde o CMB-02 este é o PONTO PÚBLICO ÚNICO de resolução: arma (corpo a corpo, bow, wand),
// magia, runa e ataque de monstro chegam por `resolveDamage` e saem por um `DamageOutcome`
// auditável. O que é do chamador — aplicar, atribuir, anunciar, decidir morte, cobrar mana ou
// gold — continua sendo do chamador; o resolver só faz a conta.

import { COMBAT_PROFILES } from '@draconya/content';
import type { Combat, CompiledMitigation, DamageModifiers, DamageType } from '@draconya/content';
import { resolveDefense } from './defense.js';
import type { DefenseSource } from './defense.js';
import type { Rng } from '../rng.js';

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
  /**
   * Resistência/vulnerabilidade por tipo e imunidades (CMB-03), já compiladas no boot. Ausente
   * é o defensor neutro — a identidade que preserva o v1.
   */
  readonly mitigation?: CompiledMitigation | undefined;
  /**
   * A fonte de defesa do defensor (CMB-04): escudo, arma de uma mão, ou nenhuma. Ausente é
   * `none`, e é o que preserva o v1 — o estágio é identidade e não consome sorteio.
   */
  readonly defense?: DefenseSource | undefined;
}

/**
 * De ONDE o dano veio (CMB-02). Vocabulário INTERNO, separado do TIPO (DT-01 do ADR 0031): o
 * mesmo elemento pode vir de uma arma, de uma magia ou de uma ability de monstro.
 *
 * **Não é o `source` visual de `CreatureHit`** (`'melee' | 'spell'`, em `combat-events.ts`):
 * aquele é apresentação e diz que efeito desenhar; este diz qual fórmula resolveu. Reusar o
 * visual para a fórmula é exatamente a confusão que a DT-01 descarta.
 */
export type DamageSource = 'basic-attack' | 'spell' | 'rune' | 'monster-attack';

/**
 * O TIPO de dano. Desde o CMB-03 é o vocabulário CANÔNICO de `@draconya/content` — o `sim`
 * importa, não redeclara (DT-01). A tabela `combat.armorEffectiveness` é indexada por ele, e
 * a mitigação do defensor também.
 */
export type { DamageType };

/** O que o atacante entrega ao resolver. A entrada fica preservada no outcome. */
export interface DamageIntent {
  /** Poder bruto, antes de qualquer mitigação. */
  readonly rawDamage: number;
  readonly source: DamageSource;
  readonly damageType: DamageType;
  /**
   * Os modificadores avançados do atacante (CMB-08): crítico, life leech e mana leech. Ausente é
   * o default NEUTRO — nenhum sorteio novo é consumido e o resultado é bit a bit o do v1.
   */
  readonly modifiers?: DamageModifiers | undefined;
}

/**
 * O resultado auditável de uma resolução (DT-02 do ADR 0031). **Efêmero**: nunca vai ao
 * cliente, nunca entra no snapshot. Existe para o host e o extrato conseguirem explicar o
 * dano — quais estágios incidiram e quanto cada um tirou.
 *
 * Os campos são os estágios na ORDEM congelada do perfil: defesa → armadura → piso →
 * resistência → imunidade → corte do Dodge → arredondamento.
 */
export interface DamageOutcome {
  /** O id do perfil que resolveu — `Content.version` é quem o fixa na sessão (invariante 7). */
  readonly profile: string;
  readonly intent: DamageIntent;
  /** O tipo que resolveu, repetido do `intent` para o consumidor não precisar desembrulhar. */
  readonly damageType: DamageType;
  /** Depois da defesa/escudo — identidade em v1 (CMB-04). */
  readonly afterDefense: number;
  /** Depois da armadura por tipo, ainda ANTES do piso (pode ser negativo). */
  readonly afterArmor: number;
  /** Quanto a armadura subtraiu, já com a efetividade do tipo de dano. */
  readonly armorReduction: number;
  /** O piso do perfil, como fração do poder bruto. */
  readonly minimumDamage: number;
  /** Depois do piso e da resistência/vulnerabilidade, ainda ANTES da imunidade e do Dodge. */
  readonly afterResistance: number;
  /** Imunidade EXPLÍCITA ao tipo (DT-02): zera, e o piso não a revoga. */
  readonly immune: boolean;
  readonly dodged: boolean;
  /**
   * O crítico rolou e ativou (CMB-08). A rolagem é o TERCEIRO sorteio do golpe, DEPOIS do Dodge
   * e da defesa, e só existe quando o intent declara `modifiers.critical`. Ausente o modificador,
   * é sempre `false` e nenhum sorteio é consumido — é o que preserva o v1.
   */
  readonly critical: boolean;
  /** O que sobrou depois de tudo, arredondado só no fim. É o que o ruleset aplica. */
  readonly resolvedDamage: number;
}

/** Chance de esquiva que de fato vale, dado onde a luta acontece. */
export function effectiveDodge(defender: Defender, context: CombatContext): number {
  const bonus = context === 'pve' ? defender.pveDodgeBonus ?? 0 : 0;
  return Math.min(1, Math.max(0, defender.dodgeChance + bonus));
}

/**
 * A resolução do perfil `combat-v1` (ADR 0031, emenda do CMB-03). Preserva **bit a bit** o
 * resultado entregue quando não há mitigação, e a ordem é a do contrato:
 *
 *   1. uma única rolagem de Dodge, SEMPRE consumida, primeiro ato;
 *   2. defesa/escudo (CMB-04) — só rola quando há fonte elegível e o tipo é aprovado;
 *   3. crítico (CMB-08) — só rola quando o intent declara `modifiers.critical`;
 *   4. armadura por tipo, sem RNG;
 *   5. piso (`minimumDamageFraction`) — DEPOIS da armadura e ANTES da resistência;
 *   6. resistência/vulnerabilidade por tipo (identidade sem dado);
 *   7. imunidade explícita, que zera sem o piso revogar;
 *   8. corte do Dodge, se a rolagem ativou;
 *   9. multiplicador do crítico, se ativou;
 *  10. arredondamento só no fim, com piso em zero.
 *
 * A ordem difere da do Tibia (defesa antes de tudo) porque a POSIÇÃO DO SORTEIO é do Draconya:
 * a rolagem é o primeiro ato para que nenhum estágio novo a desloque. Um estágio que mude a
 * sequência do conteúdo JÁ entregue exige perfil novo; o bloqueio do CMB-04 só rola quando o
 * conteúdo declara defesa, então o v1 sem defesa continua consumindo exatamente um sorteio.
 */
function resolveCombatV1(
  intent: DamageIntent,
  defender: Defender,
  context: CombatContext,
  combat: Combat,
  rng: Rng,
): DamageOutcome {
  // A rolagem acontece SEMPRE, mesmo com chance zero.
  //
  // Pular quando não há esquiva faria a sequência do gerador depender de um atributo do
  // alvo — e aí dar dodge a um monstro deslocaria todo o loot que vem depois, num efeito
  // que ninguém ligaria à causa. Consumo uniforme é o que mantém a sequência auditável.
  const dodged = rng.chance(effectiveDodge(defender, context));

  // Defesa/escudo (CMB-04): o estágio real, e o SEGUNDO sorteio do golpe quando há fonte
  // elegível e o tipo está aprovado. Sem fonte, é identidade e não consome nada — é o que
  // mantém o v1 bit a bit. A rolagem de Dodge acima continua sendo o primeiro ato.
  const afterDefense = resolveDefense(intent, defender.defense, combat, rng).afterDefense;

  // Crítico (CMB-08): o TERCEIRO sorteio, e SÓ quando o intent declara o modificador. Declarado
  // com `chance: 0`, ele ainda é consumido — a sequência não pode depender do VALOR, como no
  // bloqueio. Ausente o modificador, nenhum sorteio novo e o resultado é bit a bit o do v1.
  const criticalModifier = intent.modifiers?.critical;
  const critical = criticalModifier !== undefined && rng.chance(criticalModifier.chance);

  const armorReduction = defender.armor * combat.armorEffectiveness[intent.damageType];
  const afterArmor = afterDefense - armorReduction;
  // Piso: nem a armadura mais alta zera um golpe. Dano zero contra um alvo pesado transforma
  // a luta em impasse silencioso, sem nada na tela dizendo o motivo.
  //
  // A base do piso é o PODER BRUTO, não o pós-defesa: sem defesa os dois são o mesmo número (e
  // o v1 segue bit a bit), e com defesa é o que impede o escudo de zerar o golpe — o bloqueio
  // é limitado ao poder, e o piso sobrevive a ele.
  const minimumDamage = intent.rawDamage * combat.minimumDamageFraction;
  const afterFloor = Math.max(minimumDamage, afterArmor);

  // Resistência positiva reduz; negativa é vulnerabilidade e amplifica. Ausente é zero, e zero
  // é a identidade — o que preserva o v1 de todo conteúdo sem mitigação.
  const resistance = defender.mitigation?.resistances[intent.damageType] ?? 0;
  const afterResistance = afterFloor * (1 - resistance);

  // A imunidade vem DEPOIS do piso e o vence: imunidade é zero, e nenhum piso a transforma em
  // dano positivo. Ela é EXPLÍCITA (DT-02), nunca 100 % de resistência.
  const immune = defender.mitigation?.immunities.has(intent.damageType) ?? false;
  const afterImmunity = immune ? 0 : afterResistance;

  // O crítico multiplica o dano já mitigado, antes do corte do Dodge. Os dois são
  // multiplicativos e comutativos; o arredondamento continua só no fim, e a ordem fica
  // documentada (ADR 0031, emenda CMB-08). A imunidade zera e nenhum crítico a revoga.
  const afterCrit = critical ? afterImmunity * (criticalModifier?.multiplier ?? 1) : afterImmunity;
  const damage = dodged ? afterCrit * combat.dodgeMultiplier : afterCrit;
  // Arredonda no FIM: arredondar antes do dodge faria 50% de 3 virar 2, e o jogador veria
  // uma esquiva que reduziu um terço.
  return {
    profile: combat.compatibilityProfile,
    intent,
    damageType: intent.damageType,
    afterDefense,
    afterArmor,
    armorReduction,
    minimumDamage,
    afterResistance,
    immune,
    dodged,
    critical,
    resolvedDamage: Math.max(0, Math.round(damage)),
  };
}

/**
 * O PONTO PÚBLICO ÚNICO de resolução de dano (DT-02 do ADR 0031): os cinco produtores atuais
 * — golpe básico (corpo a corpo, bow, wand), magia, runa e ataque de monstro — chegam aqui.
 *
 * Função PURA a menos do RNG, que é o da sessão: semeado e determinístico (FUN-25).
 * `Math.random()` aqui tornaria "por que eu morri" uma pergunta sem resposta.
 *
 * O despacho é pelo perfil fixado no conteúdo. Perfil desconhecido **lança** — o resolver não
 * escolhe fallback; o boot de `buildContent` já o recusou antes de a sessão existir.
 *
 * O resolver NÃO cobra mana nem gold, NÃO agenda evento, NÃO escreve vida, NÃO atribui dano e
 * NÃO decide morte: quem faz isso é o ruleset, com o `resolvedDamage` do outcome.
 */
export function resolveDamage(
  intent: DamageIntent,
  defender: Defender,
  context: CombatContext,
  combat: Combat,
  rng: Rng,
): DamageOutcome {
  if (!COMBAT_PROFILES.has(combat.compatibilityProfile)) {
    throw new Error(
      `perfil de combate "${combat.compatibilityProfile}" desconhecido: o resolver não escolhe ` +
        'fallback (ADR 0031)',
    );
  }
  switch (combat.compatibilityProfile) {
    case 'combat-v1':
      return resolveCombatV1(intent, defender, context, combat, rng);
    default:
      // Inalcançável enquanto o registro do conteúdo e este despacho conhecerem o mesmo
      // conjunto; existe para um perfil novo não virar uma fórmula silenciosamente ausente.
      throw new Error(
        `perfil de combate "${combat.compatibilityProfile}" não tem implementação (ADR 0031)`,
      );
  }
}
