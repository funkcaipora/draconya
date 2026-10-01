import { describe, expect, it, vi } from 'vitest';
import type { Combat, Spell, Supply } from '@draconya/content';
import { evaluateSpellPower } from '@draconya/content';
import { CharacterRuntime } from './character.js';
import { learnedSpellsStateOf } from './learned-spells.js';
import { actionExhaustKey, balanceOf, castSpell, executeHealing, spellCooldownKey, useSupply } from './casting.js';
import type { SpellScaling } from './casting.js';
import { normalRandomInt } from './combat/weapon-power.js';
import { Rng } from './rng.js';

// Esquiva zero e armadura que conta inteira: aqui o assunto é o PORTÃO — level, cooldown,
// alcance, mana e gold —, e um dano que varia por sorteio esconderia exatamente isso. Quem
// cuida da matemática do golpe é `combat/damage.test.ts`.
const combat: Combat = {
  id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 1, earth: 1, fire: 1, ice: 1, holy: 1, death: 1, drown: 1, lifedrain: 1, manadrain: 1, arcane: 1 }, minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0, damageType: 'physical' },
  spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
};

const heal: Spell = {
  id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1_000, minLevel: 1,
  effect: { kind: 'heal', amount: 60 },
};
const strike: Spell = {
  id: 'strike', name: 'Golpe', manaCost: 15, cooldownMs: 2_000, minLevel: 1,
  effect: { kind: 'damage', power: 40, range: 3, damageType: 'arcane' },
};
const challenge: Spell = {
  id: 'challenge', name: 'Challenge', manaCost: 30, cooldownMs: 2_000, minLevel: 20,
  effect: { kind: 'challenge', durationMs: 6_000, range: 3 },
};

const potion: Supply = {
  id: 'health-potion', name: 'Poção de Vida', price: 45, group: 'potion', groupCooldownMs: 1_000, requires: {},
  effect: { kind: 'heal', amount: 80 },
};
const manaPotion: Supply = {
  id: 'mana-potion', name: 'Poção de Mana', price: 50, group: 'potion', groupCooldownMs: 1_000, requires: {},
  effect: { kind: 'mana', amount: 100 },
};

// O herói sabe TODA magia que este arquivo declara: o portão do aprendizado (#624) é o assunto de
// um bloco só (`castSpell — o aprendizado`), e o resto dos testes é sobre o que vem depois dele —
// level, cooldown, alcance, mana. Quem quer o herói que NÃO aprendeu passa `learned`.
const KNOWN_SPELLS = [
  'antidote-rune', 'avalanche-rune', 'base-healing', 'blast', 'blood-rage', 'cancel-magic-shield',
  'challenge', 'conjure-arrow', 'conjure-avalanche-rune', 'cure-poison', 'destroy-field-rune',
  'divine-caldera', 'ethereal-spear', 'fair-wound-cleansing', 'fire-field-rune', 'fire-wave',
  'flame-strike', 'great-death-beam', 'great-energy-beam', 'great-fireball-rune', 'haste', 'heal',
  'heal-party', 'ice-strike', 'intense-healing', 'intense-healing-rune', 'invisibility-druid',
  'light-healing', 'long', 'magic-shield', 'nature-heal', 'paralyze-rune', 'player-fire-field',
  'protect-party', 'recovery', 'short', 'strike', 'sudden-death-rune', 'ultimate-healing-rune',
];

const hero = (over: Partial<{
  health: number; mana: number; soul: number; level: number; gold: number; goldDelta: number;
  learned: readonly string[];
}> = {}): CharacterRuntime => new CharacterRuntime({
  id: 'hero', position: { x: 1, y: 1, z: 7 },
  health: over.health ?? 100, maxHealth: 100,
  mana: over.mana ?? 100, maxMana: 100,
  soul: over.soul ?? 100,
  level: over.level ?? 10, xp: 0, vocationId: null,
  staminaMs: null, staminaUpdatedAtMs: 0,
  gold: over.gold ?? 0, goldDelta: over.goldDelta ?? 0,
  alive: true, cooldowns: {},
  learnedSpells: learnedSpellsStateOf(over.learned ?? KNOWN_SPELLS),
});

/** Uma mira de alvo único, que é o caso mais comum. */
const near = (over: Partial<{ armor: number; dodgeChance: number; distance: number }> = {}) => ({
  distance: over.distance ?? 1,
  targets: [{ armor: over.armor ?? 0, dodgeChance: over.dodgeChance ?? 0 }],
});
const rng = () => Rng.fromSeed('casting');

describe('castSpell — o portão, na ordem em que ele custa a descobrir', () => {
  it('recusa abaixo do level mínimo, e não gasta mana nenhuma', () => {
    const caster = hero({ level: 1 });
    const forte: Spell = { ...heal, minLevel: 50 };

    expect(castSpell(caster, forte, null, 0, combat, rng()))
      .toEqual({ ok: false, reason: 'level-too-low', retryInMs: 0 });
    expect(caster.mana).toBe(100);
  });

  it('recusa em cooldown, e DIZ em quanto tempo vale tentar de novo', () => {
    // O prazo não é enfeite: é o que faz a categoria do bot voltar no vencimento em vez de
    // engatilhar e dormir. Um personagem parado, com a cura em cooldown e sem levar dano,
    // nunca veria o mundo mudar — e nunca curaria.
    const caster = hero({ health: 10 });

    expect(castSpell(caster, heal, null, 0, combat, rng()).ok).toBe(true);
    expect(castSpell(caster, heal, null, 400, combat, rng()))
      .toEqual({ ok: false, reason: 'on-cooldown', retryInMs: 600 });
    expect(castSpell(caster, heal, null, 1_000, combat, rng()).ok).toBe(true);
  });

  it('o cooldown é gravado no relógio LÓGICO da sessão, com a chave prefixada', () => {
    // Prefixo porque o mesmo mapa guarda cooldown de outras coisas: `heal` a seco colidiria
    // com um supply de mesmo id no dia em que alguém criasse um.
    const caster = hero();
    castSpell(caster, heal, null, 5_000, combat, rng());
    expect(caster.cooldowns.isReady(spellCooldownKey('heal'), 5_999)).toBe(false);
    expect(caster.cooldowns.isReady(spellCooldownKey('heal'), 6_000)).toBe(true);
  });

  it('magia de dano sem alvo é recusada, e fora de alcance também', () => {
    const caster = hero();
    expect(castSpell(caster, strike, null, 0, combat, rng()).ok).toBe(false);
    expect(castSpell(caster, strike, near({ distance: 4 }), 0, combat, rng()))
      .toEqual({ ok: false, reason: 'out-of-range', retryInMs: 0 });
    // Nenhuma das duas cobrou nada: nem mana, nem cooldown.
    expect(caster.mana).toBe(100);
    expect(caster.cooldowns.isReady(spellCooldownKey('strike'), 0)).toBe(true);
  });

  it('a MANA sai por último: alcance é conferido antes de descontar', () => {
    // Descontar antes de saber se o alvo estava ao alcance é como se perde mana sem lançar
    // nada — o defeito que o jogador nota e não consegue explicar.
    const caster = hero({ mana: 15 });
    expect(castSpell(caster, strike, near({ distance: 9 }), 0, combat, rng()).ok).toBe(false);
    expect(caster.mana).toBe(15);
  });

  it('sem mana, recusa — e "sem mana" não melhora com o tempo, então não há prazo', () => {
    const caster = hero({ mana: 5 });
    expect(castSpell(caster, heal, null, 0, combat, rng()))
      .toEqual({ ok: false, reason: 'not-enough-mana', retryInMs: 0 });
  });

  describe('pacified (#554/#622, ADR 0040 decisão 1 e ADR 0041): trava de ataque', () => {
    const combatV3: Combat = { ...combat, compatibilityProfile: 'combat-v3' };
    /** A condição `pacified` até `expiresAtMs` — o mesmo estado que a trava de escada aplica. */
    const pacify = (caster: CharacterRuntime, expiresAtMs: number): void => {
      caster.conditions.apply({ key: 'pacified', expiresAtMs, merge: 'longest' });
    };

    it('magia AGRESSIVA recusa com `attack-locked` e o prazo exato — antes do alvo, e sem gastar mana', () => {
      const caster = hero();
      pacify(caster, 2_000);
      // Sem mira nenhuma (`null`): se a checagem de alcance/alvo viesse primeiro, a recusa
      // seria `no-target`, não `attack-locked` — a ordem é a mesma do `playerSpellCheck` do
      // Canary, que confere `CONDITION_PACIFIED` antes do alvo.
      expect(castSpell(caster, strike, null, 500, combatV3, rng()))
        .toEqual({ ok: false, reason: 'attack-locked', retryInMs: 1_500 });
      expect(caster.mana).toBe(100);
    });

    it('vencida a condição, a magia agressiva sai normalmente — no instante EXATO do vencimento', () => {
      const caster = hero();
      pacify(caster, 2_000);
      expect(castSpell(caster, strike, near(), 1_999, combatV3, rng()).ok).toBe(false);
      expect(castSpell(caster, strike, near(), 2_000, combatV3, rng()).ok).toBe(true);
    });

    it('cura NÃO é bloqueada pela MESMA condição — só `damage`/`damage-over-time` são agressivas', () => {
      const caster = hero({ health: 10 });
      pacify(caster, 2_000);
      expect(castSpell(caster, heal, null, 0, combatV3, rng()).ok).toBe(true);
    });

    it('Summon Creature é AGRESSIVA por padrão no Canary: recusa com `attack-locked`, sem gastar mana (#622)', () => {
      // `summon_creature.lua` não chama `isAggressive(false)` — toda cura, condição própria e
      // conjuração chama —, e `Spell::playerSpellCheck` recusa a magia agressiva sob
      // `CONDITION_PACIFIED` (`spells.cpp:517`) ANTES do script que cria a invocação.
      const summon: Spell = {
        id: 'summon-creature', name: 'Summon Creature', manaCost: 0, cooldownMs: 2_000, minLevel: 1,
        effect: { kind: 'summon' },
      };
      const caster = hero();
      pacify(caster, 2_000);
      const cast = (nowMs: number) => castSpell(
        caster, summon, null, nowMs, combatV3, rng(), undefined, undefined, undefined, undefined,
        undefined, 30,
      );
      expect(cast(500)).toEqual({ ok: false, reason: 'attack-locked', retryInMs: 1_500 });
      expect(caster.mana).toBe(100);
      expect(cast(2_000)).toMatchObject({ ok: true, summon: true });
      expect(caster.mana).toBe(70);
    });

    it('a condição é o portão, em QUALQUER perfil: a trava de escada só a aplica no combat-v3, mas o conteúdo pode aplicá-la', () => {
      const caster = hero();
      pacify(caster, 2_000);
      expect(castSpell(caster, strike, near(), 0, combat, rng()))
        .toEqual({ ok: false, reason: 'attack-locked', retryInMs: 2_000 });
    });
  });

  describe('feared (#622, ADR 0041): nenhuma magia nem runa sai', () => {
    const fear = (caster: CharacterRuntime, expiresAtMs: number): void => {
      caster.conditions.apply({ key: 'feared', expiresAtMs, merge: 'longest' });
    };

    it('recusa QUALQUER magia — cura inclusive — com `feared` e o prazo do medo, antes de tudo', () => {
      const caster = hero({ health: 10, level: 1 });
      fear(caster, 3_000);
      // Antes do level (`heal` do fixture exige level 1, `strike` mais) e antes do alvo: a
      // primeira coisa que `playerSpellCheck` confere, depois das flags de grupo, é o medo.
      expect(castSpell(caster, heal, null, 1_000, combat, rng()))
        .toEqual({ ok: false, reason: 'feared', retryInMs: 2_000 });
      expect(castSpell(caster, strike, null, 1_000, combat, rng()))
        .toEqual({ ok: false, reason: 'feared', retryInMs: 2_000 });
      expect(caster.mana).toBe(100);
      // Vencido o medo, a mesma cura sai.
      expect(castSpell(caster, heal, null, 3_000, combat, rng()).ok).toBe(true);
    });
  });

  it('sem alma, recusa — pela MESMA regra da mana (#593)', () => {
    const caster = hero({ soul: 2 });
    const costly: Spell = { ...heal, soulCost: 3 };
    expect(castSpell(caster, costly, null, 0, combat, rng()))
      .toEqual({ ok: false, reason: 'not-enough-soul', retryInMs: 0 });
    // Nada foi gasto: a recusa não fica devendo.
    expect(caster.mana).toBe(100);
    expect(caster.soul).toBe(2);
  });

  it('com alma suficiente, a magia gasta o custo declarado', () => {
    const caster = hero({ soul: 5 });
    const costly: Spell = { ...heal, soulCost: 3 };
    expect(castSpell(caster, costly, null, 0, combat, rng()).ok).toBe(true);
    expect(caster.soul).toBe(2);
  });
});

describe('useSupply — medo e pacificação alcançam a RUNA, não a poção (#622)', () => {
  const attackRune: Supply = {
    id: 'sudden-death-rune', name: 'Sudden Death', price: 20, group: 'attack', groupCooldownMs: 2_000,
    requires: {}, effect: { kind: 'damage', basePower: 45, range: 4, damageType: 'death' },
  };
  const healingRune: Supply = {
    id: 'uh-rune', name: 'Ultimate Healing Rune', price: 20, group: 'healing', groupCooldownMs: 1_000,
    requires: {}, effect: { kind: 'heal', amount: 60 },
  };
  const fieldRune: Supply = {
    id: 'fire-field-rune', name: 'Fire Field', price: 10, group: 'attack', groupCooldownMs: 2_000,
    requires: {}, effect: {
      kind: 'field', range: 4,
      field: { id: 'fire-field', durationMs: 5_000, shape: { shape: 'point' } },
    },
  };
  const antidote: Supply = {
    id: 'antidote-rune', name: 'Antidote', price: 15, group: 'healing', groupCooldownMs: 1_000,
    requires: {}, effect: { kind: 'dispel', types: ['poison'] },
  };
  const aim = { distance: 2, targets: [{ armor: 0, dodgeChance: 0 }] };
  const scaling = { skillLevel: 10, powerScale: 1 };
  const condition = (key: string, expiresAtMs: number) => ({ key, expiresAtMs, merge: 'longest' as const });

  it('feared recusa TODA runa (cura inclusive) e não gasta nada — mas a poção sai', () => {
    const user = hero({ gold: 200, health: 10 });
    user.conditions.apply(condition('feared', 3_000));
    expect(useSupply(user, attackRune, aim, combat, rng(), scaling, undefined, undefined, 1_000))
      .toEqual({ ok: false, reason: 'feared', retryInMs: 2_000 });
    expect(useSupply(user, healingRune, null, combat, rng(), scaling, undefined, undefined, 1_000))
      .toEqual({ ok: false, reason: 'feared', retryInMs: 2_000 });
    expect(useSupply(user, antidote, null, combat, rng(), scaling, undefined, undefined, 1_000))
      .toEqual({ ok: false, reason: 'feared', retryInMs: 2_000 });
    expect(user.goldDelta).toBe(0);
    // A poção não passa por `Spell::playerSpellCheck` — continua liberada.
    expect(useSupply(user, potion, null, combat, rng(), scaling, undefined, undefined, 1_000).ok).toBe(true);
  });

  it('pacified recusa só a runa AGRESSIVA (dano e campo) com `attack-locked`; cura e antídoto passam', () => {
    const user = hero({ gold: 200, health: 10 });
    user.conditions.apply(condition('pacified', 2_000));
    expect(useSupply(user, attackRune, aim, combat, rng(), scaling, undefined, undefined, 500))
      .toEqual({ ok: false, reason: 'attack-locked', retryInMs: 1_500 });
    expect(useSupply(user, fieldRune, aim, combat, rng(), scaling, undefined, undefined, 500))
      .toEqual({ ok: false, reason: 'attack-locked', retryInMs: 1_500 });
    expect(useSupply(user, healingRune, null, combat, rng(), scaling, undefined, undefined, 500).ok).toBe(true);
    expect(useSupply(user, antidote, null, combat, rng(), scaling, undefined, undefined, 500).ok).toBe(true);
    // Vencida a condição, a runa de ataque sai.
    expect(useSupply(user, attackRune, aim, combat, rng(), scaling, undefined, undefined, 2_000).ok).toBe(true);
  });
});

