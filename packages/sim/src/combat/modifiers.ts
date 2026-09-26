// Crítico e leech de item e de monstro (M30-04, #551, ADR 0037 d.6): a fonte dos modificadores
// avançados que `combat/damage.ts` (CMB-08) já sabia consumir, e a fórmula do leech dividido por
// `targetsAffected` — a ORDEM e a MATEMÁTICA do Canary, não uma simplificação nossa.
//
// `Inventory.combatModifiers` (item, somado pelo equipamento) e `monsterCriticalModifiers`
// (monstro, campo único) produzem o MESMO `DamageModifiers` que `resolveDamage` já lê desde o
// CMB-08 — nenhum contrato novo em `damage.ts`, só de onde os números vêm. `combineCombatModifiers`
// junta essas fontes com o `combat.modifiers` estático do conteúdo (o andaime original do CMB-08,
// que nenhum conteúdo real declara hoje, mas que os testes de integração continuam exercendo) —
// pontos-base somam, como o Canary soma `SKILL_CRITICAL_HIT_CHANCE` de vários itens antes de UMA
// rolagem só (`combat.cpp:2657`).
//
// `calculateLeechAmount`/`applyLeech` são a MESMA função em `game.cpp:9058`
// (`Game::calculateLeechAmount`): NÃO é uma divisão simples por `targetsAffected` — ver o
// comentário de `calculateLeechAmount`.

import type { DamageModifiers, Monster } from '@draconya/content';
import type { CharacterRuntime } from '../character.js';

/**
 * `Monster::getCriticalChance() * 100` (`combat.cpp:2766`): o `critChance` do conteúdo é
 * PERCENTUAL (0-100, a escala do Lua do Canary), e vira pontos-base aqui — a escala que a
 * rolagem usa (CMB-08). `undefined` sem crítico: `critChance` ausente ou `0` é a identidade de
 * todo monstro do bestiário atual (nenhum dos quatro declara), e não consome sorteio nenhum —
 * `canApplyCritical = baseChance != 0 && ...` do Canary curto-circuita da mesma forma.
 *
 * O multiplicador é sempre `1` — nenhum monstro do Canary declara bônus de DANO crítico em
 * conteúdo (`Monster::getCriticalDamage` é campo só de runtime, sempre `0` sem script que o
 * altere, `monster.cpp:307`) —, então um crítico de monstro ativa a FLAG (`DamageOutcome.critical`)
 * sem multiplicar dano nenhum: fiel ao que o Canary de fato faz hoje, não um vazio nosso.
 */
export function monsterCriticalModifiers(
  monster: Pick<Monster, 'critChance'> | undefined,
): DamageModifiers | undefined {
  const critChance = monster?.critChance ?? 0;
  if (critChance <= 0) return undefined;
  return { critical: { chance: (critChance * 100) / 10_000, multiplier: 1 } };
}

/**
 * Junta várias fontes de `DamageModifiers` (o `combat.modifiers` estático do conteúdo — o
 * andaime original do CMB-08 — e `Inventory.combatModifiers`, o equipamento do M30-04) numa só,
 * na mesma UNIDADE que o Canary soma antes de rolar: pontos-base. `critical` de QUALQUER fonte
 * (mesmo com `chance: 0`) marca a rolagem como declarada — a mesma regra aditiva de sempre
 * (ADR 0031): a sequência não pode depender do VALOR, só de a fonte existir. `lifeLeech`/
 * `manaLeech` somam direto, já como fração.
 *
 * `undefined` quando NENHUMA fonte declara nada — o que preserva bit a bit todo conteúdo (e todo
 * equipamento) que não usa o mecanismo, a identidade de rato/rotworm/dragon/dragon-lord hoje.
 */
export function combineCombatModifiers(
  ...sources: readonly (DamageModifiers | undefined)[]
): DamageModifiers | undefined {
  let criticalChanceBasisPoints = 0;
  let criticalDamageBasisPoints = 0;
  let lifeLeech = 0;
  let manaLeech = 0;
  let anyCritical = false;
  for (const source of sources) {
    if (source === undefined) continue;
    if (source.critical !== undefined) {
      anyCritical = true;
      criticalChanceBasisPoints += source.critical.chance * 10_000;
      criticalDamageBasisPoints += (source.critical.multiplier - 1) * 10_000;
    }
    lifeLeech += source.lifeLeech ?? 0;
    manaLeech += source.manaLeech ?? 0;
  }
  if (!anyCritical && lifeLeech === 0 && manaLeech === 0) return undefined;
  return {
    ...(anyCritical ? {
      critical: {
        chance: criticalChanceBasisPoints / 10_000,
        multiplier: 1 + criticalDamageBasisPoints / 10_000,
      },
    } : {}),
    ...(lifeLeech === 0 ? {} : { lifeLeech }),
    ...(manaLeech === 0 ? {} : { manaLeech }),
  };
}

