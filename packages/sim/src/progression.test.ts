import { describe, expect, it } from 'vitest';
import { NEUTRAL_RATES } from '@draconya/content';
import type { Progression, Skill, Vocation } from '@draconya/content';
import { CharacterRuntime } from './character.js';
import {
  applyDeathPenalty, applyExperienceBonus, grantXp, levelExperienceBonusPercent, levelForXp,
  statsForLevel, totalXpForLevel, xpToCompleteLevel,
} from './progression.js';

/** Sem skill nenhuma no catálogo: o caso de quem só quer a conta de XP. */
const NO_SKILLS: ReadonlyMap<string, Skill> = new Map();

const baseline: Progression = {
  id: 'baseline',
  startingHealth: 150, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10,
  vocationLevel: 8, startingKit: [], satchelInitialSlots: 10, containerRow: 5,
  startingSpeed: 300, speedPerLevel: 2,
  regen: { health: { ticksMs: 1000, amount: 1 }, mana: { ticksMs: 1000, amount: 1 } },
  regeneration: { requiresFood: false },
  xp: { kind: 'power', base: 20, exponent: 2 },
  // blessingReduction é POR BÊNÇÃO (#570): 0.08 × 7 = 0.56, o mesmo total que o binário
  // `premium: true` dava antes — os testes abaixo passam `{ blessings: 7 }` para reproduzir
  // exatamente os números de antes, e `{ blessings: 0 }` no lugar de `premium: false`.
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.08, promotionReduction: 0.3 },
  experienceBonusByLevel: [],
  skillMultipliers: {},
  mitigation: { multiplier: 1.3, primaryShield: 2.05, secondaryShield: 1.25 },
  rates: NEUTRAL_RATES,
};
const knight: Vocation = {
  id: 'knight', name: 'Knight', healthPerLevel: 20, manaPerLevel: 5, capacityPerLevel: 25, spellSkill: 'magic',
  startingKit: [], skillMultipliers: {}, meleeDamageMultiplier: 1, distDamageMultiplier: 1,
  soulMax: 100, soulGainTicksMs: 120000,
};
const sorcerer: Vocation = {
  id: 'sorcerer', name: 'Sorcerer', healthPerLevel: 5, manaPerLevel: 25, capacityPerLevel: 10, spellSkill: 'magic',
  startingKit: [], skillMultipliers: {}, meleeDamageMultiplier: 1, distDamageMultiplier: 1,
  soulMax: 100, soulGainTicksMs: 120000,
};

describe('statsForLevel', () => {
  it('gives the starting values at level 1', () => {
    // Quem começa não "subiu" para o level 1: o primeiro level não concede incremento.
    expect(statsForLevel(1, null, baseline)).toEqual({
      maxHealth: 150, maxMana: 0, capacity: 400, speed: 300,
    });
  });

  it('uses the baseline while the character has no vocation', () => {
    // Nasce sem vocação e escolhe no level 8 (§7.4): até lá, todo mundo cresce igual.
    expect(statsForLevel(8, null, baseline)).toEqual({
      maxHealth: 150 + 7 * 5, maxMana: 7 * 5, capacity: 400 + 7 * 10, speed: 300 + 7 * 2,
    });
  });

  it('applies the vocation only above the choosing level', () => {
    // Não é retroativo: os sete primeiros levels continuam valendo a base, e escolher a
    // vocação não muda o HP que o personagem já tinha.
    const noVocation = statsForLevel(8, null, baseline);
    const atNine = statsForLevel(9, knight, baseline);
    expect(atNine.maxHealth).toBe(noVocation.maxHealth + knight.healthPerLevel);
    expect(atNine.maxMana).toBe(noVocation.maxMana + knight.manaPerLevel);
  });

  it('separates the vocations where the table says it should', () => {
    const level = 20;
    const asKnight = statsForLevel(level, knight, baseline);
    const asSorcerer = statsForLevel(level, sorcerer, baseline);
    const afterChoice = level - baseline.vocationLevel;

    expect(asKnight.maxHealth - asSorcerer.maxHealth)
      .toBe(afterChoice * (knight.healthPerLevel - sorcerer.healthPerLevel));
    expect(asSorcerer.maxMana - asKnight.maxMana)
      .toBe(afterChoice * (sorcerer.manaPerLevel - knight.manaPerLevel));
  });

  it('keeps growing on the baseline for someone past the level who never chose', () => {
    // O §7.4 permite passar do 8 sem escolher. Travar o crescimento seria punição silenciosa.
    expect(statsForLevel(12, null, baseline).maxHealth).toBe(150 + 11 * 5);
  });

  it('follows the table, not the code', () => {
    // O teste que define a issue: dobrar o número no JSON dobra o resultado, sem tocar em
    // lógica. Se algum valor estivesse embutido aqui, isto falharia.
    const generous: Progression = { ...baseline, healthPerLevel: 10 };
    expect(statsForLevel(8, null, generous).maxHealth)
      .toBe(150 + 7 * 10);
    const tanky: Vocation = { ...knight, healthPerLevel: 40 };
    expect(statsForLevel(9, tanky, baseline).maxHealth)
      .toBe(statsForLevel(8, null, baseline).maxHealth + 40);
  });

  it('refuses a level that is not a positive integer', () => {
    expect(() => statsForLevel(0, null, baseline)).toThrow(/level/);
    expect(() => statsForLevel(1.5, null, baseline)).toThrow(/level/);
  });
});