describe('castSpell — Swift Foot: a haste que pacifica (#622, `swift_foot.lua`)', () => {
  const swiftFoot: Spell = {
    id: 'swift-foot', name: 'Swift Foot', manaCost: 20, cooldownMs: 10_000, minLevel: 1,
    effect: { kind: 'haste', speedPercent: 80, durationMs: 10_000, pacifies: true },
  };
  const plainHaste: Spell = {
    ...swiftFoot, id: 'haste', effect: { kind: 'haste', speedPercent: 30, durationMs: 10_000 },
  };

  it('devolve a haste E a pacificação, pelo MESMO prazo e com `merge: longest`', () => {
    const result = castSpell(hero(), swiftFoot, null, 1_000, combat, rng());
    expect(result.ok && result.condition).toMatchObject({ key: 'haste', speedPercent: 80, expiresAtMs: 11_000 });
    expect(result.ok && result.alsoConditions).toEqual([{
      key: 'pacified', spellId: 'swift-foot', expiresAtMs: 11_000, merge: 'longest',
    }]);
  });

  it('a haste comum não pacifica — `alsoConditions` nem existe', () => {
    const result = castSpell(hero(), plainHaste, null, 0, combat, rng());
    expect(result.ok && result.alsoConditions).toBeUndefined();
  });
});

describe('castSpell — o efeito', () => {
  it('cura devolve o quanto REPÔS, não o quanto o conteúdo prometia', () => {
    // Curar 60 em quem estava a 10 do teto é uma cura de 10. Contar 60 faria toda métrica de
    // eficiência de poção e magia mentir.
    const caster = hero({ health: 90 });
    const result = castSpell(caster, heal, null, 0, combat, rng());

    expect(result).toMatchObject({ ok: true, healed: 10, damage: 0 });
    expect(caster.health).toBe(100);
    expect(caster.mana).toBe(80);
  });

  it('dano sai RESOLVIDO e não aplicado: quem tem o alvo é quem o aplica', () => {
    // Aplicar é também atribuir (`recordDamage`) e resolver morte. Fazer isso aqui seria a
    // atribuição escrita em dois lugares, e o `AGENTS.md` deste pacote é explícito: não pague
    // duas vezes por saber quem matou.
    const caster = hero();
    const result = castSpell(caster, strike, near({ armor: 10, distance: 3 }), 0, combat, rng());

    // 40 de poder, 10 de armadura, efetividade mágica 1 neste conteúdo de teste.
    expect(result).toMatchObject({ ok: true, damage: 30, hits: [30], healed: 0 });
    expect(caster.mana).toBe(85);
  });
});

describe('castSpell — Challenge (#589): o mesmo portão de dano, sem golpe nenhum', () => {
  it('recusa abaixo do level mínimo, sem gastar mana', () => {
    const caster = hero({ level: 1 });
    expect(castSpell(caster, challenge, near(), 0, combat, rng()))
      .toEqual({ ok: false, reason: 'level-too-low', retryInMs: 0 });
    expect(caster.mana).toBe(100);
  });

  it('recusa em cooldown, com o prazo restante', () => {
    const caster = hero({ level: 30 });
    expect(castSpell(caster, challenge, near(), 0, combat, rng()).ok).toBe(true);
    expect(castSpell(caster, challenge, near(), 400, combat, rng()))
      .toEqual({ ok: false, reason: 'on-cooldown', retryInMs: 1_600 });
  });

  it('sem alvo é `no-target`, e fora de alcance é `out-of-range` — mesma ordem de `damage`', () => {
    const caster = hero({ level: 30 });
    expect(castSpell(caster, challenge, null, 0, combat, rng()))
      .toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
    expect(castSpell(caster, challenge, near({ distance: 4 }), 0, combat, rng()))
      .toEqual({ ok: false, reason: 'out-of-range', retryInMs: 0 });
    expect(caster.mana).toBe(100);
  });

  it('sem mana suficiente, recusa depois de conferir o alvo', () => {
    const caster = hero({ level: 30, mana: 5 });
    expect(castSpell(caster, challenge, near(), 0, combat, rng()))
      .toEqual({ ok: false, reason: 'not-enough-mana', retryInMs: 0 });
  });

  it('sucesso não causa dano nem cura — o efeito é todo do ruleset, que tem os monstros atingidos', () => {
    const caster = hero({ level: 30 });
    const result = castSpell(caster, challenge, near(), 0, combat, rng());
    expect(result).toEqual({ ok: true, healed: 0, manaRestored: 0, damage: 0, hits: [], goldSpent: 0 });
    expect(caster.mana).toBe(70);
  });
});

describe('castSpell/useSupply — dispel (#590, Cure Poison e afins)', () => {
  const curePoison: Spell = {
    ...heal, id: 'cure-poison', effect: { kind: 'dispel', types: ['poison'] },
  };
  const fairWoundCleansing: Spell = {
    ...heal, id: 'fair-wound-cleansing',
    effect: { kind: 'heal', amount: 40, dispel: { types: ['paralyze'] } },
  };
  const antidoteRune: Supply = {
    id: 'antidote-rune', name: 'Antidote Rune', price: 15, group: 'healing',
    groupCooldownMs: 1_000, requires: {}, effect: { kind: 'dispel', types: ['poison'] },
  };

  it('a magia de dispel puro devolve as chaves, sem curar e sem gastar sorteio', () => {
    const caster = hero();
    const result = castSpell(caster, curePoison, null, 0, combat, rng());
    expect(result).toEqual({
      ok: true, healed: 0, manaRestored: 0, damage: 0, hits: [], goldSpent: 0, dispel: ['poison'],
    });
    expect(caster.mana).toBe(80); // gastou a mana da magia (§4.4, `heal.manaCost`), como sempre.
  });

  it('a cura composta cura E devolve o dispel no MESMO lançamento', () => {
    const caster = hero({ health: 50 });
    const result = castSpell(caster, fairWoundCleansing, null, 0, combat, rng());
    expect(result).toMatchObject({ ok: true, healed: 40, dispel: ['paralyze'] });
  });

  it('magia sem `dispel` declarado continua sem o campo — não inventa remoção', () => {
    const result = castSpell(hero(), heal, null, 0, combat, rng());
    expect(result.ok && result.dispel).toBeUndefined();
  });

  it('useSupply: a runa de dispel puro cobra gold e devolve as chaves, sem cura', () => {
    const user = hero({ gold: 100 });
    const result = useSupply(user, antidoteRune, null, combat, rng());
    expect(result).toMatchObject({ ok: true, healed: 0, goldSpent: 15, dispel: ['poison'] });
    expect(balanceOf(user)).toBe(85);
  });

  it('a runa de dispel recusa sem gold, como qualquer supply — e não devolve dispel nenhum', () => {
    const user = hero({ gold: 0 });
    const result = useSupply(user, antidoteRune, null, combat, rng());
    expect(result).toEqual({ ok: false, reason: 'not-enough-gold', retryInMs: 0 });
  });
});

describe('castSpell/useSupply — Paralyze Rune e Invisibility (#592)', () => {
  const invisibility: Spell = {
    ...heal, id: 'invisibility-druid', manaCost: 440, minLevel: 35,
    effect: { kind: 'invisible', durationMs: 200_000 },
  };
  const paralyzeRune: Supply = {
    id: 'paralyze-rune', name: 'Paralyze Rune', price: 700, group: 'support',
    groupCooldownMs: 2_000, cooldownMs: 6_000, requires: { level: 54, magicLevel: 18 },
    effect: {
      kind: 'condition', target: 'enemy', range: 3,
      condition: {
        key: 'speed', merge: 'strongest', durationMs: 6_000,
        effect: { kind: 'speed', type: 'paralyze', formula: { mina: -1, minb: 0, maxa: -1, maxb: 0 } },
      },
    },
  };
  /** A mira de um MONSTRO, com `speed`/`creatureId` — o que a runa de condição precisa. */
  const monsterAim = (speed: number, distance = 1) => ({
    distance,
    targets: [{ armor: 0, dodgeChance: 0, creatureId: 'm:1', speed }],
  });
  const scaling: SpellScaling = { skillLevel: 20, powerScale: 1 };

  it('Invisibility devolve a condição `invisible` no LANÇADOR, sem curar nem gastar sorteio', () => {
    const caster = hero({ mana: 500, level: 40 });
    const result = castSpell(caster, invisibility, null, 1_000, combat, rng(), scaling);
    expect(result).toMatchObject({
      ok: true, healed: 0, damage: 0, hits: [],
      condition: { key: 'invisible', spellId: 'invisibility-druid', expiresAtMs: 201_000 },
    });
    expect(caster.mana).toBe(60); // 500 - 440 (§4.4, `invisibility.manaCost`).
  });

  it('Invisibility recusa sem mana — 440 é mais que o hero de teste tem por padrão', () => {
    const caster = hero({ mana: 100, level: 40 });
    const result = castSpell(caster, invisibility, null, 0, combat, rng(), scaling);
    expect(result).toEqual({ ok: false, reason: 'not-enough-mana', retryInMs: 0 });
  });

  it('Paralyze Rune mira o MONSTRO: devolve a condição `speed` com o alvo dele, não o do usuário', () => {
    const user = hero({ gold: 1_000, level: 60 });
    const result = useSupply(
      user, paralyzeRune, monsterAim(220), combat, rng(), scaling, undefined, undefined, 1_000,
    );
    expect(result).toMatchObject({
      ok: true, healed: 0, damage: 0, hits: [], goldSpent: 700,
      condition: { key: 'speed', targetId: 'm:1', sourceId: 'hero' },
    });
    // baseSpeed 220, formula (-1,0,-1,0): min=max=40-220=-180, speedDelta antes do piso
    // = -180-220 = -400, piso 40-220=-180 vence — a mesma matemática de `conditions.test.ts`.
    expect((result as { ok: true; condition?: { speedPercent?: number } }).condition?.speedPercent)
      .toBeCloseTo((-180 / 220) * 100);
  });

  it('Paralyze Rune recusa sem alvo, como a runa de ataque', () => {
    const user = hero({ gold: 1_000, level: 60 });
    const result = useSupply(user, paralyzeRune, null, combat, rng(), scaling, undefined, undefined, 1_000);
    expect(result).toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
  });

  it('Paralyze Rune tem cooldown PRÓPRIO de 6s, além do grupo de 2s (#592)', () => {
    const user = hero({ gold: 10_000, level: 60 });
    const first = useSupply(
      user, paralyzeRune, monsterAim(220), combat, rng(), scaling, undefined, undefined, 0,
    );
    expect(first.ok).toBe(true);
    // 3s depois: o GRUPO (2s) já venceu, mas o livro PRÓPRIO (6s) ainda tranca — sem isto a
    // runa recarregaria no ritmo do grupo, e o #592 existe exatamente para essa diferença.
    const second = useSupply(
      user, paralyzeRune, monsterAim(220), combat, rng(), scaling, undefined, undefined, 3_000,
    );
    expect(second).toMatchObject({ ok: false, reason: 'on-cooldown' });
    const third = useSupply(
      user, paralyzeRune, monsterAim(220), combat, rng(), scaling, undefined, undefined, 6_000,
    );
    expect(third.ok).toBe(true);
  });
});

describe('useSupply — gold, e o saldo que nunca fica negativo', () => {
  it('debita o preço do delta da sessão e diz quanto gastou', () => {
    const user = hero({ health: 50, gold: 100 });
    const result = useSupply(user, potion);

    expect(result).toMatchObject({ ok: true, healed: 50, goldSpent: 45 });
    expect(user.goldDelta).toBe(-45);
    expect(balanceOf(user)).toBe(55);
  });

  it('poção de mana repõe MANA, e não vida', () => {
    const user = hero({ health: 50, mana: 10, gold: 100 });
    expect(useSupply(user, manaPotion)).toMatchObject({ ok: true, manaRestored: 90, healed: 0 });
    expect(user.health).toBe(50);
    expect(user.mana).toBe(100);
  });

  it('o saldo é o de ENTRADA mais o delta: loot desta sessão já dá para gastar', () => {
    // Gold ganho na hunt é gastável na hunt. Exigir que ele passasse pelo banco antes seria
    // o oposto do idle-first: a poção só chegaria depois de encerrar a sessão.
    const user = hero({ gold: 0, goldDelta: 60 });
    expect(useSupply(user, potion).ok).toBe(true);
    expect(balanceOf(user)).toBe(15);
  });

  it('recusa quando falta gold, e NADA é debitado', () => {
    // O saldo nunca fica negativo, e a garantia é a ordem: recusar antes, não corrigir depois.
    const user = hero({ health: 10, gold: 44 });
    expect(useSupply(user, potion))
      .toEqual({ ok: false, reason: 'not-enough-gold', retryInMs: 0 });
    expect(user.goldDelta).toBe(0);
    expect(user.health).toBe(10);
  });

  it('o preço exato PASSA — a recusa é por falta, não por chegar no limite', () => {
    const user = hero({ gold: 45 });
    expect(useSupply(user, potion).ok).toBe(true);
    expect(balanceOf(user)).toBe(0);
  });
});

describe('useSupply — o ESTOQUE do loot é gasto antes do gold (#520, revisão do #536)', () => {
  it('com estoque, usa SEM debitar gold nenhum — `goldSpent` sai 0', () => {
    const user = hero({ health: 50, gold: 0 });
    user.supplyStock.set('health-potion', 2);
    const result = useSupply(user, potion);

    expect(result).toMatchObject({ ok: true, healed: 50, goldSpent: 0 });
    expect(user.goldDelta).toBe(0);
    expect(balanceOf(user)).toBe(0);
    expect(user.supplyStock.get('health-potion')).toBe(1);
  });

  it('esgota o estoque em 1 unidade: a chave some do Map ao zerar', () => {
    // `Map` sem a chave, não `0` guardado — o mesmo cuidado de `Cooldowns`/`ammo`: uma chave
    // com valor 0 sobreviveria ao snapshot como "tem estoque zero" em vez de "não tem estoque".
    const user = hero({ health: 50, gold: 100 });
    user.supplyStock.set('health-potion', 1);
    useSupply(user, potion);
    expect(user.supplyStock.has('health-potion')).toBe(false);
    // E o gold NÃO foi tocado nesse uso — só o estoque.
    expect(user.goldDelta).toBe(0);
  });

  it('sem estoque, cai no gold de sempre — `goldSpent` sai o preço cheio', () => {
    const user = hero({ health: 50, gold: 100 });
    const result = useSupply(user, potion);
    expect(result).toMatchObject({ ok: true, goldSpent: 45 });
    expect(user.goldDelta).toBe(-45);
  });

  it('com estoque MAS sem gold, ainda assim usa: o estoque não depende do saldo', () => {
    const user = hero({ health: 50, gold: 0, goldDelta: 0 });
    user.supplyStock.set('health-potion', 1);
    expect(useSupply(user, potion).ok).toBe(true);
    expect(balanceOf(user)).toBe(0);
  });

  it('sem estoque e sem gold, recusa como sempre — o estoque não inventa saldo', () => {
    const user = hero({ health: 10, gold: 44 });
    expect(useSupply(user, potion))
      .toEqual({ ok: false, reason: 'not-enough-gold', retryInMs: 0 });
    expect(user.supplyStock.size).toBe(0);
  });

  it('o estoque de mana potion é um id DIFERENTE — não compartilha contador com a de vida', () => {
    const user = hero({ mana: 10, gold: 0 });
    user.supplyStock.set('mana-potion', 1);
    expect(useSupply(user, manaPotion)).toMatchObject({ ok: true, goldSpent: 0 });
    expect(user.supplyStock.has('health-potion')).toBe(false);
    expect(user.supplyStock.has('mana-potion')).toBe(false);
  });
});

