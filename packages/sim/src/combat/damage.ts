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
import type { BlockFlags } from './blockhit.js';
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
   *
   * O `combat-v3` (#548) REUSA o `defense.defense` numérico daqui como a magnitude do estágio
   * novo (`blockhit.ts`) — "o jogador defensor usa os números atuais de defesa e armadura até
   * o M30-02" — e ganha o `kind: 'monster'` para a defesa inata do monstro (`Monster.defense`,
   * sem peça nenhuma envolvida).
   */
  readonly defense?: DefenseSource | undefined;
  /**
   * A mitigação percentual do `combat-v3` (#548, `Monster.defenseMitigation`): em [0, 30],
   * aplicada por ÚLTIMO no estágio novo, sobre QUALQUER tipo (exceto a exceção de lifedrain/
   * manadrain do Canary, ainda sem tipo correspondente — M29-07). Ausente é `0`: o jogador
   * (M30-02) e todo monstro que não declara. Ignorado em `combat-v1`/`v2`.
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
 * O pipeline de recebimento do `combat-v3` (#548, M30-01; ADR 0040) — o `Creature::blockHit` do
 * Canary, na ordem:
 *
 *   1. uma única rolagem de Dodge, SEMPRE consumida, primeiro ato (INALTERADO do v1/v2: o Tibia
 *      nega o golpe inteiro ANTES de chamar `blockHit`, a mesma posição que o Draconya já usa —
 *      ver o `Skill dodge (ruse)` de `Game::combatChangeHealth`);
 *   2. imunidade explícita, defesa com `blockCount` e faixa, armadura em faixa e mitigação
 *      percentual — o estágio NOVO, `resolveBlockHit` (`blockhit.ts`), que substitui o bloqueio
 *      binário do CMB-04 inteiro (defesa) e a subtração flat de armadura do CMB-02/03;
 *   3. resistência/vulnerabilidade por tipo (CMB-03, `mitigation.resistances`) — INTOCADO, e
 *      continua um estágio à parte: o Canary a resolve como absorção percentual (o PRIMEIRO
 *      estágio de `blockHit`, fora do escopo do #548, M30-05), e o Draconya já tinha este
 *      mecanismo antes desta issue — não duplicado aqui, só reposicionado depois do estágio
 *      novo por não ter razão para vir antes dele;
 *   4. piso (`minimumDamageFraction`), sobre o PODER BRUTO — mantido como salvaguarda de
 *      PRODUTO do Draconya (nunca existiu no Canary: lá um bloqueio pode legitimamente zerar um
 *      golpe). Pulado quando IMUNE — o piso nunca revoga imunidade explícita;
 *   5. crítico (CMB-08), quando o intent declara o modificador — REPOSICIONADO para depois da
 *      mitigação inteira (era o 3º sorteio, entre defesa e armadura, no v1/v2): crítico e leech
 *      são o M30-04, ainda não implementado para o `combat-v3`, e nenhum conteúdo real declara
 *      `combat.modifiers` hoje — mover o multiplicador para o fim evita fatiar o estágio novo
 *      (que decide "pular armadura" olhando o dano JÁ com defesa aplicada) sem mudar resultado
 *      nenhum observável ainda. Decisão registrada para revisão no M30-04;
 *   6. corte do Dodge, se a rolagem ativou;
 *   7. arredondamento só no fim, com piso em zero;
 *   8. componente secundário (#473), se declarado — mesma regra do v1/v2.
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
  // Idêntico ao v1/v2: primeiro ato, sempre consumido.
  const dodged = rng.chance(effectiveDodge(defender, context));

  const immune = defender.mitigation?.immunities.has(intent.damageType) ?? false;
  const blockHit = resolveBlockHit({
    rawDamage: intent.rawDamage,
    damageType: intent.damageType,
    immune,
    blockable: intent.blockable ?? MELEE_BLOCK_FLAGS,
    defense: defender.defense?.defense ?? 0,
    armor: defender.armor,
    defenseMitigationPercent: defender.defenseMitigation ?? 0,
    // A exceção de lifedrain/manadrain do Canary não tem tipo correspondente ainda (M29-07):
    // nunca isenta, hoje, para nenhum tipo do vocabulário atual.
    mitigationExempt: false,
    blockCharge: defender.blockCharge ?? FULL_BLOCK_CHARGE,
    nowMs,
  }, rng);

  // Resistência/vulnerabilidade por tipo (CMB-03): o mesmo mecanismo do v1/v2, intocado — ver o
  // comentário acima sobre por que ele continua separado do estágio novo.
  const resistance = defender.mitigation?.resistances[intent.damageType] ?? 0;
  const afterResistance = blockHit.damage * (1 - resistance);

  // Piso, sobre o PODER BRUTO — como no v1/v2 — mas nunca revogando imunidade explícita.
  const minimumDamage = intent.rawDamage * combat.minimumDamageFraction;
  const afterFloor = immune ? 0 : Math.max(minimumDamage, afterResistance);

  // Crítico: mesma regra de consumo do v1/v2 (rola só quando declarado, mesmo com chance 0),
  // reposicionado para depois da mitigação inteira — ver o comentário da função.
  const criticalModifier = intent.modifiers?.critical;
  const critical = criticalModifier !== undefined && rng.chance(criticalModifier.chance);
  const afterCrit = critical ? afterFloor * (criticalModifier?.multiplier ?? 1) : afterFloor;

  const damage = dodged ? afterCrit * combat.dodgeMultiplier : afterCrit;

  const secondaryOutcome = intent.secondary === undefined
    ? undefined
    : resolveDamage(
      {
        rawDamage: intent.secondary.rawDamage,
        source: intent.source,
        damageType: intent.secondary.damageType,
        ...(intent.blockable === undefined ? {} : { blockable: intent.blockable }),
      },
      defender, context, combat, rng, nowMs,
    );

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
    resolvedDamage: Math.max(0, Math.round(damage)),
    defenseMitigationRemoved: blockHit.mitigationRemoved,
    blockCharge: blockHit.blockCharge,
    ...(secondaryOutcome === undefined ? {} : { secondaryOutcome }),
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
      // O pipeline de RECEBIMENTO muda (ver `resolveBlockHitProfile`); o que o `combat-v2`
      // mudou no lado ofensivo continua valendo — o `rawDamage` que chega aqui já é a fórmula
      // de arma do Canary, resolvida ANTES pelo chamador, como no v2.
      return resolveBlockHitProfile(intent, defender, context, combat, rng, nowMs);
    default:
      // Inalcançável enquanto o registro do conteúdo e este despacho conhecerem o mesmo
      // conjunto; existe para um perfil novo não virar uma fórmula silenciosamente ausente.
      throw new Error(
        `perfil de combate "${combat.compatibilityProfile}" não tem implementação (ADR 0031)`,
      );
  }
}
