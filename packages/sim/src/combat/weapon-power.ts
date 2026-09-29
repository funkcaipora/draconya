// O poder de uma arma, resolvido por PERFIL (CMB-05, #333; `combat-v2` em #522, ADR 0037 d.5).
//
// A fórmula é do CONTEÚDO: a família declara `levelFactor` e `spread` (v1), a skill apontada dá
// a contribuição por nível (v1) ou o nível ABSOLUTO (v2), e a arma (ou a munição) dá o `base`.
// Aqui só há aritmética — sem I/O, sem catálogo, sem `if` por nome de item ou vocação. O RNG é o
// da sessão.
//
// Duas formas, e a distinção é contrato:
//
//   - `power` (corpo a corpo e distância): escala por level e skill. No `combat-v1`, `spread: 0`
//     devolve o valor SEM consumir sorteio — é o que preserva o v1 bit a bit (DT-03). No
//     `combat-v2` a variância é sempre a normal truncada do Canary, e SEMPRE consome sorteio —
//     a sequência não pode depender do VALOR do intervalo (a mesma regra do `blockChance`).
//   - `fixedDamage` (wand/rod): faixa fixa. No `combat-v1`, uma rolagem UNIFORME por golpe
//     (`rng.integer`), como sempre. No `combat-v2`, a MESMA normal truncada do corpo a corpo e
//     da distância — `WeaponWand::getWeaponDamage` do Canary também usa `normal_random`, não uma
//     faixa uniforme; só a fórmula de MÁXIMO/MÍNIMO de wand/rod não muda (ela já era uma faixa
//     fixa do item, sem coeficiente nem `attackFactor`).
//
// A POSTURA (M30-03, #550): o `attackFactor` do `Weapons::getMaxWeaponDamage` é o
// `Player::getAttackFactor` do modo de luta escolhido — 1.0 / 0.75 / 0.5 (`combat/fight-mode.ts`).
// Só o `combat-v3` (e o v4 que o herda) o lê: `combat-v1`/`v2` continuam no 1.0 fixo que a
// constante de conteúdo `weaponDamage.attackFactor` dava (a ofensiva), bit a bit (ADR 0031).
//
// Wand/rod NÃO passam por multiplicador de weapon skill: o perfil deles não tem `power`, e é
// por construção, não por um `if` — o contrato de wand/rod é distinto do de spellPower (DT-02).

import type { Combat, WeaponProfile } from '@draconya/content';
import type { Rng } from '../rng.js';
import { DEFAULT_FIGHT_MODE, attackFactorFor } from './fight-mode.js';
import type { FightMode } from './fight-mode.js';
import { isV3OrLater } from './profile.js';

/**
 * Uma amostra da normal truncada do Canary (`normal_random`, `src/utils/tools.cpp`): média 0,5,
 * desvio 0,25, em `[0,1]` por REJEIÇÃO — reamostra enquanto a amostra cai fora do intervalo.
 *
 * O Canary usa `std::normal_distribution<float>` (algoritmo não especificado pelo padrão C++,
 * e de qualquer forma GPL — ADR 0019). Esta é uma implementação ORIGINAL em TypeScript: só a
 * FORMA (normal, média, desvio, rejeição em `[0,1]`) vem do Canary, nunca o código. A normal
 * padrão sai de Box-Muller com duas frações uniformes do `Rng` da sessão POR TENTATIVA (aceita
 * ou rejeitada) — sem estado guardado entre chamadas, então cada tentativa consome exatamente
 * dois sorteios, e o número de tentativas até aceitar faz parte da sequência determinística por
 * semente (auditável, como todo sorteio sob o ADR 0031).
 */
function truncatedNormalUnit(rng: Rng): number {
  for (;;) {
    // `Math.log(0)` é `-Infinity`; o piso evita isso sem enviesar a amostra — a chance de
    // `fraction()` devolver exatamente 0 é 1 em 2^32, e o piso é menor que qualquer diferença
    // que o `Math.round` final do chamador enxergue.
    const u1 = Math.max(rng.fraction(), Number.EPSILON);
    const u2 = rng.fraction();
    const standardNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const value = 0.5 + 0.25 * standardNormal;
    if (value >= 0 && value <= 1) return value;
  }
}

