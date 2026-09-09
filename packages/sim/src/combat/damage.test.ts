import type { Combat } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { effectiveDodge, resolveDamage } from './damage.js';

const combat: Combat = {
  id: 'baseline',
  dodgeMultiplier: 0.5,
  armorEffectiveness: { melee: 1, magic: 0 },
  minimumDamageFraction: 0.1,
};

/** Gerador de mentira, para separar "esquivou" de "não esquivou" sem depender de semente. */
const rigged = (dodges: boolean): Rng =>
  ({ chance: () => dodges } as unknown as Rng);

const plate = { armor: 20, dodgeChance: 0 };
const swing = { power: 100, kind: 'melee' } as const;

describe('resolveDamage', () => {
  it('always hits: there is no offensive roll', () => {
    // §12.2. Não existe miss ofensivo do jogador — some metade da matemática de combate, e
    // some junto a frustração de errar sem entender por quê.
    const result = resolveDamage(swing, plate, 'pve', combat, rigged(false));
    expect(result.damage).toBe(80);
    expect(result.dodged).toBe(false);
  });

  it('halves the damage when dodge triggers, and never zeroes it', () => {
    // Esquiva não é invulnerabilidade: um golpe que passa pela defesa ainda machuca.
    const result = resolveDamage(swing, plate, 'pve', combat, rigged(true));
    expect(result.damage).toBe(40);
    expect(result.dodged).toBe(true);
  });

  it('applies the floor so heavy armour never zeroes a hit', () => {
    // Dano zero contra um alvo pesado vira impasse silencioso, sem nada na tela explicando.
    const tank = { armor: 500, dodgeChance: 0 };
    expect(resolveDamage(swing, tank, 'pve', combat, rigged(false)).damage).toBe(10);
  });

  it('lets the table decide whether armour applies to magic', () => {
    // Nenhum coeficiente no código (§12.1). Aqui a tabela diz que armadura não vale contra
    // magia; mudar o JSON muda o resultado sem tocar em lógica.
    const spell = { power: 100, kind: 'magic' } as const;
    expect(resolveDamage(spell, plate, 'pve', combat, rigged(false)).damage).toBe(100);

    const armouredAgainstMagic: Combat = {
      ...combat, armorEffectiveness: { melee: 1, magic: 1 },
    };
    expect(resolveDamage(spell, plate, 'pve', armouredAgainstMagic, rigged(false)).damage)
      .toBe(80);
  });

  it('rounds only at the end', () => {
    // Arredondar antes do dodge faria 50% de 3 virar 2, e o jogador veria uma esquiva que
    // reduziu um terço em vez de metade.
    const soft = { armor: 0, dodgeChance: 0 };
    const weak = { power: 3, kind: 'melee' } as const;
    expect(resolveDamage(weak, soft, 'pve', combat, rigged(true)).damage).toBe(2);
    expect(resolveDamage(weak, soft, 'pve', combat, rigged(false)).damage).toBe(3);
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
