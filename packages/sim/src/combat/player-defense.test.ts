// Vetores calculados à mão a partir do MECANISMO do Canary (#549, M30-02; ADR 0040) —
// `Player::getDefense` (`player.cpp:776-813`), `Player::getArmor` (`player.cpp:658-667`) e
// `PlayerWheel::calculateMitigation` (`player_wheel.cpp:4072-4124`). Cada caso documenta a conta
// no comentário, para o número não parecer mágico.

import { describe, expect, it } from 'vitest';
import {
  playerArmor, playerDefense, playerMitigation,
} from './player-defense.js';

describe('playerDefense', () => {
  // `recentlyAttacked: true` é o jogador BATENDO (a janela `(now - lastAttack) < attackSpeed` do
  // `Player::getDefenseFactor(false)`): ofensivo 0.5, balanceado 0.75. Os vetores antigos desta
  // suíte — escritos quando o fator era o estático do painel — são exatamente esse caso.

  it('desarmado usa a defesa do punho (7) e a skill fist (Draconya: melee)', () => {
    // (10/4 + 2.23) × 7 × 0.5 (ofensivo batendo) × 0.15 (sem escudo, sem arma) = 2.48325 → trunc 2.
    expect(playerDefense({
      fistSkillLevel: 10, shieldSkillLevel: 0, fightMode: 'attack', recentlyAttacked: true,
    })).toBe(2);
  });

  it('skill de defesa zero devolve 1 no modo ofensivo/equilibrado, sem multiplicador nenhum', () => {
    for (const recentlyAttacked of [true, false]) {
      expect(playerDefense({
        fistSkillLevel: 0, shieldSkillLevel: 0, fightMode: 'attack', recentlyAttacked,
      })).toBe(1);
      expect(playerDefense({
        fistSkillLevel: 0, shieldSkillLevel: 0, fightMode: 'balanced', recentlyAttacked,
      })).toBe(1);
    }
  });

  it('skill de defesa zero devolve 2 no modo defensivo', () => {
    expect(playerDefense({
      fistSkillLevel: 0, shieldSkillLevel: 0, fightMode: 'defense', recentlyAttacked: false,
    })).toBe(2);
  });

  it('arma de uma mão sem escudo usa a defesa e a skill DELA, escala 0,146 (defense > 0)', () => {
    // (50/4 + 2.23) × 14 × 0.5 × 0.146 = 15.05406 → trunc 15.
    expect(playerDefense({
      weapon: { defense: 14, extraDefense: 0, skillLevel: 50 },
      fistSkillLevel: 10, shieldSkillLevel: 0, fightMode: 'attack', recentlyAttacked: true,
    })).toBe(15);
  });

  it('escudo + arma de uma mão: defenseValue é o do escudo MAIS o extraDefense da arma, skill de escudo, escala 0,16', () => {
    // Mystic Blade (defense 25, extraDefense 2) + Mastermind Shield (defense 37), skill 95:
    // defenseValue = 37 + 2 = 39; (95/4 + 2.23) × 39 × 0.5 × 0.16 = 81.0576 → trunc 81.
    expect(playerDefense({
      weapon: { defense: 25, extraDefense: 2, skillLevel: 95 },
      shield: { defense: 37 },
      fistSkillLevel: 10, shieldSkillLevel: 95, fightMode: 'attack', recentlyAttacked: true,
    })).toBe(81);
  });

  it('arma de duas mãos sem defesa própria (Royal Crossbow) e sem escudo dá defesa zero', () => {
    // defenseValue = 0 + 0 = 0 → o produto inteiro é zero, mesmo com skill alta.
    expect(playerDefense({
      weapon: { defense: 0, extraDefense: 0, skillLevel: 110 },
      fistSkillLevel: 10, shieldSkillLevel: 0, fightMode: 'attack', recentlyAttacked: true,
    })).toBe(0);
  });

  describe('o fator de postura é o DINÂMICO do Canary (`getDefenseFactor(false)`)', () => {
    // A mesma arma e a mesma skill nos seis cenários (modo × batendo/parado):
    //   base = (50/4 + 2.23) × 14 × 0.146 = 30.10812 (antes do fator)
    //   ofensivo batendo 0.5 → 15.05 → 15 · ofensivo parado 1.0 → 30.10 → 30
    //   balanceado batendo 0.75 → 22.58 → 22 · balanceado parado 1.0 → 30
    //   defensivo (qualquer) 1.0 → 30
    const at = (fightMode: 'attack' | 'balanced' | 'defense', recentlyAttacked: boolean): number =>
      playerDefense({
        weapon: { defense: 14, extraDefense: 0, skillLevel: 50 },
        fistSkillLevel: 10, shieldSkillLevel: 0, fightMode, recentlyAttacked,
      });

    it('ofensivo: 0,5 enquanto bate, 1,0 depois de parar um intervalo', () => {
      expect(at('attack', true)).toBe(15);
      expect(at('attack', false)).toBe(30);
    });

    it('balanceado: 0,75 enquanto bate, 1,0 depois de parar um intervalo', () => {
      expect(at('balanced', true)).toBe(22);
      expect(at('balanced', false)).toBe(30);
    });

    it('defensivo: 1,0 sempre — bater ou não bater não muda a defesa', () => {
      expect(at('defense', true)).toBe(30);
      expect(at('defense', false)).toBe(30);
    });

    it('a postura defensiva nunca dá menos defesa que a ofensiva, batendo ou não', () => {
      expect(at('defense', true)).toBeGreaterThan(at('attack', true));
      expect(at('defense', false)).toBeGreaterThanOrEqual(at('attack', false));
    });
  });
});