describe('cura em outro personagem (#399, ADR 0035 d.10)', () => {
  it('castSpell: o RECIPIENT recebe a cura, quem lança paga a mana (RF-04)', () => {
    const caster = hero({ mana: 100 });
    const recipient = hero({ health: 10 });

    const result = castSpell(caster, heal, null, 0, combat, rng(), undefined, recipient);

    expect(result).toMatchObject({ ok: true, healed: 60 });
    expect(recipient.health).toBe(70);
    // O lançador fica intacto de vida e paga a mana — o benefício viaja, o custo não.
    expect(caster.health).toBe(100);
    expect(caster.mana).toBe(80);
  });

  it('useSupply: o RECIPIENT recebe vida/mana, quem usa paga o gold (RF-04)', () => {
    const user = hero({ health: 100, mana: 0, gold: 100 });
    const recipient = hero({ health: 0, mana: 0 });

    const life = useSupply(user, potion, null, undefined, undefined, undefined, undefined, recipient);
    expect(life).toMatchObject({ ok: true, healed: 80, goldSpent: 45 });
    expect(recipient.health).toBe(80);
    expect(user.health).toBe(100);
    expect(user.goldDelta).toBe(-45);

    const mana = useSupply(user, manaPotion, null, undefined, undefined, undefined, undefined, recipient);
    expect(mana).toMatchObject({ ok: true, manaRestored: 100, goldSpent: 50 });
    expect(recipient.mana).toBe(100);
    expect(user.goldDelta).toBe(-95);
  });
});

