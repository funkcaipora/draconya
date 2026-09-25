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
//   - `fixedDamage` (wand/rod): faixa fixa, UMA rolagem por golpe, como o loot. IDÊNTICA nos
//     dois perfis — a #522 não muda wand/rod (já é o modelo de faixa fixa do Canary).
//
// Wand/rod NÃO passam por multiplicador de weapon skill: o perfil deles não tem `power`, e é
// por construção, não por um `if` — o contrato de wand/rod é distinto do de spellPower (DT-02).

import type { Combat, WeaponProfile } from '@draconya/content';
import type { Rng } from '../rng.js';

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
 * `skillLevel` é o nível ABSOLUTO da skill — ao contrário do v1, o v2 NÃO subtrai
 * `skillStartingLevel`: o Canary multiplica pelo `attackSkill` bruto (`player->getWeaponSkill`/
 * `getSkillLevel(SKILL_DISTANCE)`), e um personagem nasce com skill 10, não 0.
 *
 * `attack` é `formula.base` — o `attack` do item, ou da munição no tiro (o mesmo campo que o v1
 * já usa); não existe ataque elemental nem proficiência de arma como sub-atributo separado no
 * catálogo do Draconya, então `attack` é o único termo de poder da arma. Documentado como
 * simplificação deliberada em `docs/product/combat.md`.
 */
function resolveWeaponPowerV2(
  formula: NonNullable<WeaponProfile['power']>, isDistance: boolean, level: number,
  skillLevel: number, rng: Rng, weaponDamage: NonNullable<Combat['weaponDamage']>,
  vocationMultiplier: number,
): number {
  const attack = formula.base;
  const coefficient = isDistance ? weaponDamage.distanceCoefficient : weaponDamage.meleeCoefficient;
  const levelTerm = Math.floor(level / 5);
  // `attack <= 0` zera o MÁXIMO só em corpo a corpo (o `isMelee` de `getMaxWeaponDamage`); a
  // distância não tem esse portão — a munição sem `attack` ainda rola o termo de level.
  const maxRounded = !isDistance && attack <= 0
    ? 0
    : Math.round(coefficient * weaponDamage.attackFactor * attack * skillLevel + levelTerm);
  // `static_cast<int32_t>(... * multiplicador)` do Canary trunca em vez de arredondar — o
  // arredondamento já aconteceu no passo anterior, e este é só o produto pelo multiplicador de
  // vocação (1,0 em toda vocação hoje, então o truncamento não é observável ainda).
  const maxDamage = Math.trunc(maxRounded * vocationMultiplier);
  const minDamage = isDistance ? levelTerm : (attack > 0 ? levelTerm : 0);
  return normalRandomInt(rng, minDamage, maxDamage);
}

/**
 * O poder bruto de um golpe de arma, antes da mitigação. Despacha por
 * `combat.compatibilityProfile` (ADR 0031): `combat-v2` usa a fórmula do Canary
 * (`resolveWeaponPowerV2`); qualquer outro valor — inclusive `combat` ausente — usa o v1, de
 * propósito, para preservar toda chamada existente que não passa `combat` (DT-03: ausência é o
 * default que preserva o v1 bit a bit, o mesmo idioma do resto do ADR 0031).
 *
 * `vocationMultiplier` é `vocation.meleeDamageMultiplier`/`distDamageMultiplier` — só o v2 o lê;
 * o v1 nunca teve multiplicador de vocação, e passar `1` (o default) não muda nada nele.
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
): number {
  if (profile.fixedDamage !== undefined) {
    return rng.integer(profile.fixedDamage.min, profile.fixedDamage.max);
  }
  const formula = profile.power;
  // Perfil sem fórmula nem faixa é uma arma sem dano — conteúdo que o boot já recusou, e zero
  // é a resposta honesta em vez de um número inventado.
  if (formula === undefined) return 0;

  if (combat?.compatibilityProfile === 'combat-v2' && combat.weaponDamage !== undefined) {
    return resolveWeaponPowerV2(
      formula, profile.family === 'distance', level, skillLevel, rng, combat.weaponDamage,
      vocationMultiplier,
    );
  }
  return resolveWeaponPowerV1(formula, level, skillLevel, rng);
}