// --- FUN-37 ---------------------------------------------------------------------------------

const hero = (over: Partial<{ level: number; xp: number; vocationId: string | null }> = {}) =>
  new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: 150, maxHealth: 150, mana: 0, maxMana: 0,
    level: over.level ?? 1, xp: over.xp ?? 0, vocationId: over.vocationId ?? null,
    goldDelta: 0, alive: true, cooldowns: {},
  });

/** Personagem coerente com a curva: no level pedido, com zero de progresso dentro dele. */
const atLevel = (level: number, vocationId: string | null = null): CharacterRuntime => {
  const character = hero({ level, xp: totalXpForLevel(level, baseline), vocationId });
  const stats = statsForLevel(level, vocationId === null ? null : knight, baseline);
  character.maxHealth = stats.maxHealth;
  character.health = stats.maxHealth;
  character.maxMana = stats.maxMana;
  character.mana = stats.maxMana;
  return character;
};

describe('curva de XP', () => {
  it('é fórmula, não tabela: mudar dois números muda a curva inteira', () => {
    // Tabela de 500 linhas nunca é rebalanceada, e a curva vai ser rebalanceada muitas vezes.
    const íngreme: Progression = { ...baseline, xp: { kind: 'power', base: 20, exponent: 3 } };
    expect(xpToCompleteLevel(3, baseline)).toBe(180);
    expect(xpToCompleteLevel(3, íngreme)).toBe(540);
  });

  it('o level 1 é de graça: é onde todo mundo nasce', () => {
    expect(totalXpForLevel(1, baseline)).toBe(0);
    expect(levelForXp(0, baseline)).toBe(1);
  });

  it('acumula, e o level acompanha a XP total', () => {
    expect(totalXpForLevel(3, baseline)).toBe(20 + 80);
    expect(levelForXp(99, baseline)).toBe(2);
    expect(levelForXp(100, baseline)).toBe(3);
  });
});

describe('level up', () => {
  it('sobe de level e aplica os stats do level novo', () => {
    const character = atLevel(1);
    expect(grantXp(character, 20, null, baseline)).toEqual({ from: 1, to: 2 });
    expect(character.level).toBe(2);
    expect(character.maxHealth).toBe(statsForLevel(2, null, baseline).maxHealth);
  });

  it('sobe mais de um level de uma vez quando a XP cabe', () => {
    // Um abate de boss no level 1 não deveria parar no level 2 e jogar o resto fora.
    const character = atLevel(1);
    expect(grantXp(character, 1000, null, baseline)?.to).toBe(levelForXp(1000, baseline));
  });

  it('sobe de level e enche vida e mana (#678, Canary `addExperience`)', () => {
    // Até #678 o level up dava os pontos e não curava (10 + healthPerLevel) — divergência do
    // Tibia sem ADR. O Canary faz `health = healthMax; mana = manaMax` quando o level muda.
    const character = atLevel(1);
    character.health = 10;
    character.mana = 0;
    grantXp(character, 20, null, baseline);
    expect(character.health).toBe(character.maxHealth);
    expect(character.mana).toBe(character.maxMana);
    expect(character.maxMana).toBeGreaterThan(0);
  });

  it('vários levels num abate curam uma vez, nos máximos FINAIS', () => {
    const character = atLevel(1);
    character.health = 1;
    const change = grantXp(character, 1000, null, baseline);
    expect(change?.to).toBeGreaterThan(2);
    expect(character.health).toBe(statsForLevel(change!.to, null, baseline).maxHealth);
    expect(character.mana).toBe(statsForLevel(change!.to, null, baseline).maxMana);
  });

  it('XP que não fecha o level não cura', () => {
    const character = atLevel(1);
    character.health = 10;
    expect(grantXp(character, 5, null, baseline)).toBeNull();
    expect(character.health).toBe(10);
  });

  it('segue a vocação do personagem, quando ele tem uma', () => {
    const cavaleiro = atLevel(9, 'knight');
    const semVocação = atLevel(9);
    grantXp(cavaleiro, xpToCompleteLevel(9, baseline), knight, baseline);
    grantXp(semVocação, xpToCompleteLevel(9, baseline), null, baseline);
    expect(cavaleiro.maxHealth).toBe(statsForLevel(10, knight, baseline).maxHealth);
    expect(semVocação.maxHealth).toBe(statsForLevel(10, null, baseline).maxHealth);
    expect(cavaleiro.maxHealth).toBeGreaterThan(semVocação.maxHealth);
  });
});