describe('magia em ÁREA (FUN-92)', () => {
  const blast = {
    id: 'blast', name: 'Explosão', manaCost: 60, cooldownMs: 4_000, minLevel: 1,
    effect: { kind: 'damage' as const, power: 30, range: 4, damageType: 'fire' as const, area: { shape: 'circle' as const, radius: 1, centered: 'target' as const } },
  };
  const aim = (targets: readonly { armor: number; dodgeChance: number }[], distance = 2) =>
    ({ distance, targets });

  it('resolve uma rolagem POR ALVO, e devolve o dano de cada um em ordem', () => {
    const caster = hero();
    const result = castSpell(
      caster, blast, aim([{ armor: 0, dodgeChance: 0 }, { armor: 10, dodgeChance: 0 }]),
      0, combat, rng(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Armaduras diferentes, danos diferentes — e na mesma ordem em que os alvos entraram.
    expect(result.hits).toEqual([30, 20]);
    expect(result.damage).toBe(50);
  });

  it('a ordem dos alvos é CONTRATO: ela decide qual sorteio cai em quem', () => {
    // Cada alvo consome uma rolagem do RNG da sessão. Trocar a ordem troca o resultado, e é
    // por isso que quem colhe os alvos tem de fazê-lo sempre na mesma ordem.
    const esquiva = [{ armor: 0, dodgeChance: 0.5 }, { armor: 0, dodgeChance: 0 }];
    const direto = castSpell(hero(), blast, aim(esquiva), 0, combat, rng());
    const trocado = castSpell(hero(), blast, aim([...esquiva].reverse()), 0, combat, rng());

    if (!direto.ok || !trocado.ok) throw new Error('esperava dois lançamentos');
    expect(direto.hits).not.toEqual([...trocado.hits].reverse());
  });

  it('a mesma mira, com a mesma semente, dá o MESMO resultado', () => {
    const alvos = [
      { armor: 0, dodgeChance: 0.5 }, { armor: 2, dodgeChance: 0.5 },
      { armor: 4, dodgeChance: 0.5 },
    ];
    const uma = castSpell(hero(), blast, aim(alvos), 0, combat, rng());
    const outra = castSpell(hero(), blast, aim(alvos), 0, combat, rng());
    if (!uma.ok || !outra.ok) throw new Error('esperava dois lançamentos');
    expect(uma.hits).toEqual(outra.hits);
  });

  it('custa a mesma mana batendo em um ou em cinco', () => {
    // O custo é da MAGIA, não do número de alvos. Cobrar por alvo faria o jogador pagar mais
    // por lançar no lugar certo, que é o inverso do que uma magia de área quer ensinar.
    const um = hero();
    const cinco = hero();
    castSpell(um, blast, aim([{ armor: 0, dodgeChance: 0 }]), 0, combat, rng());
    castSpell(
      cinco, blast,
      aim(Array.from({ length: 5 }, () => ({ armor: 0, dodgeChance: 0 }))),
      0, combat, rng(),
    );
    expect(um.mana).toBe(cinco.mana);
  });

  it('mira vazia é recusada como "sem alvo"', () => {
    expect(castSpell(hero(), blast, aim([]), 0, combat, rng()))
      .toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
  });

  it('só o alvo PRINCIPAL é conferido contra o alcance', () => {
    // Quem foi pego pela área está lá porque cai dentro do raio, não porque o lançador o
    // alcança. Conferir cada um contra o alcance faria a área encolher para o alcance.
    const dentro = castSpell(
      hero(), blast, aim([{ armor: 0, dodgeChance: 0 }], 4), 0, combat, rng(),
    );
    expect(dentro.ok).toBe(true);
    expect(castSpell(hero(), blast, aim([{ armor: 0, dodgeChance: 0 }], 5), 0, combat, rng()))
      .toEqual({ ok: false, reason: 'out-of-range', retryInMs: 0 });
  });
});

describe('crítico do LANÇADOR (M30-04, #551): o Canary rola para magia como para o golpe básico', () => {
  it('sem modificadores (o de sempre), o dano não muda com a semente do golpe crítico', () => {
    const semCritico = castSpell(hero(), strike, near(), 0, combat, rng());
    if (!semCritico.ok) throw new Error('esperava lançar');
    expect(semCritico.damage).toBe(40);
  });

  it('modifiers declarado dobra o dano quando o crítico ativa', () => {
    const comCritico = castSpell(
      hero(), strike, near(), 0, combat, rng(), undefined, undefined,
      { critical: { chance: 1, multiplier: 2 } },
    );
    if (!comCritico.ok) throw new Error('esperava lançar');
    expect(comCritico.damage).toBe(80);
  });

  it('vale também para magia em ÁREA — a 100% de chance, TODO alvo critica junto', () => {
    const blast = {
      id: 'blast', name: 'Explosão', manaCost: 60, cooldownMs: 4_000, minLevel: 1,
      effect: { kind: 'damage' as const, power: 30, range: 4, damageType: 'fire' as const, area: { shape: 'circle' as const, radius: 1, centered: 'target' as const } },
    };
    const aim = (targets: readonly { armor: number; dodgeChance: number }[], distance = 2) =>
      ({ distance, targets });
    const result = castSpell(
      hero(), blast, aim([{ armor: 0, dodgeChance: 0 }, { armor: 0, dodgeChance: 0 }]),
      0, combat, rng(), undefined, undefined, { critical: { chance: 1, multiplier: 2 } },
    );
    if (!result.ok) throw new Error('esperava lançar');
    expect(result.hits).toEqual([60, 60]);
  });

  it('o crítico é da AÇÃO, não do alvo: com chance PARCIAL os alvos da MESMA magia nunca '
    + 'se dividem (achado da revisão do #551/#653)', () => {
    // `Combat::applyExtensions` do Canary rola uma vez por `doCombat` inteiro (combat.cpp:2657) e
    // aplica o MESMO resultado a todo alvo da área — nunca um crítico e outro não na mesma magia
    // (fora do charm "low blow", fora de escopo). Com `chance: 0.5` e 3 alvos, um sorteio POR
    // ALVO renderia misturas (~37,5% das vezes, por `1 - 0.5^3 - (1-0.5)^3`); a correção faz o
    // resultado da rolagem única se repetir nos três `hits`.
    const blast = {
      id: 'blast', name: 'Explosão', manaCost: 60, cooldownMs: 4_000, minLevel: 1,
      effect: { kind: 'damage' as const, power: 30, range: 4, damageType: 'fire' as const, area: { shape: 'circle' as const, radius: 1, centered: 'target' as const } },
    };
    const aim = (targets: readonly { armor: number; dodgeChance: number }[], distance = 2) =>
      ({ distance, targets });
    const targets = [
      { armor: 0, dodgeChance: 0 }, { armor: 0, dodgeChance: 0 }, { armor: 0, dodgeChance: 0 },
    ];
    const outcomes = new Set<number>();
    for (let seed = 0; seed < 40; seed += 1) {
      const result = castSpell(
        hero(), blast, aim(targets), 0, combat, Rng.fromSeed(`area-crit-shared-${seed}`),
        undefined, undefined, { critical: { chance: 0.5, multiplier: 2 } },
      );
      if (!result.ok) throw new Error('esperava lançar');
      // Os três alvos da MESMA magia sempre concordam: 30/30/30 (sem crítico) ou 60/60/60
      // (crítico) — nunca uma mistura.
      expect(new Set(result.hits).size).toBe(1);
      outcomes.add(result.hits[0] as number);
    }
    // As duas saídas realmente ocorrem entre as sementes — não é sempre a mesma por acidente
    // (o que esconderia um "sempre falso"/"sempre verdadeiro" como bug disfarçado de correção).
    expect(outcomes).toEqual(new Set([30, 60]));
  });
});

describe('charms passivos do lançador por ALVO (#603): Low Blow, Savage Blow e leech', () => {
  const blast = {
    id: 'blast', name: 'Explosão', manaCost: 60, cooldownMs: 4_000, minLevel: 1,
    effect: { kind: 'damage' as const, power: 30, range: 4, damageType: 'fire' as const, area: { shape: 'circle' as const, radius: 1, centered: 'target' as const } },
  };
  const plain = { armor: 0, dodgeChance: 0 };
  const ofMonster = (monsterId: string, bonus: { lowBlow?: number; savageBlow?: number; lifeLeech?: number }) =>
    ({ armor: 0, dodgeChance: 0, charm: { monsterId, ...bonus } });
  const base = { critical: { chance: 0, multiplier: 2 } };

  it('Low Blow (chance 1): o crítico base falhou, o charm abre — só o alvo do charm critica', () => {
    const result = castSpell(
      hero(), blast,
      { distance: 2, targets: [ofMonster('rat', { lowBlow: 1 }), plain, ofMonster('rat', { lowBlow: 1 })] },
      0, combat, rng(), undefined, undefined, base,
    );
    if (!result.ok) throw new Error('esperava lançar');
    expect(result.hits).toEqual([60, 30, 60]);
  });

  it('Low Blow: os alvos do MESMO monstro dividem UM sorteio (o `lowBlowCrits` do Canary)', () => {
    // Com chance parcial e três ratos, um sorteio por alvo daria misturas; um por monstro-alvo,
    // nunca — em nenhuma semente.
    const outcomes = new Set<number>();
    for (let seed = 0; seed < 60; seed += 1) {
      const result = castSpell(
        hero(), blast,
        { distance: 2, targets: [ofMonster('rat', { lowBlow: 0.5 }), ofMonster('rat', { lowBlow: 0.5 }), ofMonster('rat', { lowBlow: 0.5 })] },
        0, combat, Rng.fromSeed(`low-blow-${seed}`), undefined, undefined, base,
      );
      if (!result.ok) throw new Error('esperava lançar');
      expect(new Set(result.hits).size).toBe(1);
      outcomes.add(result.hits[0] as number);
    }
    expect(outcomes).toEqual(new Set([30, 60]));
  });

  it('Savage Blow soma ao multiplicador do crítico (2 + 0,5) só do alvo do charm', () => {
    const result = castSpell(
      hero(), blast,
      { distance: 2, targets: [ofMonster('rat', { savageBlow: 0.5 }), plain] },
      0, combat, rng(), undefined, undefined, { critical: { chance: 1, multiplier: 2 } },
    );
    if (!result.ok) throw new Error('esperava lançar');
    expect(result.hits).toEqual([75, 60]);
  });

  it('o leech do charm chega ao intent do alvo, sem tocar o dos outros', () => {
    const result = castSpell(
      hero(), blast,
      { distance: 2, targets: [ofMonster('rat', { lifeLeech: 0.05 }), plain] },
      0, combat, rng(),
    );
    if (!result.ok) throw new Error('esperava lançar');
    expect(result.hitOutcomes?.[0]?.intent.modifiers?.lifeLeech).toBe(0.05);
    expect(result.hitOutcomes?.[1]?.intent.modifiers).toBeUndefined();
  });

  it('sem charm em alvo nenhum, o resultado é o de sempre — mesmo dano, mesmo estado do Rng', () => {
    const a = rng();
    const b = rng();
    const withField = castSpell(
      hero(), blast, { distance: 2, targets: [plain, plain] }, 0, combat, a, undefined, undefined, base,
    );
    const legacy = castSpell(
      hero(), blast, { distance: 2, targets: [{ armor: 0, dodgeChance: 0 }, { armor: 0, dodgeChance: 0 }] },
      0, combat, b, undefined, undefined, base,
    );
    if (!withField.ok || !legacy.ok) throw new Error('esperava lançar');
    expect(withField.hits).toEqual(legacy.hits);
    expect(a.getState()).toEqual(b.getState());
  });
});

describe('requisito de VOCAÇÃO (FUN-92)', () => {
  const druidica = { ...heal, id: 'nature-heal', vocationId: 'druid' };

  it('recusa quem não tem a vocação, e nada é cobrado', () => {
    const cavaleiro = hero({ level: 20 });
    cavaleiro.vocationId = 'knight';
    expect(castSpell(cavaleiro, druidica, null, 0, combat, rng()))
      .toEqual({ ok: false, reason: 'wrong-vocation', retryInMs: 0 });
    expect(cavaleiro.mana).toBe(100);
  });

  it('quem TEM a vocação lança normalmente', () => {
    const druida = hero({ level: 20, health: 50 });
    druida.vocationId = 'druid';
    expect(castSpell(druida, druidica, null, 0, combat, rng()).ok).toBe(true);
  });

  it('personagem SEM vocação não lança magia de vocação — e é por construção', () => {
    // O personagem nasce sem vocação e escolhe no level 8 (§7.4). Uma magia com requisito é
    // inacessível até lá sem nenhuma regra escrita em outro lugar.
    const novato = hero({ level: 1 });
    expect(novato.vocationId).toBeNull();
    expect(castSpell(novato, druidica, null, 0, combat, rng()).ok).toBe(false);
  });

  it('magia SEM requisito continua valendo para todo mundo', () => {
    const novato = hero({ health: 50 });
    expect(castSpell(novato, heal, null, 0, combat, rng()).ok).toBe(true);
  });

  it('a recusa por vocação NÃO tem prazo — esperar não faz ninguém virar druida', () => {
    const cavaleiro = hero();
    cavaleiro.vocationId = 'knight';
    const recusa = castSpell(cavaleiro, druidica, null, 0, combat, rng());
    expect(recusa.ok).toBe(false);
    if (!recusa.ok) expect(recusa.retryInMs).toBe(0);
  });
});

describe('o catálogo do Tibia (#155, ADR 0026 decisão 5)', () => {
  // A conversão do Base Power (`spellPowerRange`) migrou para `@draconya/content` (#436, ADR
  // 0033) — o cliente precisa dela para a prévia sem importar `sim`. O teste da fórmula em si
  // mora em `packages/content/src/spell-power.test.ts`; aqui fica só a integração com `castSpell`.
  it('a basePower spell rolls in the range and does NOT stack the per-use skill multiplier (DT-03)', () => {
    const bp: Spell = { ...heal, id: 'light-healing', effect: { kind: 'heal', basePower: 40 } };
    const caster = hero({ level: 8, health: 1 });
    const result = castSpell(caster, bp, null, 0, combat, rng(), { skillLevel: 0, powerScale: 10 });
    expect(result.ok && result.healed).toBeGreaterThanOrEqual(50);
    expect(result.ok && result.healed).toBeLessThanOrEqual(69);
    // O fixo continua escalando pelas skills por uso.
    const fixed = castSpell(hero({ level: 8, health: 1 }), heal, null, 0, combat, rng(), { skillLevel: 0, powerScale: 1.5 });
    expect(fixed.ok && fixed.healed).toBe(90);
  });

  it('the group locks every spell of the group, the secondary only its own, and no mana leaves on refusal', () => {
    const flame: Spell = {
      ...strike, id: 'flame-strike', group: 'attack', groupCooldownMs: 2_000, cooldownMs: 2_000,
      effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'fire' },
    };
    const beam: Spell = {
      ...flame, id: 'great-energy-beam', groupCooldownMs: 2_000, cooldownMs: 6_000,
      secondaryGroup: { name: 'great-beams', cooldownMs: 6_000 },
      effect: { kind: 'damage', basePower: 155, area: { shape: 'beam', length: 8 }, damageType: 'energy' },
    };
    const deathBeam: Spell = { ...beam, id: 'great-death-beam' };
    const stance: Spell = {
      ...heal, id: 'blood-rage', manaCost: 20, group: 'support', groupCooldownMs: 2_000,
      secondaryGroup: { name: 'stance', cooldownMs: 2_000 },
      effect: { kind: 'buff', durationMs: 10_000, damageDealtPercent: { melee: 25 }, damageTakenPercent: 15 },
    };
    const caster = hero({ level: 80, mana: 1_000 });

    expect(castSpell(caster, beam, near(), 0, combat, rng()).ok).toBe(true);
    // O grupo `attack` trancou por 2 s: a outra magia do grupo espera, com o prazo.
    expect(castSpell(caster, flame, near(), 500, combat, rng()))
      .toEqual({ ok: false, reason: 'group-cooldown', retryInMs: 1_500 });
    // O secundário `great-beams` tranca por 6 s — e só as que o têm.
    expect(castSpell(caster, deathBeam, near(), 2_000, combat, rng()))
      .toEqual({ ok: false, reason: 'group-cooldown', retryInMs: 4_000 });
    expect(castSpell(caster, flame, near(), 2_000, combat, rng()).ok).toBe(true);
    // A postura é de outro grupo: passa, e devolve a condição SEM aplicar nada.
    const manaBefore = caster.mana;
    const buffed = castSpell(caster, stance, null, 2_000, combat, rng());
    expect(buffed.ok && buffed.condition).toEqual({
      key: 'buff', spellId: 'blood-rage', expiresAtMs: 12_000,
      damageDealtPercent: { melee: 25 }, damageTakenPercent: 15,
    });
    expect(caster.mana).toBe(manaBefore - 20);
    expect(caster.conditions.size).toBe(0);
    // Recusa por grupo não gasta mana.
    const before = caster.mana;
    expect(castSpell(caster, deathBeam, near(), 3_000, combat, rng()).ok).toBe(false);
    expect(caster.mana).toBe(before);
  });

  it('haste, mana shield and heal-over-time come back as conditions with the logical deadline', () => {
    const caster = hero({ level: 50, mana: 1_000 });
    const haste: Spell = { ...heal, id: 'haste', effect: { kind: 'haste', speedPercent: 30, durationMs: 30_000 } };
    const shield: Spell = { ...heal, id: 'magic-shield', effect: { kind: 'mana-shield', durationMs: 180_000 } };
    const recovery: Spell = { ...heal, id: 'recovery', effect: { kind: 'heal-over-time', amount: 20, intervalMs: 3_000, durationMs: 60_000 } };
    const at = (spell: Spell, now: number) => castSpell(caster, spell, null, now, combat, rng());
    expect(at(haste, 1_000)).toMatchObject({ ok: true, condition: { key: 'haste', expiresAtMs: 31_000, speedPercent: 30 } });
    expect(at(shield, 1_000)).toMatchObject({ ok: true, condition: { key: 'mana-shield', expiresAtMs: 181_000 } });
    expect(at(recovery, 1_000)).toMatchObject({
      ok: true, condition: { key: 'heal-over-time', expiresAtMs: 61_000, tick: { amount: 20, intervalMs: 3_000 } },
    });
  });

  it('remove-condition (#596: Cancel Magic Shield) devolve a chave e NÃO agenda condição nenhuma', () => {
    const caster = hero({ level: 20, mana: 1_000 });
    const cancel: Spell = { ...heal, id: 'cancel-magic-shield', manaCost: 50, effect: { kind: 'remove-condition', key: 'mana-shield' } };
    const result = castSpell(caster, cancel, null, 0, combat, rng());
    expect(result).toMatchObject({ ok: true, removeConditionKey: 'mana-shield' });
    // Ao contrário de `mana-shield`/`haste`/`heal-over-time` (acima), esta magia NÃO devolve
    // `condition` — não há nada para o ruleset agendar na fila de eventos.
    expect((result as { condition?: unknown }).condition).toBeUndefined();
    expect(caster.mana).toBe(1_000 - 50);
  });

  describe('alvo de party e custo escalado (#588: Heal/Protect/Enchant/Train Party)', () => {
    const healParty: Spell = {
      ...heal, id: 'heal-party', manaCost: { kind: 'party-scaled', base: 120, decay: 0.9 },
      effect: {
        kind: 'heal-over-time', amount: 20, intervalMs: 2_000, durationMs: 120_000, target: 'party', range: 36,
      },
    };
    const protectParty: Spell = {
      ...heal, id: 'protect-party', manaCost: { kind: 'party-scaled', base: 90, decay: 0.9 },
      effect: {
        kind: 'buff', durationMs: 120_000, skillDeltas: { shielding: 3 }, target: 'party', range: 36,
      },
    };

    it('refuses "no-target" with nobody else in range — the lone caster never pays', () => {
      const caster = hero({ level: 50, mana: 1_000 });
      // `partyTargets: []` é "colhido, e ninguém além do lançador está no alcance" — o
      // MESMO "No party members in range" do Canary com `tmp <= 1`.
      expect(castSpell(caster, healParty, null, 0, combat, rng(), undefined, undefined, undefined, []))
        .toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
      expect(castSpell(caster, healParty, null, 0, combat, rng(), undefined, undefined, undefined, [caster]))
        .toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
      // Mana intocada: a recusa vem ANTES do débito.
      expect(caster.mana).toBe(1_000);
    });

    it('refuses "no-target" when partyTargets is absent — a non-party call never pays either', () => {
      const caster = hero({ level: 50, mana: 1_000 });
      expect(castSpell(caster, healParty, null, 0, combat, rng())).toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
      expect(caster.mana).toBe(1_000);
    });

    it('charges the Canary formula, scaled by affectedCount — not the flat base', () => {
      const caster = hero({ level: 50, mana: 1_000 });
      const ally1 = hero({ level: 50, mana: 1_000 });
      const ally2 = hero({ level: 50, mana: 1_000 });
      // n = 3: ceil((0.9^2 * 120) * 3) = 292 — não os 120 do `base` de exibição.
      const result = castSpell(
        caster, healParty, null, 0, combat, rng(), undefined, undefined, undefined, [caster, ally1, ally2],
      );
      expect(result.ok).toBe(true);
      expect(caster.mana).toBe(1_000 - 292);
    });

    it('applies the SAME condition to every affected member, and only to them', () => {
      // O CHAMADOR (hunt.ts) é quem aplica a condição a cada membro — `castSpell` só a
      // DEVOLVE, uma vez, para quem chama replicar. Aqui confere-se que a condição devolvida
      // carrega os números certos (Protect Party: shielding +3, 2 minutos).
      const caster = hero({ level: 50, mana: 1_000 });
      const ally = hero({ level: 50, mana: 1_000 });
      const result = castSpell(
        caster, protectParty, null, 10_000, combat, rng(), undefined, undefined, undefined, [caster, ally],
      );
      expect(result.ok && result.condition).toEqual({
        key: 'buff', spellId: 'protect-party', expiresAtMs: 130_000, skillDeltas: { shielding: 3 },
      });
    });

    it('a plain numeric manaCost ignores affectedCount entirely', () => {
      // `partyTargets` presente mas o efeito não é `target: 'party'`: nenhuma checagem de
      // party roda, e o custo é o de sempre.
      const caster = hero({ level: 50, mana: 1_000 });
      const result = castSpell(caster, heal, null, 0, combat, rng(), undefined, undefined, undefined, [caster]);
      expect(result.ok).toBe(true);
      expect(caster.mana).toBe(1_000 - 20);
    });
  });

  it('a self-origin shape needs no range and no primary distance; the posture scales the spell hit', () => {
    const wave: Spell = {
      ...strike, id: 'fire-wave', effect: { kind: 'damage', power: 40, area: { shape: 'wave', length: 3 }, damageType: 'fire' },
    };
    const caster = hero({ level: 20 });
    // A mira vem com `distance: 0` e os alvos colhidos pela forma; o alcance não é conferido.
    const aim = { distance: 0, targets: [{ armor: 0, dodgeChance: 0 }, { armor: 0, dodgeChance: 0 }] };
    const plain = castSpell(caster, wave, aim, 0, combat, rng());
    expect(plain.ok && plain.hits).toHaveLength(2);
    caster.conditions.apply({ key: 'buff', spellId: 'x', expiresAtMs: 9_999, damageDealtPercent: { spell: -50 } });
    const halved = castSpell(caster, wave, aim, 5_000, combat, rng());
    if (!halved.ok || !plain.ok) throw new Error('lançamento recusado');
    expect(halved.damage).toBeLessThan(plain.damage);
  });
});

describe('a fórmula canônica do Canary (#474)', () => {
  // Ice Strike (`exori frigo`): min = level/5 + ML×1.403 + 8, max = level/5 + ML×2.203 + 13.
  // O `basePower` 45 continua no arquivo como número de exibição (ADR 0033); a fórmula vence.
  const canaryIceStrike: Spell = {
    ...strike, id: 'ice-strike', manaCost: 12, cooldownMs: 2_000,
    group: 'attack', groupCooldownMs: 2_000, minLevel: 8, vocationId: 'sorcerer',
    effect: {
      kind: 'damage', basePower: 45, range: 3, damageType: 'ice',
      formula: { levelFactor: 0.2, skillMin: 1.403, skillMax: 2.203, baseMin: 8, baseMax: 13 },
    },
  };
  const mage = (): CharacterRuntime => {
    const caster = hero({ level: 50, mana: 100 });
    caster.vocationId = 'sorcerer';
    return caster;
  };
  const scaling = { skillLevel: 40, powerScale: 1 };

  it('level 50 e ML 40 rendem a faixa Canary 74~111, não a do basePower', () => {
    const result = castSpell(mage(), canaryIceStrike, near({ distance: 3 }), 0, combat, rng(), scaling);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // min = 10 + 40×1.403 + 8 = 74; max = 10 + 40×2.203 + 13 = 111. Sem armadura o golpe é o
    // poder sorteado. Mutação que mata: cair no `basePower` (45) daria uma faixa de 382~518.
    expect(result.hits[0]).toBeGreaterThanOrEqual(74);
    expect(result.hits[0]).toBeLessThanOrEqual(111);
  });

  it('a fórmula VENCE o basePower, e a mana e o cooldown saem normalmente', () => {
    const caster = mage();
    const comFormula = castSpell(caster, canaryIceStrike, near({ distance: 3 }), 0, combat, rng(), scaling);
    const soBasePower = castSpell(
      mage(), { ...canaryIceStrike, effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'ice' } },
      near({ distance: 3 }), 0, combat, rng(), scaling,
    );
    expect(comFormula.ok && comFormula.hits[0]).toBeLessThanOrEqual(111);
    expect(soBasePower.ok && soBasePower.hits[0]).toBeGreaterThan(111);
    expect(caster.mana).toBe(88);
    expect(caster.cooldowns.isReady(spellCooldownKey('ice-strike'), 1_999)).toBe(false);
    expect(caster.cooldowns.isReady(spellCooldownKey('ice-strike'), 2_000)).toBe(true);
  });

  it('a fórmula consome exatamente os MESMOS sorteios que o basePower (ordem de RNG intacta)', () => {
    // Trocar a fórmula muda o NÚMERO do dano, nunca a posição/quantidade de sorteio: os dois
    // caminhos fazem UM `rng.integer` pelo poder, e o resolver canônico faz o resto. Se a
    // fórmula introduzisse um sorteio a mais, o estado do RNG divergiria aqui — e toda hunt
    // retomada da mesma semente passaria a render outra coisa (ADR 0031, DT-03).
    const formulaRng = rng();
    const baseRng = rng();
    castSpell(mage(), canaryIceStrike, near({ distance: 3 }), 0, combat, formulaRng, scaling);
    castSpell(
      mage(),
      { ...canaryIceStrike, effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'ice' } },
      near({ distance: 3 }), 0, combat, baseRng, scaling,
    );
    expect(formulaRng.getState()).toEqual(baseRng.getState());
  });

  it('sem mana a magia é recusada, a mana fica intacta e o cooldown NÃO é consumido (RF-04)', () => {
    const caster = hero({ level: 50, mana: 11 });
    caster.vocationId = 'sorcerer';
    expect(castSpell(caster, canaryIceStrike, near({ distance: 3 }), 0, combat, rng(), scaling))
      .toEqual({ ok: false, reason: 'not-enough-mana', retryInMs: 0 });
    expect(caster.mana).toBe(11);
    expect(caster.cooldowns.isReady(spellCooldownKey('ice-strike'), 0)).toBe(true);
    expect(caster.cooldowns.isReady('group:attack', 0)).toBe(true);
  });

  it('o grupo `attack` tranca as outras magias do grupo por 2000ms (RF-05)', () => {
    const caster = mage();
    expect(castSpell(caster, canaryIceStrike, near({ distance: 3 }), 0, combat, rng(), scaling).ok).toBe(true);
    const flame: Spell = { ...canaryIceStrike, id: 'flame-strike', effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'fire' } };
    expect(castSpell(caster, flame, near({ distance: 3 }), 500, combat, rng(), scaling))
      .toEqual({ ok: false, reason: 'group-cooldown', retryInMs: 1_500 });
    // No vencimento do grupo, outra magia do grupo passa — o cooldown é do GRUPO, não da magia.
    expect(castSpell(caster, flame, near({ distance: 3 }), 2_000, combat, rng(), scaling).ok).toBe(true);
  });
});

