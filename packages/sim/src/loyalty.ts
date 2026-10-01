// Loyalty: o bônus da idade da conta sobre skill e magic level (M44, #628, ADR 0052 d.5).
//
// Duas metades, e só uma mora aqui. A `api` conta os dias da conta e escolhe o degrau
// (`loyaltyBonusPercentOf`, com o relógio DELA) na emissão do ticket; o percentual viaja no
// ticket e fica FIXO no personagem pela sessão, como a versão de conteúdo (invariante 7) — o
// `sim` nunca lê conta nem relógio (invariante 1). Aqui fica o que é aritmética pura: dado o
// percentual, quantos NÍVEIS a mais a skill vale (`loyaltyLevel`), sem tocar no dado persistido
// (nível e tries continuam os de sempre; o extrato e o snapshot não sabem que o bônus existe).
//
// Os números e a ordem das contas vêm do Canary: `Player::getLoyaltySkill`
// (`player.cpp:1100-1125`) e `Player::getLoyaltyMagicLevel` (`player.cpp:7429-7453`), que
// `getSkillLevel`/`getMagicLevel` usam no lugar do nível base — é por isso que o bônus entra no
// dano, na chance, no requisito de runa e na cura, e não só no que a tela mostra.
//
// **Não é `nível × (1 + p)`.** O bônus é sobre TRIES: `total × p / 100` tries de graça, somados
// ao que a skill já tem rumo ao próximo nível e gastos nível a nível na curva REAL da vocação —
// então um bônus de 10 % num skill 100 vale bem menos que 10 níveis, e num skill 20 quase nada.
//
// **Tries totais** (`Vocation::getTotalSkillTries`/`getTotalMana`) são a soma do custo de todos
// os níveis já fechados mais os tries do nível corrente — `Σ pointsForLevel(j)` de
// `startingLevel` até `level − 1`, o mesmo custo que `Skills.gain` cobra. Vale para skill (piso
// 10, `minSkillLevel` do Canary) e para magic level (piso 0, `getReqMana(0) = 0`) pela MESMA
// conta, porque o piso é o `startingLevel` do conteúdo.

import type { Loyalty, Skill } from '@draconya/content';
import { pointsForLevel } from './skills.js';

/**
 * Pontos de Loyalty de uma conta com `accountAgeDays` dias — `getAccountAgeInDays() *
 * loyaltyPointsPerCreationDay` (`iologindata_load_player.cpp:114`; os dois termos de Premium do
 * Canary valem 0 no `config.lua.dist`). Dias negativos (relógio da conta à frente do da `api`)
 * valem zero.
 */
export function loyaltyPointsOf(config: Loyalty, accountAgeDays: number): number {
  return Math.max(0, Math.floor(accountAgeDays)) * config.pointsPerCreationDay;
}

/**
 * O bônus percentual (inteiro) que estes pontos dão — `initializeLoyaltySystem`
 * (`data/libs/functions/player.lua:792-826`): o `percent` do MAIOR degrau cujo `minPoints` os
 * pontos alcançam, vezes `bonusPercentageMultiplier`, TRUNCADO (`setLoyaltyBonus(uint16_t)`).
 * Abaixo do primeiro degrau, ou com o sistema desligado (`loyaltyEnabled`), é zero.
 */
export function loyaltyBonusPercentOf(config: Loyalty, points: number): number {
  if (!config.enabled) return 0;
  let percent = 0;
  for (const tier of config.tiers) {
    if (points >= tier.minPoints) percent = tier.percent;
  }
  return Math.floor(percent * config.bonusPercentageMultiplier);
}

/**
 * Nível efetivo de uma skill (ou do magic level) COM o bônus de Loyalty, com um cache por
 * personagem dos tries acumulados até cada nível.
 *
 * O cache existe porque `levelOf` roda por golpe, por magia e por defesa — a soma dos custos de
 * todos os níveis é O(nível) em `pow`, e o resultado só muda quando o nível ou o fator mudam
 * (o fator muda ao escolher a vocação). Os tries DO nível corrente mudam a cada uso e por isso
 * ficam fora do cache: `total = acumulado(level) + tries`. É estado derivado — nunca entra no
 * snapshot, e recomeça vazio a cada restauração sem mudar nenhum resultado.
 */
export class LoyaltyLevels {
  readonly #accumulated = new Map<string, number[]>();

  /**
   * `level` e `points` são o nível base e os tries do nível corrente (`Skills`). `factor` é o da
   * vocação (`skillFactorFor`). `bonusPercent` zero devolve o nível base sem conta nenhuma.
   */
  levelOf(
    definition: Skill, level: number, points: number, bonusPercent: number, factor: number,
  ): number {
    if (bonusPercent <= 0) return level;
    const floor = definition.startingLevel;
    // Tries para ALCANÇAR `target` a partir de `target - 1` — o `getReqSkillTries`/`getReqMana`
    // do Canary, que devolve zero no piso (`level <= minSkillLevel`, `magLevel == 0`).
    const cost = (target: number): number =>
      target > floor ? pointsForLevel(definition, target - 1, factor) : 0;

    let current = cost(level);
    let next = cost(level + 1);
    // O "nível máximo" do Canary: quando o custo deixa de crescer (a conversão para `uint64`
    // estourou, ou o fator é 1), o nível corrente é o teto e o bônus não passa dele.
    if (current >= next) return level;

    // Os tries são inteiros no Tibia; o `Skills` do Draconya pode carregar fração (rate ≠ 1).
    const tries = Math.floor(points);
    const total = this.#totalTries(definition, level, factor) + tries;
    let bonus = Math.floor((total * bonusPercent) / 100);
    let have = tries;
    let effective = level;
    while (have + bonus >= next) {
      bonus -= next - have;
      effective += 1;
      have = 0;
      current = next;
      next = cost(effective + 1);
      if (current >= next) break;
    }
    return effective;
  }

  /** `Σ pointsForLevel(j)`, de `startingLevel` a `level − 1` — os tries de tudo que já fechou. */
  #totalTries(definition: Skill, level: number, factor: number): number {
    const key = `${definition.id}:${String(factor)}`;
    let prefix = this.#accumulated.get(key);
    if (prefix === undefined) {
      prefix = [0];
      this.#accumulated.set(key, prefix);
    }
    const steps = Math.max(0, level - definition.startingLevel);
    for (let i = prefix.length; i <= steps; i += 1) {
      const previous = prefix[i - 1] as number;
      prefix.push(previous + pointsForLevel(definition, definition.startingLevel + i - 1, factor));
    }
    return prefix[steps] as number;
  }
}