describe('penalidade de morte (#521/#569, ADR 0037 — a fórmula do Tibia)', () => {
  it('abaixo do limiar cúbico (24), tira a fração fixa da XP ACUMULADA — não mais de UM level', () => {
    // A diferença estrutural para o modelo antigo: a fração agora é sobre `character.xp`
    // (o total), não sobre `xpToCompleteLevel` (o custo de UM level).
    const character = atLevel(20);
    const antes = character.xp;
    const esperado = Math.round(baseline.deathPenalty.flatFraction * antes);
    expect(applyDeathPenalty(character, { blessings: 0 }, null, baseline, NO_SKILLS).xpLost)
      .toBe(esperado);
  });

  it('com sete bênçãos perde menos — TETADO em 50%, não os 56% crus, abaixo do limiar cúbico (#570)', () => {
    // `Player::getLostPercent` do Canary (ramo `level < 24`):
    // `percentReduction = (percentReduction >= 0.40 ? 0.50 : percentReduction)`. Sete bênçãos
    // dão 56% — ≥ 40% —, e o Tibia teta isso em exatamente 50% NESTE ramo, não o valor bruto.
    const character = atLevel(20);
    const antes = character.xp;
    const esperado = Math.round(baseline.deathPenalty.flatFraction * antes * (1 - 0.50));
    expect(applyDeathPenalty(character, { blessings: 7 }, null, baseline, NO_SKILLS).xpLost)
      .toBe(esperado);
  });

  it('abaixo de 40% cru, o teto não mexe em nada — só entra quando a redução bateria 40% ou mais', () => {
    // Uma bênção só, a 30% de redução: abaixo do limiar de 40% que aciona o teto.
    const gentle: Progression = { ...baseline, deathPenalty: { ...baseline.deathPenalty, blessingReduction: 0.30 } };
    const character = atLevel(20);
    const antes = character.xp;
    const esperado = Math.round(gentle.deathPenalty.flatFraction * antes * (1 - 0.30));
    expect(applyDeathPenalty(character, { blessings: 1 }, null, gentle, NO_SKILLS).xpLost)
      .toBe(esperado);
  });

  it('no limiar cúbico (level ≥ 24) a redução crua vale, sem teto: 56%, não 50%', () => {
    // O teto do Canary só existe no ramo `else` (`level < 24`) de `getLostPercent` — a fórmula
    // cúbica não passa por ele.
    const character = atLevel(24);
    const level = character.level; // atLevel deixa o personagem exatamente na fronteira do level.
    const rawLoss = ((level + 50) / 100) * 50 * (level * level - 5 * level + 8);
    const esperado = Math.round(rawLoss * (1 - baseline.deathPenalty.blessingReduction * 7));
    expect(applyDeathPenalty(character, { blessings: 7 }, null, baseline, NO_SKILLS).xpLost)
      .toBe(esperado);
  });

  it('promovido soma 30% de redução, ADITIVA à bênção e NUNCA tetada (#569)', () => {
    // `Player::getLostPercent`: `if (isPromoted()) percentReduction += 0.30` acontece DEPOIS
    // do teto de 50% do ramo `level < cubicFromLevel` — a promoção nunca passa pelo teto.
    const character = atLevel(20);
    const antes = character.xp;
    const esperado = Math.round(baseline.deathPenalty.flatFraction * antes * (1 - 0.30));
    expect(applyDeathPenalty(character, { blessings: 0, promoted: true }, null, baseline, NO_SKILLS).xpLost)
      .toBe(esperado);
  });

  it('bênção TETADA em 50% mais promoção somam 80%, sem re-tetar o total', () => {
    const character = atLevel(20);
    const antes = character.xp;
    // blessingReduction × 7 (0.56) ≥ 0.40 → teto 50%; + 30% de promoção = 80% total.
    const esperado = Math.round(baseline.deathPenalty.flatFraction * antes * (1 - 0.80));
    expect(applyDeathPenalty(character, { blessings: 7, promoted: true }, null, baseline, NO_SKILLS).xpLost)
      .toBe(esperado);
  });

  it('pode rebaixar o level', () => {
    const character = atLevel(20);
    expect(applyDeathPenalty(character, { blessings: 0 }, null, baseline, NO_SKILLS).levelChange)
      .toEqual({ from: 20, to: 19 });
  });

  it('a perda de level NÃO enche vida nem mana (#678): só reduz os máximos, como no Canary', () => {
    const character = atLevel(20);
    character.health = 10;
    character.mana = 3;
    const penalidade = applyDeathPenalty(character, { blessings: 0 }, null, baseline, NO_SKILLS);
    expect(penalidade.levelChange).toEqual({ from: 20, to: 19 });
    expect(character.health).toBeLessThan(character.maxHealth);
    expect(character.health).toBeLessThanOrEqual(10);
    expect(character.mana).toBeLessThanOrEqual(3);
  });

  it('desce um level e para lá, com a curva que está no conteúdo hoje', () => {
    // Vale saber, e foi medido escrevendo estes testes: `flatFraction` é 10% do ACUMULADO, e
    // para qualquer curva de potência com termos crescentes isso nunca cascateia mais de um
    // level partindo exatamente da fronteira — precisaria de uma fração bem maior que 50% para
    // ultrapassar o termo do level anterior. O código trata cascata mesmo assim (abaixo), com
    // uma curva onde o modelo cúbico (level ≥ 24) domina.
    const character = atLevel(9);
    applyDeathPenalty(character, { blessings: 0 }, null, baseline, NO_SKILLS);
    expect(character.level).toBe(8);
    expect(character.xp).toBeGreaterThan(totalXpForLevel(8, baseline));
  });

  // A partir do level 24 a perda é a fórmula CÚBICA do Tibia — função só do level, não da curva
  // de XP —, então uma curva de XP mais "barata" (`base` pequeno) faz a mesma perda ABSOLUTA
  // valer muitos levels. Não é a curva do conteúdo, e é esse o ponto: o teste continua valendo
  // quando alguém rebalancear `baseline.xp`.
  const íngreme: Progression = { ...baseline, xp: { kind: 'power', base: 5, exponent: 2 } };
  const profunda: Progression = { ...baseline, xp: { kind: 'power', base: 1, exponent: 2 } };

  it('CASCATEIA por mais de um level quando a perda passa do level inteiro', () => {
    // O caso que passa despercebido e só aparece com um jogador reclamando.
    const character = hero({ level: 24, xp: totalXpForLevel(24, íngreme) });
    const penalidade = applyDeathPenalty(character, { blessings: 0 }, null, íngreme, NO_SKILLS);
    expect(penalidade.levelChange?.to).toBeLessThan(23);
    expect(character.level).toBe(levelForXp(character.xp, íngreme));
  });

  it('SEM piso (#569): pode cair abaixo do level 8, e a XP nunca fica negativa', () => {
    // Antes do #569 esta mesma curva parava EXATAMENTE no level 8 (o piso do Draconya). O
    // Tibia não tem esse piso (`Player::death`/`getLostPercent`, sem `levelFloor` nenhum), e a
    // #569 alinhou o Draconya a isso: a curva agressiva agora derruba até o level 1.
    const character = hero({ level: 24, xp: totalXpForLevel(24, profunda) });
    applyDeathPenalty(character, { blessings: 0 }, null, profunda, NO_SKILLS);
    expect(character.level).toBe(1);
    expect(character.xp).toBe(0);
  });

  it('nível baixo NÃO é mais protegido: perde a fração fixa como qualquer outro abaixo do limiar', () => {
    // Antes do #569 o piso do level 8 fazia o level 5 não perder XP nenhuma. Sem piso, ele
    // segue a MESMA regra `flatFraction` de todo mundo abaixo de `cubicFromLevel`.
    const character = atLevel(5);
    const antes = character.xp;
    const esperado = Math.round(baseline.deathPenalty.flatFraction * antes);
    const penalidade = applyDeathPenalty(character, { blessings: 0 }, null, baseline, NO_SKILLS);
    expect(penalidade.xpLost).toBe(esperado);
    expect(penalidade.xpLost).toBeGreaterThan(0);
  });

  it('nunca perde item, porque não existe nada disso aqui', () => {
    // §3.8: morte no Draconya nunca é perda material, e é o que elimina a necessidade de
    // qualquer sistema de recuperação de itens. O teste é a ausência: a penalidade mexe em
    // XP, level, skill e stats derivados, e em mais nada.
    const character = atLevel(20);
    character.goldDelta = 500;
    applyDeathPenalty(character, { blessings: 0 }, null, baseline, NO_SKILLS);
    expect(character.goldDelta).toBe(500);
  });
});

