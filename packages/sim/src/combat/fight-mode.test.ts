// Os três fatores da postura de luta e o relógio de "bateu há pouco" (M30-03, #550) — vetores dos
// switches do Canary (`player.cpp:840-872`, `player_wheel.cpp:4078-4090`), um por modo.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIGHT_MODE, FIGHT_MODES, attackFactorFor, attackedRecently, defenseFactorFor,
  isFightMode, mitigationFightFactorFor,
} from './fight-mode.js';

describe('FIGHT_MODES', () => {
  it('são os três modos do Canary, ofensivo primeiro — e o default é o FIGHTMODE_ATTACK', () => {
    expect([...FIGHT_MODES]).toEqual(['attack', 'balanced', 'defense']);
    expect(DEFAULT_FIGHT_MODE).toBe('attack');
  });

  it('isFightMode aceita só os três nomes', () => {
    for (const mode of FIGHT_MODES) expect(isFightMode(mode)).toBe(true);
    for (const junk of ['aggressive', 'Attack', '', 1, 2, null, undefined, {}]) {
      expect(isFightMode(junk)).toBe(false);
    }
  });
});

describe('attackFactorFor — Player::getAttackFactor (Canary)', () => {
  it('ofensivo 1,0, balanceado 0,75, defensivo 0,5 — o Canary, não o 1,0/1,2/2,0 (divisor) do TFS', () => {
    expect(attackFactorFor('attack')).toBe(1);
    expect(attackFactorFor('balanced')).toBe(0.75);
    expect(attackFactorFor('defense')).toBe(0.5);
  });
});

describe('defenseFactorFor — Player::getDefenseFactor(false), a variante dinâmica', () => {
  it('ofensivo e balanceado só perdem defesa enquanto o jogador está batendo', () => {
    expect(defenseFactorFor('attack', true)).toBe(0.5);
    expect(defenseFactorFor('attack', false)).toBe(1);
    expect(defenseFactorFor('balanced', true)).toBe(0.75);
    expect(defenseFactorFor('balanced', false)).toBe(1);
  });

  it('defensivo é 1,0 sempre', () => {
    expect(defenseFactorFor('defense', true)).toBe(1);
    expect(defenseFactorFor('defense', false)).toBe(1);
  });
});

describe('mitigationFightFactorFor — o fightFactor de calculateMitigation', () => {
  it('ofensivo 0,8, balanceado 1,0, defensivo 1,2 — escala própria, estática', () => {
    expect(mitigationFightFactorFor('attack')).toBe(0.8);
    expect(mitigationFightFactorFor('balanced')).toBe(1);
    expect(mitigationFightFactorFor('defense')).toBe(1.2);
  });
});

describe('attackedRecently — (agora − lastAttack) < getAttackSpeed()', () => {
  it('nunca bateu (null) não é "batendo" — o `lastAttack == 0` do Canary, sem o relógio de processo', () => {
    expect(attackedRecently(null, 0, 2_000)).toBe(false);
    expect(attackedRecently(null, 1_000_000, 2_000)).toBe(false);
  });

  it('dentro do intervalo é recente; exatamente um intervalo depois já não é (comparação estrita)', () => {
    expect(attackedRecently(10_000, 10_000, 2_000)).toBe(true);
    expect(attackedRecently(10_000, 11_999, 2_000)).toBe(true);
    expect(attackedRecently(10_000, 12_000, 2_000)).toBe(false);
    expect(attackedRecently(10_000, 30_000, 2_000)).toBe(false);
  });

  it('o intervalo é o do parâmetro, não um número fixo', () => {
    expect(attackedRecently(10_000, 10_999, 1_000)).toBe(true);
    expect(attackedRecently(10_000, 11_000, 1_000)).toBe(false);
  });

  it('um carimbo NO FUTURO nunca é recente: o relógio é da sessão que o gravou (#550, revisão)', () => {
    // 57 700 ms de uma hunt anterior lidos por uma sessão nova que está em 1 000 ms.
    expect(attackedRecently(57_700, 1_000, 2_000)).toBe(false);
    expect(attackedRecently(57_700, 1_000, 2_000, () => true)).toBe(false);
    expect(attackedRecently(10_001, 10_000, 2_000)).toBe(false);
  });

  describe('o empate exato (agora − lastAttack == attackSpeed) só abre com o golpe do herói pendente', () => {
    it('com o golpe agendado para este ms o empate é janela ABERTA — quem bate sem parar nunca a fecha', () => {
      expect(attackedRecently(10_000, 12_000, 2_000, () => true)).toBe(true);
      // Nos dois intervalos de conteúdo que o jogo usa, o empate é o mesmo múltiplo.
      expect(attackedRecently(10_000, 11_000, 1_000, () => true)).toBe(true);
    });

    it('sem golpe pendente (o herói parou) o empate é a comparação estrita do Canary: fechada', () => {
      expect(attackedRecently(10_000, 12_000, 2_000, () => false)).toBe(false);
      expect(attackedRecently(10_000, 12_000, 2_000)).toBe(false);
    });

    it('a exceção é SÓ do empate: depois dele a janela fecha mesmo com golpe pendente', () => {
      expect(attackedRecently(10_000, 12_001, 2_000, () => true)).toBe(false);
      expect(attackedRecently(10_000, 30_000, 2_000, () => true)).toBe(false);
    });

    it('a fila só é consultada no empate exato — o golpe recebido comum não paga a varredura', () => {
      let looked = 0;
      const due = (): boolean => { looked += 1; return true; };
      attackedRecently(null, 12_000, 2_000, due);
      attackedRecently(10_000, 10_500, 2_000, due);
      attackedRecently(10_000, 12_001, 2_000, due);
      attackedRecently(57_700, 1_000, 2_000, due);
      expect(looked).toBe(0);
      attackedRecently(10_000, 12_000, 2_000, due);
      expect(looked).toBe(1);
    });
  });
});
