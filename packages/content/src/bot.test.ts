import { describe, expect, it } from 'vitest';
import { validateBotConfig } from './bot.js';
import {
  BOT_CATEGORIES, BOT_VOCABULARY_VERSION, botConfigSchema, botConditionSchema,
} from './schemas.js';
import type { BotConfig, BotLimits } from './schemas.js';

const limits: BotLimits = {
  id: 'baseline', vocabularyVersion: BOT_VOCABULARY_VERSION, categoryCooldownMs: 1_000,
  advancedFromLevel: 50,
  slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
};

const rule = (percent: number) => ({
  when: { kind: 'hp' as const, op: '<=' as const, percent },
  do: { kind: 'spell' as const, spellId: 'strong-heal' },
});

const config = (over: Partial<BotConfig> = {}): BotConfig => ({
  version: BOT_VOCABULARY_VERSION,
  heal: [], potion: [], attack: [], rune: [], support: [],
  ...over,
});

describe('o vocabulário é FECHADO (FUN-73)', () => {
  it('aceita as quatro condições do §13.3, e recusa o que não está na lista', () => {
    // Fechado porque o compilador (ADR 0002) só transforma em predicado o que conhece. Uma
    // condição fora da lista não é "ignorada": é recusada, com o nome do campo.
    for (const ok of [
      { kind: 'hp', op: '<=', percent: 30 },
      { kind: 'mana', op: '<', percent: 20 },
      { kind: 'targets', op: '>=', count: 3 },
      { kind: 'target-hp', op: '>', percent: 50 },
    ]) {
      expect(botConditionSchema.safeParse(ok).success).toBe(true);
    }
    expect(botConditionSchema.safeParse({ kind: 'gold', op: '<', amount: 100 }).success)
      .toBe(false);
  });

  it('recusa operador fora dos quatro, e percentual fora de 0–100', () => {
    // Sem `==`: comparar percentual exato nunca dispara na prática, e é a armadilha que faz o
    // jogador achar que configurou cura e não ter cura nenhuma.
    expect(botConditionSchema.safeParse({ kind: 'hp', op: '==', percent: 30 }).success)
      .toBe(false);
    expect(botConditionSchema.safeParse({ kind: 'hp', op: '<=', percent: 130 }).success)
      .toBe(false);
    expect(botConditionSchema.safeParse({ kind: 'hp', op: '<=', percent: -1 }).success)
      .toBe(false);
  });

  it('a recusa DIZ qual campo está errado, e não "nenhuma variante casou"', () => {
    // É por isso que a união é discriminada por `kind`. O critério da issue é que regra fora
    // do vocabulário seja recusada com MOTIVO — uma mensagem genérica não deixa o jogador
    // corrigir, e não deixa o cliente apontar o slot.
    const bad = botConditionSchema.safeParse({ kind: 'hp', op: '<=', percent: 'trinta' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.path).toContain('percent');
    }
  });

  it('as cinco categorias existem, e a configuração exige todas', () => {
    expect([...BOT_CATEGORIES]).toEqual(['heal', 'potion', 'attack', 'rune', 'support']);
    // Categoria faltando é recusada em vez de virar lista vazia por default: um bot que
    // silenciosamente não tem cura é o defeito, não a tolerância.
    const { heal: _heal, ...semCura } = config();
    expect(botConfigSchema.safeParse(semCura).success).toBe(false);
  });
});

describe('os limites vêm do CONTEÚDO, não do código (FUN-73)', () => {
  it('aceita o que cabe nos slots', () => {
    expect(validateBotConfig(config({ heal: [rule(30), rule(55), rule(80)] }), limits))
      .toEqual([]);
  });

  it('recusa mais regras que slots, dizendo a categoria e os números', () => {
    // Quantos slots cada categoria tem é balanceamento (§13.3), e balanceamento mora onde um
    // designer o alcança sem deploy. O schema não enxerga isso — quem cruza os dois é aqui.
    const problems = validateBotConfig(
      config({ heal: [rule(30), rule(55), rule(80), rule(90)] }), limits,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('heal');
    expect(problems[0]).toContain('4');
    expect(problems[0]).toContain('3');
  });

  it('recusa configuração de outra versão de vocabulário', () => {
    // A configuração é dado PERSISTIDO do jogador. Um vocabulário que muda sem versão quebra
    // a regra de quem a salvou — e quebra em silêncio, que é o pior formato: o bot para de
    // curar e ninguém liga uma coisa à outra.
    const problems = validateBotConfig(config({ version: 99 }), limits);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('99');
  });

  it('lista TODOS os problemas de uma vez, e não só o primeiro', () => {
    // Descobrir um erro por vez é o que faz o jogador desistir de configurar o bot.
    const problems = validateBotConfig(
      config({ version: 99, heal: [rule(1), rule(2), rule(3), rule(4)] }), limits,
    );
    expect(problems).toHaveLength(2);
  });
});