// --- #569: a mesma fração tira tries de skill e mana gasta (a skill `magic`) --------------------

describe('perda de skill e de mana gasta na morte (#569, `Player::death` do Canary)', () => {
  const fist: Skill = {
    id: 'fist', name: 'Punho', startingLevel: 10,
    curve: { base: 50, factor: 1.5 },
    gain: { on: 'melee-hit', points: 1 },
    damagePerLevel: 0.02,
  };
  const magicSkill: Skill = {
    id: 'magic', name: 'Magia', startingLevel: 0,
    curve: { base: 1600, factor: 4.0 },
    gain: { on: 'spell-cast', pointsPerMana: 1 },
    damagePerLevel: 0.03,
  };
  const skillCatalog: ReadonlyMap<string, Skill> = new Map([[fist.id, fist], [magicSkill.id, magicSkill]]);

  /** Personagem no level 20 (abaixo do limiar cúbico), com `fist` e `magic` no estado dado. */
  const withSkills = (skills: { fist: { level: number; points: number }; magic: { level: number; points: number } }) =>
    new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 },
      health: 150, maxHealth: 150, mana: 0, maxMana: 0,
      level: 20, xp: totalXpForLevel(20, baseline), vocationId: null,
      goldDelta: 0, alive: true, cooldowns: {}, skills,
    });

  it('tira tries de skill corpo a corpo e mana gasta (magic) na MESMA fração da XP, e cada uma pode cruzar nível', () => {
    // fist no level 12 com 10 pontos: total acumulado = pointsForLevel(10) + pointsForLevel(11)
    // + 10 = 50 + 75 + 10 = 135. Fração (premium false, belowCubic) = flatFraction = 0.1.
    // triesLost = floor(135 × 0,1) = 13; 13 > 10 (pontos correntes) desce um nível: pontos
    // recarregam para pointsForLevel(11) = 75, e os 3 que sobram saem dali: 75 − 3 = 72.
    //
    // magic no level 1 com 0 pontos: total acumulado = pointsForLevel(0) = 1600.
    // triesLost = floor(1600 × 0,1) = 160; 160 > 0 desce para o level 0 (piso da própria
    // magia — `startingLevel`), pontos recarregam para pointsForLevel(0) = 1600, sobra 160:
    // 1600 − 160 = 1440.
    const character = withSkills({ fist: { level: 12, points: 10 }, magic: { level: 1, points: 0 } });
    const penalty = applyDeathPenalty(character, { blessings: 0 }, null, baseline, skillCatalog);

    const fistLoss = penalty.skillLosses.find((loss) => loss.skillId === 'fist');
    expect(fistLoss).toEqual({ skillId: 'fist', triesLost: 13, levelChange: { from: 12, to: 11 } });
    expect(character.skills.levelOf(fist)).toBe(11);
    expect(character.skills.pointsOf(fist)).toBe(72);

    const magicLoss = penalty.skillLosses.find((loss) => loss.skillId === 'magic');
    expect(magicLoss).toEqual({ skillId: 'magic', triesLost: 160, levelChange: { from: 1, to: 0 } });
    expect(character.skills.levelOf(magicSkill)).toBe(0);
    expect(character.skills.pointsOf(magicSkill)).toBe(1440);
  });

  it('perda pequena não cruza nível: só desconta os pontos, `levelChange` fica `null`', () => {
    // fist no level 20 com 1000 pontos: perder uma fração pequena de um total grande não chega
    // a esvaziar os pontos correntes.
    const character = withSkills({ fist: { level: 20, points: 1000 }, magic: { level: 0, points: 0 } });
    const penalty = applyDeathPenalty(character, { blessings: 0 }, null, baseline, skillCatalog);
    const fistLoss = penalty.skillLosses.find((loss) => loss.skillId === 'fist');
    expect(fistLoss?.levelChange).toBeNull();
    expect(character.skills.levelOf(fist)).toBe(20);
    expect(character.skills.pointsOf(fist)).toBe(1000 - (fistLoss?.triesLost ?? 0));
  });

  it('skill no piso (`startingLevel`) não desce mais: os pontos zeram e param', () => {
    // fist já no level inicial (10), sem pontos: não há para onde descer.
    const character = withSkills({ fist: { level: 10, points: 0 }, magic: { level: 0, points: 0 } });
    const penalty = applyDeathPenalty(character, { blessings: 0 }, null, baseline, skillCatalog);
    const fistLoss = penalty.skillLosses.find((loss) => loss.skillId === 'fist');
    expect(fistLoss).toBeUndefined(); // nada para perder: total acumulado × fração dá zero.
    expect(character.skills.levelOf(fist)).toBe(10);
    expect(character.skills.pointsOf(fist)).toBe(0);
  });

  it('sem skill no catálogo, `skillLosses` é uma lista vazia — a XP continua sendo tirada normalmente', () => {
    const character = atLevel(20);
    const penalty = applyDeathPenalty(character, { blessings: 0 }, null, baseline, NO_SKILLS);
    expect(penalty.skillLosses).toEqual([]);
    expect(penalty.xpLost).toBeGreaterThan(0);
  });
});

