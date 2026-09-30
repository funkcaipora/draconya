import { describe, expect, it, vi } from 'vitest';
import type { ItemDefinition, TrainingRegister, TrainingRules } from '../state/hud.js';
import {
  attemptTrainingIntent, bankView, buyItemMessage, canAfford, chargeYield, enterTrainingMessage,
  formatBankTime, offlineSkillMessage, ownedWeapons, shopWeapons, skillNameOf,
} from './training-view.js';

const HOUR = 3_600_000;

const rules: TrainingRules = {
  perCharge: { tries: 7, manaSpent: 600 },
  bankCapMs: 12 * HOUR, graceMs: 600_000,
  spendCapMs: { free: 6 * HOUR, premium: 12 * HOUR },
  offlineSkills: [
    { skillId: 'sword', name: 'Espada', kind: 'attacks' },
    { skillId: 'magic', name: 'Magic Level', kind: 'mana' },
  ],
};

const weapon = (id: string, skillId: string, charges: number, buyPrice?: number): ItemDefinition => ({
  id, name: id.replaceAll('-', ' '), appearanceId: 100, weight: 10, slot: null, twoHanded: false,
  exercise: { skillId, charges }, ...(buyPrice === undefined ? {} : { buyPrice }),
});
const items: ItemDefinition[] = [
  weapon('lasting-exercise-sword', 'sword', 14_400, 7_500_000),
  weapon('exercise-sword', 'sword', 500, 347_222),
  weapon('exercise-rod', 'magic', 500, 347_222),
  weapon('durable-exercise-sword', 'sword', 1_800, 1_250_000),
  weapon('not-for-sale', 'sword', 50),
  { id: 'rock', name: 'Rock', appearanceId: 5, weight: 1, slot: null, twoHanded: false },
];

const training = (over: Partial<TrainingRegister> = {}): TrainingRegister => ({
  offlineBankMs: 0, offlineSkill: null, weapons: [], activeInstanceId: null, ...over,
});

describe('a loja de exercise weapons', () => {
  it('lista só o que o servidor marcou como comprável, por skill na ordem do livro e da menor para a maior carga', () => {
    // Mutação que mata: ordenar por preço ou por nome — o Tibia mostra comum, durable, lasting.
    expect(shopWeapons(items, rules).map((row) => row.itemId)).toEqual([
      'exercise-sword', 'durable-exercise-sword', 'lasting-exercise-sword', 'exercise-rod',
    ]);
    expect(shopWeapons(items, rules)[0]).toMatchObject({ skillId: 'sword', charges: 500, price: 347_222 });
  });

  it('sem catálogo, ou sem itens à venda, não há loja', () => {
    expect(shopWeapons(undefined, rules)).toEqual([]);
    expect(shopWeapons([{ id: 'rock', name: 'Rock', appearanceId: 5, weight: 1, slot: null, twoHanded: false }], rules)).toEqual([]);
  });

  it('uma skill fora do livro vai para o fim, sem quebrar a ordem', () => {
    const odd = [...items, weapon('exercise-fist', 'fist', 500, 1)];
    expect(shopWeapons(odd, rules).at(-1)?.itemId).toBe('exercise-fist');
  });

  it('habilita o botão quando o gold cobre o preço — a decisão de verdade é do servidor', () => {
    expect(canAfford(347_222, 347_222)).toBe(true);
    expect(canAfford(347_221, 347_222)).toBe(false);
  });
});

