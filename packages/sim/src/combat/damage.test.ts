import { compileMitigation } from '@draconya/content';
import type { Combat, DamageType } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { effectiveDodge, resolveDamage } from './damage.js';
import type { DamageIntent } from './damage.js';

const combat: Combat = {
  id: 'baseline',
  compatibilityProfile: 'combat-v1',
  dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 },
  minimumDamageFraction: 0.1,
  // O personagem desarmado não participa de nenhum caso deste arquivo: aqui o atacante e o
  // defensor são montados à mão, tijolo por tijolo. Está preenchido porque o tipo pede.
  player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 4, dodgeChance: 0.05, damageType: 'physical' },
  spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
};

/** Gerador de mentira, para separar "esquivou" de "não esquivou" sem depender de semente. */
const rigged = (dodges: boolean): Rng =>
  ({ chance: () => dodges } as unknown as Rng);

const plate = { armor: 20, dodgeChance: 0 };
const swing: DamageIntent = { rawDamage: 100, source: 'basic-attack', damageType: 'physical' };

/** A intenção de um golpe com o tipo de dano dado. O tipo é o que decide a coluna de armadura. */
const hit = (rawDamage: number, damageType: DamageType = 'physical'): DamageIntent =>
  ({ rawDamage, source: 'basic-attack', damageType });

describe('resolveDamage', () => {
  it('always hits: there is no offensive roll', () => {
    // §12.2. Não existe miss ofensivo do jogador — some metade da matemática de combate, e
    // some junto a frustração de errar sem entender por quê.
    const result = resolveDamage(swing, plate, 'pve', combat, rigged(false));
    expect(result.resolvedDamage).toBe(80);
    expect(result.dodged).toBe(false);
  });

  it('halves the damage when dodge triggers, and never zeroes it', () => {
    // Esquiva não é invulnerabilidade: um golpe que passa pela defesa ainda machuca.
    const result = resolveDamage(swing, plate, 'pve', combat, rigged(true));
    expect(result.resolvedDamage).toBe(40);
    expect(result.dodged).toBe(true);
  });

  it('applies the floor so heavy armour never zeroes a hit', () => {
    // Dano zero contra um alvo pesado vira impasse silencioso, sem nada na tela explicando.
    const tank = { armor: 500, dodgeChance: 0 };
    expect(resolveDamage(swing, tank, 'pve', combat, rigged(false)).resolvedDamage).toBe(10);
  });

  it('lets the table decide whether armour applies to magic', () => {
    // Nenhum coeficiente no código (§12.1). Aqui a tabela diz que armadura não vale contra
    // magia; mudar o JSON muda o resultado sem tocar em lógica.
    const spell = hit(100, 'arcane');
    expect(resolveDamage(spell, plate, 'pve', combat, rigged(false)).resolvedDamage).toBe(100);

    const armouredAgainstMagic: Combat = {
      ...combat,
      armorEffectiveness: { physical: 1, energy: 1, earth: 1, fire: 1, ice: 1, holy: 1, death: 1, arcane: 1 },
    };
    expect(resolveDamage(spell, plate, 'pve', armouredAgainstMagic, rigged(false)).resolvedDamage)
      .toBe(80);
  });

  it('rounds only at the end', () => {
    // Arredondar antes do dodge faria 50% de 3 virar 2, e o jogador veria uma esquiva que
    // reduziu um terço em vez de metade.
    const soft = { armor: 0, dodgeChance: 0 };
    const weak = hit(3);
    expect(resolveDamage(weak, soft, 'pve', combat, rigged(true)).resolvedDamage).toBe(2);
    expect(resolveDamage(weak, soft, 'pve', combat, rigged(false)).resolvedDamage).toBe(3);
  });

  it('is deterministic for the same seed', () => {
    // O RNG é o da sessão (FUN-25). Sem isto, "por que eu morri" é pergunta sem resposta.
    const run = () => {
      const rng = Rng.fromSeed('sessao-1');
      const target = { armor: 10, dodgeChance: 0.5 };
      return Array.from({ length: 8 }, () =>
        resolveDamage(swing, target, 'pve', combat, rng));
    };
    expect(run()).toEqual(run());
  });

  it('consumes one roll per hit, even against a target that cannot dodge', () => {
    // Pular a rolagem quando não há esquiva faria a sequência do gerador depender de um
    // atributo do alvo — e aí dar dodge a um monstro deslocaria todo o loot posterior.
    const withDodge = Rng.fromSeed('x');
    const withoutDodge = Rng.fromSeed('x');
    resolveDamage(swing, { armor: 0, dodgeChance: 0.5 }, 'pve', combat, withDodge);
    resolveDamage(swing, { armor: 0, dodgeChance: 0 }, 'pve', combat, withoutDodge);
    expect(withDodge.getState()).toEqual(withoutDodge.getState());
  });
});

