import { describe, expect, it } from 'vitest';
import { validateBotConfig, validateBotConfigV2 } from './bot.js';
import { buildContent } from './content.js';
import {
  BOT_CATEGORIES, BOT_VOCABULARY_VERSION, BOT_VOCABULARY_VERSION_V1, botConfigSchema,
  botConditionSchema, botConfigV2Schema, botExitRuleSchema, botLureSchema, botRingSwapSchema,
  botRuleSchema, botTargetingSchema,
} from './schemas.js';
import type { BotConfig, BotConfigV2, BotExitRule, BotSlot } from './schemas.js';

/**
 * O conteúdo mínimo que a validação cruzada precisa: os limites, e os catálogos contra os
 * quais cada regra é conferida. Montado por `buildContent` de propósito — uma estrutura
 * escrita à mão passaria a divergir do que o carregador de verdade produz.
 */
const content = buildContent({
  monsters: [
    {
      id: 'rat', name: 'Rat', recommendedLevel: 1,
      health: 20, experience: 5, attack: 6, armor: 0,
      attackIntervalMs: 2_000, speed: 300, aggroRadius: 4,
      loot: { items: [] },
    },
    {
      id: 'wolf', name: 'Wolf', recommendedLevel: 3,
      health: 40, experience: 12, attack: 12, armor: 2,
      attackIntervalMs: 2_000, speed: 300, aggroRadius: 5,
      loot: { items: [] },
    },
  ],
  hunts: [], vocations: [],
  // Aparência derivada (FUN-94): este arquivo valida regra de bot, não arte.
  appearances: [{
    id: 'baseline', pack: 'placeholder',
    monsters: { rat: 1, wolf: 2 }, items: { 'spike-sword': 3, 'life-ring': 4 },
  }],
  progression: [{
    id: 'baseline', startingHealth: 150, startingMana: 60, startingCapacity: 400,
    healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10,
    vocationLevel: 8, startingSpeed: 300, speedPerLevel: 0,
    regen: { healthPerSecond: 1, manaPerSecond: 1 },
    xp: { kind: 'power', base: 20, exponent: 2 },
    deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessedReduction: 0.56, levelFloor: 8 },
  }],
  combat: [{
    id: 'baseline', dodgeMultiplier: 0.5,
    armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 }, minimumDamageFraction: 0.1,
    player: {
      attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 4, dodgeChance: 0.05,
    },
  }],
  stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
  party: [{ id: 'baseline', maxMembers: 4, xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200 } }],
  bot: [{
    id: 'baseline', vocabularyVersion: BOT_VOCABULARY_VERSION, categoryCooldownMs: 1_000,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
  }],
  spells: [
    {
      id: 'strong-heal', name: 'Cura Forte', manaCost: 20, cooldownMs: 1_000,
      effect: { kind: 'heal', amount: 60 },
    },
    {
      id: 'heal-friend-test', name: 'Cura em Amigo', manaCost: 25, cooldownMs: 1_000,
      effect: { kind: 'heal', amount: 50, target: 'friend', range: 4 },
    },
  ],
  supplies: [
    {
      id: 'health-potion', name: 'Poção de Vida', price: 45, group: 'potion',
      effect: { kind: 'heal', amount: 80 },
    },
    {
      id: 'mana-potion-friend', name: 'Poção de Mana em Amigo', price: 50, group: 'potion',
      effect: { kind: 'mana', amount: 100, target: 'friend', range: 1 },
    },
  ],
  items: [
    {
      id: 'spike-sword', name: 'Spike Sword', kind: 'weapon',
      slot: 'hand', weight: 50, value: 0, attack: 24,
    },
    {
      id: 'life-ring', name: 'Life Ring', kind: 'ring',
      slot: 'finger', weight: 1, value: 0, armor: 2,
    },
  ],
});

const rule = (percent: number) => ({
  when: { kind: 'hp' as const, op: '<=' as const, percent },
  do: { kind: 'spell' as const, spellId: 'strong-heal' },
});