describe('a skill da fórmula: LEVELMAGIC lê o magic level, SKILLVALUE a da vocação (#677)', () => {
  // Paladin level 100, distance 100 e ML 20. Divine Caldera no Canary registra
  // `CALLBACK_PARAM_LEVELMAGICVALUE`: min = level/5 + ML×4, max = level/5 + ML×6.
  const divineCaldera: Spell = {
    id: 'divine-caldera', name: 'Divine Caldera', manaCost: 160, cooldownMs: 4_000, minLevel: 50,
    vocationId: 'paladin',
    effect: {
      kind: 'damage', basePower: 150, damageType: 'holy',
      area: { shape: 'circle', radius: 3, centered: 'caster' },
      formula: { levelFactor: 0.2, skillMin: 4, skillMax: 6, baseMin: 0, baseMax: 0, scaling: 'magic' },
    },
  };
  // Ethereal Spear registra `CALLBACK_PARAM_SKILLVALUE`: o termo é a distance, e a fórmula não
  // declara `scaling` (= `vocation`).
  const etherealSpear: Spell = {
    id: 'ethereal-spear', name: 'Ethereal Spear', manaCost: 25, cooldownMs: 2_000, minLevel: 23,
    vocationId: 'paladin',
    effect: {
      kind: 'damage', basePower: 25, range: 7, damageType: 'physical',
      formula: { levelFactor: 0.2, skillMin: 0.333333, skillMax: 1, baseMin: 8.333333, baseMax: 25 },
    },
  };
  const paladin = (): CharacterRuntime => {
    const caster = hero({ level: 100, mana: 1_000 });
    caster.vocationId = 'paladin';
    return caster;
  };
  const scaling = { skillLevel: 100, powerScale: 1, magicLevel: 20 };

  it('Divine Caldera com `scaling: magic` rende 100~140 pelo ML 20, não 420~620 pela distance', () => {
    const result = castSpell(paladin(), divineCaldera, near(), 0, combat, rng(), scaling);
    if (!result.ok) throw new Error('lançamento recusado');
    // min = 20 + 20×4 = 100; max = 20 + 20×6 = 140. Lendo a distance seria 420~620.
    expect(result.hits[0]).toBeGreaterThanOrEqual(100);
    expect(result.hits[0]).toBeLessThanOrEqual(140);
  });

  it('Ethereal Spear sem `scaling` continua lendo a skill da vocação (distance 100)', () => {
    const result = castSpell(paladin(), etherealSpear, near({ distance: 3 }), 0, combat, rng(), scaling);
    if (!result.ok) throw new Error('lançamento recusado');
    // min = 20 + 100×0.333333 + 8.33 ≈ 61.67; max = 20 + 100 + 25 = 145. A prova de que o ML
    // não entra: o mesmo lançamento com ML 500 sai idêntico (lendo o ML, o teto iria a 545).
    const outroMl = castSpell(paladin(), etherealSpear, near({ distance: 3 }), 0, combat, rng(),
      { ...scaling, magicLevel: 500 });
    if (!outroMl.ok) throw new Error('lançamento recusado');
    expect(result.hits).toEqual(outroMl.hits);
    expect(result.hits[0]).toBeGreaterThanOrEqual(61);
    expect(result.hits[0]).toBeLessThanOrEqual(145);
  });

  it('`scaling: magic` sem `magicLevel` na escala cai em `skillLevel` (o fallback das fixtures)', () => {
    const result = castSpell(paladin(), divineCaldera, near(), 0, combat, rng(), { skillLevel: 20, powerScale: 1 });
    if (!result.ok) throw new Error('lançamento recusado');
    expect(result.hits[0]).toBeGreaterThanOrEqual(100);
    expect(result.hits[0]).toBeLessThanOrEqual(140);
  });
});

describe('o ML especializado do elemento soma no termo de ML da fórmula (#680)', () => {
  // Level 100, ML 20. O que se mede é a FAIXA sorteada: `rng.integer(min, max)` é a primeira
  // rolagem do efeito (sem crítico declarado, nada sorteia antes).
  const firstRoll = (act: (random: Rng) => void): [number, number] => {
    const random = rng();
    const spy = vi.spyOn(random, 'integer');
    act(random);
    const call = spy.mock.calls[0];
    if (call === undefined) throw new Error('nenhum sorteio');
    return [call[0], call[1]];
  };
  const sorcerer = (): CharacterRuntime => hero({ level: 100, mana: 1_000 });
  const base: SpellScaling = { skillLevel: 20, powerScale: 1, magicLevel: 20 };
  // Fire Wave (`fire-wave.json`): LEVELMAGIC, min = level/5 + ML×1.25 + 4, max = level/5 + ML×2 + 12.
  const fireWave: Spell = {
    id: 'fire-wave', name: 'Fire Wave', manaCost: 25, cooldownMs: 4_000, minLevel: 18,
    effect: {
      kind: 'damage', basePower: 40, damageType: 'fire', area: { shape: 'wave', length: 3 },
      formula: { levelFactor: 0.2, skillMin: 1.25, skillMax: 2, baseMin: 4, baseMax: 12, scaling: 'magic' },
    },
  };
  // Ethereal Spear: SKILLVALUE (sem `scaling`), `physical`.
  const etherealSpear: Spell = {
    id: 'ethereal-spear', name: 'Ethereal Spear', manaCost: 25, cooldownMs: 2_000, minLevel: 23,
    effect: {
      kind: 'damage', basePower: 25, range: 7, damageType: 'physical',
      formula: { levelFactor: 0.2, skillMin: 0.333333, skillMax: 1, baseMin: 8.333333, baseMax: 25 },
    },
  };
  // Ultimate Healing (`ultimate-healing-*.json`) e Mass Healing (`mass-healing.json`, que lê o ML cru).
  const ultimateHealing = {
    kind: 'heal' as const,
    formula: { levelFactor: 0.2, skillMin: 6.8, skillMax: 12.9, baseMin: 42, baseMax: 90 },
  };
  const massHealing = {
    kind: 'heal' as const,
    formula: {
      levelFactor: 0.2, skillMin: 5.7, skillMax: 10.43, baseMin: 26, baseMax: 62,
      includeSpecializedMagicLevel: false,
    },
  };

  it('Fire Wave com fire +2 sorteia em [51, 76]; sem o item, [49, 72]', () => {
    const cast = (scaling: SpellScaling) => firstRoll((random) => {
      castSpell(sorcerer(), fireWave, near(), 0, combat, random, scaling);
    });
    expect(cast(base)).toEqual([49, 72]);
    expect(cast({ ...base, specializedMagicLevel: { fire: 2 } })).toEqual([51, 76]);
  });

  it('o especializado de OUTRO elemento não soma, e a SKILLVALUE nunca soma', () => {
    const fire = firstRoll((random) => {
      castSpell(sorcerer(), fireWave, near(), 0, combat, random, { ...base, specializedMagicLevel: { energy: 2 } });
    });
    expect(fire).toEqual([49, 72]);
    const spear = (scaling: SpellScaling) => firstRoll((random) => {
      castSpell(sorcerer(), etherealSpear, near({ distance: 3 }), 0, combat, random, scaling);
    });
    expect(spear({ ...base, specializedMagicLevel: { physical: 5 } })).toEqual(spear(base));
  });

  it('Ultimate Healing soma o `healing`: [211, 393] com +2, [198, 368] sem', () => {
    const healRoll = (scaling: SpellScaling) => firstRoll((random) => {
      executeHealing(sorcerer(), sorcerer(), ultimateHealing, scaling, combat, random);
    });
    expect(healRoll(base)).toEqual([198, 368]);
    expect(healRoll({ ...base, specializedMagicLevel: { healing: 2 } })).toEqual([211, 393]);
  });

  it('Mass Healing (`includeSpecializedMagicLevel: false`) lê o ML cru', () => {
    const healRoll = (scaling: SpellScaling) => firstRoll((random) => {
      executeHealing(sorcerer(), sorcerer(), massHealing, scaling, combat, random);
    });
    expect(healRoll({ ...base, specializedMagicLevel: { healing: 5 } })).toEqual(healRoll(base));
  });

  it('a runa soma o do elemento DELA na fórmula, mas o requisito de ML lê o ML cru', () => {
    const rune: Supply = {
      id: 'great-fireball-rune', name: 'Great Fireball Rune', price: 10, group: 'attack', groupCooldownMs: 2_000,
      requires: { level: 30, magicLevel: 20 },
      effect: {
        kind: 'damage', basePower: 60, range: 4, damageType: 'fire',
        area: { shape: 'circle', radius: 3, centered: 'target' },
        formula: { levelFactor: 0.2, skillMin: 1.2, skillMax: 2.4, baseMin: 7, baseMax: 16 },
      },
    };
    const user = () => hero({ level: 100, gold: 1_000 });
    // ML 19 + fire 5: o Canary confere `getMagicLevel()` cru — recusa.
    expect(useSupply(user(), rune, near({ distance: 2 }), combat, rng(), {
      skillLevel: 19, powerScale: 1, magicLevel: 19, specializedMagicLevel: { fire: 5 },
    })).toEqual({ ok: false, reason: 'magic-level-too-low', retryInMs: 0 });
    // ML 20 + fire 1: a faixa é a do ML 21 — min = 20 + 21×1.2 + 7, max = 20 + 21×2.4 + 16.
    const roll = (scaling: SpellScaling) => firstRoll((random) => {
      useSupply(user(), rune, near({ distance: 2 }), combat, random, scaling);
    });
    expect(roll(base)).toEqual([51, 84]);
    expect(roll({ ...base, specializedMagicLevel: { fire: 1 } })).toEqual([52, 86]);
  });
});

describe('a runa Avalanche — supply de ataque em área (#165, ADR 0026 decisão 8)', () => {
  const rune: Supply = {
    id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, group: 'attack', groupCooldownMs: 2_000,
    requires: { level: 30, magicLevel: 4 },
    effect: { kind: 'damage', basePower: 45, range: 4, damageType: 'ice', area: { shape: 'circle', radius: 3, centered: 'target' } },
  };
  const three = { distance: 2, targets: [{ armor: 0, dodgeChance: 0 }, { armor: 0, dodgeChance: 0 }, { armor: 0, dodgeChance: 0 }] };
  const scaling = (skillLevel: number) => ({ skillLevel, powerScale: 1 });

  it('hits every target in the aim with one roll each, and charges the gold ONCE', () => {
    const caster = hero({ level: 30, gold: 100 });
    const result = useSupply(caster, rune, three, combat, rng(), scaling(4));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits).toHaveLength(3);
    expect(result.hits.every((hit) => hit > 0)).toBe(true);
    expect(result.goldSpent).toBe(14);
    expect(caster.goldDelta).toBe(-14);
    // A mesma semente dá o mesmo dano.
    const again = useSupply(hero({ level: 30, gold: 100 }), rune, three, combat, rng(), scaling(4));
    expect(again.ok && again.hits).toEqual(result.hits);
  });

  it('com estoque de loot (#520), a runa sai SEM debitar gold — goldSpent 0', () => {
    const caster = hero({ level: 30, gold: 0 });
    caster.supplyStock.set('avalanche-rune', 1);
    const result = useSupply(caster, rune, three, combat, rng(), scaling(4));
    expect(result).toMatchObject({ ok: true, goldSpent: 0 });
    expect(caster.goldDelta).toBe(0);
    expect(caster.supplyStock.has('avalanche-rune')).toBe(false);
  });

  it('refuses by level, magic level, target, range and gold — and NEVER charges on a refusal', () => {
    // Mutação que mata: subir o débito para antes da mira (runa em ninguém custaria).
    const at = (level: number, gold: number, skill: number, aim: typeof three | null) => {
      const caster = hero({ level, gold });
      const result = useSupply(caster, rune, aim, combat, rng(), scaling(skill));
      return { result, gold: caster.goldDelta };
    };
    expect(at(29, 100, 4, three)).toEqual({ result: { ok: false, reason: 'level-too-low', retryInMs: 0 }, gold: 0 });
    expect(at(30, 100, 3, three)).toEqual({ result: { ok: false, reason: 'magic-level-too-low', retryInMs: 0 }, gold: 0 });
    expect(at(30, 100, 4, null)).toEqual({ result: { ok: false, reason: 'no-target', retryInMs: 0 }, gold: 0 });
    expect(at(30, 100, 4, { ...three, distance: 5 })).toEqual({ result: { ok: false, reason: 'out-of-range', retryInMs: 0 }, gold: 0 });
    expect(at(30, 10, 4, three)).toEqual({ result: { ok: false, reason: 'not-enough-gold', retryInMs: 0 }, gold: 0 });
  });

  it('o crítico da runa em área é da AÇÃO — os três alvos nunca se dividem (#551/#653)', () => {
    // A mesma correção de `castSpell`: `Combat::applyExtensions` do Canary rola o crítico uma
    // vez por `doCombat`, área inclusive — a runa de ataque em área precisa da mesma garantia.
    // `spellPower` sem fator nem espalhamento colapsa a faixa em `basePower` exato (45) nos três
    // alvos, o que isola o crítico como a ÚNICA fonte de variação entre eles.
    const fixedPower: Combat = { ...combat, spellPower: { levelFactor: 0, skillFactor: 0, spread: 0 } };
    const outcomes = new Set<number>();
    for (let seed = 0; seed < 40; seed += 1) {
      const caster = hero({ level: 30, gold: 100 });
      const result = useSupply(
        caster, rune, three, fixedPower, Rng.fromSeed(`avalanche-crit-${seed}`), scaling(4),
        undefined, undefined, undefined, { critical: { chance: 0.5, multiplier: 2 } },
      );
      if (!result.ok) throw new Error('esperava usar a runa');
      // Os três alvos concordam sempre: 45/45/45 (sem crítico) ou 90/90/90 (crítico) — nunca uma
      // mistura, como o Canary.
      expect(new Set(result.hits).size).toBe(1);
      outcomes.add(result.hits[0] as number);
    }
    expect(outcomes).toEqual(new Set([45, 90]));
  });

  it('without combat context the rune does not exist — never damage without an rng', () => {
    // Sem `scaling` o magic level é zero e recusa antes; sem `combat`/`rng` com scaling, cai
    // em `not-in-catalog` — e em nenhum dos dois o gold sai.
    const caster = hero({ level: 30, gold: 100 });
    expect(useSupply(caster, rune, three)).toEqual({ ok: false, reason: 'magic-level-too-low', retryInMs: 0 });
    expect(useSupply(caster, rune, three, undefined, undefined, scaling(4))).toEqual({ ok: false, reason: 'not-in-catalog', retryInMs: 0 });
    expect(caster.goldDelta).toBe(0);
    // A poção continua no caminho de sempre, sem contexto nenhum.
    expect(useSupply(hero({ health: 10, gold: 100 }), potion).ok).toBe(true);
  });
});

describe('quem paga o supply é a Purse (#192, ADR 0027)', () => {
  it('a refusing purse debits nothing and heals nothing; a paying one is charged after the checks', () => {
    // Mutação que mata: debitar ou curar antes de `canAfford` — a poção sairia sem pagar.
    const potion = { id: 'health-potion', name: 'Poção', price: 45, group: 'potion' as const, groupCooldownMs: 1_000, requires: {}, effect: { kind: 'heal' as const, amount: 80 } };
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 }, health: 10, maxHealth: 500, mana: 0, maxMana: 0,
      level: 1, xp: 0, gold: 1_000, goldDelta: 0, alive: true, cooldowns: {},
    });
    const paid: number[] = [];
    const refusing = { canAfford: () => false, pay: (cost: number) => { paid.push(cost); } };
    expect(useSupply(hero, potion, null, undefined, undefined, undefined, refusing)).toMatchObject({ ok: false, reason: 'not-enough-gold' });
    expect(hero.health).toBe(10);
    expect(hero.goldDelta).toBe(0);
    expect(paid).toEqual([]);

    const paying = { canAfford: () => true, pay: (cost: number) => { paid.push(cost); } };
    expect(useSupply(hero, potion, null, undefined, undefined, undefined, paying)).toMatchObject({ ok: true, healed: 80, goldSpent: 45 });
    expect(paid).toEqual([45]);
    // A bolsa de UM é o de sempre: saldo dele, débito nele.
    expect(useSupply(hero, potion)).toMatchObject({ ok: true, goldSpent: 45 });
    expect(hero.goldDelta).toBe(-45);
  });
});

