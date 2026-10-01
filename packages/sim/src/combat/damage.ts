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
import { FULL_BLOCK_CHARGE, type BlockChargeState } from './block-charge.js';
import { MELEE_BLOCK_FLAGS, resolveBlockHit } from './blockhit.js';
import { hasCharmStage } from './profile.js';
import type { BlockFlags, BlockType } from './blockhit.js';
import type { Rng } from '../rng.js';
import { resolveReflect } from './reflect.js';
import type { DefenderReflect, ReflectAttacker, ReflectedDamage } from './reflect.js';

/**
 * A absorção do DEFENSOR no `combat-v3` (M30-05, #552), em percentual INTEIRO — a escala do
 * Canary. São dois estágios em lugares diferentes do pipeline, como lá:
 *
 *   - `flat` é o `absorbFlat` do `Creature` (`applyAbsorbDamageModifications`,
 *     `creature.cpp:924-942`), ANTES da imunidade e da defesa;
 *   - `items` é o `absorbPercent` de CADA item vestido (`Player::blockHit`,
 *     `player.cpp:3938-3962`), DEPOIS da defesa, da armadura e da mitigação percentual, um item
 *     por vez e arredondando a cada um: `damage -= round(damage × p / 100)`. Dois itens de 20 %
 *     tiram 36 %, não 40 %.
 *
 * Ausente é o defensor sem absorção nenhuma — o monstro (os `elements` dele são a resistência de
 * `mitigation`, um estágio próprio do `Monster::blockHit`, não esta absorção) e todo jogador sem
 * item que absorva.
 */
export interface DefenderAbsorb {
  readonly items: readonly Readonly<Partial<Record<DamageType, number>>>[];
  readonly flat: Readonly<Partial<Record<DamageType, number>>>;
}

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
   *
   * O `combat-v3` (#548) REUSA o `defense.defense` numérico daqui como a magnitude do estágio
   * novo (`blockhit.ts`) — "o jogador defensor usa os números atuais de defesa e armadura até
   * o M30-02" — e ganha o `kind: 'monster'` para a defesa inata do monstro (`Monster.defense`,
   * sem peça nenhuma envolvida).
   */
  readonly defense?: DefenseSource | undefined;
  /**
   * A mitigação percentual do `combat-v3` (#548, `Monster.defenseMitigation`): em [0, 30] para
   * um MONSTRO que declara — a QUEM não declara (e a todo defensor em `combat-v1`/`v2`, onde o
   * campo é ignorado), ausente vale `0`. Aplicada por ÚLTIMO no estágio novo, sobre QUALQUER
   * tipo, exceto lifedrain e manadrain (#547, M29-07, a exceção do Canary — `mitigationExempt`
   * em `blockhit.ts`). Desde o #549 (M30-02) o JOGADOR sob `combat-v3` NÃO cai mais neste
   * "ausente": ele sempre chega aqui com um percentual REAL, calculado por `playerMitigation`
   * (sem o teto de 30 do schema do monstro — a fórmula do jogador não tem esse limite).
   */
  readonly defenseMitigation?: number | undefined;
  /**
   * As cargas de bloqueio do `combat-v3` (#548, `blockCount` do Canary — `block-charge.ts`).
   * Ausente é `FULL_BLOCK_CHARGE`: o defensor que nunca bloqueou ainda (as duas cargas já
   * disponíveis, o caso comum — ver o comentário de `FULL_BLOCK_CHARGE`). Ignorado em
   * `combat-v1`/`v2`. Só a chamada de `applyDamageOutcome` (CMB-08) ESCREVE o estado novo de
   * volta no personagem ou monstro dono (invariante 9); este resolver é puro e só o CALCULA.
   */
  readonly blockCharge?: BlockChargeState | undefined;
  /**
   * A MANA atual do defensor (#547, M29-07 — achado da revisão do PR #648): só existe para
   * quem TEM mana (`CharacterRuntime`), e só importa para um golpe `manadrain`. O Canary
   * calcula `manaLoss = min(mana atual, -manaChange)` ANTES de rodar `blockHit` — isto é, ANTES
   * da resistência/absorção (`applyAbsorbDamageModifications`, `game.cpp:9175-9176`) — e não
   * depois, como um dreno normal seria tentado a fazer. Sem este campo, `resolveBlockHitProfile`
   * aplicaria a resistência sobre o poder BRUTO e só limitaria à mana no fim
   * (`applyDamageOutcome`), dobrando o dreno sempre que a mana disponível for menor que o poder
   * bruto e o alvo tiver resistência a `manadrain`. Ausente é "não capar aqui" — um monstro
   * (sem mana) não precisa: `applyDamageOutcome` já zera o dreno dele por outro caminho (mana
   * sempre 0). Ignorado para qualquer outro tipo de dano.
   */
  readonly mana?: number | undefined;
  /** A absorção do `combat-v3` (#552) — ver `DefenderAbsorb`. Ignorada em `combat-v1`/`v2`. */
  readonly absorb?: DefenderAbsorb | undefined;
  /**
   * O reflexo do defensor (#552; o de monstro é o #683) — ver `combat/reflect.ts`. Ausente é quem
   * não reflete nada. Ignorado em `combat-v1`/`v2`.
   */
  readonly reflect?: DefenderReflect | undefined;
  /**
   * A cura por elemento do MONSTRO (#683, `monster.heals` do Canary): a tabela completa por
   * tipo, em percentual INTEIRO (`compileElementHealing`, `content`). Ausente é quem não cura com
   * tipo nenhum. Só o `combat-v3` lê.
   */
  readonly elementHealing?: Readonly<Record<DamageType, number>> | undefined;
}