describe('o outcome v1 é auditável (CMB-02, ADR 0031)', () => {
  it('expõe a entrada e cada estágio da mitigação, sem arredondar no meio', () => {
    // O que o CMB-02 acrescenta ao resultado mínimo: dá para dizer QUANTO a armadura tirou,
    // QUAL piso valeu e QUAL perfil resolveu — sem recalcular no host nem no cliente (DT-02).
    const result = resolveDamage(swing, plate, 'pve', combat, rigged(false));
    expect(result).toEqual({
      profile: 'combat-v1',
      intent: swing,
      damageType: 'physical',
      afterDefense: 100,
      afterArmor: 80,
      armorReduction: 20,
      minimumDamage: 10,
      afterResistance: 80,
      immune: false,
      dodged: false,
      critical: false,
      resolvedDamage: 80,
    });
  });

  it('é BIT A BIT o v1: um refactor que mude qualquer estágio quebra aqui', () => {
    // Âncora do perfil aditivo. Trocar a ordem de RNG, a posição do arredondamento, a coluna
    // de armadura ou o piso muda estes números e é rompimento observável (ADR 0031).
    const arcane = resolveDamage(hit(100, 'arcane'), plate, 'pve', combat, rigged(true));
    expect(arcane).toMatchObject({ armorReduction: 0, minimumDamage: 10, resolvedDamage: 50 });
    // A esquiva corta o PISO, não o dano pós-armadura: max(10, 80) × 0,5 = 40; max(10, 100) ×
    // 0,5 = 50. O piso entra ANTES do corte, e é essa ordem que está congelada.
    expect(resolveDamage(swing, plate, 'pve', combat, rigged(true)).resolvedDamage).toBe(40);
  });

  it('preserva a intenção: o ruleset sabe de onde o dano veio e de que tipo é', () => {
    const spell = resolveDamage(
      { rawDamage: 30, source: 'spell', damageType: 'arcane' },
      plate, 'pve', combat, rigged(false),
    );
    expect(spell.intent).toEqual({ rawDamage: 30, source: 'spell', damageType: 'arcane' });
    const rune = resolveDamage(
      { rawDamage: 30, source: 'rune', damageType: 'arcane' },
      plate, 'pve', combat, rigged(false),
    );
    expect(rune.intent.source).toBe('rune');
    const monster = resolveDamage(
      { rawDamage: 30, source: 'monster-attack', damageType: 'physical' },
      plate, 'pve', combat, rigged(false),
    );
    expect(monster.intent.source).toBe('monster-attack');
  });

  it('resolve um poder ZERO: o outcome existe e o dano resolvido é zero', () => {
    // Caso de borda do perfil: poder zero não é ausência de resolução — o ruleset ainda
    // aplica zero, atribui zero e anuncia zero, como qualquer golpe.
    const result = resolveDamage(hit(0), plate, 'pve', combat, rigged(false));
    expect(result.resolvedDamage).toBe(0);
    expect(result.dodged).toBe(false);
  });

  it('recusa um perfil desconhecido, sem escolher fallback', () => {
    // O boot de `buildContent` já recusou; aqui é a defesa em profundidade do despachante. Um
    // perfil que o motor não conhece não pode ser reinterpretado em silêncio (ADR 0031).
    const unknown: Combat = { ...combat, compatibilityProfile: 'combat-v99' };
    expect(() => resolveDamage(swing, plate, 'pve', unknown, rigged(false)))
      .toThrow(/perfil de combate "combat-v99" desconhecido/);
  });
});