describe('a poção do Tibia — faixa fixa, espírito e requisito de vocação (#524, kit level 200)', () => {
  // `hero()` tem `maxHealth`/`maxMana` 100, curtos demais para as faixas de 250-350 do Tibia — a
  // cura sairia CLAMPADA pelo teto e o teste mediria o teto, não a faixa. Pools grandes aqui.
  const bigHero = (over: Partial<{
    health: number; mana: number; level: number; gold: number; vocationId: string | null;
  }> = {}): CharacterRuntime => {
    const runtime = new CharacterRuntime({
      id: 'hero', position: { x: 1, y: 1, z: 7 },
      health: over.health ?? 10, maxHealth: 2_000,
      mana: over.mana ?? 0, maxMana: 2_000,
      level: over.level ?? 60, xp: 0, vocationId: over.vocationId ?? null,
      staminaMs: null, staminaUpdatedAtMs: 0,
      gold: over.gold ?? 1_000, goldDelta: 0, alive: true, cooldowns: {},
    });
    return runtime;
  };

  const strongHeal: Supply = {
    id: 'strong-health-potion', name: 'Strong Health Potion', price: 115, group: 'potion',
    groupCooldownMs: 1_000,
    requires: { level: 50, vocationId: ['knight', 'paladin'] },
    effect: { kind: 'heal', amountRange: { min: 250, max: 350 } },
  };
  const strongMana: Supply = {
    id: 'strong-mana-potion', name: 'Strong Mana Potion', price: 150, group: 'potion',
    groupCooldownMs: 1_000,
    requires: { level: 50 },
    effect: { kind: 'mana', amountRange: { min: 115, max: 185 } },
  };
  const spirit: Supply = {
    id: 'great-spirit-potion', name: 'Great Spirit Potion', price: 225, group: 'potion',
    groupCooldownMs: 1_000,
    requires: { level: 80, vocationId: 'paladin' },
    effect: {
      kind: 'heal', amountRange: { min: 250, max: 350 },
      alsoMana: { amountRange: { min: 100, max: 200 } },
    },
  };

  it('sorteia a cura DENTRO da faixa, com o RNG da sessão — nunca fora dela', () => {
    // Um `bigHero` NOVO por rodada — não só a vida resetada: 20 usos a 115 gold cada estourariam
    // o saldo de um personagem só, e a recusa por `not-enough-gold` não é o que este teste mede.
    for (let seed = 0; seed < 20; seed += 1) {
      const paladino = bigHero({ level: 60, health: 10, gold: 1_000 });
      paladino.vocationId = 'paladin';
      const result = useSupply(
        paladino, strongHeal, null, undefined, Rng.fromSeed(`s${seed}`), undefined, undefined,
        paladino, 0,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.healed).toBeGreaterThanOrEqual(250);
        expect(result.healed).toBeLessThanOrEqual(350);
        expect(paladino.health).toBe(10 + result.healed);
      }
    }
  });

  it('sem `rng` (caminho de fixture), a faixa cai no MÍNIMO — determinístico, nunca undefined', () => {
    const paladino = bigHero({ level: 60, health: 10, gold: 1_000 });
    paladino.vocationId = 'paladin';
    expect(useSupply(paladino, strongHeal)).toMatchObject({ ok: true, healed: 250 });
  });

  it('recusa por LEVEL: a poção pede 50, quem tem 49 não bebe', () => {
    const cavaleiro = bigHero({ level: 49, gold: 1_000 });
    cavaleiro.vocationId = 'knight';
    expect(useSupply(cavaleiro, strongHeal)).toEqual({ ok: false, reason: 'level-too-low', retryInMs: 0 });
  });

  it('recusa por VOCAÇÃO — lista de duas: nem sorcerer nem druid bebem a poção de knight/paladin', () => {
    const sorcerer = bigHero({ level: 60, gold: 1_000 });
    sorcerer.vocationId = 'sorcerer';
    expect(useSupply(sorcerer, strongHeal)).toEqual({ ok: false, reason: 'wrong-vocation', retryInMs: 0 });

    const cavaleiro = bigHero({ level: 60, gold: 1_000 });
    cavaleiro.vocationId = 'knight';
    expect(useSupply(cavaleiro, strongHeal).ok).toBe(true);
    const paladino = bigHero({ level: 60, gold: 1_000 });
    paladino.vocationId = 'paladin';
    expect(useSupply(paladino, strongHeal).ok).toBe(true);
  });

  it('poção de mana com faixa TAMBÉM confere level — gap que não existia antes do #524', () => {
    const novato = bigHero({ level: 10, mana: 0, gold: 1_000 });
    expect(useSupply(novato, strongMana)).toEqual({ ok: false, reason: 'level-too-low', retryInMs: 0 });
    const veterano = bigHero({ level: 60, mana: 0, gold: 1_000 });
    const result = useSupply(veterano, strongMana, null, undefined, Rng.fromSeed('mana'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manaRestored).toBeGreaterThanOrEqual(115);
      expect(result.manaRestored).toBeLessThanOrEqual(185);
    }
  });

  it('poção de mana SEM `requires.vocationId` vale para qualquer vocação (a strong mana potion do Tibia)', () => {
    const sorcerer = bigHero({ level: 60, mana: 0, gold: 1_000 });
    sorcerer.vocationId = 'sorcerer';
    expect(useSupply(sorcerer, strongMana, null, undefined, Rng.fromSeed('any')).ok).toBe(true);
  });

  it('a poção de espírito cura E repõe mana no MESMO uso (`alsoMana`)', () => {
    const paladino = bigHero({ level: 90, health: 10, mana: 0, gold: 1_000 });
    paladino.vocationId = 'paladin';
    const result = useSupply(paladino, spirit, null, undefined, Rng.fromSeed('spirit'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.healed).toBeGreaterThanOrEqual(250);
      expect(result.healed).toBeLessThanOrEqual(350);
      expect(result.manaRestored).toBeGreaterThanOrEqual(100);
      expect(result.manaRestored).toBeLessThanOrEqual(200);
    }
    // As duas barras de fato mudaram — não é só o `CastSuccess` mentindo.
    expect(paladino.health).toBeGreaterThan(10);
    expect(paladino.mana).toBeGreaterThan(0);
  });

  it('quem não é Paladino não bebe a poção de espírito, e nada muda', () => {
    const druida = bigHero({ level: 90, health: 10, mana: 0, gold: 1_000 });
    druida.vocationId = 'druid';
    expect(useSupply(druida, spirit)).toEqual({ ok: false, reason: 'wrong-vocation', retryInMs: 0 });
    expect(druida.health).toBe(10);
    expect(druida.mana).toBe(0);
  });

  it('a recusa por vocação/level do supply NÃO tem prazo, como a da magia', () => {
    const sorcerer = bigHero({ level: 60, gold: 1_000 });
    sorcerer.vocationId = 'sorcerer';
    const recusa = useSupply(sorcerer, strongHeal);
    expect(recusa.ok).toBe(false);
    if (!recusa.ok) expect(recusa.retryInMs).toBe(0);
  });

  // #690: o `doTargetCombatHealth`/`doTargetCombatMana` do Canary sorteia pela normal truncada;
  // só o `combat-v3` troca, `combat-v1`/`v2` seguem uniformes bit a bit (ADR 0031).
  const combatV2: Combat = { ...combat, compatibilityProfile: 'combat-v2' };
  const combatV3: Combat = { ...combat, compatibilityProfile: 'combat-v3' };
  const paladin = (): CharacterRuntime => {
    const runtime = bigHero({ level: 90, health: 10, mana: 0, gold: 1_000 });
    runtime.vocationId = 'paladin';
    return runtime;
  };

  it('`combat-v3` sorteia a faixa pela normal truncada: mesma semente = `normalRandomInt`', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const expected = Rng.fromSeed(`n${seed}`);
      const heal = normalRandomInt(expected, 250, 350);
      const result = useSupply(paladin(), strongHeal, null, combatV3, Rng.fromSeed(`n${seed}`));
      expect(result).toMatchObject({ ok: true, healed: heal });
    }
  });

  it('`combat-v2` continua no `rng.integer` uniforme — a normal não vaza para v1/v2', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const heal = Rng.fromSeed(`u${seed}`).integer(250, 350);
      const result = useSupply(paladin(), strongHeal, null, combatV2, Rng.fromSeed(`u${seed}`));
      expect(result).toMatchObject({ ok: true, healed: heal });
    }
  });

  it('`combat-v3` na poção de mana e na de espírito: vida sorteia ANTES da mana', () => {
    const expectedMana = normalRandomInt(Rng.fromSeed('m'), 115, 185);
    expect(useSupply(paladin(), strongMana, null, combatV3, Rng.fromSeed('m')))
      .toMatchObject({ ok: true, manaRestored: expectedMana });

    const sequence = Rng.fromSeed('spirit-v3');
    const heal = normalRandomInt(sequence, 250, 350);
    const mana = normalRandomInt(sequence, 100, 200);
    expect(useSupply(paladin(), spirit, null, combatV3, Rng.fromSeed('spirit-v3')))
      .toMatchObject({ ok: true, healed: heal, manaRestored: mana });
  });
});

describe('a poção de BUFF do Tibia — Berserk, Mastermind, Bullseye, Magic Shield (#576)', () => {
  const berserk: Supply = {
    id: 'berserk-potion', name: 'Berserk Potion', price: 0, group: 'potion', groupCooldownMs: 1_000,
    requires: { vocationId: 'knight' },
    effect: {
      kind: 'condition',
      condition: {
        key: 'berserk-potion', merge: 'refresh', durationMs: 600_000,
        effect: { kind: 'buff', skillDeltas: { melee: 5, shielding: -10 } },
      },
    },
  };
  const magicShield: Supply = {
    id: 'magic-shield-potion', name: 'Magic Shield Potion', price: 0, group: 'potion',
    groupCooldownMs: 1_000,
    requires: { level: 14, vocationId: ['sorcerer', 'druid'] },
    effect: {
      kind: 'condition',
      condition: { key: 'mana-shield', merge: 'refresh', durationMs: 60_000, effect: { kind: 'mana-shield' } },
    },
  };

  it('bebe e devolve a condição auto-alvo, com o mesmo usuário como alvo e origem', () => {
    const cavaleiro = hero({ gold: 0 });
    cavaleiro.vocationId = 'knight';
    const result = useSupply(cavaleiro, berserk, null, undefined, undefined, undefined, undefined, cavaleiro, 10_000);
    expect(result).toMatchObject({
      ok: true, healed: 0, manaRestored: 0, damage: 0, goldSpent: 0,
      condition: {
        key: 'berserk-potion', targetId: 'hero', sourceId: 'hero', expiresAtMs: 610_000,
        skillDeltas: { melee: 5, shielding: -10 },
      },
    });
  });

  it('recusa por VOCAÇÃO — Berserk é só do Knight, um Sorcerer não bebe', () => {
    const sorcerer = hero({ gold: 0 });
    sorcerer.vocationId = 'sorcerer';
    expect(useSupply(sorcerer, berserk)).toEqual({ ok: false, reason: 'wrong-vocation', retryInMs: 0 });
  });

  it('recusa por LEVEL — Magic Shield Potion pede 14, quem tem 10 não bebe', () => {
    const druida = hero({ level: 10, gold: 0 });
    druida.vocationId = 'druid';
    expect(useSupply(druida, magicShield)).toEqual({ ok: false, reason: 'level-too-low', retryInMs: 0 });
  });

  it('sem `nowMs` (fixture), a condição conta o prazo a partir de 0, e o cooldown não inicia', () => {
    const cavaleiro = hero({ gold: 0 });
    cavaleiro.vocationId = 'knight';
    const result = useSupply(cavaleiro, berserk);
    expect(result).toMatchObject({ ok: true, condition: { expiresAtMs: 600_000 } });
  });

  it('gold: sem saldo é recusado; com saldo, debita e trava o grupo', () => {
    const pobre = hero({ gold: 0 });
    pobre.vocationId = 'knight';
    const paga: Supply = { ...berserk, price: 500 };
    expect(useSupply(pobre, paga, null, undefined, undefined, undefined, undefined, pobre, 0))
      .toEqual({ ok: false, reason: 'not-enough-gold', retryInMs: 0 });

    const rico = hero({ gold: 500 });
    rico.vocationId = 'knight';
    expect(useSupply(rico, paga, null, undefined, undefined, undefined, undefined, rico, 0).ok).toBe(true);
    expect(balanceOf(rico)).toBe(0);
    expect(rico.cooldowns.remainingMs(`group:potion`, 0)).toBe(1_000);
  });

  it('Magic Shield Potion reaproveita a MESMA chave `mana-shield` da magia (OU-lógica, nunca dois escudos)', () => {
    const sorcerer = hero({ level: 20, gold: 0 });
    sorcerer.vocationId = 'sorcerer';
    const result = useSupply(sorcerer, magicShield);
    expect(result).toMatchObject({ ok: true, condition: { key: 'mana-shield' } });
  });
});

describe('a exaustão de ação compartilhada entre poção e runa (#690)', () => {
  const exhaustingPotion: Supply = { ...potion, actionExhaustMs: 1_000 };

  it('o uso trava `exhaust:action` pelo `actionExhaustMs` do supply', () => {
    const user = hero({ health: 10, gold: 1_000 });
    expect(useSupply(user, exhaustingPotion, null, undefined, undefined, undefined, undefined, user, 5_000).ok)
      .toBe(true);
    expect(user.cooldowns.remainingMs(actionExhaustKey(), 5_000)).toBe(1_000);
    expect(user.cooldowns.remainingMs(actionExhaustKey(), 5_600)).toBe(400);
  });

  it('supply SEM `actionExhaustMs` não entra no livro (fixture, Magic Shield Potion)', () => {
    const user = hero({ health: 10, gold: 1_000 });
    expect(useSupply(user, potion, null, undefined, undefined, undefined, undefined, user, 0).ok).toBe(true);
    expect(user.cooldowns.remainingMs(actionExhaustKey(), 0)).toBe(0);
  });

  it('o livro só AVANÇA: uma exaustão curta nunca encurta a que já corre', () => {
    const user = hero({ health: 10, gold: 1_000 });
    const long: Supply = { ...potion, id: 'long', actionExhaustMs: 3_000 };
    const short: Supply = { ...potion, id: 'short', group: 'healing', actionExhaustMs: 1_000 };
    useSupply(user, long, null, undefined, undefined, undefined, undefined, user, 0);
    useSupply(user, short, null, undefined, undefined, undefined, undefined, user, 500);
    expect(user.cooldowns.remainingMs(actionExhaustKey(), 500)).toBe(2_500);
  });

  it('uso recusado (sem gold) não trava nada', () => {
    const user = hero({ health: 10, gold: 0 });
    expect(useSupply(user, exhaustingPotion, null, undefined, undefined, undefined, undefined, user, 0).ok)
      .toBe(false);
    expect(user.cooldowns.remainingMs(actionExhaustKey(), 0)).toBe(0);
  });
});