/**
 * De ONDE o dano veio (CMB-02). Vocabulário INTERNO, separado do TIPO (DT-01 do ADR 0031): o
 * mesmo elemento pode vir de uma arma, de uma magia ou de uma ability de monstro.
 *
 * **Não é o `source` visual de `CreatureHit`** (`'melee' | 'spell'`, em `combat-events.ts`):
 * aquele é apresentação e diz que efeito desenhar; este diz qual fórmula resolveu. Reusar o
 * visual para a fórmula é exatamente a confusão que a DT-01 descarta.
 */
export type DamageSource =
  | 'basic-attack' | 'spell' | 'rune' | 'monster-attack' | 'reflect'
  // O dano de um Charm (#603, `IOBestiary::parseCharmCombat`): extensão de outro golpe.
  | 'charm';

/**
 * O TIPO de dano. Desde o CMB-03 é o vocabulário CANÔNICO de `@draconya/content` — o `sim`
 * importa, não redeclara (DT-01). A tabela `combat.armorEffectiveness` é indexada por ele, e
 * a mitigação do defensor também.
 */
export type { DamageType };

/**
 * Um componente ADICIONAL de um golpe composto (primary/secondary, #473). Carrega só o que o
 * resolver precisa para rodar os MESMOS estágios sobre ele — poder e tipo —, herdando a ORIGEM
 * (`source`) do intent: um golpe composto vem de um atacante só.
 *
 * É o que a referência §18 não cobre: o Canary resolve um `CombatDamage` por vez. O campo é uma
 * extensão original do Draconya para o dia em que um golpe tiver dois componentes; a unidade
 * desta task é ESTRUTURAR o suporte, sem nenhum conteúdo declará-lo (o v1 segue bit a bit).
 */