describe('mitigação por tipo: resistência, vulnerabilidade e imunidade (CMB-03)', () => {
  const mitigation = (
    resistances: Partial<Record<DamageType, number>>, immunities: DamageType[] = [],
  ) => compileMitigation({ resistances, immunities });
  const guard = (
    resistances: Partial<Record<DamageType, number>>, immunities: DamageType[] = [],
  ) => ({ armor: 20, dodgeChance: 0, mitigation: mitigation(resistances, immunities) });

  it('tipo elemental ignora a armadura quando a tabela diz que ela não vale', () => {
    // A coluna agora é POR TIPO: fogo vale 0 na tabela, então a armadura não subtrai nada.
    expect(resolveDamage(hit(100, 'fire'), guard({}), 'pve', combat, rigged(false)).resolvedDamage)
      .toBe(100);
  });

  it('resistência reduz por fração, sem RNG', () => {
    const result = resolveDamage(hit(100, 'fire'), guard({ fire: 0.5 }), 'pve', combat, rigged(false));
    expect(result.afterResistance).toBe(50);
    expect(result.resolvedDamage).toBe(50);
  });

  it('vulnerabilidade (resistência negativa) amplifica', () => {
    expect(resolveDamage(hit(100, 'fire'), guard({ fire: -0.5 }), 'pve', combat, rigged(false)).resolvedDamage)
      .toBe(150);
  });

  it('imunidade zera, e o piso NÃO a revoga', () => {
    // Armadura altíssima + piso 10 % dariam 10; a imunidade explícita derruba para zero.
    const tank = { armor: 500, dodgeChance: 0, mitigation: mitigation({}, ['physical']) };
    const result = resolveDamage(swing, tank, 'pve', combat, rigged(false));
    expect(result.immune).toBe(true);
    expect(result.resolvedDamage).toBe(0);
    // Sem a imunidade o piso valeria 10 — é a prova de que a imunidade vence o piso.
    expect(resolveDamage(swing, { armor: 500, dodgeChance: 0 }, 'pve', combat, rigged(false)).resolvedDamage)
      .toBe(10);
  });

  it('a ordem é a do contrato: o piso entra ANTES da resistência', () => {
    // Armadura 500 contra 100 físico: afterArmor = −400 e o piso vale 10. Com resistência 0,5
    // o correto é 5 (piso, e SÓ ENTÃO resistência). Se o piso viesse depois, daria 10.
    const tank = { armor: 500, dodgeChance: 0, mitigation: mitigation({ physical: 0.5 }) };
    expect(resolveDamage(swing, tank, 'pve', combat, rigged(false)).resolvedDamage).toBe(5);
  });

  it('o Dodge corta DEPOIS da imunidade e do piso', () => {
    const dodged = resolveDamage(
      hit(100, 'fire'), { armor: 0, dodgeChance: 0, mitigation: mitigation({ fire: 0.5 }) },
      'pve', combat, rigged(true),
    );
    // 100 → resistência 0,5 → 50 → dodge → 25.
    expect(dodged.resolvedDamage).toBe(25);
    const immune = resolveDamage(
      hit(100, 'fire'), { armor: 0, dodgeChance: 0, mitigation: mitigation({}, ['fire']) },
      'pve', combat, rigged(true),
    );
    expect(immune.resolvedDamage).toBe(0);
  });

  it('dano zero por imunidade consome a MESMA rolagem de Dodge', () => {
    // A sequência do gerador não pode depender de o alvo ser imune: um sorteio por golpe.
    const withImmunity = Rng.fromSeed('x');
    const without = Rng.fromSeed('x');
    resolveDamage(
      hit(100, 'fire'), { armor: 0, dodgeChance: 0, mitigation: mitigation({}, ['fire']) },
      'pve', combat, withImmunity,
    );
    resolveDamage(hit(100, 'fire'), { armor: 0, dodgeChance: 0 }, 'pve', combat, without);
    expect(withImmunity.getState()).toEqual(without.getState());
  });

  it('sem mitigação o resultado é BIT A BIT o v1', () => {
    const plain = resolveDamage(swing, plate, 'pve', combat, rigged(false));
    const empty = resolveDamage(
      swing, { armor: 20, dodgeChance: 0, mitigation: mitigation({}) }, 'pve', combat, rigged(false),
    );
    expect(empty).toEqual(plain);
  });
});

