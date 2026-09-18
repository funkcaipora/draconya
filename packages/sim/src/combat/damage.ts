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
import type { Combat } from '@draconya/content';
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
}

/**
 * De ONDE o dano veio (CMB-02). Vocabulário INTERNO e transitório até o CMB-03, quando os
 * tipos de dano e a resistência por tipo entrarem.
 *
 * **Não é o `source` visual de `CreatureHit`** (`'melee' | 'spell'`, em `combat-events.ts`):
 * aquele é apresentação e diz que efeito desenhar; este diz qual fórmula resolveu. Reusar o
 * visual para a fórmula é exatamente a confusão que a DT-01 do ADR 0031 descarta.
 */
export type DamageSource = 'basic-attack' | 'spell' | 'rune' | 'monster-attack';

/**
 * O TIPO de dano, transitório até o CMB-03. Hoje ele só decide qual coluna de
 * `combat.armorEffectiveness` vale — `physical` → `melee`, `arcane` → `magic` —, sem renomear
 * a tabela do conteúdo. A coluna é a mesma; o vocabulário é que ficou explícito.
 */
export type DamageType = 'physical' | 'arcane';

/** O que o atacante entrega ao resolver. A entrada fica preservada no outcome. */
export interface DamageIntent {
  /** Poder bruto, antes de qualquer mitigação. */
  readonly rawDamage: number;
  readonly source: DamageSource;
  readonly damageType: DamageType;
}

/**
 * O resultado auditável de uma resolução (DT-02 do ADR 0031). **Efêmero**: nunca vai ao
 * cliente, nunca entra no snapshot. Existe para o host e o extrato conseguirem explicar o
 * dano — quais estágios incidiram e quanto cada um tirou.
 */
export interface DamageOutcome {
  /** O id do perfil que resolveu — `Content.version` é quem o fixa na sessão (invariante 7). */
  readonly profile: string;
  readonly intent: DamageIntent;
  /** Quanto a armadura subtraiu, já com a efetividade do tipo de dano. */
  readonly armorReduction: number;
  /** O piso do perfil, como fração do poder bruto. */
  readonly minimumDamage: number;
  readonly dodged: boolean;
  /** O que sobrou depois de tudo, arredondado só no fim. É o que o ruleset aplica. */
  readonly resolvedDamage: number;
}

/** Chance de esquiva que de fato vale, dado onde a luta acontece. */
export function effectiveDodge(defender: Defender, context: CombatContext): number {
  const bonus = context === 'pve' ? defender.pveDodgeBonus ?? 0 : 0;
  return Math.min(1, Math.max(0, defender.dodgeChance + bonus));
}

/**
 * O mapa transitório de `DamageType` para as chaves de `combat.armorEffectiveness` (CMB-02).
 * Constante de módulo: nada é alocado por golpe. O CMB-03 troca a TABELA por tipo de dano; a
 * tradução `physical`/`arcane` some junto.
 */
const ARMOR_KEY: Readonly<Record<DamageType, 'melee' | 'magic'>> = {
  physical: 'melee',
  arcane: 'magic',
};

/**
 * A resolução do perfil `combat-v1` (ADR 0031). Preserva **bit a bit** o resultado entregue:
 *
 *   1. uma única rolagem de Dodge, SEMPRE consumida, primeiro ato;
 *   2. armadura por tipo, sem RNG;
 *   3. piso (`minimumDamageFraction`);
 *   4. corte do Dodge, se a rolagem ativou;
 *   5. arredondamento só no fim, com piso em zero.
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

  const armorReduction = defender.armor * combat.armorEffectiveness[ARMOR_KEY[intent.damageType]];
  const afterArmor = intent.rawDamage - armorReduction;
  // Piso: nem a armadura mais alta zera um golpe. Dano zero contra um alvo pesado transforma
  // a luta em impasse silencioso, sem nada na tela dizendo o motivo.
  const minimumDamage = intent.rawDamage * combat.minimumDamageFraction;
  const beforeDodge = Math.max(minimumDamage, afterArmor);

  const damage = dodged ? beforeDodge * combat.dodgeMultiplier : beforeDodge;
  // Arredonda no FIM: arredondar antes do dodge faria 50% de 3 virar 2, e o jogador veria
  // uma esquiva que reduziu um terço.
  return {
    profile: combat.compatibilityProfile,
    intent,
    armorReduction,
    minimumDamage,
    dodged,
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