export interface SecondaryDamage {
  readonly rawDamage: number;
  readonly damageType: DamageType;
  /**
   * Ausente herda o `blockable` do intent (comportamento do #473). O elemento de uma arma
   * (#687) passa `MAGIC_BLOCK_FLAGS`: como o `blockHit(…, false, false)` do Canary, o secundário
   * não perde para escudo nem armadura — só para resistência.
   */
  readonly blockable?: BlockFlags | undefined;
}

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
  /**
   * O componente secundário de um golpe composto (#473). Ausente é o default NEUTRO: nenhuma
   * rolagem extra é consumida e o resultado é bit a bit o do v1. Declarado, ele passa pelos
   * MESMOS estágios do primário contra o mesmo defensor — inclusive a própria rolagem de Dodge.
   */
  readonly secondary?: SecondaryDamage | undefined;
  /**
   * Se este golpe bloqueia por defesa/escudo e por armadura no `combat-v3` (#548,
   * `checkDefense`/`checkArmor` do Canary — `blockhit.ts`): depende da ORIGEM do dano, não do
   * tipo. Ausente é `MELEE_BLOCK_FLAGS` (`{ armor: true, shield: true }`) — o físico corpo a
   * corpo e o ataque básico de monstro, os produtores mais comuns; quem chama com origem
   * mágica ou à distância declara o próprio. Ignorado em `combat-v1`/`v2`.
   */
  readonly blockable?: BlockFlags | undefined;
  /**
   * O atacante CRIATURA do golpe (#552): o que o reflexo precisa (vida máxima e distância). Ausente
   * é golpe sem contra quem refletir. Só o `combat-v3` lê.
   */
  readonly attacker?: ReflectAttacker | undefined;
  /**
   * O golpe é EXTENSÃO de outro (#552, o `damage.extension` do Canary): o reflexo e o cleave.
   * Extensão nunca gera reflexo — é o que impede reflexo sobre reflexo. Crítico e leech a
   * extensão também não tem, mas isso é de quem monta o intent: ele não declara `modifiers` de
   * crítico nem de leech.
   */
  readonly extension?: boolean | undefined;
  /**
   * Dano NEUTRO (#552): o reflexo de um JOGADOR (`ReflectedDamage.neutral`). Pula absorção,
   * aumento, imunidade e resistência — o `COMBAT_NEUTRALDAMAGE` do Canary não tem entrada em
   * nenhuma dessas tabelas. Só o `combat-v3` lê.
   */
  readonly neutral?: boolean | undefined;
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
  /**
   * O componente secundário resolvido (#473), quando o intent declara `secondary`. Cada
   * componente tem o próprio `resolvedDamage` e os próprios estágios (armadura/mitigação por
   * tipo); quem aplica continua somando os dois `resolvedDamage`. Ausente no v1.
   */
  readonly secondaryOutcome?: DamageOutcome;
  /**
   * Quanto a mitigação percentual do `combat-v3` tirou (#548, `defenseMitigation`). Ausente em
   * `combat-v1`/`v2` (a função nem o calcula); em `combat-v3` sem o campo declarado, ou com o
   * golpe imune/não elegível, o valor é `0` — a identidade.
   */
  readonly defenseMitigationRemoved?: number;
  /**
   * As cargas de bloqueio DEPOIS deste golpe (#548, `blockCharge`/`blockCount`) — o que
   * `applyDamageOutcome` grava de volta no dono do estado (invariante 9). Presente sempre que o
   * `combat-v3` resolve (mesmo imune, ou com origem que não bloqueia nada: o valor sai IGUAL ao
   * de entrada, e a escrita de volta é um no-op). Ausente em `combat-v1`/`v2`.
   */
  readonly blockCharge?: BlockChargeState;
  /**
   * O tipo de bloqueio do golpe (#686), o que o ATACANTE vê — ver `BlockType`. Só no
   * `combat-v3`; ausente em `combat-v1`/`v2`, que não mudam a prática por causa dele. O Dodge e
   * o piso do Draconya ficam FORA: o tipo é o do `blockHit`, antes deles.
   */
  readonly blockType?: BlockType;
  /** Se havia carga de bloqueio para consumir (#686, o `hasDefense` do Canary). Só no `combat-v3`. */
  readonly hadBlockCharge?: boolean;
  /**
   * O dano que volta ao ATACANTE (#552): o reflexo do defensor sobre este golpe, já com o teto de
   * 1 % da vida máxima do atacante. Quem aplica o outcome é quem faz a segunda resolução contra o
   * atacante (`reflectedDamageIntent`). Ausente sem reflexo — sempre em `combat-v1`/`v2`, e
   * sempre num golpe que já é extensão.
   */
  readonly reflected?: ReflectedDamage;
  /**
   * Quanto o golpe CURA o defensor (#683, `monster.heals`): `ceil(dano já crítico × p / 100)`,
   * calculado ANTES do bloqueio e mesmo com imunidade. OPCIONAL de propósito: ausente é zero, e o
   * outcome de `combat-v1`/`v2` — e todo golpe em quem não cura — mantém a forma de sempre. Só
   * este componente: o do secundário vem em `secondaryOutcome.elementHealing`. Quem aplica a
   * cura é o ruleset, depois do dano e do reflexo.
   */
  readonly elementHealing?: number;
}

/** Chance de esquiva que de fato vale, dado onde a luta acontece. */
export function effectiveDodge(defender: Defender, context: CombatContext): number {
  const bonus = context === 'pve' ? defender.pveDodgeBonus ?? 0 : 0;
  return Math.min(1, Math.max(0, defender.dodgeChance + bonus));
}