/**
 * `normal_random(min, max)` do Canary: a normal truncada de `truncatedNormalUnit`, escalada
 * para `[min, max]` (o menor dos dois primeiro, como o `std::minmax` do Canary) e arredondada
 * ao inteiro mais próximo.
 *
 * Roda SEMPRE, mesmo com `min === max`: a sequência de sorteios não pode depender do VALOR do
 * intervalo — a mesma regra do `blockChance` e do crítico consumidos com chance zero (ADR 0031).
 */
export function normalRandomInt(rng: Rng, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const value = truncatedNormalUnit(rng);
  return lo + Math.round(value * (hi - lo));
}

/**
 * O poder bruto de um golpe pela fórmula `combat-v1` (ADR 0031). `skillLevel` conta a partir do
 * `skillStartingLevel` compilado. Função PURA a menos do RNG: `spread: 0` devolve o valor exato
 * sem consumir sorteio, e é o que preserva a sequência de RNG da hunt v1 bit a bit.
 */
function resolveWeaponPowerV1(
  formula: NonNullable<WeaponProfile['power']>, level: number, skillLevel: number, rng: Rng,
): number {
  const steps = Math.max(0, skillLevel - formula.skillStartingLevel);
  const mid = formula.base * (1 + level * formula.levelFactor + steps * formula.skillFactor);
  if (formula.spread <= 0) return mid;

  const min = Math.floor(mid * (1 - formula.spread));
  const max = Math.ceil(mid * (1 + formula.spread));
  return rng.integer(min, max);
}

/**
 * O poder bruto de um golpe pela fórmula `combat-v2` (#522, ADR 0037 d.5) —
 * `Weapons::getMaxWeaponDamage`/`WeaponMelee::getWeaponDamage`/`WeaponDistance::getWeaponDamage`
 * do Canary, só o MECANISMO e os coeficientes (ADR 0019):
 *
 * ```text
 * maxDamage = round(coefficient × attackFactor × attack × skill + ⌊level/5⌋) × vocationMultiplier
 * minDamage = ⌊level/5⌋ (corpo a corpo: 0 se `attack` ≤ 0; distância: sempre)
 * damage    = normalRandomInt(minDamage, maxDamage)
 * ```
 *
 * `attackFactor` chega pronto de quem chama (`resolveWeaponPower`/`resolveWeaponHit` o resolvem
 * pelo perfil e pela postura do personagem) — a função só multiplica.
 *
 * `skillLevel` é o nível ABSOLUTO da skill — ao contrário do v1, o v2 NÃO subtrai
 * `skillStartingLevel`: o Canary multiplica pelo `attackSkill` bruto (`player->getWeaponSkill`/
 * `getSkillLevel(SKILL_DISTANCE)`), e um personagem nasce com skill 10, não 0.
 *
 * `attack` é `formula.base` — o `attack` do item, ou da munição no tiro (o mesmo campo que o v1
 * já usa). O Canary soma `physicalAttack + elementalAttack + weaponProficiency` num único termo
 * antes de multiplicar pela skill; `attackBonus` é o `elementalAttack` (#687), que só o
 * `resolveWeaponHit` do `combat-v3` passa — v2 e v3 sem elemento chamam com `0` e a conta não
 * muda. O `minDamage` continua testando só o `attack` FÍSICO (`physicalAttack > 0 ? level/5 :
 * 0` do Canary). Proficiência não existe no catálogo. Ver `docs/product/combat.md`, seção
 * "Dano de arma e chance de acerto à distância".
 *
 * `vocationMultiplier` trunca em ORDEM DIFERENTE por família — reproduzindo uma ASSIMETRIA real
 * do Canary, não um capricho do Draconya: `WeaponMelee::getWeaponDamage` (`weapons.cpp:655`)
 * multiplica primeiro e trunca o PRODUTO (`static_cast<int32_t>(getMaxWeaponDamage(...) *
 * meleeDamageMultiplier)`); `WeaponDistance::getWeaponDamage` (`weapons.cpp:939`) trunca o
 * MULTIPLICADOR primeiro e só então multiplica (`maxValue * static_cast<int32_t>(
 * distDamageMultiplier)`) — um `distDamageMultiplier` fracionário (`1,5`, por exemplo) vira `1`
 * ANTES de entrar na conta, e o bônus desaparece por inteiro na distância, enquanto o mesmo
 * `1,5` vale cheio no corpo a corpo. Invisível hoje porque toda vocação declara `1` nos dois
 * campos (`vocations.xml` do Canary e `packages/content/data/vocations/*.json`), mas é a conta
 * exata que um `distDamageMultiplier` fracionário futuro precisa reproduzir.
 */
