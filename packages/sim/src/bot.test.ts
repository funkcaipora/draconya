import { describe, expect, it } from 'vitest';
import type { BotConfig, Content } from '@draconya/content';
import { BOT_VOCABULARY_VERSION, botConfigSchema } from '@draconya/content';
import { compileBot } from './bot.js';
import type { BotView } from './bot.js';
import { CharacterRuntime } from './character.js';

// O compilador não lê conteúdo ainda — a referência cruzada de magia e supply é M7/M8.
const content = {} as Content;

const hero = (health: number, maxHealth = 100, mana = 100, maxMana = 100) =>
  new CharacterRuntime({
    id: 'hero', position: { x: 1, y: 1, z: 7 },
    health, maxHealth, mana, maxMana, level: 1, xp: 0, vocationId: null,
    staminaMs: null, goldDelta: 0, alive: true, cooldowns: {},
  });

const view = (over: Partial<BotView> = {}): BotView => ({
  self: hero(100), targetCount: 0, target: null, ...over,
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

const heal = (percent: number, spellId: string) => ({
  when: { kind: 'hp' as const, op: '<=' as const, percent },
  do: { kind: 'spell' as const, spellId },
});

describe('as quatro condições viram predicado (FUN-80)', () => {
  it('hp e mana comparam PERCENTUAL, não valor absoluto', () => {
    // A regra do jogador fala em percentual (§13.3). Comparar o valor absoluto faria a mesma
    // configuração se comportar diferente a cada level up, que é o oposto do que ele pediu.
    const bot = compileBot(config({ heal: [heal(50, 'cure')] }));

    expect(bot.select('heal', view({ self: hero(40, 100) }))).toEqual(
      { kind: 'spell', spellId: 'cure' },
    );
    // 400 de 1000 é o MESMO 40%, e a regra vale igual.
    expect(bot.select('heal', view({ self: hero(400, 1000) }))).toEqual(
      { kind: 'spell', spellId: 'cure' },
    );
    expect(bot.select('heal', view({ self: hero(60, 100) }))).toBeNull();
  });

  it('target-hp sem alvo é FALSA, e não um erro', () => {
    // "Ataque quando o alvo estiver abaixo de 30%" não vale quando não há alvo. Lançar aqui
    // derrubaria a sessão por uma regra que o jogador escreveu certo.
    const bot = compileBot(config({
      attack: [{
        when: { kind: 'target-hp', op: '<=', percent: 30 },
        do: { kind: 'spell', spellId: 'finish' },
      }],
    }));

    expect(bot.select('attack', view({ target: null }))).toBeNull();
    expect(bot.select('attack', view({ target: { health: 20, maxHealth: 100 } })))
      .toEqual({ kind: 'spell', spellId: 'finish' });
  });

  it('maxHealth zero não divide por zero', () => {
    const bot = compileBot(config({ heal: [heal(50, 'cure')] }));
    expect(() => bot.select('heal', view({ self: hero(0, 0) }))).not.toThrow();
  });
});

describe('primeira válida executa (§13.4)', () => {
  it('para na primeira, e as de baixo nem são consultadas', () => {
    // O exemplo do PRD: "HP<=30 → forte", "HP<=55 → média", "HP<=80 → fraca". Com HP em 20 as
    // três valem, e só a primeira executa — as outras nem são avaliadas naquele ciclo.
    let avaliadas = 0;
    const contando = (percent: number, spellId: string) => ({
      ...heal(percent, spellId),
      when: { kind: 'hp' as const, op: '<=' as const, percent },
    });
    const bot = compileBot(config({
      heal: [contando(30, 'forte'), contando(55, 'media'), contando(80, 'fraca')],
    }));
    // Espiona os predicados compilados para contar quantos foram consultados.
    const rules = bot.categories.get('heal') ?? [];
    const espiadas = rules.map((rule) => ({
      ...rule,
      when: (v: BotView) => { avaliadas += 1; return rule.when(v); },
    }));
    const espiao = compileBot(config());
    (espiao.categories as Map<string, unknown>).set('heal', espiadas);

    expect(espiao.select('heal', view({ self: hero(20) })))
      .toEqual({ kind: 'spell', spellId: 'forte' });
    expect(avaliadas).toBe(1);
  });

  it('categoria vazia devolve null, e não quebra', () => {
    expect(compileBot(config()).select('heal', view())).toBeNull();
  });

  it('as categorias são independentes — sem prioridade global', () => {
    // §13.5: uma ação de poção não impede a de ataque no mesmo instante. Quem serializa é o
    // cooldown de cada categoria, e ele é a FUN-84.
    const bot = compileBot(config({
      heal: [heal(50, 'cure')],
      attack: [{
        when: { kind: 'targets', op: '>=', count: 3 },
        do: { kind: 'spell', spellId: 'wave' },
      }],
    }));
    const v = view({ self: hero(40), targetCount: 5 });

    expect(bot.select('heal', v)).toEqual({ kind: 'spell', spellId: 'cure' });
    expect(bot.select('attack', v)).toEqual({ kind: 'spell', spellId: 'wave' });
  });
});

describe('compilar é o que torna a avaliação barata', () => {
  it('a avaliação NÃO aloca — nem a view, nem a regra, nem a ação', () => {
    // É o critério de custo da issue. Com 5.000 hunts e cinco categorias por personagem,
    // alocar por avaliação é o coletor rodando o tempo todo por dados que morrem em
    // microssegundos. A ação devolvida é a MESMA referência do vetor compilado, não uma cópia.
    const bot = compileBot(config({ heal: [heal(50, 'cure')] }));
    const v = view({ self: hero(40) });

    const primeira = bot.select('heal', v);
    const segunda = bot.select('heal', v);

    expect(primeira).toBe(segunda);
    expect(primeira).toBe(bot.categories.get('heal')?.[0]?.act);
  });

  it('a view é reaproveitada: mudar o campo muda o resultado, sem recompilar', () => {
    const bot = compileBot(config({ heal: [heal(50, 'cure')] }));
    const v = view({ self: hero(40) });

    expect(bot.select('heal', v)).not.toBeNull();
    v.self = hero(90);
    expect(bot.select('heal', v)).toBeNull();
  });
});

describe('o interruptor por regra (#162)', () => {
  it('a regra desligada nunca dispara, a seguinte é avaliada, e ausente é ligada', () => {
    // Mutação que mata: `compileBot` ignorar `enabled` (a primeira cura dispararia), ou tratar
    // ausente como desligada (a segunda nunca dispararia).
    const config = botConfigSchema.parse({
      version: BOT_VOCABULARY_VERSION,
      heal: [
        { enabled: false, when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'off' } },
        { when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'on' } },
      ],
      potion: [], attack: [], rune: [], support: [],
    });
    const compiled = compileBot(config);
    const hurt = view({ self: hero(50) });
    expect(compiled.select('heal', hurt)).toEqual({ kind: 'spell', spellId: 'on' });
    // Ligar de volta é uma configuração nova: a primeira volta a ser avaliada primeiro.
    const on = botConfigSchema.parse({ ...config, heal: config.heal.map((r) => ({ ...r, enabled: true })) });
    expect(compileBot(on).select('heal', hurt)).toEqual({ kind: 'spell', spellId: 'off' });
  });
});