/**
 * A resolução da MITIGAÇÃO (ADR 0031, emenda do CMB-03) — compartilhada por `combat-v1` e
 * `combat-v2` (#522, ADR 0037 d.5): o que muda no v2 é o PODER BRUTO que chega em `rawDamage`
 * (a fórmula de arma do Canary, `combat/weapon-power.ts`) e a chance de acerto à distância — as
 * duas resolvidas ANTES desta função, pelo chamador (`HuntRuleset#strike`). O que este resolver
 * faz com o `rawDamage` — Dodge, defesa/escudo, crítico, armadura, piso, resistência,
 * imunidade — é uma decisão do Draconya (ADR 0031), não do Canary, e nenhuma das duas issues
 * (#522 aqui, defesa/armadura já fechada no M24) muda esse pipeline. Preserva **bit a bit** o
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
 *  10. arredondamento só no fim, com piso em zero;
 *  11. componente secundário (#473), se o intent o declara — resolvido pelos mesmos estágios,
 *      depois do primário inteiro, com a própria rolagem de Dodge.
 *
 * A ordem difere da do Tibia (defesa antes de tudo) porque a POSIÇÃO DO SORTEIO é do Draconya:
 * a rolagem é o primeiro ato para que nenhum estágio novo a desloque. Um estágio que mude a
 * sequência do conteúdo JÁ entregue exige perfil novo; o bloqueio do CMB-04 só rola quando o
 * conteúdo declara defesa, então o v1 sem defesa continua consumindo exatamente um sorteio.
 */
function resolveMitigation(
  intent: DamageIntent,
  defender: Defender,
  context: CombatContext,
  combat: Combat,
  rng: Rng,
  nowMs: number,
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

  // O componente secundário (#473) é resolvido por ÚLTIMO, depois de todas as rolagens do
  // primário: a sequência do gerador é primário inteiro, e só então o secundário. O intent
  // sintetizado NÃO herda `modifiers` nem `secondary` — o crítico e o leech do golpe são do
  // primário, e o secundário não pode recursar. Ausente, nada é consumido e o v1 não muda.
  const secondaryOutcome = intent.secondary === undefined
    ? undefined
    : resolveDamage(
      {
        rawDamage: intent.secondary.rawDamage,
        source: intent.source,
        damageType: intent.secondary.damageType,
      },
      defender, context, combat, rng, nowMs,
    );

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
    ...(secondaryOutcome === undefined ? {} : { secondaryOutcome }),
  };
}