describe('as exercise weapons carregadas', () => {
  it('mostra as cargas RESTANTES do `training-state` sobre o total da definição, e marca a que está em uso', () => {
    const state = training({
      weapons: [
        { instanceId: 'a', itemId: 'exercise-sword', charges: 431 },
        { instanceId: 'b', itemId: 'exercise-rod', charges: 500 },
      ],
      activeInstanceId: 'a',
    });
    expect(ownedWeapons(state, items)).toEqual([
      {
        instanceId: 'a', itemId: 'exercise-sword', name: 'exercise sword', appearanceId: 100,
        skillId: 'sword', charges: 431, totalCharges: 500, active: true,
      },
      {
        instanceId: 'b', itemId: 'exercise-rod', name: 'exercise rod', appearanceId: 100,
        skillId: 'magic', charges: 500, totalCharges: 500, active: false,
      },
    ]);
  });

  it('uma instância cujo item o catálogo não conhece — ou que não é exercise weapon — cai fora', () => {
    const state = training({
      weapons: [
        { instanceId: 'x', itemId: 'desconhecida', charges: 5 },
        { instanceId: 'r', itemId: 'rock', charges: 5 },
      ],
    });
    expect(ownedWeapons(state, items)).toEqual([]);
    expect(ownedWeapons(null, items)).toEqual([]);
    expect(ownedWeapons(state, undefined)).toEqual([]);
  });
});

describe('o que as cargas rendem', () => {
  it('skills por ataque rendem tries (7 por carga), o magic level rende mana gasta (600 por carga)', () => {
    expect(chargeYield(500, 'sword', rules)).toEqual({ unit: 'tries', amount: 3_500 });
    expect(chargeYield(500, 'magic', rules)).toEqual({ unit: 'mana', amount: 300_000 });
    // Sem regras (servidor sem Treino) a tela não inventa um número.
    expect(chargeYield(500, 'sword', undefined)).toBeNull();
  });

  it('o nome da skill é o do livro; sem ele, o próprio id — nunca um nome inventado', () => {
    expect(skillNameOf(rules, 'sword')).toBe('Espada');
    expect(skillNameOf(rules, 'fist')).toBe('fist');
    expect(skillNameOf(undefined, 'sword')).toBe('sword');
  });
});

describe('o banco de offline training', () => {
  it('formata em horas e minutos, arredondando para baixo', () => {
    expect(formatBankTime(0)).toBe('0 min');
    expect(formatBankTime(59_999)).toBe('0 min');
    expect(formatBankTime(45 * 60_000)).toBe('45 min');
    expect(formatBankTime(3 * HOUR)).toBe('3 h');
    expect(formatBankTime(3 * HOUR + 20 * 60_000)).toBe('3 h 20 min');
    expect(formatBankTime(-5)).toBe('0 min');
  });

  it('a barra é a razão banco/teto, presa em 0–1; sem registro ou sem regras, zero', () => {
    expect(bankView(training({ offlineBankMs: 3 * HOUR }), rules)).toEqual({ bankMs: 3 * HOUR, capMs: 12 * HOUR, fraction: 0.25 });
    expect(bankView(training({ offlineBankMs: 20 * HOUR }), rules).fraction).toBe(1);
    expect(bankView(null, rules)).toEqual({ bankMs: 0, capMs: 12 * HOUR, fraction: 0 });
    expect(bankView(training({ offlineBankMs: HOUR }), undefined).fraction).toBe(0);
  });
});

describe('as intenções do Treino (invariante 4: só QUAL id)', () => {
  it('monta exatamente a mensagem que o protocolo define — sem preço, sem cargas, sem resultado', () => {
    expect(enterTrainingMessage('w1')).toEqual({ type: 'enter-training', itemInstanceId: 'w1' });
    expect(buyItemMessage('exercise-sword')).toEqual({ type: 'buy-item', itemId: 'exercise-sword' });
    expect(offlineSkillMessage('sword')).toEqual({ type: 'set-offline-training-skill', skillId: 'sword' });
    expect(offlineSkillMessage(null)).toEqual({ type: 'set-offline-training-skill', skillId: null });
  });

  it('só avisa que mandou quando a intenção FOI enviada — sem conexão o modal fica aberto', () => {
    const sent = vi.fn(() => true);
    const onSent = vi.fn();
    expect(attemptTrainingIntent(enterTrainingMessage('w1'), sent, onSent)).toBe(true);
    expect(onSent).toHaveBeenCalledTimes(1);

    const offline = vi.fn(() => false);
    const notSent = vi.fn();
    expect(attemptTrainingIntent(enterTrainingMessage('w1'), offline, notSent)).toBe(false);
    expect(notSent).not.toHaveBeenCalled();
  });
});