/**
 * `Game::calculateLeechAmount` (`game.cpp:9058`): **NÃO** é uma divisão simples por
 * `targetsAffected` — é
 *
 * ```text
 * realDamage × leechFraction × (0,1 × n + 0,9) / n
 * ```
 *
 * arredondado (`std::lround`, meio para cima) e limitado a `[0, realDamage]`. Para `n = 1` o
 * fator vale exatamente `1` — a identidade do golpe de alvo único, bit a bit o de sempre. Para
 * `n = 5` vale `(0,5 + 0,9) / 5 = 0,28`, não `0,2`: uma magia em área rende, POR ALVO, mais que
 * um quinto do que renderia sozinha — é assim que o Canary de fato calcula, não uma
 * simplificação nossa (a frase "dividido pelos alvos" da issue é a descrição solta; o número
 * vem daqui).
 *
 * `targetsAffected` é o `damage.affected` do Canary (`combat.cpp:1473`/`1582`): o total de
 * criaturas que a MESMA ação atingiu, não só as elegíveis a leech — um golpe de alvo único
 * (padrão, corpo a corpo/distância/wand) é sempre `1`.
 */
export function calculateLeechAmount(
  realDamage: number, leechFraction: number, targetsAffected: number,
): number {
  if (realDamage <= 0 || leechFraction <= 0) return 0;
  const n = Math.max(1, targetsAffected);
  const raw = realDamage * leechFraction * (0.1 * n + 0.9) / n;
  return Math.min(realDamage, Math.max(0, Math.round(raw)));
}

/** O que `applyLeech` de fato repôs no atacante. */
export interface LeechResult {
  /** Vida que o atacante de fato repôs, já clampada no teto dele. */
  readonly lifeLeechApplied: number;
  /** Mana que o atacante de fato repôs, já clampada no teto dele. */
  readonly manaLeechApplied: number;
}

/**
 * Aplica life leech e mana leech no ATACANTE, pela fórmula de `calculateLeechAmount` — a peça
 * compartilhada entre o golpe de alvo único (`applyDamageOutcome`, `combat/outcome.ts`,
 * `targetsAffected` `1` por padrão) e a magia em área (`HuntRuleset#applyHits`, um
 * `targetsAffected` só para todos os alvos da MESMA mira, como o Canary faz em
 * `Combat::doAreaCombatHealth`/`damage.affected`).
 *
 * `healthDamage` é sempre o HP EFETIVAMENTE removido do alvo (`realDamage` do Canary) — nunca o
 * resolvido: overkill e absorção total (mana shield) não rendem leech. O que de fato repõe é
 * sempre clampado no teto do atacante (`heal`/`maxMana`), nunca o que a fórmula prometia.
 */
export function applyLeech(
  attacker: CharacterRuntime, healthDamage: number, modifiers: DamageModifiers | undefined,
  targetsAffected: number,
): LeechResult {
  if (healthDamage <= 0) return { lifeLeechApplied: 0, manaLeechApplied: 0 };
  let lifeLeechApplied = 0;
  const lifeLeech = modifiers?.lifeLeech ?? 0;
  if (lifeLeech > 0) {
    lifeLeechApplied = attacker.heal(calculateLeechAmount(healthDamage, lifeLeech, targetsAffected));
  }
  let manaLeechApplied = 0;
  const manaLeech = modifiers?.manaLeech ?? 0;
  if (manaLeech > 0) {
    const room = attacker.maxMana - attacker.mana;
    manaLeechApplied = Math.min(
      calculateLeechAmount(healthDamage, manaLeech, targetsAffected), Math.max(0, room),
    );
    attacker.mana += manaLeechApplied;
  }
  return { lifeLeechApplied, manaLeechApplied };
}