describe('playerArmor', () => {
  it('é a identidade — o multiplicador de vocação é 1,0 em todo `vocations.xml` hoje', () => {
    expect(playerArmor(0)).toBe(0);
    expect(playerArmor(42)).toBe(42);
  });
});

describe('playerMitigation', () => {
  const knightVocation = { multiplier: 1.3, primaryShield: 2.05, secondaryShield: 1.25 };
  const paladinVocation = { multiplier: 1.28, primaryShield: 2.08, secondaryShield: 1.2 };
  const sorcererVocation = { multiplier: 1.26, primaryShield: 2.0, secondaryShield: 1.2 };

  it('Knight com escudo real (Mystic Blade + Mastermind Shield) usa o primaryShield', () => {
    // defenseValue = 37 (escudo) + 2 (extraDefense da arma) = 39; shieldFactor = primaryShield
    // (2.05, dos dois lados — escudo e arma concordam); fightFactor 0.8 (ofensivo).
    // ((95 × 1.3 + 2.05 × 39) / 100) × 0.8 = 1.6276 → ceil(162.76)/100 = 1.63.
    expect(playerMitigation({
      shieldSkillLevel: 95,
      vocation: knightVocation,
      weapon: { defense: 25, extraDefense: 2, twoHanded: false, usesAmmo: false },
      shield: { defense: 37, rangedFocus: false },
      fightMode: 'attack',
    })).toBe(1.63);
  });

  it('Paladin com besta de duas mãos (munição) usa secondaryShield como distanceFactor, sem escudo', () => {
    // A checagem de munição vem ANTES da de duas mãos (ordem do Canary): defenseValue e
    // shieldFactor ficam nos defaults (0 e 1) — só distanceFactor muda.
    // ((90 × 1.28 + 1 × 0) / 100) × 0.8 × 1.2 = 1.10592 → ceil(110.592)/100 = 1.11.
    expect(playerMitigation({
      shieldSkillLevel: 90,
      vocation: paladinVocation,
      weapon: { defense: 0, extraDefense: 0, twoHanded: true, usesAmmo: true },
      fightMode: 'attack',
    })).toBe(1.11);
  });

  it('Sorcerer com spellbook (rangedFocus) + wand: distanceFactor do escudo, primaryShield sobrescrito pela arma', () => {
    // Escudo: distanceFactor = secondaryShield (1.2), defenseValue = 16 (defesa do spellbook).
    // Arma (wand, uma mão, sem munição): defenseValue += 0, shieldFactor = primaryShield (2.0)
    // — sobrescreve o default 1 que o ramo do escudo não tocou.
    // ((28 × 1.26 + 2.0 × 16) / 100) × 0.8 × 1.2 = 0.645888 → ceil(64.5888)/100 = 0.65.
    expect(playerMitigation({
      shieldSkillLevel: 28,
      vocation: sorcererVocation,
      weapon: { defense: 0, extraDefense: 0, twoHanded: false, usesAmmo: false },
      shield: { defense: 16, rangedFocus: true },
      fightMode: 'attack',
    })).toBe(0.65);
  });

  it('sem escudo e sem arma, a mitigação vem só da skill (defenseValue 0)', () => {
    // ((10 × 1.3 + 1 × 0) / 100) × 0.8 × 1 = 0.104 → ceil(10.4)/100 = 0.11.
    expect(playerMitigation({
      shieldSkillLevel: 10, vocation: knightVocation, fightMode: 'attack',
    })).toBe(0.11);
  });

  it('a postura defensiva usa fightFactor 1,2 em vez de 0,8 — mais mitigação', () => {
    const attack = playerMitigation({ shieldSkillLevel: 50, vocation: knightVocation, fightMode: 'attack' });
    const defense = playerMitigation({ shieldSkillLevel: 50, vocation: knightVocation, fightMode: 'defense' });
    expect(defense).toBeGreaterThan(attack);
  });

  it('cada postura liga o SEU fightFactor (0,8 / 1,0 / 1,2), estático, sem olhar o relógio de ataque', () => {
    // Sem escudo nem arma: base = (41 × 1.3) / 100 = 0.533 (longe de qualquer fronteira de ceil).
    //   ofensivo    × 0.8 = 0.4264 → ceil(42.64) / 100 = 0.43
    //   balanceado  × 1.0 = 0.533  → ceil(53.3)  / 100 = 0.54
    //   defensivo   × 1.2 = 0.6396 → ceil(63.96) / 100 = 0.64
    const at = (fightMode: 'attack' | 'balanced' | 'defense'): number =>
      playerMitigation({ shieldSkillLevel: 41, vocation: knightVocation, fightMode });
    expect(at('attack')).toBe(0.43);
    expect(at('balanced')).toBe(0.54);
    expect(at('defense')).toBe(0.64);
  });
});