const config = (over: Partial<BotConfig> = {}): BotConfig =>
  // Pelo SCHEMA, e não por literal: é o schema que sabe preencher `targeting` e o que vier
  // depois dele. Um literal aqui obriga toda fixture a acompanhar cada campo novo com default,
  // que é o trabalho que o parse já faz — e do jeito que a produção faz.
  botConfigSchema.parse({
    version: BOT_VOCABULARY_VERSION_V1,
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

  it('recusa item SEMPRE — o catálogo e o inventário existem, mas falta o atuador', () => {
    // Desde a FUN-76 o catálogo existe e desde a FUN-82 (#160) o inventário também — a recusa
    // mudou de motivo de novo: não é mais "não há catálogo" nem "não há inventário", é "não há
    // atuador". Aceitar a regra faria o bot escolhê-la e o atuador recusá-la em silêncio a cada
    // avaliação — um slot morto que o jogador não consegue explicar.
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
    expect(problems[0]).toContain('atuador');
  });

  it('e o item que nem existe no catálogo é recusado por OUTRO motivo', () => {
    // A distinção importa para quem lê: "não existe" manda corrigir o id; "exige um atuador"
    // manda esperar. Uma mensagem só para os dois casos faria o jogador procurar um erro de
    // digitação que não está lá.
    const problems = validateBotConfig(
      config({
        support: [{
          when: { kind: 'targets', op: '>=', count: 2 },
          do: { kind: 'item', itemId: 'excalibur' },
        }],
      }),
      content,
    );
    expect(problems[0]).toContain('não existe');
    expect(problems[0]).not.toContain('atuador');
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

describe('regras de saída têm teto (FUN-86)', () => {
  it('recusa mais regras de saída que slots, dizendo os números', () => {
    // A lista é avaliada a cada 250 ms. Sem teto, mil regras salvas viram mil predicados
    // rodando quatro vezes por segundo por hunt — e nada no schema impediria isso.
    const uma = { kind: 'hp-below' as const, percent: 50 };
    const problems = validateBotConfig(
      config({ exit: [uma, uma, uma, uma, uma] }), content,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('5');
    expect(problems[0]).toContain('4');
  });

  it('aceita o que cabe, e lista vazia é o padrão', () => {
    expect(validateBotConfig(config(), content)).toEqual([]);
    expect(config().exit).toEqual([]);
  });

  it('aceita out-of-capacity e combinações de tipos dentro do limite de 4 slots', () => {
    expect(botExitRuleSchema.safeParse({ kind: 'out-of-capacity' }).success).toBe(true);
    const todas: BotExitRule[] = [
      { kind: 'hp-below', percent: 30 },
      { kind: 'out-of-gold' },
      { kind: 'party-member-lost' },
      { kind: 'out-of-capacity' },
    ];
    expect(validateBotConfig(config({ exit: todas }), content)).toEqual([]);

    const excesso: BotExitRule[] = [
      ...todas,
      { kind: 'hp-below', percent: 50 },
    ];
    const problems = validateBotConfig(config({ exit: excesso }), content);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('5');
    expect(problems[0]).toContain('4');
  });
});

describe('lure e ring swap: a seção AVANÇADA do vocabulário (FUN-87, §13.7 e §13.8)', () => {
  const ring = (over: Record<string, unknown> = {}) =>
    botRingSwapSchema.safeParse({ itemId: 'life-ring', equipBelow: 40, removeAbove: 70, ...over });

  it('o lure aceita limiares iguais, e recusa o intervalo invertido', () => {
    // `max` abaixo de `min` deixaria a máquina sem estado alcançável: ela sairia de "correndo"
    // ao chegar no máximo e voltaria na mesma avaliação, por estar abaixo do mínimo.
    //
    // Iguais, porém, VALEM — e é aqui que o lure difere do anel de propósito. Lá os limiares
    // comparam HP, que muda a cada golpe; aqui comparam uma contagem, que só muda quando
    // alguém morre ou nasce. `{ min: 1, max: 1 }` é o comportamento de quem não configurou
    // lure, escrito como configuração.
    expect(botLureSchema.safeParse({ min: 2, max: 5 }).success).toBe(true);
    expect(botLureSchema.safeParse({ min: 5, max: 5 }).success).toBe(true);
    expect(botLureSchema.safeParse({ min: 5, max: 2 }).success).toBe(false);
  });

  it('os dois limiares do anel precisam ser DIFERENTES, e nessa ordem', () => {
    // Limiares iguais apagam a faixa morta: com `equipBelow` igual a `removeAbove`, o HP
    // parado em cima do número troca o anel a cada golpe. Recusar na entrada é mais barato
    // que descobrir pelo extrato cheio de trocas.
    expect(ring().success).toBe(true);
    expect(ring({ equipBelow: 70, removeAbove: 70 }).success).toBe(false);
    expect(ring({ equipBelow: 70, removeAbove: 40 }).success).toBe(false);
  });

  it('o anel apontado precisa existir e precisa VESTIR no dedo', () => {
    // Uma máquina de estados que aponta item inexistente — ou uma espada — é um slot avançado
    // que nunca dispara, e nada dizendo por quê.
    const parsed = ring();
    if (!parsed.success) throw new Error('a fixture do anel deveria parsear');
    expect(validateBotConfig(config({ ringSwap: parsed.data }), content)).toEqual([]);

    const inexistente = ring({ itemId: 'anel-que-nao-existe' });
    if (!inexistente.success) throw new Error('a fixture do anel deveria parsear');
    expect(validateBotConfig(config({ ringSwap: inexistente.data }), content)[0])
      .toContain('não existe');

    const espada = ring({ itemId: 'spike-sword' });
    if (!espada.success) throw new Error('a fixture da espada deveria parsear');
    const problema = validateBotConfig(config({ ringSwap: espada.data }), content)[0];
    expect(problema).toContain('não é anel');
    expect(problema).toContain('hand');
  });

  it('os dois deixaram de ter gate de level (AB-03)', () => {
    // O §13.2 exigia level 50 para lure e ring swap; o ADR 0032 d.4 revogou o gate. Aqui a
    // asserção é que a configuração v1 continua válida SEM o gate — o juiz v1 não olha mais
    // level nenhum.
    const parsed = ring();
    if (!parsed.success) throw new Error('a fixture do anel deveria parsear');
    expect(validateBotConfig(config({ lure: { min: 2, max: 5 }, ringSwap: parsed.data }), content))
      .toEqual([]);
  });
});

describe('o juiz do vocabulário v2 (AB-03)', () => {
  const emptySlots = (): (BotSlot | null)[] => Array.from({ length: 24 }, () => null);
  const set = (slots = emptySlots()) => ({ slots });
  const v2 = (over: Partial<BotConfigV2> = {}): BotConfigV2 => botConfigV2Schema.parse({
    version: 2,
    sets: [set(), set(), set(), set()],
    ...over,
  });

  it('recusa magia e supply inexistentes nomeando conjunto e slot', () => {
    const badSpell = v2({
      sets: [
        set([{ do: { kind: 'spell', spellId: 'nao-existe' }, when: [], auto: true }, ...emptySlots().slice(1)]),
        set(), set(), set(),
      ],
    });
    expect(validateBotConfigV2(badSpell, content)[0]).toContain('conjunto 1, slot 1');
    expect(validateBotConfigV2(badSpell, content)[0]).toContain('nao-existe');

    const badSupply = v2({
      sets: [
        set([null, { do: { kind: 'supply', supplyId: 'nao-existe' }, when: [], auto: true }, ...emptySlots().slice(2)]),
        set(), set(), set(),
      ],
    });
    expect(validateBotConfigV2(badSupply, content)[0]).toContain('conjunto 1, slot 2');
  });

  it('aceita o que existe, e confere as automações contra o catálogo', () => {
    const good = v2({
      sets: [
        set([{ do: { kind: 'spell', spellId: 'strong-heal' }, when: [], auto: true }, ...emptySlots().slice(1)]),
        set(), set(), set(),
      ],
    });
    expect(validateBotConfigV2(good, content)).toEqual([]);

    const badAutomation = v2({
      automations: [{ model: 'renew-ring', params: { itemId: 'nao-existe' }, enter: [], exit: [] }],
    });
    const problems = validateBotConfigV2(badAutomation, content);
    expect(problems[0]).toContain('renew-ring');
    expect(problems[0]).toContain('nao-existe');
  });
});

describe('o interruptor por regra (#162)', () => {
  it('a configuração gravada antes do campo continua válida, e a regra desligada continua contando slot', () => {
    // Mutação que mata: `enabled` obrigatório (a config antiga reprova), ou `validateBotConfig`
    // contar só as ligadas (desligar viraria truque para ganhar slot).
    expect(botConfigSchema.safeParse(config({ heal: [rule(30)] })).success).toBe(true);
    const parsed = botConfigSchema.parse(config({ heal: [{ ...rule(30), enabled: false }] }));
    expect(parsed.heal[0]?.enabled).toBe(false);
    const problems = validateBotConfig(
      config({ heal: [rule(30), rule(55), { ...rule(80), enabled: false }, rule(90)] }), content,
    );
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('follow de membro e alvo de regra (§24-30, ADR 0035 d.9 e d.10)', () => {
  it('follow ausente é none, e os três kind parseiam', () => {
    // Mutação que mata: tirar o `.default({ kind: 'none' })` — toda configuração salva antes
    // deste campo viraria inválida.
    expect(config().follow).toEqual({ kind: 'none' });
    for (const follow of [
      { kind: 'none' }, { kind: 'leader' }, { kind: 'member', characterId: 'abc' },
    ]) {
      expect(botConfigSchema.parse({ ...config(), follow }).follow).toEqual(follow);
    }
    expect(botConfigSchema.safeParse({ ...config(), follow: { kind: 'guild' } }).success).toBe(false);
  });

  it('target ausente é self, e os três kind parseiam', () => {
    // Mutação que mata: tirar o `.default({ kind: 'self' })` — toda regra salva sem `target`
    // reprovaria.
    expect(botRuleSchema.parse(rule(30)).target).toEqual({ kind: 'self' });
    for (const target of [
      { kind: 'self' }, { kind: 'lowest-hp-member' }, { kind: 'member', characterId: 'abc' },
    ]) {
      expect(botRuleSchema.parse({ ...rule(30), target }).target).toEqual(target);
    }
  });

  it('recusa alvo diferente de self em attack e rune, nomeando a categoria', () => {
    // Mutação que mata: trocar `category === 'attack' || category === 'rune'` por só uma delas.
    const attack = validateBotConfig(
      config({
        attack: [{
          ...rule(50), do: { kind: 'spell', spellId: 'strong-heal' },
          target: { kind: 'lowest-hp-member' },
        }],
      }),
      content,
    );
    expect(attack).toHaveLength(1);
    expect(attack[0]).toContain('attack');

    const rune = validateBotConfig(
      config({
        rune: [{
          ...rule(50), do: { kind: 'spell', spellId: 'strong-heal' },
          target: { kind: 'lowest-hp-member' },
        }],
      }),
      content,
    );
    expect(rune).toHaveLength(1);
    expect(rune[0]).toContain('rune');
  });

  it('recusa alvo em outro personagem quando a magia é self-only, e aceita quando ela é friend', () => {
    // Mutação que mata: remover a checagem `effect.target === 'friend'`, deixando qualquer
    // heal/mana valer como alvo de terceiro.
    const selfOnly = validateBotConfig(
      config({ heal: [{ ...rule(50), target: { kind: 'lowest-hp-member' } }] }), // do: strong-heal
      content,
    );
    expect(selfOnly).toHaveLength(1);
    expect(selfOnly[0]).toContain('heal');

    const friendTargetable = validateBotConfig(
      config({
        heal: [{
          ...rule(50), do: { kind: 'spell', spellId: 'heal-friend-test' },
          target: { kind: 'lowest-hp-member' },
        }],
      }),
      content,
    );
    expect(friendTargetable).toEqual([]);
  });

  it('a mesma regra vale para supply: self-only recusa, friend aceita', () => {
    const selfOnly = validateBotConfig(
      config({
        potion: [{
          ...rule(50), do: { kind: 'supply', supplyId: 'health-potion' },
          target: { kind: 'member', characterId: 'abc' },
        }],
      }),
      content,
    );
    expect(selfOnly).toHaveLength(1);
    expect(selfOnly[0]).toContain('potion');

    const friendTargetable = validateBotConfig(
      config({
        potion: [{
          ...rule(50), do: { kind: 'supply', supplyId: 'mana-potion-friend' },
          target: { kind: 'member', characterId: 'abc' },
        }],
      }),
      content,
    );
    expect(friendTargetable).toEqual([]);
  });
});