describe('outcomes avançados: crítico e leech (CMB-08)', () => {
  /** Sorteios na ORDEM do golpe: Dodge, bloqueio, crítico. */
  const rolls = (...values: boolean[]): Rng => {
    let index = 0;
    return { chance: () => values[index++] ?? false } as unknown as Rng;
  };
  const combatWithDefense: Combat = {
    ...combat,
    defense: { skillId: 'shielding', blockChance: 1, blockTypes: ['physical'] },
  };
  const crit = (chance: number, multiplier: number) => ({ critical: { chance, multiplier } });

  it('sem modificador NÃO consome sorteio novo e é sempre não-crítico', () => {
    // É a âncora do perfil aditivo: o conteúdo que não declara modificador reproduz o v1,
    // inclusive a sequência do gerador.
    const withModifiers = Rng.fromSeed('x');
    const plain = Rng.fromSeed('x');
    const a = resolveDamage(swing, plate, 'pve', combat, withModifiers);
    const b = resolveDamage(swing, plate, 'pve', combat, plain);
    expect(a.critical).toBe(false);
    expect(a.resolvedDamage).toBe(b.resolvedDamage);
    expect(withModifiers.getState()).toEqual(plain.getState());
  });

  it('crítico declarado com chance 0 AINDA consome a rolagem', () => {
    // Mesma regra do bloqueio do CMB-04: a sequência não pode depender do valor.
    const zero = Rng.fromSeed('x');
    const none = Rng.fromSeed('x');
    resolveDamage({ ...swing, modifiers: crit(0, 2) }, plate, 'pve', combat, zero);
    resolveDamage(swing, plate, 'pve', combat, none);
    expect(zero.getState()).not.toEqual(none.getState());
  });

  it('o crítico multiplica o dano mitigado, e o arredondamento continua no fim', () => {
    const result = resolveDamage(
      { ...swing, modifiers: crit(1, 2) }, plate, 'pve', combat, rolls(false, true),
    );
    // 100 − armadura 20 = 80 → crítico ×2 = 160.
    expect(result.critical).toBe(true);
    expect(result.resolvedDamage).toBe(160);
    // O piso e a resistência informados NÃO incluem o crítico — ele é o último estágio.
    expect(result.afterResistance).toBe(80);
  });

  it('a rolagem do crítico é a TERCEIRA: depois do Dodge e da defesa', () => {
    // `rolls(dodge, bloqueio, crítico)`: o crítico só ativa com o terceiro valor.
    const shield = { kind: 'shield' as const, defense: 0 };
    const noCrit = resolveDamage(
      { ...swing, modifiers: crit(1, 2) },
      { armor: 0, dodgeChance: 0, defense: shield }, 'pve', combatWithDefense,
      rolls(false, false, false),
    );
    expect(noCrit.critical).toBe(false);
    const critHit = resolveDamage(
      { ...swing, modifiers: crit(1, 2) },
      { armor: 0, dodgeChance: 0, defense: shield }, 'pve', combatWithDefense,
      rolls(false, false, true),
    );
    expect(critHit.critical).toBe(true);
    expect(critHit.resolvedDamage).toBe(200);
    // Se a rolagem fosse a primeira, o `true` de dodge ativaria o crítico — e não ativa.
    const dodgeFirst = resolveDamage(
      { ...swing, modifiers: crit(1, 2) },
      { armor: 0, dodgeChance: 1, defense: shield }, 'pve', combatWithDefense,
      rolls(true, false, false),
    );
    expect(dodgeFirst.critical).toBe(false);
    expect(dodgeFirst.dodged).toBe(true);
  });

  it('o crítico é consumido uma vez por golpe, mesmo com imunidade', () => {
    // Dano zero por imunidade ainda passa pela mesma rolagem — a sequência é do golpe.
    const immune = resolveDamage(
      { ...swing, modifiers: crit(1, 2) },
      { armor: 0, dodgeChance: 0, mitigation: compileMitigation({ resistances: {}, immunities: ['physical'] }) },
      'pve', combat, rolls(false, true),
    );
    expect(immune.immune).toBe(true);
    expect(immune.critical).toBe(true);
    expect(immune.resolvedDamage).toBe(0);
  });

  it('leech NÃO consome sorteio: a sequência é a de um golpe sem modificador', () => {
    const withLeech = Rng.fromSeed('x');
    const plain = Rng.fromSeed('x');
    resolveDamage({ ...swing, modifiers: { lifeLeech: 0.5, manaLeech: 0.5 } }, plate, 'pve', combat, withLeech);
    resolveDamage(swing, plate, 'pve', combat, plain);
    expect(withLeech.getState()).toEqual(plain.getState());
  });
});