function resolveWeaponPowerV2(
  formula: NonNullable<WeaponProfile['power']>, isDistance: boolean, level: number,
  skillLevel: number, rng: Rng, weaponDamage: NonNullable<Combat['weaponDamage']>,
  vocationMultiplier: number, attackFactor: number, attackBonus = 0,
): number {
  const attack = formula.base;
  const coefficient = isDistance ? weaponDamage.distanceCoefficient : weaponDamage.meleeCoefficient;
  const levelTerm = Math.floor(level / 5);
  // `attack <= 0` zera o MÁXIMO só em corpo a corpo (o `isMelee` de `getMaxWeaponDamage`); a
  // distância não tem esse portão — a munição sem `attack` ainda rola o termo de level.
  const maxRounded = !isDistance && attack <= 0
    ? 0
    : Math.round(
      coefficient * attackFactor * (attack + attackBonus) * skillLevel + levelTerm,
    );
  // A assimetria do Canary (ver o comentário da função): corpo a corpo multiplica e trunca o
  // PRODUTO; distância trunca o MULTIPLICADOR antes de multiplicar — dois `static_cast<int32_t>`
  // em posições diferentes do código-fonte, não a mesma conta escrita duas vezes.
  const maxDamage = isDistance
    ? maxRounded * Math.trunc(vocationMultiplier)
    : Math.trunc(maxRounded * vocationMultiplier);
  const minDamage = isDistance ? levelTerm : (attack > 0 ? levelTerm : 0);
  return normalRandomInt(rng, minDamage, maxDamage);
}

/**
 * O `attackFactor` do golpe (M30-03, #550): a postura do personagem nos perfis que a conhecem
 * (`combat-v3` em diante), 1.0 — a ofensiva — nos outros. É a ÚNICA porta por onde a postura
 * entra na fórmula de arma, então `combat-v1`/`v2` não têm como lê-la por engano.
 */
function attackFactorOf(combat: Combat, fightMode: FightMode): number {
  return isV3OrLater(combat.compatibilityProfile) ? attackFactorFor(fightMode) : 1;
}

/**
 * O poder bruto de um golpe de arma, antes da mitigação. Despacha por
 * `combat.compatibilityProfile` (ADR 0031): `combat-v2` E `combat-v3` (#548, ADR 0040 — o
 * `combat-v3` não muda o lado OFENSIVO, só o de recebimento) usam a fórmula do Canary
 * (`resolveWeaponPowerV2`); qualquer outro valor — inclusive `combat` ausente — usa o v1, de
 * propósito, para preservar toda chamada existente que não passa `combat` (DT-03: ausência é o
 * default que preserva o v1 bit a bit, o mesmo idioma do resto do ADR 0031).
 *
 * `vocationMultiplier` é `vocation.meleeDamageMultiplier`/`distDamageMultiplier` — só o v2/v3 o
 * lê; o v1 nunca teve multiplicador de vocação, e passar `1` (o default) não muda nada nele.
 *
 * `fightMode` é a postura do personagem (M30-03, #550): só o `combat-v3`/`v4` a lê, para o
 * `attackFactor`; nos outros perfis o fator é 1.0, como a constante de conteúdo que existia.
 *
 * Função PURA a menos do RNG da sessão.
 */