describe('a fórmula canônica de cura e as runas UH/IH (#475)', () => {
  // Light Healing (`exura`): min = level/5 + ML×1.4 + 8, max = level/5 + ML×2.0 + 11.
  const canaryLightHealing: Spell = {
    ...heal, id: 'light-healing', manaCost: 20, cooldownMs: 1_000,
    group: 'healing', groupCooldownMs: 1_000, minLevel: 8,
    effect: {
      kind: 'heal', basePower: 40,
      formula: { levelFactor: 0.2, skillMin: 1.4, skillMax: 2.0, baseMin: 8, baseMax: 11 },
    },
  };
  // Intense Healing (`exura gran`): outra magia do MESMO grupo, para o cooldown de grupo.
  const canaryIntenseHealing: Spell = {
    ...canaryLightHealing, id: 'intense-healing',
    effect: {
      kind: 'heal', basePower: 120,
      formula: { levelFactor: 0.2, skillMin: 2.4, skillMax: 3.0, baseMin: 20, baseMax: 30 },
    },
  };
  const canaryFlame: Spell = {
    ...strike, id: 'flame-strike', group: 'attack', groupCooldownMs: 2_000, cooldownMs: 2_000,
    effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'fire' },
  };
  // Outra magia do MESMO grupo `attack`: com ids distintos, o cooldown individual não mascara
  // o de grupo — é ele que o teste da independência precisa enxergar.
  const canaryIce: Spell = {
    ...canaryFlame, id: 'ice-strike', effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'ice' },
  };
  const uhRune: Supply = {
    id: 'ultimate-healing-rune', name: 'Ultimate Healing Rune', price: 35,
    group: 'healing', groupCooldownMs: 1_000,
    requires: { level: 24, magicLevel: 4 },
    effect: {
      kind: 'heal', range: 4,
      formula: { levelFactor: 0.2, skillMin: 5.7, skillMax: 10.3, baseMin: 36, baseMax: 65 },
    },
  };
  const ihRune: Supply = {
    ...uhRune, id: 'intense-healing-rune', price: 20, requires: { level: 8, magicLevel: 1 },
    effect: {
      kind: 'heal', range: 4,
      formula: { levelFactor: 0.2, skillMin: 2.4, skillMax: 3.0, baseMin: 20, baseMax: 30 },
    },
  };
  // A cura escala pelo MAGIC LEVEL, não pela skill de magia da vocação.
  const magic = { skillLevel: 0, powerScale: 1, magicLevel: 40 };
  /** Teto alto para a cura não ser clampada: o assunto aqui é a FAIXA, não o overheal. */
  const mage = (health: number, mana = 1_000): CharacterRuntime => {
    const caster = hero({ level: 50, health, mana });
    caster.maxHealth = 5_000;
    return caster;
  };

  it('level 50 e ML 40 rendem a faixa Canary 74~101, não a do basePower', () => {
    const result = castSpell(mage(1), canaryLightHealing, null, 0, combat, rng(), magic);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // min = 10 + 40×1.4 + 8 = 74; max = 10 + 40×2.0 + 11 = 101. Mutação que mata: cair no
    // `basePower` 40 daria 340~460.
    expect(result.healed).toBeGreaterThanOrEqual(74);
    expect(result.healed).toBeLessThanOrEqual(101);
  });

  it('a fórmula VENCE o basePower — os dois caminhos consomem os MESMOS sorteios', () => {
    const formulaRng = rng();
    const baseRng = rng();
    const withFormula = castSpell(mage(1), canaryLightHealing, null, 0, combat, formulaRng, magic);
    const onlyBase = castSpell(
      mage(1),
      { ...canaryLightHealing, effect: { kind: 'heal', basePower: 40 } },
      null, 0, combat, baseRng, magic,
    );
    expect(withFormula.ok && withFormula.healed).toBeLessThanOrEqual(101);
    expect(onlyBase.ok && onlyBase.healed).toBeGreaterThan(101);
    // A ordem de RNG não muda: a fórmula troca o NÚMERO, nunca a quantidade de sorteios.
    expect(formulaRng.getState()).toEqual(baseRng.getState());
  });

  it('a cura é limitada ao HP máximo e devolve o que REPÔS, não o que prometia (RF-04)', () => {
    const caster = hero({ level: 50, health: 95 });
    const result = castSpell(caster, canaryLightHealing, null, 0, combat, rng(), magic);
    expect(result).toMatchObject({ ok: true, healed: 5 });
    expect(caster.health).toBe(100);
  });

  it('o grupo `healing` (1000ms) é INDEPENDENTE do grupo `attack` (2000ms) (RF-03)', () => {
    // Cura primeiro: o ataque não espera o livro da cura.
    const caster = hero({ level: 50, mana: 1_000, health: 1 });
    expect(castSpell(caster, canaryLightHealing, null, 0, combat, rng(), magic).ok).toBe(true);
    expect(castSpell(caster, canaryFlame, near(), 500, combat, rng()).ok).toBe(true);
    // A segunda CURA (outra magia do grupo) espera os 1000ms do livro `healing`.
    expect(castSpell(caster, canaryIntenseHealing, null, 500, combat, rng(), magic))
      .toEqual({ ok: false, reason: 'group-cooldown', retryInMs: 500 });
    expect(castSpell(caster, canaryIntenseHealing, null, 1_000, combat, rng(), magic).ok).toBe(true);

    // Ataque primeiro: a cura não espera o livro do ataque (que tranca 2000ms).
    const outro = hero({ level: 50, mana: 1_000, health: 1 });
    expect(castSpell(outro, canaryFlame, near(), 0, combat, rng()).ok).toBe(true);
    expect(castSpell(outro, canaryLightHealing, null, 500, combat, rng(), magic).ok).toBe(true);
    expect(castSpell(outro, canaryIce, near(), 1_000, combat, rng()))
      .toEqual({ ok: false, reason: 'group-cooldown', retryInMs: 1_000 });
  });

  it('a UH rune escala pelo magic level, debita o gold e tranca o grupo `healing` (RF-02)', () => {
    const user = hero({ level: 50, health: 100, gold: 100 });
    user.maxHealth = 5_000;
    const result = useSupply(user, uhRune, null, combat, rng(), magic, undefined, user, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // min = 10 + 40×5.7 + 36 = 274; max = 10 + 40×10.3 + 65 = 487.
    expect(result.healed).toBeGreaterThanOrEqual(274);
    expect(result.healed).toBeLessThanOrEqual(487);
    expect(result.goldSpent).toBe(35);
    expect(user.goldDelta).toBe(-35);
    expect(user.cooldowns.isReady('group:healing', 999)).toBe(false);
    expect(user.cooldowns.isReady('group:healing', 1_000)).toBe(true);
  });

  it('com estoque de loot (#520), a UH rune escalada sai SEM debitar gold', () => {
    const user = hero({ level: 50, health: 100, gold: 0 });
    user.maxHealth = 5_000;
    user.supplyStock.set('ultimate-healing-rune', 3);
    const result = useSupply(user, uhRune, null, combat, rng(), magic, undefined, user, 0);
    expect(result).toMatchObject({ ok: true, goldSpent: 0 });
    expect(user.goldDelta).toBe(0);
    expect(user.supplyStock.get('ultimate-healing-rune')).toBe(2);
  });

  it('a IH rune recusa por magic level e não cura sem contexto — sem cobrar gold', () => {
    // Abaixo do ML exigido: recusa antes do gold.
    const fraco = hero({ level: 50, gold: 100 });
    expect(useSupply(fraco, ihRune, null, combat, rng(), { skillLevel: 0, powerScale: 1, magicLevel: 0 }))
      .toEqual({ ok: false, reason: 'magic-level-too-low', retryInMs: 0 });
    expect(fraco.goldDelta).toBe(0);
    // Sem combate/rng a runa escalada não existe — e o gold NÃO sai.
    const semContexto = hero({ level: 50, gold: 100 });
    expect(useSupply(semContexto, ihRune, null, undefined, undefined, magic))
      .toEqual({ ok: false, reason: 'not-in-catalog', retryInMs: 0 });
    expect(semContexto.goldDelta).toBe(0);
  });
});

describe('as runas de ataque com a fórmula canônica do Canary (#476)', () => {
  // Os coeficientes são do Canary (`data/scripts/runes/*.lua`) e a fórmula é a mesma da magia
  // de dano (#474), escalada pelo magic level. A SD é a runa de ALVO ÚNICO: sem `area`.
  const suddenDeath: Supply = {
    id: 'sudden-death-rune', name: 'Sudden Death Rune', price: 108,
    group: 'attack', groupCooldownMs: 2_000,
    requires: { level: 45, magicLevel: 15 },
    effect: {
      kind: 'damage', range: 8, damageType: 'death',
      formula: { levelFactor: 0.2, skillMin: 4.6, skillMax: 7.4, baseMin: 32, baseMax: 48 },
    },
  };
  const avalanche: Supply = {
    id: 'avalanche-rune', name: 'Avalanche Rune', price: 14,
    group: 'attack', groupCooldownMs: 2_000,
    requires: { level: 30, magicLevel: 4 },
    effect: {
      kind: 'damage', range: 8, damageType: 'ice',
      formula: { levelFactor: 0.2, skillMin: 1.2, skillMax: 2.8, baseMin: 7, baseMax: 17 },
      area: { shape: 'circle', radius: 3, centered: 'target' },
    },
  };
  const at = (supply: Supply, skill: number) => ({ skillLevel: skill, powerScale: 1, magicLevel: skill });

  it('a SD em level 45 / ML 15 bate a faixa Canary 110~168, sem basePower no arquivo', () => {
    // min = 45/5 + 15×4.6 + 32 = 110; max = 45/5 + 15×7.4 + 48 = 168. Mutação que mata: cair
    // no caminho do `basePower` — sem BP, `evaluateSpellPower` devolveria a faixa de 0.
    const user = hero({ level: 45, gold: 1_000 });
    const result = useSupply(user, suddenDeath, near({ distance: 5 }), combat, rng(), at(suddenDeath, 15));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toBeGreaterThanOrEqual(110);
    expect(result.hits[0]).toBeLessThanOrEqual(168);
    expect(result.goldSpent).toBe(108);
  });

  it('a área da Avalanche atinge 5 alvos com uma rolagem integral por alvo, sem splitting', () => {
    // A área é aplicada por quem tem os alvos (a hunt); aqui a mira traz os cinco e o dano é
    // independente por alvo. Se houvesse splitting, cada golpe ficaria abaixo do piso da
    // fórmula (17 no level 30 / ML 4) — é isso que a asserção prende.
    const five = {
      distance: 2,
      targets: Array.from({ length: 5 }, () => ({ armor: 0, dodgeChance: 0 })),
    };
    const result = useSupply(hero({ level: 30, gold: 100 }), avalanche, five, combat, rng(), at(avalanche, 4));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits).toHaveLength(5);
    for (const hit of result.hits) {
      expect(hit).toBeGreaterThanOrEqual(17);
      expect(hit).toBeLessThanOrEqual(34);
    }
  });

  it('recusa por level e por magic level ANTES do gold e sem entrar em cooldown', () => {
    // A ordem é a de `castSpell`: requisitos, alvo, e só então gold. A recusa não cobra nem
    // tranca o grupo — o uso que não saiu não pode consumir o cooldown de quem não o executou.
    const semLevel = hero({ level: 44, gold: 1_000 });
    expect(useSupply(semLevel, suddenDeath, null, combat, rng(), at(suddenDeath, 15)))
      .toEqual({ ok: false, reason: 'level-too-low', retryInMs: 0 });
    expect(semLevel.goldDelta).toBe(0);
    expect(semLevel.cooldowns.isReady('group:attack', 0)).toBe(true);

    const semMagic = hero({ level: 30, gold: 1_000 });
    expect(useSupply(semMagic, avalanche, near(), combat, rng(), at(avalanche, 3)))
      .toEqual({ ok: false, reason: 'magic-level-too-low', retryInMs: 0 });
    expect(semMagic.goldDelta).toBe(0);
    expect(semMagic.cooldowns.isReady('group:attack', 0)).toBe(true);
  });

  it('o elemento de cada runa é o do catálogo, e a fórmula não o troca', () => {
    for (const supply of [suddenDeath, avalanche] as const) {
      expect(supply.effect.kind).toBe('damage');
      if (supply.effect.kind !== 'damage') continue;
      const target = { armor: 0, dodgeChance: 0 };
      const result = useSupply(
        hero({ level: supply.requires.level ?? 1, gold: 1_000 }), supply,
        { distance: 1, targets: [target] }, combat, rng(),
        at(supply, supply.requires.magicLevel ?? 0),
      );
      expect(result.ok).toBe(true);
    }
  });
});

describe('a normal truncada do Canary no `combat-v3` (#681)', () => {
  // O Canary sorteia magia, runa e poção por `normal_random` (`combat.cpp:2046`,
  // `global_functions.cpp:372`/`:455`). Cada caso compara com `normalRandomInt` sobre um CLONE
  // do `Rng` no estado de antes — o valor é o primeiro sorteio da ação.
  const v3: Combat = { ...combat, compatibilityProfile: 'combat-v3' };
  /** Pools grandes: a cura não pode ser clampada pelo teto, o assunto é o sorteio. */
  const bigPools = (level: number, over: Partial<{ health: number; mana: number }> = {}): CharacterRuntime =>
    new CharacterRuntime({
      id: 'hero', position: { x: 1, y: 1, z: 7 },
      health: over.health ?? 1, maxHealth: 10_000,
      mana: over.mana ?? 1_000, maxMana: 10_000,
      level, xp: 0, vocationId: null,
      staminaMs: null, staminaUpdatedAtMs: 0,
      gold: 10_000, goldDelta: 0, alive: true, cooldowns: {},
      learnedSpells: learnedSpellsStateOf(KNOWN_SPELLS),
    });

  it('poção `amountRange` 250–350 sorteia `normalRandomInt` — e o v1 continua `rng.integer`', () => {
    const strongHeal: Supply = {
      id: 'strong-health-potion', name: 'Strong Health Potion', price: 115, group: 'potion',
      groupCooldownMs: 1_000, requires: {}, effect: { kind: 'heal', amountRange: { min: 250, max: 350 } },
    };
    for (let seed = 0; seed < 20; seed += 1) {
      const source = Rng.fromSeed(`potion-v3-${seed}`);
      const clone = new Rng(source.getState());
      const user = bigPools(60);
      expect(useSupply(user, strongHeal, null, v3, source, undefined, undefined, user, 0))
        .toMatchObject({ ok: true, healed: normalRandomInt(clone, 250, 350) });

      const v1Source = Rng.fromSeed(`potion-v3-${seed}`);
      const v1Clone = new Rng(v1Source.getState());
      const v1User = bigPools(60);
      expect(useSupply(v1User, strongHeal, null, combat, v1Source, undefined, undefined, v1User, 0))
        .toMatchObject({ ok: true, healed: v1Clone.integer(250, 350) });
    }
  });

  it('poção de mana e a de espírito (`alsoMana`) também saem da normal', () => {
    const spirit: Supply = {
      id: 'great-spirit-potion', name: 'Great Spirit Potion', price: 225, group: 'potion',
      groupCooldownMs: 1_000, requires: {},
      effect: {
        kind: 'heal', amountRange: { min: 250, max: 350 },
        alsoMana: { amountRange: { min: 100, max: 200 } },
      },
    };
    const strongMana: Supply = {
      id: 'strong-mana-potion', name: 'Strong Mana Potion', price: 150, group: 'potion',
      groupCooldownMs: 1_000, requires: {}, effect: { kind: 'mana', amountRange: { min: 115, max: 185 } },
    };
    const source = Rng.fromSeed('spirit-v3');
    const clone = new Rng(source.getState());
    const user = bigPools(90, { mana: 0 });
    const result = useSupply(user, spirit, null, v3, source, undefined, undefined, user, 0);
    const healed = normalRandomInt(clone, 250, 350);
    expect(result).toMatchObject({ ok: true, healed, manaRestored: normalRandomInt(clone, 100, 200) });

    const manaSource = Rng.fromSeed('mana-v3');
    const manaClone = new Rng(manaSource.getState());
    const manaUser = bigPools(60, { mana: 0 });
    expect(useSupply(manaUser, strongMana, null, v3, manaSource, undefined, undefined, manaUser, 0))
      .toMatchObject({ ok: true, manaRestored: normalRandomInt(manaClone, 115, 185) });
  });

  it('magia de cura com `formula` e com `basePower` provisório sorteiam pela normal', () => {
    const magic = { skillLevel: 40, powerScale: 1, magicLevel: 40 };
    const withFormula: Spell = {
      ...heal, id: 'light-healing',
      effect: {
        kind: 'heal', basePower: 40,
        formula: { levelFactor: 0.2, skillMin: 1.4, skillMax: 2.0, baseMin: 8, baseMax: 11 },
      },
    };
    const onlyBase: Spell = { ...heal, id: 'base-healing', effect: { kind: 'heal', basePower: 40 } };
    // Fórmula: min = 10 + 40×1.4 + 8 = 74, max = 10 + 40×2.0 + 11 = 101. BP: a conversão provisória.
    const base = evaluateSpellPower(undefined, 40, 50, 40, v3.spellPower);
    const cases = [
      { spell: withFormula, min: 74, max: 101 },
      { spell: onlyBase, min: base.min, max: base.max },
    ];
    for (const { spell, min, max } of cases) {
      const source = Rng.fromSeed(`heal-v3-${spell.id}`);
      const clone = new Rng(source.getState());
      expect(castSpell(bigPools(50), spell, null, 0, v3, source, magic))
        .toMatchObject({ ok: true, healed: normalRandomInt(clone, min, max) });
    }
  });

  it('runa de cura (UH) sorteia pela normal', () => {
    const uhRune: Supply = {
      id: 'ultimate-healing-rune', name: 'Ultimate Healing Rune', price: 35,
      group: 'healing', groupCooldownMs: 1_000, requires: { level: 24, magicLevel: 4 },
      effect: {
        kind: 'heal', range: 4,
        formula: { levelFactor: 0.2, skillMin: 5.7, skillMax: 10.3, baseMin: 36, baseMax: 65 },
      },
    };
    const source = Rng.fromSeed('uh-v3');
    const clone = new Rng(source.getState());
    const user = bigPools(50);
    const result = useSupply(user, uhRune, null, v3, source, { skillLevel: 0, powerScale: 1, magicLevel: 40 }, undefined, user, 0);
    // min = 10 + 40×5.7 + 36 = 274; max = 10 + 40×10.3 + 65 = 487.
    expect(result).toMatchObject({ ok: true, healed: normalRandomInt(clone, 274, 487) });
  });

  it('runa de ataque (SD) sorteia pela normal', () => {
    const suddenDeath: Supply = {
      id: 'sudden-death-rune', name: 'Sudden Death Rune', price: 108,
      group: 'attack', groupCooldownMs: 2_000, requires: { level: 45, magicLevel: 15 },
      effect: {
        kind: 'damage', range: 8, damageType: 'death',
        formula: { levelFactor: 0.2, skillMin: 4.6, skillMax: 7.4, baseMin: 32, baseMax: 48 },
      },
    };
    for (let seed = 0; seed < 10; seed += 1) {
      const source = Rng.fromSeed(`sd-v3-${seed}`);
      const clone = new Rng(source.getState());
      const result = useSupply(
        bigPools(45), suddenDeath, near({ distance: 5 }), v3, source,
        { skillLevel: 15, powerScale: 1, magicLevel: 15 },
      );
      if (!result.ok) throw new Error('esperava usar a runa');
      // Sem armadura, esquiva nem defesa, o golpe é o poder sorteado: min 110, max 168.
      expect(result.hits[0]).toBe(normalRandomInt(clone, 110, 168));
    }
  });

  it('magia de ataque com `formula` sorteia pela normal', () => {
    const iceStrike: Spell = {
      ...strike, id: 'ice-strike', manaCost: 12, minLevel: 8,
      effect: {
        kind: 'damage', basePower: 45, range: 3, damageType: 'ice',
        formula: { levelFactor: 0.2, skillMin: 1.403, skillMax: 2.203, baseMin: 8, baseMax: 13 },
      },
    };
    for (let seed = 0; seed < 10; seed += 1) {
      const source = Rng.fromSeed(`ice-v3-${seed}`);
      const clone = new Rng(source.getState());
      const result = castSpell(
        bigPools(50), iceStrike, near({ distance: 3 }), 0, v3, source, { skillLevel: 40, powerScale: 1 },
      );
      if (!result.ok) throw new Error('esperava lançar');
      // min = 10 + 40×1.403 + 8 = 74; max = 10 + 40×2.203 + 13 = 111.
      expect(result.hits[0]).toBe(normalRandomInt(clone, 74, 111));
    }
  });
});

