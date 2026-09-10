import { describe, expect, it } from 'vitest';
import { validateBotConfig } from './bot.js';
import { buildContent } from './content.js';
import {
  BOT_CATEGORIES, BOT_VOCABULARY_VERSION, botConfigSchema, botConditionSchema,
  botTargetingSchema,
} from './schemas.js';
import type { BotConfig } from './schemas.js';

/**
 * O conteúdo mínimo que a validação cruzada precisa: os limites, e os catálogos contra os
 * quais cada regra é conferida. Montado por `buildContent` de propósito — uma estrutura
 * escrita à mão passaria a divergir do que o carregador de verdade produz.
 */
const content = buildContent({
  monsters: [
    {
      id: 'rat', name: 'Rat', outfitId: 21, recommendedLevel: 1,
      health: 20, experience: 5, attack: 6, armor: 0,
      attackIntervalMs: 2_000, stepDurationMs: 500, aggroRadius: 4,
      loot: { items: [] },
    },
    {
      id: 'wolf', name: 'Wolf', outfitId: 22, recommendedLevel: 3,
      health: 40, experience: 12, attack: 12, armor: 2,
      attackIntervalMs: 2_000, stepDurationMs: 400, aggroRadius: 5,
      loot: { items: [] },
    },
  ],
  hunts: [], vocations: [],
  progression: [{
    id: 'baseline', startingHealth: 150, startingMana: 60, startingCapacity: 400,
    healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10,
    vocationLevel: 8, stepDurationMs: 500,
    regen: { healthPerSecond: 1, manaPerSecond: 1 },
    xp: { base: 20, exponent: 2 },
    deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
  }],
  combat: [{
    id: 'baseline', dodgeMultiplier: 0.5,
    armorEffectiveness: { melee: 1, magic: 0 }, minimumDamageFraction: 0.1,
    player: {
      attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 4, dodgeChance: 0.05,
    },
  }],
  stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
  bot: [{
    id: 'baseline', vocabularyVersion: BOT_VOCABULARY_VERSION, categoryCooldownMs: 1_000,
    advancedFromLevel: 50,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
  }],
  spells: [{
    id: 'strong-heal', name: 'Cura Forte', manaCost: 20, cooldownMs: 1_000,
    effect: { kind: 'heal', amount: 60 },
  }],
  supplies: [{
    id: 'health-potion', name: 'Poção de Vida', price: 45,
    effect: { kind: 'heal', amount: 80 },
  }],
});

const rule = (percent: number) => ({
  when: { kind: 'hp' as const, op: '<=' as const, percent },
  do: { kind: 'spell' as const, spellId: 'strong-heal' },
});

const config = (over: Partial<BotConfig> = {}): BotConfig =>
  // Pelo SCHEMA, e não por literal: é o schema que sabe preencher `targeting` e o que vier
  // depois dele. Um literal aqui obriga toda fixture a acompanhar cada campo novo com default,
  // que é trabalho que o parse já faz — e do jeito que a produção faz.
  botConfigSchema.parse({
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
    expect(validateBotConfig(config({ heal: [rule(30), rule(55), rule(80)] }), content))
      .toEqual([]);
  });

  it('recusa mais regras que slots, dizendo a categoria e os números', () => {
    // Quantos slots cada categoria tem é balanceamento (§13.3), e balanceamento mora onde um
    // designer o alcança sem deploy. O schema não enxerga isso — quem cruza os dois é aqui.
    const problems = validateBotConfig(
      config({ heal: [rule(30), rule(55), rule(80), rule(90)] }), content,
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
    const problems = validateBotConfig(config({ version: 99 }), content);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('99');
  });

  it('lista TODOS os problemas de uma vez, e não só o primeiro', () => {
    // Descobrir um erro por vez é o que faz o jogador desistir de configurar o bot.
    const problems = validateBotConfig(
      config({ version: 99, heal: [rule(1), rule(2), rule(3), rule(4)] }), content,
    );
    expect(problems).toHaveLength(2);
  });
});

describe('a referência cruzada, que a FUN-73 deixou como gancho (FUN-74, FUN-77)', () => {
  it('recusa regra que aponta magia inexistente, dizendo a categoria e o slot', () => {
    // A checagem é AQUI, e não na hora de disparar a regra. Uma magia inexistente que só
    // falha ao ser lançada é o bot que para de curar sem ninguém saber por quê — o formato
    // exato de defeito que o vocabulário fechado existe para impedir.
    const problems = validateBotConfig(
      config({
        heal: [{
          when: { kind: 'hp', op: '<=', percent: 30 },
          do: { kind: 'spell', spellId: 'exura-gran-que-nao-existe' },
        }],
      }),
      content,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('heal');
    expect(problems[0]).toContain('slot 1');
    expect(problems[0]).toContain('exura-gran-que-nao-existe');
  });

  it('recusa supply inexistente, e aceita o que está no catálogo', () => {
    expect(validateBotConfig(
      config({
        potion: [{
          when: { kind: 'hp', op: '<=', percent: 50 },
          do: { kind: 'supply', supplyId: 'health-potion' },
        }],
      }),
      content,
    )).toEqual([]);

    expect(validateBotConfig(
      config({
        potion: [{
          when: { kind: 'hp', op: '<=', percent: 50 },
          do: { kind: 'supply', supplyId: 'ultimate-potion' },
        }],
      }),
      content,
    )).toHaveLength(1);
  });

  it('recusa item SEMPRE, porque catálogo de itens ainda não existe', () => {
    // Mesma escolha de `buildContent` com `loot.items`: melhor um slot recusado no boot que
    // uma regra que aponta para o nada e falha calada meses depois.
    const problems = validateBotConfig(
      config({
        support: [{
          when: { kind: 'targets', op: '>=', count: 2 },
          do: { kind: 'item', itemId: 'spike-sword' },
        }],
      }),
      content,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('catálogo de itens');
  });
});

describe('targeting é validado contra o catálogo de MONSTROS (FUN-85)', () => {
  it('recusa priorizar ou ignorar monstro que não existe', () => {
    // Slot morto pela mesma razão que a magia inexistente: a preferência nunca dispara e nada
    // diz por quê. Nomear o campo é o que permite ao cliente apontar onde.
    const problems = validateBotConfig(
      config({ targeting: botTargetingSchema.parse({
        prioritize: ['dragao-que-nao-existe'], ignore: ['outro-que-nao-existe'],
      }) }),
      content,
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('prioritize');
    expect(problems[1]).toContain('ignore');
  });

  it('aceita id que existe no catálogo, mesmo fora da hunt em que ele vai caçar', () => {
    // A configuração é do PERSONAGEM e sobrevive à troca de hunt. Recusar "priorize rato"
    // porque a hunt do momento não tem rato faria a configuração deixar de valer ao mudar de
    // lugar — e o jogador teria que reconfigurar a cada hunt.
    expect(validateBotConfig(
      config({ targeting: botTargetingSchema.parse({ prioritize: ['rat'], ignore: ['wolf'] }) }),
      content,
    )).toEqual([]);
  });
});