export function resolveWeaponPower(
  profile: WeaponProfile,
  level: number,
  skillLevel: number,
  rng: Rng,
  combat?: Combat,
  vocationMultiplier = 1,
  fightMode: FightMode = DEFAULT_FIGHT_MODE,
): number {
  const usesCanaryWeaponFormula = combat !== undefined
    && (combat.compatibilityProfile === 'combat-v2' || isV3OrLater(combat.compatibilityProfile))
    && combat.weaponDamage !== undefined;
  if (profile.fixedDamage !== undefined) {
    // `combat-v2`/`combat-v3`: `WeaponWand::getWeaponDamage` do Canary também sorteia pela
    // normal truncada (`normal_random(minChange, maxChange)`), não uma faixa uniforme — a
    // MESMA distribuição do corpo a corpo e da distância, só o MÁXIMO/MÍNIMO de wand/rod não
    // muda (já era faixa fixa do item, sem coeficiente nem `attackFactor`). `combat-v1`
    // continua uniforme, como sempre.
    return usesCanaryWeaponFormula
      ? normalRandomInt(rng, profile.fixedDamage.min, profile.fixedDamage.max)
      : rng.integer(profile.fixedDamage.min, profile.fixedDamage.max);
  }
  const formula = profile.power;
  // Perfil sem fórmula nem faixa é uma arma sem dano — conteúdo que o boot já recusou, e zero
  // é a resposta honesta em vez de um número inventado.
  if (formula === undefined) return 0;

  if (usesCanaryWeaponFormula && combat?.weaponDamage !== undefined) {
    return resolveWeaponPowerV2(
      formula, profile.family === 'distance', level, skillLevel, rng, combat.weaponDamage,
      vocationMultiplier, attackFactorOf(combat, fightMode),
    );
  }
  return resolveWeaponPowerV1(formula, level, skillLevel, rng);
}

/** O golpe de arma dividido (#687): a parte física e a elemental, já com `damagePercent`. */
export interface WeaponHit {
  readonly physical: number;
  readonly elemental: number;
}

/**
 * O golpe de arma com o componente elemental e o `damagePercent` do `unproperly` (#687) —
 * `internalUseWeapon`/`WeaponMelee::getWeaponDamage` do Canary, só o mecanismo (ADR 0019):
 *
 * ```text
 * total     = trunc(getWeaponDamage(attack + element) × damagePercent / 100)
 * physical  = trunc(total × attack / (attack + element))
 * elemental = trunc(total × element / (attack + element))
 * ```
 *
 * Só o `combat-v3` com arma que declara `element` entra no ramo novo. Qualquer outro caso —
 * v1, v2, v3 sem elemento, wand — faz exatamente a chamada de sempre ao `resolveWeaponPower`,
 * com os mesmos sorteios (ADR 0031), e aplica `damagePercent` (100 é identidade: `trunc` de um
 * inteiro). O `buff` de postura de MAGIA do Draconya (Blood Rage, Sharpshooter) é do chamador e
 * vale para as duas partes; já a postura de LUTA (`fightMode`) entra aqui, no `attackFactor` do
 * total — o Canary a multiplica DENTRO de `getWeaponDamage`, antes da divisão físico/elemento.
 */
export function resolveWeaponHit(
  profile: WeaponProfile, level: number, skillLevel: number, rng: Rng,
  combat: Combat | undefined, vocationMultiplier: number, damagePercent: number,
  fightMode: FightMode = DEFAULT_FIGHT_MODE,
): WeaponHit {
  const element = profile.element;
  if (combat === undefined || !isV3OrLater(combat.compatibilityProfile) || element === undefined
    || profile.power === undefined || combat.weaponDamage === undefined) {
    const power = resolveWeaponPower(
      profile, level, skillLevel, rng, combat, vocationMultiplier, fightMode,
    );
    // `damagePercent` 100 devolve o poder intacto — inclusive o valor FRACIONÁRIO do v1, que
    // um `trunc` mudaria.
    return {
      physical: damagePercent === 100 ? power : Math.trunc((power * damagePercent) / 100),
      elemental: 0,
    };
  }
  const physicalAttack = profile.power.base;
  const total = Math.trunc((resolveWeaponPowerV2(
    profile.power, false, level, skillLevel, rng, combat.weaponDamage, vocationMultiplier,
    attackFactorOf(combat, fightMode), element.attack,
  ) * damagePercent) / 100);
  const combined = physicalAttack + element.attack;
  // `static_cast<int32_t>` por parte, como no Canary: a soma pode perder 1 ponto.
  return {
    physical: Math.trunc(total * (physicalAttack / combined)),
    elemental: Math.trunc(total * (element.attack / combined)),
  };
}
