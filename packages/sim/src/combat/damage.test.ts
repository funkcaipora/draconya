import type { Combat } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { effectiveDodge, resolveDamage } from './damage.js';
import type { DamageIntent, DamageType } from './damage.js';

const combat: Combat = {
  id: 'baseline',
  compatibilityProfile: 'combat-v1',
  dodgeMultiplier: 0.5,
  armorEffectiveness: { melee: 1, magic: 0 },
  minimumDamageFraction: 0.1,
  // O personagem desarmado não participa de nenhum caso deste arquivo: aqui o atacante e o
  // defensor são montados à mão, tijolo por tijolo. Está preenchido porque o tipo pede.
  player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 4, dodgeChance: 0.05 },
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
      ...combat, armorEffectiveness: { melee: 1, magic: 1 },
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
      armorReduction: 20,
      minimumDamage: 10,
      dodged: false,
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