/**
 * O pipeline de recebimento do `combat-v3` (#548, M30-01; #551, M30-04; ADR 0040) — o
 * `Creature::blockHit` do Canary, na ordem:
 *
 *   1. uma única rolagem de Dodge, SEMPRE consumida, primeiro ato (INALTERADO do v1/v2: o Tibia
 *      nega o golpe inteiro ANTES de chamar `blockHit`, a mesma posição que o Draconya já usa —
 *      ver o `Skill dodge (ruse)` de `Game::combatChangeHealth`);
 *   2. crítico (CMB-08, M30-04), quando o intent declara o modificador — na GERAÇÃO do dano,
 *      ANTES do `blockHit`: é onde o Canary de fato rola (`Combat::applyExtensions`, chamado de
 *      `getCombatDamage`/`doCombat`, roda ANTES de `Creature::blockHit` multiplicar
 *      `damage.primary.value`). O multiplicador incide sobre o PODER BRUTO, e o que segue
 *      (imunidade, defesa, armadura, mitigação) age sobre o dano JÁ com o bônus — um crítico não
 *      é "desperdiçado" por imunidade, porque o Canary também não sabe de imunidade neste ponto:
 *      `applyExtensions` só olha o ATACANTE, nunca o alvo. Esta é a correção do M30-04: a
 *      posição anterior (depois da mitigação inteira) era um placeholder documentado como tal —
 *      nenhum teste a travava, e nenhum conteúdo real declarava `combat.modifiers` ainda;
 *   3. imunidade explícita, defesa com `blockCount` e faixa, armadura em faixa e mitigação
 *      percentual — o estágio `resolveBlockHit` (`blockhit.ts`), que substitui o bloqueio
 *      binário do CMB-04 inteiro (defesa) e a subtração flat de armadura do CMB-02/03, agora
 *      sobre o dano JÁ crítico;
 *   2a. (#683) a cura por elemento do monstro (`elementHealing`), sobre o dano JÁ crítico e
 *      antes de tudo que segue — imunidade inclusive; o ruleset a aplica depois do golpe;
 *   2b. (#552, M30-05) o corte de manadrain à mana atual e o estágio de absorção do `Creature`
 *      (`applyAbsorbDamageModifications`): absorção FLAT do defensor e AUMENTO do atacante por
 *      tipo — ANTES da imunidade e da defesa, como o primeiro ato do `blockHit` do Canary;
 *   3b. (#552) a absorção percentual ITEM A ITEM do jogador (`Player::blockHit`), depois do
 *      estágio de bloqueio inteiro, arredondando a cada item;
 *   4. resistência/vulnerabilidade por tipo (CMB-03, `mitigation.resistances`) — os `elements`
 *      do MONSTRO, que o Canary aplica em `Monster::blockHit` depois do `Creature::blockHit`
 *      (conferido no #552: NÃO passam por `getAbsorbPercent`). O jogador do `combat-v3` chega
 *      aqui sem resistência: a do item é a absorção do passo 3b. O monstro vai até `-2` (#683,
 *      `monsterMitigationSchema`): `dano × (1 − (−2))` triplica;
 *   5. piso (`minimumDamageFraction`), sobre o PODER BRUTO ORIGINAL (sem o crítico) — mantido
 *      como salvaguarda de PRODUTO do Draconya (nunca existiu no Canary: lá um bloqueio pode
 *      legitimamente zerar um golpe, e o crítico não existe no Canary como conceito de "piso").
 *      Pulado quando IMUNE — o piso nunca revoga imunidade explícita;
 *   6. corte do Dodge, se a rolagem ativou;
 *   7. arredondamento só no fim, com piso em zero;
 *   8. componente secundário (#473), se declarado — mesma regra do v1/v2, e o secundário
 *      continua SEM crítico nem leech próprios (`intent` sintetizado herda só o `increase`);
 *   9. reflexo (#552, `combat/reflect.ts`), sobre o `resolvedDamage` do primário, quando o
 *      defensor reflete, o intent traz o atacante e não é extensão. A segunda resolução contra
 *      o atacante é de quem aplica o outcome.
 *
 * O LEECH (M30-04) não mora aqui: ele opera sobre o HP EFETIVAMENTE removido, não sobre o
 * `DamageOutcome`, e por isso é aplicado depois — em `applyDamageOutcome`/`applyLeech`
 * (`combat/outcome.ts`/`combat/modifiers.ts`) —, dividido por `targetsAffected` pela fórmula do
 * Canary (`Game::calculateLeechAmount`).
 *
 * As cargas de bloqueio (`blockCharge`) do resultado são as NOVAS — quem aplica o outcome
 * (`applyDamageOutcome`, CMB-08) as grava de volta no personagem ou monstro dono (invariante 9);
 * este resolver é puro e só as CALCULA a partir do que `defender.blockCharge` trouxe.
 */