describe('castSpell — conjuração (#594, ADR 0044)', () => {
  const avalancheConjure: Spell = {
    id: 'conjure-avalanche-rune', name: 'Avalanche Rune', manaCost: 530, soulCost: 3,
    cooldownMs: 2_000, minLevel: 30,
    effect: { kind: 'conjure', supplyId: 'avalanche-rune', charges: 4, blankPrice: 10 },
  };
  const arrowConjure: Spell = {
    id: 'conjure-arrow', name: 'Conjure Arrow', manaCost: 100, soulCost: 1,
    cooldownMs: 2_000, minLevel: 13,
    effect: { kind: 'conjure', ammunitionId: 'arrow', charges: 10, blankPrice: 0 },
  };

  it('credita as cargas no ESTOQUE do próprio lançador, e debita mana, alma e a runa em branco', () => {
    const caster = hero({ mana: 530, soul: 3, gold: 10, level: 30 });
    const result = castSpell(caster, avalancheConjure, null, 0, combat, rng());

    expect(result).toMatchObject({ ok: true, healed: 0, damage: 0, goldSpent: 10 });
    expect(caster.mana).toBe(0);
    expect(caster.soul).toBe(0);
    expect(balanceOf(caster)).toBe(0);
    expect(caster.supplyStock.get('avalanche-rune')).toBe(4);
    // A conjuração NUNCA cria item físico (ADR 0044 decisão 1) — o estoque de munição
    // permanece vazio, e a runa só existe como carga abstrata.
    expect(caster.ammunitionStock.size).toBe(0);
  });

  it('SOMA no estoque existente, em vez de sobrescrever — duas conjurações acumulam', () => {
    const caster = hero({ mana: 1_060, soul: 6, gold: 20, level: 30 });
    castSpell(caster, avalancheConjure, null, 0, combat, rng());
    castSpell(caster, avalancheConjure, null, 2_000, combat, rng());
    expect(caster.supplyStock.get('avalanche-rune')).toBe(8);
  });

  it('recusa sem alma, e não desconta mana nem gold — a mesma regra da mana (#593)', () => {
    const caster = hero({ mana: 530, soul: 2, gold: 10, level: 30 });
    const result = castSpell(caster, avalancheConjure, null, 0, combat, rng());

    expect(result).toEqual({ ok: false, reason: 'not-enough-soul', retryInMs: 0 });
    expect(caster.mana).toBe(530);
    expect(caster.soul).toBe(2);
    expect(balanceOf(caster)).toBe(10);
    expect(caster.supplyStock.size).toBe(0);
  });

  it('recusa sem gold para a runa em branco — nem mana nem alma saem, e nada é creditado', () => {
    const caster = hero({ mana: 530, soul: 3, gold: 9, level: 30 });
    const result = castSpell(caster, avalancheConjure, null, 0, combat, rng());

    expect(result).toEqual({ ok: false, reason: 'not-enough-gold', retryInMs: 0 });
    expect(caster.mana).toBe(530);
    expect(caster.soul).toBe(3);
    expect(balanceOf(caster)).toBe(9);
    expect(caster.supplyStock.size).toBe(0);
  });

  it('a conjuração de munição não gasta gold nenhum — `blankId` zero no Canary', () => {
    const caster = hero({ mana: 100, soul: 1, gold: 0, level: 13 });
    const result = castSpell(caster, arrowConjure, null, 0, combat, rng());

    expect(result).toMatchObject({ ok: true, goldSpent: 0 });
    expect(balanceOf(caster)).toBe(0);
    expect(caster.ammunitionStock.get('arrow')).toBe(10);
    expect(caster.supplyStock.size).toBe(0);
  });

  it('não cura, não causa dano e não consome nenhum sorteio do Rng — quantidade é FIXA', () => {
    const caster = hero({ mana: 530, soul: 3, gold: 10, level: 30 });
    const source = rng();
    const before = source.getState();
    const result = castSpell(caster, avalancheConjure, null, 0, combat, source);

    expect(result).toMatchObject({ ok: true, healed: 0, damage: 0, hits: [] });
    expect(source.getState()).toEqual(before);
  });

  it('respeita o cooldown/grupo como qualquer magia — a segunda tentativa no mesmo instante recusa', () => {
    const caster = hero({ mana: 1_060, soul: 6, gold: 20, level: 30 });
    castSpell(caster, avalancheConjure, null, 0, combat, rng());
    const second = castSpell(caster, avalancheConjure, null, 0, combat, rng());
    expect(second).toMatchObject({ ok: false, reason: 'on-cooldown' });
    expect(caster.supplyStock.get('avalanche-rune')).toBe(4);
  });
});

describe('useSupply — runa de campo e Destroy Field (#591)', () => {
  const groundAim = (point: { x: number; y: number; z: number }, distance = 3) => ({
    distance, targets: [], point,
  });
  const fireFieldRune: Supply = {
    id: 'fire-field-rune', name: 'Fire Field Rune', price: 20, group: 'attack', groupCooldownMs: 1_000, requires: {},
    effect: {
      kind: 'field', range: 8,
      field: {
        id: 'player-fire-field', durationMs: 20_000,
        shape: { shape: 'point' },
        condition: {
          key: 'burning', merge: 'strongest', durationMs: 20_000,
          effect: { kind: 'damage-over-time', form: 'rounds', rounds: [{ count: 2, intervalMs: 10_000, damage: 20 }], damageType: 'fire' },
        },
      },
    },
  };
  const destroyFieldRune: Supply = {
    id: 'destroy-field-rune', name: 'Destroy Field', price: 10, group: 'support', groupCooldownMs: 1_000, requires: {},
    effect: { kind: 'destroy-field', range: 5 },
  };

  it('devolve o FieldSpec e o tile — não aplica nada sozinho (o ruleset é quem planta)', () => {
    const result = useSupply(hero({ gold: 100 }), fireFieldRune, groundAim({ x: 2, y: 2, z: 7 }));
    if (!result.ok) throw new Error('esperava usar a runa');
    expect(result.field).toEqual({ spec: fireFieldRune.effect.kind === 'field' ? fireFieldRune.effect.field : undefined, at: { x: 2, y: 2, z: 7 } });
    expect(result.goldSpent).toBe(20);
  });

  it('sem mira (`aim` null ou sem `point`) recusa `no-target`, sem debitar', () => {
    const noAim = useSupply(hero({ gold: 100 }), fireFieldRune, null);
    expect(noAim).toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
    const noPoint = useSupply(hero({ gold: 100 }), fireFieldRune, { distance: 1, targets: [] });
    expect(noPoint).toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
  });

  it('fora do alcance recusa `out-of-range`, sem debitar', () => {
    const result = useSupply(hero({ gold: 100 }), fireFieldRune, groundAim({ x: 9, y: 9, z: 7 }, 9));
    expect(result).toEqual({ ok: false, reason: 'out-of-range', retryInMs: 0 });
  });

  it('sem gold recusa `not-enough-gold`, e nada é debitado', () => {
    const caster = hero({ gold: 5 });
    const result = useSupply(caster, fireFieldRune, groundAim({ x: 2, y: 2, z: 7 }));
    expect(result).toEqual({ ok: false, reason: 'not-enough-gold', retryInMs: 0 });
  });

  it('Destroy Field devolve o TILE mirado — a presença de campo é conferida por quem chama, não aqui', () => {
    const result = useSupply(hero({ gold: 100 }), destroyFieldRune, groundAim({ x: 4, y: 4, z: 7 }, 4));
    if (!result.ok) throw new Error('esperava usar a runa');
    expect(result.destroyFieldAt).toEqual({ x: 4, y: 4, z: 7 });
    expect(result.goldSpent).toBe(10);
  });
});

describe('castSpell — o aprendizado (#624, ADR 0058 d.1)', () => {
  // No Canary o `toggleLearnSpells` vem ligado, e `Spell::playerSpellCheck` recusa toda magia
  // instantânea que `hasLearnedInstantSpell` não reconhece. A runa é item: exige só level e magic
  // level. A CONJURAÇÃO da runa é magia, e exige o aprendizado como qualquer outra.
  const untaught = (over: Partial<Parameters<typeof hero>[0]> = {}): CharacterRuntime =>
    hero({ learned: [], ...over });

  it('recusa a magia NÃO aprendida com `spell-not-learned`, sem prazo — esperar não a ensina', () => {
    const caster = untaught({ health: 10 });
    expect(castSpell(caster, heal, null, 0, combat, rng()))
      .toEqual({ ok: false, reason: 'spell-not-learned', retryInMs: 0 });
  });

  it('a recusa não gasta NADA: nem mana, nem alma, nem cooldown, nem gold', () => {
    const caster = untaught({ health: 10, gold: 50 });
    castSpell(caster, heal, null, 0, combat, rng());
    expect(caster.mana).toBe(100);
    expect(caster.soul).toBe(100);
    expect(caster.goldDelta).toBe(0);
    expect(caster.health).toBe(10);
    expect(caster.cooldowns.isReady(spellCooldownKey('heal'), 0)).toBe(true);
  });

  it('depois de aprender, a MESMA magia sai — o aprendizado é o único portão que mudou', () => {
    const caster = untaught({ health: 10 });
    expect(castSpell(caster, heal, null, 0, combat, rng()).ok).toBe(false);
    caster.learnedSpells.grant('heal');
    expect(castSpell(caster, heal, null, 0, combat, rng()).ok).toBe(true);
    expect(caster.health).toBe(70);
  });

  it('é POR magia: aprender uma não ensina a outra', () => {
    const caster = untaught({ health: 10 });
    caster.learnedSpells.grant('heal');
    expect(castSpell(caster, strike, near(), 0, combat, rng()))
      .toEqual({ ok: false, reason: 'spell-not-learned', retryInMs: 0 });
  });

  it('vem DEPOIS de level e vocação — que também nunca melhoram esperando —, e ANTES de cooldown e mana', () => {
    // Level baixo vence: o jogador que não tem o level ouve "level", não "aprenda" (a magia
    // sequer está à venda para ele).
    expect(castSpell(untaught({ level: 1 }), { ...heal, minLevel: 50 }, null, 0, combat, rng()))
      .toMatchObject({ reason: 'level-too-low' });
    expect(castSpell(untaught(), { ...heal, vocationId: 'knight' }, null, 0, combat, rng()))
      .toMatchObject({ reason: 'wrong-vocation' });
    // E antes de cooldown e mana: sem mana e sem aprender, a resposta é o aprendizado.
    expect(castSpell(untaught({ mana: 0 }), heal, null, 0, combat, rng()))
      .toMatchObject({ reason: 'spell-not-learned' });
  });

  it('vale para TODO efeito de magia: dano, cura, condição e conjuração', () => {
    const haste: Spell = {
      id: 'haste', name: 'Haste', manaCost: 60, cooldownMs: 2_000, minLevel: 1,
      effect: { kind: 'haste', speedPercent: 30, durationMs: 10_000 },
    };
    const conjure: Spell = {
      id: 'conjure-avalanche-rune', name: 'Avalanche Rune', manaCost: 530, soulCost: 3, cooldownMs: 2_000,
      minLevel: 1, effect: { kind: 'conjure', supplyId: 'avalanche-rune', charges: 4, blankPrice: 10 },
    };
    for (const spell of [strike, heal, haste, conjure]) {
      expect(castSpell(untaught({ gold: 100 }), spell, near(), 0, combat, rng()), spell.id)
        .toEqual({ ok: false, reason: 'spell-not-learned', retryInMs: 0 });
    }
  });

  it('a RUNA (supply) NÃO exige aprendizado: só level e magic level, como no Tibia', () => {
    const rune: Supply = {
      id: 'ultimate-healing-rune', name: 'Ultimate Healing Rune', price: 40, group: 'healing',
      groupCooldownMs: 2_000, requires: { level: 24, magicLevel: 4 },
      effect: { kind: 'heal', amount: 100 },
    };
    // Não aprendeu NENHUMA magia, inclusive a que conjura a runa — e a usa do mesmo jeito.
    const caster = untaught({ level: 30, health: 10, gold: 100 });
    const scaling: SpellScaling = { skillLevel: 4, powerScale: 1, magicLevel: 4 };
    expect(useSupply(caster, rune, null, combat, rng(), scaling).ok).toBe(true);
    expect(caster.learnedSpells.size).toBe(0);
  });
});