describe('pipeline canônico elemental, físico e mitigações (#473)', () => {
  const ELEMENTS: readonly DamageType[] = ['ice', 'fire', 'energy', 'earth', 'holy', 'death'];

  it('RF-01: os seis elementos ignoram armadura E escudo', () => {
    // A armadura vale 0 fora de `physical` (baseline), e o escudo só aprova `physical` em
    // `blockTypes`. Um alvo de armadura 100 e escudo 100 leva o golpe elemental integral: não é
    // exceção no código, é o conteúdo dizendo qual coluna incide em qual tipo.
    const withShield: Combat = {
      ...combat,
      defense: { skillId: 'shielding', blockChance: 1, blockTypes: ['physical'] },
    };
    const tank = { armor: 100, dodgeChance: 0, defense: { kind: 'shield' as const, defense: 100 } };
    for (const type of ELEMENTS) {
      const result = resolveDamage(hit(100, type), tank, 'pve', withShield, rigged(false));
      expect(result.afterDefense).toBe(100);
      expect(result.armorReduction).toBe(0);
      expect(result.resolvedDamage).toBe(100);
    }
  });

  it('RF-02: imunidade explícita zera cada elemento', () => {
    // `100 % de resistência` é recusado no boot (ADR 0031, DT-02); a imunidade é o mecanismo
    // EXPLÍCITO, e nenhum piso a revoga.
    for (const type of ELEMENTS) {
      const target = {
        armor: 0, dodgeChance: 0,
        mitigation: compileMitigation({ resistances: {}, immunities: [type] }),
      };
      const result = resolveDamage(hit(100, type), target, 'pve', combat, rigged(false));
      expect(result.immune).toBe(true);
      expect(result.resolvedDamage).toBe(0);
    }
  });

  it('RF-03: fraqueza de 10 % rende exatamente 110 % de dano', () => {
    const target = {
      armor: 0, dodgeChance: 0,
      mitigation: compileMitigation({ resistances: { fire: -0.1 }, immunities: [] }),
    };
    expect(resolveDamage(hit(100, 'fire'), target, 'pve', combat, rigged(false)).resolvedDamage)
      .toBe(110);
  });

  it('#510: o rato do Tibia (Huntera Cyclopedia) sofre +20 % de terra/sagrado e −10 % de gelo/morte', () => {
    // packages/content/data/monsters/rat.json — os quatro sinais de mitigation.resistances,
    // traduzidos do "elements" do Huntera (docs/reference/huntera-observed.md Parte V §32):
    // "earth +20, holy +20" é o rato SOFRENDO mais (vulnerabilidade → negativo no schema);
    // "ice −10, death −10" é o rato sofrendo menos (resistência → positivo). Sinal fixado pelo
    // ADR 0031, emenda 2026-09-17: negativo amplifica, positivo reduz.
    const rat = {
      armor: 1, dodgeChance: 0,
      mitigation: compileMitigation({
        resistances: { earth: -0.2, holy: -0.2, ice: 0.1, death: 0.1 },
        immunities: [],
      }),
    };
    expect(resolveDamage(hit(100, 'earth'), rat, 'pve', combat, rigged(false)).resolvedDamage)
      .toBe(120);
    expect(resolveDamage(hit(100, 'holy'), rat, 'pve', combat, rigged(false)).resolvedDamage)
      .toBe(120);
    expect(resolveDamage(hit(100, 'ice'), rat, 'pve', combat, rigged(false)).resolvedDamage)
      .toBe(90);
    expect(resolveDamage(hit(100, 'death'), rat, 'pve', combat, rigged(false)).resolvedDamage)
      .toBe(90);
  });

  it('#473: golpe composto resolve o secundário com os mesmos estágios', () => {
    // Primário físico sofre armadura 20; o secundário de fogo passa intacto. Cada componente
    // tem o próprio `resolvedDamage`, e o secundário NÃO recursa.
    const composite: DamageIntent = {
      rawDamage: 100, source: 'spell', damageType: 'physical',
      secondary: { rawDamage: 50, damageType: 'fire' },
    };
    const result = resolveDamage(composite, plate, 'pve', combat, rigged(false));
    expect(result.resolvedDamage).toBe(80);
    expect(result.secondaryOutcome?.damageType).toBe('fire');
    expect(result.secondaryOutcome?.resolvedDamage).toBe(50);
    expect(result.secondaryOutcome?.secondaryOutcome).toBeUndefined();
  });

  it('#473: o secundário respeita resistência e imunidade do próprio tipo', () => {
    const target = {
      armor: 0, dodgeChance: 0,
      mitigation: compileMitigation({ resistances: { fire: 0.5 }, immunities: ['ice'] }),
    };
    const result = resolveDamage(
      { rawDamage: 40, source: 'spell', damageType: 'ice', secondary: { rawDamage: 40, damageType: 'fire' } },
      target, 'pve', combat, rigged(false),
    );
    expect(result.resolvedDamage).toBe(0);
    expect(result.secondaryOutcome?.resolvedDamage).toBe(20);
  });

  it('#473: sem secundário o outcome NÃO carrega o campo, e é bit a bit o v1', () => {
    const result = resolveDamage(swing, plate, 'pve', combat, rigged(false));
    expect(result.secondaryOutcome).toBeUndefined();
    expect('secondaryOutcome' in result).toBe(false);
  });

  it('#473: declarar secundário consome a rolagem de Dodge dele', () => {
    // O primário continua o primeiro a rolar; o secundário é resolvido depois do primário
    // inteiro, com a própria rolagem — por isso o estado do RNG avança.
    const composed = Rng.fromSeed('x');
    const plain = Rng.fromSeed('x');
    const result = resolveDamage(
      { ...swing, secondary: { rawDamage: 50, damageType: 'fire' } }, plate, 'pve', combat, composed,
    );
    const only = resolveDamage(swing, plate, 'pve', combat, plain);
    expect(result.resolvedDamage).toBe(only.resolvedDamage);
    expect(composed.getState()).not.toEqual(plain.getState());
  });

  it('#473: o golpe composto é determinístico para a mesma semente', () => {
    const run = () => {
      const rng = Rng.fromSeed('composto-1');
      return Array.from({ length: 5 }, () => resolveDamage(
        { ...swing, secondary: { rawDamage: 30, damageType: 'ice' } }, plate, 'pve', combat, rng,
      ));
    };
    expect(run()).toEqual(run());
  });
});

describe('effectiveDodge', () => {
  it('gives the Bestiary bonus in PvE only', () => {
    // §18.5: bônus de Bestiário são PvE-only. O contexto é o que impede a Guild War de
    // herdá-los — a regra fica estrutural, não lembrada.
    const hunter = { armor: 0, dodgeChance: 0.1, pveDodgeBonus: 0.2 };
    expect(effectiveDodge(hunter, 'pve')).toBeCloseTo(0.3);
    expect(effectiveDodge(hunter, 'pvp')).toBeCloseTo(0.1);
  });

  it('clamps to a probability', () => {
    const blessed = { armor: 0, dodgeChance: 0.9, pveDodgeBonus: 0.5 };
    expect(effectiveDodge(blessed, 'pve')).toBe(1);
    expect(effectiveDodge({ armor: 0, dodgeChance: -1 }, 'pve')).toBe(0);
  });
});