describe('bônus de XP por level (#563)', () => {
  const comFaixas: Progression = {
    ...baseline,
    experienceBonusByLevel: [
      { maxLevel: 300, bonusPercent: 200 },
      { bonusPercent: 100 },
    ],
  };

  it('a faixa vale até o teto INCLUSIVO, e a sem maxLevel é o catch-all', () => {
    expect(levelExperienceBonusPercent(1, comFaixas)).toBe(200);
    expect(levelExperienceBonusPercent(300, comFaixas)).toBe(200);
    expect(levelExperienceBonusPercent(301, comFaixas)).toBe(100);
    expect(levelExperienceBonusPercent(1_000, comFaixas)).toBe(100);
  });

  it('sem faixas (conteúdo de teste) o bônus é zero', () => {
    expect(levelExperienceBonusPercent(50, baseline)).toBe(0);
  });

  it('aplica o percentual ADITIVO numa multiplicação só, em inteiro', () => {
    expect(applyExperienceBonus(100, 0)).toBe(100);
    // 100 + 200% = 300; 100 + 100% = 200.
    expect(applyExperienceBonus(100, 200)).toBe(300);
    expect(applyExperienceBonus(100, 100)).toBe(200);
    // Soma de bônus (level 200% + Bestiário 13%) numa multiplicação: 100 × 3,13 = 313.
    expect(applyExperienceBonus(100, 200 + 13)).toBe(313);
    // 5 × 3,01 = 15,05 → 15: o piso é o inteiro.
    expect(applyExperienceBonus(5, 200 + 1)).toBe(15);
  });

  it('a conta é em INTEIRO — 13% sobre 100 dá 113, não 112', () => {
    // `1 + 0,01 × 13` é `1.13`, e `100 × 1.13` é `112.99999999999999`: o `floor` da conta em
    // ponto flutuante devolveria 112. É a armadilha do acumulador fracionário, evitada pela
    // mesma porta — não deixar o resíduo chegar ao arredondamento.
    expect(Math.floor(100 * (1 + 0.01 * 13))).toBe(112);
    expect(applyExperienceBonus(100, 13)).toBe(113);
  });

  it('somar aplica UM floor, e não encadear um por bônus', () => {
    // Dois bônus de 50% sobre 7: somando dá +100% → floor(7 × 2) = 14. Encadeando um `floor`
    // por bônus daria floor(floor(7 × 1,5) × 1,5) = floor(10 × 1,5) = 15 — um ponto a mais, e
    // o floor duplo é justamente o que somar evita.
    expect(applyExperienceBonus(7, 50 + 50)).toBe(14);
  });
});