function resolveBlockHitProfile(
  intent: DamageIntent,
  defender: Defender,
  context: CombatContext,
  combat: Combat,
  rng: Rng,
  nowMs: number,
): DamageOutcome {
  // Idêntico ao v1/v2: primeiro ato, sempre consumido — ATÉ o `combat-v4` (#603, ADR 0053 d.5):
  // o Dodge do PRD (`dodgeChance` do defensor, corte pela metade) SAI do perfil, o único Dodge é o
  // charm (que nega o golpe inteiro, e vive no ruleset, antes do mana shield). Sem o estágio,
  // nem o sorteio é consumido: a sequência do `combat-v4` é a de um resolver sem Dodge.
  const dodged = hasCharmStage(combat.compatibilityProfile)
    ? false
    : rng.chance(effectiveDodge(defender, context));

  // Crítico (M30-04): o SEGUNDO sorteio, na GERAÇÃO do dano — ANTES do `blockHit`, a mesma
  // posição do Canary (ver o comentário da função). Declarado com `chance: 0`, ainda consome —
  // a mesma regra aditiva do bloqueio (ADR 0031); ausente, nenhum sorteio novo e o resultado é
  // bit a bit o de sempre.
  const criticalModifier = intent.modifiers?.critical;
  const critical = criticalModifier !== undefined && rng.chance(criticalModifier.chance);
  const criticalRawDamage = critical
    ? intent.rawDamage * (criticalModifier?.multiplier ?? 1)
    : intent.rawDamage;

  // O dano NEUTRO (#552, reflexo de jogador) não tem entrada em tabela nenhuma do defensor:
  // imunidade, absorção, aumento e resistência não o tocam.
  const neutral = intent.neutral === true;
  const immune = !neutral && (defender.mitigation?.immunities.has(intent.damageType) ?? false);

  // A cura por elemento (#683, `Game::combatBlockHit`): sobre o valor JÁ crítico e ANTES do
  // `blockHit` — nem absorção, nem defesa, nem imunidade a tocam, então o monstro imune ao tipo
  // cura igual. Sem sorteio. Conta inteira, como o reflexo: `ceil(d × p / 100)`. O dano neutro
  // (reflexo de jogador) não tem entrada no `healingMap` do Canary e não cura.
  const healingPercent = neutral ? 0 : defender.elementHealing?.[intent.damageType] ?? 0;
  const elementHealing = healingPercent > 0 ? Math.ceil((criticalRawDamage * healingPercent) / 100) : 0;

  // Manadrain capa para a mana ATUAL do alvo ANTES de qualquer estágio (#547, M29-07 — achado da
  // revisão do PR #648): o Canary computa `manaLoss = min(mana atual, -manaChange)` e só DEPOIS
  // roda `blockHit` — que abre com `applyAbsorbDamageModifications` e termina com a resistência —
  // sobre o valor já capado (`game.cpp:9175-9176`). Resistir primeiro e capar depois (a ordem que
  // `applyDamageOutcome` sozinho produziria) dobra o dreno sempre que a mana disponível for menor
  // que o poder bruto e o alvo tiver resistência — ver o exemplo no comentário de
  // `Defender.mana`. Sem `defender.mana` (monstro, que não tem), nada muda aqui: o dreno dele já
  // é zerado depois, em `applyDamageOutcome` (mana sempre 0). Até o #552 o corte vinha depois do
  // `resolveBlockHit`, que para manadrain só zera por imunidade — capar antes dá o mesmo número, e
  // agora vem antes também da absorção, como no Canary.
  const manaCapped = intent.damageType === 'manadrain' && defender.mana !== undefined
    ? Math.min(defender.mana, criticalRawDamage)
    : criticalRawDamage;

  // O estágio de absorção do `Creature` (#552, `applyAbsorbDamageModifications`,
  // `creature.cpp:924-942`), o PRIMEIRO de `blockHit`: a absorção flat do defensor (sem descer de
  // zero) e o aumento do ATACANTE por tipo (`increasePercent`), arredondado. Sem sorteio. A
  // absorção PERCENTUAL do item não é esta: ela vem depois da armadura (abaixo).
  const afterAbsorbStage = neutral ? manaCapped : absorbStage(intent, defender, manaCapped);

  // Manadrain NUNCA bloqueia por defesa/escudo nem por armadura (#547, M29-07 — achado da
  // revisão do PR #648): o Canary chama `target->blockHit(attacker, COMBAT_MANADRAIN,
  // manaLoss)` com só 3 argumentos (`game.cpp:9176`), e `checkDefense`/`checkArmor` default a
  // `false` (`Creature::blockHit`, `creature.cpp:944`) — os dois estágios ficam de fora para
  // TODO mana-drain, corpo a corpo ou à distância, independente da origem do golpe. A ORIGEM
  // (`intent.blockable`) continua decidindo para qualquer outro tipo; só manadrain a ignora.
  const blockable = intent.damageType === 'manadrain'
    ? { armor: false, shield: false }
    : intent.blockable ?? MELEE_BLOCK_FLAGS;
  const blockHit = resolveBlockHit({
    // O dano JÁ crítico entra no estágio de bloqueio — defesa, armadura e o "pular armadura
    // quando a defesa absorveu tudo" decidem sobre o número que o alvo de fato recebe, não
    // sobre o poder bruto sem o bônus.
    rawDamage: afterAbsorbStage,
    damageType: intent.damageType,
    immune,
    blockable,
    defense: defender.defense?.defense ?? 0,
    armor: defender.armor,
    defenseMitigationPercent: defender.defenseMitigation ?? 0,
    // A exceção do `mitigateDamage` do Canary (#547, M29-07, `creature.cpp:911-921`): a
    // mitigação percentual NUNCA se aplica a lifedrain nem manadrain. `drown` não é isento —
    // só os dois tipos de dreno ficam de fora, os únicos que o Canary pula ali (`agony` não
    // existe no Draconya).
    mitigationExempt: intent.damageType === 'lifedrain' || intent.damageType === 'manadrain',
    blockCharge: defender.blockCharge ?? FULL_BLOCK_CHARGE,
    nowMs,
  }, rng);

  // A absorção percentual de CADA item vestido (#552, `Player::blockHit`, `player.cpp:3938-3962`):
  // depois da defesa, da armadura e da mitigação, só sobre dano que passou, um item por vez e
  // arredondando a cada um. Neutro não é absorvido.
  const afterItemAbsorb = neutral ? blockHit.damage : itemAbsorb(defender.absorb, intent.damageType, blockHit.damage);

  // Resistência/vulnerabilidade por tipo (CMB-03): o mesmo mecanismo do v1/v2 — os `elements` do
  // MONSTRO, que o Canary aplica em `Monster::blockHit` DEPOIS do `Creature::blockHit` inteiro
  // (`monster.cpp:1402-1426`) e NÃO por `getAbsorbPercent` (conferido no #552): é por isso que
  // ele continua um estágio à parte, depois do estágio novo. O jogador do `combat-v3` chega aqui
  // sem resistência (a do item virou a absorção acima, `HuntRuleset#playerDefender`).
  const resistance = neutral ? 0 : defender.mitigation?.resistances[intent.damageType] ?? 0;
  const afterResistance = afterItemAbsorb * (1 - resistance);

  // Piso, sobre o PODER BRUTO ORIGINAL (sem o crítico) — como no v1/v2 — mas nunca revogando
  // imunidade explícita. O crítico é bônus do atacante; o piso é a garantia de que nem a maior
  // mitigação zera o golpe BASE, e as duas coisas não precisam se multiplicar juntas.
  const minimumDamage = intent.rawDamage * combat.minimumDamageFraction;
  const afterFloor = immune ? 0 : Math.max(minimumDamage, afterResistance);

  const damage = dodged ? afterFloor * combat.dodgeMultiplier : afterFloor;

  // O secundário roda contra o defensor JÁ COM a carga que o primário gastou (#548, achado da
  // revisão do PR #642): sem isto, o secundário sortearia o estágio novo como se o primário
  // nunca tivesse consumido nada, e uma carga extra seria descontada em memória sem nunca voltar
  // ao dono — `applyDamageOutcome` só lê o `blockCharge` de NÍVEL SUPERIOR do outcome (ver
  // abaixo), então o consumo do secundário tem que terminar ali.
  const secondaryBlockable = intent.secondary?.blockable ?? intent.blockable;
  const secondaryOutcome = intent.secondary === undefined
    ? undefined
    : resolveDamage(
      {
        rawDamage: intent.secondary.rawDamage,
        source: intent.source,
        damageType: intent.secondary.damageType,
        ...(secondaryBlockable === undefined ? {} : { blockable: secondaryBlockable }),
        // O aumento do atacante vale para o secundário também (#552, o `blockHit` do secundário
        // chama o mesmo `applyAbsorbDamageModifications`); crítico e leech continuam do primário.
        ...(intent.modifiers?.increase === undefined
          ? {} : { modifiers: { increase: intent.modifiers.increase } }),
        // Sem `attacker`: o secundário não reflete por conta própria. O Canary só olha o reflexo
        // do secundário quando o ALVO é monstro (`game.cpp:8016-8039`), e o #683 o deixou de
        // fora: nenhum conteúdo tem secundário contra monstro que reflete, e a conta de lá usa o
        // valor do PRIMÁRIO com o tipo do secundário — não há o que copiar sem copiar o defeito.
        // A CURA do secundário, ao contrário, sai daqui sozinha (`elementHealing` do outcome
        // dele), e o ruleset soma as duas, como o `damageHeal` do Canary.
      },
      { ...defender, blockCharge: blockHit.blockCharge }, context, combat, rng, nowMs,
    );

  const resolvedDamage = Math.max(0, Math.round(damage));
  // O reflexo (#552): sobre o dano JÁ bloqueado, nunca num golpe que já é extensão (reflexo e
  // cleave), e só com um atacante criatura contra quem voltar. A segunda resolução é de quem
  // aplica o outcome — este resolver continua puro.
  const reflected = intent.extension === true || intent.attacker === undefined
    || defender.reflect === undefined
    ? undefined
    : resolveReflect(resolvedDamage, intent.damageType, defender.reflect, intent.attacker);

  return {
    profile: combat.compatibilityProfile,
    intent,
    damageType: intent.damageType,
    afterDefense: blockHit.afterDefense,
    afterArmor: blockHit.afterArmor,
    armorReduction: blockHit.armorReduction,
    minimumDamage,
    afterResistance,
    immune,
    dodged,
    critical,
    resolvedDamage,
    defenseMitigationRemoved: blockHit.mitigationRemoved,
    // O estado que `applyDamageOutcome` grava de volta (invariante 9) tem que refletir o QUE O
    // SECUNDÁRIO ainda gastou por cima do primário — sem isto, o consumo dele nunca persistiria.
    blockCharge: secondaryOutcome?.blockCharge ?? blockHit.blockCharge,
    blockType: blockHit.blockType,
    hadBlockCharge: blockHit.hadBlockCharge,
    ...(secondaryOutcome === undefined ? {} : { secondaryOutcome }),
    ...(reflected === undefined ? {} : { reflected }),
    ...(elementHealing > 0 ? { elementHealing } : {}),
  };
}

/**
 * `applyAbsorbDamageModifications` do Canary (#552, `creature.cpp:924-942`), na ordem dele: a
 * absorção flat do defensor (`max(0, d − flat)`) e depois o aumento do atacante
 * (`d += round(d × p / 100)`). A absorção percentual do `Creature` do Canary vem de wheel e
 * condição — nada disso existe no Draconya —, então a percentual do ITEM é outro estágio
 * (`itemAbsorb`).
 *
 * O sinal do flat: o Canary soma (`damage + value`) um campo que nenhum código escreve
 * (`setAbsorbFlat` não tem chamador no `47dfd51`), então não há comportamento observável a copiar;
 * aqui "absorver" subtrai, como o nome diz.
 */
function absorbStage(intent: DamageIntent, defender: Defender, damage: number): number {
  if (damage === 0) return 0;
  let value = damage;
  const flat = defender.absorb?.flat[intent.damageType] ?? 0;
  if (flat !== 0) value = Math.max(0, value - flat);
  const increase = intent.modifiers?.increase?.[intent.damageType] ?? 0;
  if (increase !== 0) value += Math.round((value * increase) / 100);
  return value;
}

/** A absorção percentual item a item (#552, `Player::blockHit`): ver `DefenderAbsorb`. */
function itemAbsorb(absorb: DefenderAbsorb | undefined, damageType: DamageType, damage: number): number {
  if (absorb === undefined || damage <= 0) return damage;
  let value = damage;
  for (const item of absorb.items) {
    const percent = item[damageType] ?? 0;
    if (percent !== 0) value -= Math.round((value * percent) / 100);
  }
  return Math.max(0, value);
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
  /**
   * O instante lógico da sessão (`session.nowMs`) — o `combat-v3` (#548) o usa para calcular as
   * cargas de bloqueio SOB DEMANDA (`blockCharge`, invariante 2), sem escrever nada por tick.
   * Ignorado em `combat-v1`/`v2`. Todo chamador em PRODUÇÃO passa `session.nowMs`; o default
   * `0` só existe para não obrigar a dezena de fixtures de `combat-v1`/`v2` (que nunca leem
   * este parâmetro) a inventar um instante que não têm.
   */
  nowMs = 0,
): DamageOutcome {
  if (!COMBAT_PROFILES.has(combat.compatibilityProfile)) {
    throw new Error(
      `perfil de combate "${combat.compatibilityProfile}" desconhecido: o resolver não escolhe ` +
        'fallback (ADR 0031)',
    );
  }
  switch (combat.compatibilityProfile) {
    case 'combat-v1':
    case 'combat-v2':
      // O pipeline de mitigação é o MESMO nos dois perfis (ver o comentário de
      // `resolveMitigation`) — o que o `combat-v2` muda é o `rawDamage` que chega aqui (fórmula
      // de arma do Canary) e a chance de acerto à distância, resolvidos ANTES pelo chamador.
      return resolveMitigation(intent, defender, context, combat, rng, nowMs);
    case 'combat-v3':
    case 'combat-v4':
      // O pipeline de RECEBIMENTO muda (ver `resolveBlockHitProfile`); o que o `combat-v2`
      // mudou no lado ofensivo continua valendo — o `rawDamage` que chega aqui já é a fórmula
      // de arma do Canary, resolvida ANTES pelo chamador, como no v2. O `combat-v4` (#598/#603)
      // soma em cima e é o MESMO resolver, sem o Dodge do PRD.
      return resolveBlockHitProfile(intent, defender, context, combat, rng, nowMs);
    default:
      // Inalcançável enquanto o registro do conteúdo e este despacho conhecerem o mesmo
      // conjunto; existe para um perfil novo não virar uma fórmula silenciosamente ausente.
      throw new Error(
        `perfil de combate "${combat.compatibilityProfile}" não tem implementação (ADR 0031)`,
      );
  }
}
