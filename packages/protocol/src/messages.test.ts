import { describe, expect, it } from 'vitest';
import { decodeS2C, encodeS2C } from './codec.js';
import {
  CLIENT_TO_SERVER, BURNED_OPCODES_C2S, BURNED_OPCODES_S2C,
  OPCODE_TO_NAME_C2S, OPCODE_TO_NAME_S2C, SERVER_TO_CLIENT,
} from './messages.js';
import { C2S_SCHEMAS, S2C_SCHEMAS } from './types.js';
import type { S2CMessage } from './types.js';

describe('English payload contract', () => {
  it('accepts English directions and rejects the legacy payload', () => {
    expect(C2S_SCHEMAS.walk.safeParse({ direction: 'north' }).success).toBe(true);
    // Payload anterior à migração; não há tradução automática no contrato novo.
    expect(C2S_SCHEMAS.walk.safeParse(JSON.parse('{"direcao":"norte"}')).success).toBe(false);
  });
});

describe('opcode map', () => {
  it('has no duplicate opcode', () => {
    expect(OPCODE_TO_NAME_C2S.size).toBe(Object.keys(CLIENT_TO_SERVER).length);
    expect(OPCODE_TO_NAME_S2C.size).toBe(Object.keys(SERVER_TO_CLIENT).length);
  });

  it('does not reuse burned opcodes', () => {
    for (const op of BURNED_OPCODES_C2S) expect(OPCODE_TO_NAME_C2S.has(op)).toBe(false);
    for (const op of BURNED_OPCODES_S2C) expect(OPCODE_TO_NAME_S2C.has(op)).toBe(false);
  });

  it('every declared message has a schema', () => {
    for (const name of Object.keys(CLIENT_TO_SERVER)) {
      expect(C2S_SCHEMAS).toHaveProperty(name);
    }
    for (const name of Object.keys(SERVER_TO_CLIENT)) {
      expect(S2C_SCHEMAS).toHaveProperty(name);
    }
  });

  it('every schema corresponds to a declared message', () => {
    for (const name of Object.keys(C2S_SCHEMAS)) {
      expect(CLIENT_TO_SERVER).toHaveProperty(name);
    }
    for (const name of Object.keys(S2C_SCHEMAS)) {
      expect(SERVER_TO_CLIENT).toHaveProperty(name);
    }
  });
});

describe('combat presentation messages (FUN-109)', () => {
  const hit: S2CMessage = { type: 'creature-hit', id: 42, amount: 40, kind: 'spell' };
  const effect: S2CMessage = { type: 'effect', position: { x: 10, y: 9, z: 7 }, effectId: 13 };
  const missile: S2CMessage = {
    type: 'missile', from: { x: 10, y: 10, z: 7 }, to: { x: 10, y: 7, z: 7 }, missileId: 5,
  };

  it('round trips the hit, the effect and the missile through the codec', () => {
    // Três mensagens, e não uma: cada uma tem destino diferente no cliente, e um golpe de
    // corpo a corpo dispara duas enquanto uma magia dispara as três. O que se prende aqui é
    // que as três estão nas DUAS tabelas — opcode e schema — e sobrevivem ao fio inteiras.
    // Mutação que mata: apagar `missile: 19` de SERVER_TO_CLIENT (`decodeS2C` devolve `null`),
    // ou tirar `'spell'` do enum de `kind`.
    for (const message of [hit, effect, missile]) {
      expect(decodeS2C(encodeS2C(message))).toEqual([message]);
    }
  });

  it('is server-to-client only: the client sees the hit, it never reports one', () => {
    // Invariante 4. Se um dia alguém precisar mandar "acertei" do cliente, o lugar de
    // descobrir que isso é errado é aqui, e não na revisão do PR.
    // Mutação que mata: acrescentar `'creature-hit': 14` a CLIENT_TO_SERVER.
    for (const name of ['creature-hit', 'effect', 'missile']) {
      expect(CLIENT_TO_SERVER).not.toHaveProperty(name);
      expect(C2S_SCHEMAS).not.toHaveProperty(name);
    }
  });

  it('rejects a negative amount: healing is a kind, not a sign', () => {
    // Cura como "dano negativo" seria dois jeitos de dizer a mesma coisa, e o cliente tendo
    // de reconhecer os dois. Zero passa: o golpe absorvido pela armadura também aparece.
    // Mutação que mata: remover `.nonnegative()` de `amount` (o negativo passa a decodificar).
    expect(decodeS2C(encodeS2C({ ...hit, amount: -1 }))).toBeNull();
    expect(decodeS2C(encodeS2C({ ...hit, amount: 0 }))).toEqual([{ ...hit, amount: 0 }]);
  });

  it('rejects an unknown hit kind', () => {
    // O `kind` é o que decide a cor. Um valor fora da lista chegaria no cliente sem cor
    // nenhuma, e o número apareceria em branco sobre a criatura — ou não apareceria.
    // Mutação que mata: `z.enum([...])` → `z.string()` em `kind`.
    expect(decodeS2C(encodeS2C({ ...hit, kind: 'poison' as 'melee' }))).toBeNull();
  });

  it('rejects effectId and missileId of zero: there is no appearance zero', () => {
    // O protocolo não sabe o que o 13 desenha, mas sabe que zero não desenha nada — e uma
    // mensagem que manda desenhar nada é um bug do servidor que o cliente não deve esconder.
    // Mutação que mata: `.positive()` → `.nonnegative()` em `effectId` ou em `missileId`.
    expect(decodeS2C(encodeS2C({ ...effect, effectId: 0 }))).toBeNull();
    expect(decodeS2C(encodeS2C({ ...missile, missileId: 0 }))).toBeNull();
  });

  it('rejects a fractional id and a fractional amount: both are counted, never measured', () => {
    // `id` é a chave da criatura no cliente, e 1.5 não é chave de nada — a mensagem chegaria
    // e o número flutuaria sobre um tile vazio. `amount` é o que se desenha em cima da
    // criatura, e meio ponto de vida não existe: `resolveDamage` arredonda antes de emitir,
    // então uma fração aqui é o servidor mandando um número que ele mesmo nunca calculou.
    // Mutação que mata: remover `.int()` de `id` ou de `amount` em `creature-hit`.
    expect(decodeS2C(encodeS2C({ ...hit, id: 1.5 }))).toBeNull();
    expect(decodeS2C(encodeS2C({ ...hit, amount: 1.5 }))).toBeNull();
  });

  it('rejects an effect without position and a missile without origin', () => {
    // Sem `position`, o efeito não tem tile para nascer; sem `from`, o projétil não tem de
    // onde partir. Tornar qualquer um dos dois opcional seria admitir a mensagem que o
    // cliente não consegue desenhar — e o caso de "veio `missile` sem `from`" viraria um
    // estado possível, que é exatamente o que separar as três mensagens quis evitar.
    // A omissão é feita por cast porque `encodeS2C` não valida: só o decode confere o schema.
    // Mutação que mata: `position: Point.optional()` em `effect`, ou `from: Point.optional()`
    // em `missile`.
    const effectWithoutPosition = { type: 'effect', effectId: 13 } as S2CMessage;
    const missileWithoutFrom = {
      type: 'missile', to: { x: 10, y: 7, z: 7 }, missileId: 5,
    } as S2CMessage;
    expect(decodeS2C(encodeS2C(effectWithoutPosition))).toBeNull();
    expect(decodeS2C(encodeS2C(missileWithoutFrom))).toBeNull();
  });
});

describe('the inventory message (FUN-90, FUN-108)', () => {
  const sword = { instanceId: 'i1', itemId: 'sword', quantity: 1 };
  const inventory: S2CMessage = {
    type: 'inventory',
    backpack: [{ instanceId: 'i2', itemId: 'health-potion', quantity: 5 }, null],
    satchel: [],
    equipped: { hand: sword },
    capacity: { used: 130, total: 400 },
  };

  it('round trips the equipped item WHOLE: id, item and quantity, like a backpack entry', () => {
    // O item vestido não está na mochila — o `sim` o MOVE ao equipar —, então `slot →
    // instanceId` deixava o cliente sem como chegar à definição: o slot ficava sem nome e
    // sem sprite. O que se prende aqui é que o equipado atravessa o fio com a mesma forma
    // de uma entrada da mochila.
    // Mutação que mata: `equipped: z.record(z.string(), z.string())` (a forma antiga) — o
    // decode recusa a mensagem e devolve `null`.
    expect(decodeS2C(encodeS2C(inventory))).toEqual([inventory]);
    const [decoded] = decodeS2C(encodeS2C(inventory)) ?? [];
    expect(decoded?.type === 'inventory' && decoded.equipped['hand']).toEqual(sword);
  });

  it('rejects the legacy `slot → instanceId` shape: a bare id is not an item', () => {
    // É a mutação que importa do lado do SERVIDOR: um host que voltasse a mandar só o id
    // seria recusado aqui, em silêncio — e o inventário nunca chegaria à tela. Este teste é o
    // que transforma o silêncio em falha.
    // Mutação que mata: aceitar `z.union([CarriedItem, z.string()])` no valor do record.
    const legacy = { ...inventory, equipped: { hand: 'i1' } } as unknown as S2CMessage;
    expect(decodeS2C(encodeS2C(legacy))).toBeNull();
  });

  it('rejects an equipped entry without itemId: the id alone is what the bug was', () => {
    // Mutação que mata: `itemId: z.string().min(1).optional()` no `CarriedItem`.
    const withoutItemId = {
      ...inventory, equipped: { hand: { instanceId: 'i1', quantity: 1 } },
    } as unknown as S2CMessage;
    expect(decodeS2C(encodeS2C(withoutItemId))).toBeNull();
  });

  it('keeps the same opcode: it is the same message, with more inside', () => {
    // Como o `catalogue` ao ganhar o vocabulário do bot: o assunto não mudou, só o conteúdo.
    // Um opcode novo queimaria o 16 por uma mensagem que nunca deixou de existir.
    // Mutação que mata: renumerar `inventory` em SERVER_TO_CLIENT.
    expect(SERVER_TO_CLIENT.inventory).toBe(16);
  });
});

describe('outfit colours on the creature (FUN-104)', () => {
  const appear: S2CMessage = {
    type: 'creature-appear', id: 7, position: { x: 1, y: 2, z: 0 }, appearanceId: 128,
    name: 'Liesh', health: 150, maxHealth: 150,
  };
  const colors = { head: 114, body: 90, legs: 20, feet: 3 };

  it('round trips the four colours, and a creature without them: the old game node still speaks', () => {
    // Mutação que mata: tirar o `.optional()` de `colors` (o segundo caso devolve `null`).
    expect(decodeS2C(encodeS2C({ ...appear, colors }))).toEqual([{ ...appear, colors }]);
    expect(decodeS2C(encodeS2C(appear))).toEqual([appear]);
  });

  it('the session state carries the same creature shape, colours included', () => {
    const state: S2CMessage = {
      type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
      self: {
        creatureId: 7, characterId: 'c1', health: 150, maxHealth: 150, mana: 0, maxMana: 0,
        level: 1, xp: 0, vocationId: null, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 },
      },
      world: { groundItems: [], mapId: 'city', creatures: [{ ...appear, colors }].map(({ type: _type, ...rest }) => rest) },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    };
    expect(decodeS2C(encodeS2C(state))).toEqual([state]);
  });

  it('rejects a colour outside the 133-entry palette, a fraction, and a missing channel', () => {
    // Um índice 133 leria fora da paleta no cliente; melhor recusar no fio que pintar lixo.
    expect(decodeS2C(encodeS2C({ ...appear, colors: { ...colors, head: 133 } }))).toBeNull();
    expect(decodeS2C(encodeS2C({ ...appear, colors: { ...colors, feet: -1 } }))).toBeNull();
    expect(decodeS2C(encodeS2C({ ...appear, colors: { ...colors, body: 1.5 } }))).toBeNull();
    const { feet: _feet, ...threeChannels } = colors;
    expect(decodeS2C(encodeS2C({ ...appear, colors: threeChannels as typeof colors }))).toBeNull();
    // Os dois extremos ENTRAM: 0 é a primeira cor da paleta e 132 a última. Sem o 132 aqui,
    // um `.max(131)` passaria por toda a suíte.
    expect(decodeS2C(encodeS2C({ ...appear, colors: { ...colors, head: 0, feet: 132 } })))
      .toEqual([{ ...appear, colors: { ...colors, head: 0, feet: 132 } }]);
  });
});

describe('the live analyzer (FUN-110)', () => {
  const update: S2CMessage = {
    type: 'analyzer',
    aggregates: {
      durationMs: 650_000, xpGained: 1_000, goldGained: 340, goldSpent: 120, kills: 13, deaths: 0,
      itemsLooted: 5, suppliesUsed: 7, bestBasicHit: 88, bestSpellHit: 140,
    },
    notableEvents: [{ atMs: 1_000, type: 'level-up' }],
  };

  it('round trips the aggregates and the notable events', () => {
    // Mutação que mata: apagar `analyzer: 20` de SERVER_TO_CLIENT (`decodeS2C` devolve `null`).
    expect(decodeS2C(encodeS2C(update))).toEqual([update]);
  });

  it('is server-to-client only: the client reads what the hunt yielded, it never reports it', () => {
    expect('analyzer' in S2C_SCHEMAS).toBe(true);
    expect('analyzer' in C2S_SCHEMAS).toBe(false);
  });

  it('accepts the aggregates of an older node, without the FUN-78 fields', () => {
    const older = {
      ...update,
      aggregates: { durationMs: 1, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
    };
    expect(decodeS2C(encodeS2C(older))).toEqual([older]);
  });
});

describe('the bot configuration in force rides the session state (FUN-111)', () => {
  const state: S2CMessage = {
    type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
    self: {
      creatureId: 1, characterId: 'c1', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
      level: 1, xp: 0, vocationId: null, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 },
    },
    world: { groundItems: [], mapId: null, creatures: [] },
    aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
    notableEvents: [],
  };

  it('round trips an opaque configuration, and a state without one', () => {
    // Opaca aqui, como a que sobe em `bot-config`: quem a valida é `botConfigSchema`.
    // Mutação que mata: tirar o `.optional()` (o segundo caso devolve `null`).
    const config = { version: 1, heal: [{ when: { kind: 'hp', op: '<=', percent: 50 } }] };
    expect(decodeS2C(encodeS2C({ ...state, botConfig: config }))).toEqual([{ ...state, botConfig: config }]);
    expect(decodeS2C(encodeS2C(state))).toEqual([state]);
  });
});

describe('the hunt catalogue carries the monster outfits to warm (FUN-112)', () => {
  const catalogue = (hunt: Record<string, unknown>): S2CMessage => ({
    type: 'catalogue',
    hunts: [{ id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1, difficulties: ['cautious'], ...hunt }],
    bot: {
      vocabularyVersion: 1,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
      spells: [], supplies: [],
    },
    items: [],
  } as unknown as S2CMessage);

  it('round trips the outfit ids, and an older node without them decodes to an EMPTY list', () => {
    // O cliente itera `hunt.outfitIds` sem guarda: `undefined` aqui seria um `for..of` que
    // lança dentro do efeito de aquecimento. Mutação que mata: trocar `.default([])` por
    // `.optional()`.
    const withIds = catalogue({ outfitIds: [21, 35] });
    // `monsters` também tem default (FUN-113), e `lootDrops` (FUN-123): o que volta é a
    // mensagem com os dois preenchidos.
    const decodedWithIds = decodeS2C(encodeS2C(withIds)) as Array<{ hunts: Array<Record<string, unknown>> }> | null;
    // E `vocations`/`vocationLevel` (#154): sem eles o diálogo da vocação não abre.
    expect(decodedWithIds).toEqual([{
      ...withIds, monsters: [], vocations: [], vocationLevel: 0,
      hunts: (withIds as unknown as { hunts: Array<Record<string, unknown>> }).hunts.map((hunt) => ({
        ...hunt, difficultyDetails: [], lootDrops: 0, monsters: [], loot: [],
      })),
    }]);
    const decoded = decodeS2C(encodeS2C(catalogue({}))) as Array<{ hunts: Array<{ outfitIds: number[]; lootDrops: number; difficultyDetails: unknown[]; monsters: unknown[]; loot: unknown[] }> }> | null;
    expect(decoded?.[0]?.hunts[0]?.outfitIds).toEqual([]);
    expect(decoded?.[0]?.hunts[0]?.lootDrops).toBe(0);
    expect(decoded?.[0]?.hunts[0]?.difficultyDetails).toEqual([]);
    expect(decoded?.[0]?.hunts[0]?.monsters).toEqual([]);
    expect(decoded?.[0]?.hunts[0]?.loot).toEqual([]);
  });

  it('round trips monsters and loot per hunt, and an older node decodes them to EMPTY lists (SV-02, #338)', () => {
    const withDetails = catalogue({
      monsters: [{ id: 'rat', name: 'Rat' }],
      loot: [{ itemId: 'cheese', name: 'Cheese' }],
    });
    const decodedWithDetails = decodeS2C(encodeS2C(withDetails)) as Array<{ hunts: Array<{ monsters: unknown[]; loot: unknown[] }> }> | null;
    expect(decodedWithDetails?.[0]?.hunts[0]?.monsters).toEqual([{ id: 'rat', name: 'Rat' }]);
    expect(decodedWithDetails?.[0]?.hunts[0]?.loot).toEqual([{ itemId: 'cheese', name: 'Cheese' }]);

    const older = catalogue({});
    const decoded = decodeS2C(encodeS2C(older)) as Array<{ hunts: Array<{ monsters: unknown[]; loot: unknown[] }> }> | null;
    expect(decoded?.[0]?.hunts[0]?.monsters).toEqual([]);
    expect(decoded?.[0]?.hunts[0]?.loot).toEqual([]);
  });

  it('round trips difficultyDetails per hunt, and an older node decodes them to an EMPTY list (SV-19, #355)', () => {
    const withDetails = catalogue({
      difficultyDetails: [
        { id: 'cautious', monsterCount: 2 },
        { id: 'bold', monsterCount: 4 },
      ],
    });
    const decodedWithDetails = decodeS2C(encodeS2C(withDetails)) as Array<{ hunts: Array<{ difficultyDetails: Array<{ id: string; monsterCount: number }> }> }> | null;
    expect(decodedWithDetails?.[0]?.hunts[0]?.difficultyDetails).toEqual([
      { id: 'cautious', monsterCount: 2 },
      { id: 'bold', monsterCount: 4 },
    ]);

    const older = catalogue({});
    const decoded = decodeS2C(encodeS2C(older)) as Array<{ hunts: Array<{ difficultyDetails: unknown[] }> }> | null;
    expect(decoded?.[0]?.hunts[0]?.difficultyDetails).toEqual([]);
  });

  it('round trips hunt description when present, preserves absence when omitted, and rejects empty string (SV-21, #357)', () => {
    const withDesc = catalogue({ description: 'Os porões de pedra sob Rookgaard' });
    const decodedWithDesc = decodeS2C(encodeS2C(withDesc)) as Array<{ hunts: Array<{ description?: string }> }> | null;
    expect(decodedWithDesc?.[0]?.hunts[0]?.description).toBe('Os porões de pedra sob Rookgaard');

    const withoutDesc = catalogue({});
    const decodedWithoutDesc = decodeS2C(encodeS2C(withoutDesc)) as Array<{ hunts: Array<{ description?: string }> }> | null;
    expect(decodedWithoutDesc?.[0]?.hunts[0]?.description).toBeUndefined();
    expect('description' in (decodedWithoutDesc?.[0]?.hunts[0] ?? {})).toBe(false);

    expect(decodeS2C(encodeS2C(catalogue({ description: '' })))).toBeNull();
  });

  it('rejects an outfit id of zero: there is no appearance zero', () => {
    expect(decodeS2C(encodeS2C(catalogue({ outfitIds: [0] })))).toBeNull();
  });
});

describe('the bestiary (FUN-113, §18)', () => {
  const counts: S2CMessage = { type: 'bestiary', counts: { rat: 1_234, bat: 0 } };

  it('round trips the counters, and rejects a negative or fractional one', () => {
    // Mutação que mata: apagar `bestiary: 21` de SERVER_TO_CLIENT.
    expect(decodeS2C(encodeS2C(counts))).toEqual([counts]);
    expect(decodeS2C(encodeS2C({ type: 'bestiary', counts: { rat: -1 } }))).toBeNull();
    expect(decodeS2C(encodeS2C({ type: 'bestiary', counts: { rat: 1.5 } }))).toBeNull();
    // A chave VAZIA também: é o que `isBestiaryState` no servidor cita como razão para nunca
    // deixar uma entrar no ticket — e a razão precisa ser verdade.
    expect(decodeS2C(encodeS2C({ type: 'bestiary', counts: { '': 1 } }))).toBeNull();
  });

  it('is server-to-client only: the client never reports a kill', () => {
    expect('bestiary' in S2C_SCHEMAS).toBe(true);
    expect('bestiary' in C2S_SCHEMAS).toBe(false);
  });

  it('the catalogue carries the monsters and the milestones, and an older node decodes without them', () => {
    const base = {
      type: 'catalogue',
      hunts: [],
      bot: {
        vocabularyVersion: 1,
        slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
        spells: [], supplies: [],
      },
      items: [],
    };
    const full = {
      ...base,
      monsters: [{ id: 'rat', name: 'Rat' }],
      vocations: [],
      vocationLevel: 8,
      bestiary: { milestones: [10_000, 25_000], xpBonusPercentPerMilestone: 1 },
    } as unknown as S2CMessage;
    expect(decodeS2C(encodeS2C(full))).toEqual([full]);
    const decoded = decodeS2C(encodeS2C(base as unknown as S2CMessage)) as Array<Record<string, unknown>> | null;
    expect(decoded?.[0]?.['monsters']).toEqual([]);
    expect(decoded?.[0]).not.toHaveProperty('bestiary');
  });

  it('round trips monster health and experience, and an older node decodes with them absent (SV-02, #338)', () => {
    const base = {
      type: 'catalogue',
      hunts: [],
      bot: {
        vocabularyVersion: 1,
        slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
        spells: [], supplies: [],
      },
      items: [],
      monsters: [{ id: 'rat', name: 'Rat', health: 20, experience: 5 }],
    } as unknown as S2CMessage;
    const decoded = decodeS2C(encodeS2C(base)) as Array<{ monsters: Array<{ id: string; name: string; health?: number; experience?: number }> }> | null;
    expect(decoded?.[0]?.monsters).toEqual([{ id: 'rat', name: 'Rat', health: 20, experience: 5 }]);

    const older = {
      ...base,
      monsters: [{ id: 'rat', name: 'Rat' }],
    } as unknown as S2CMessage;
    const decodedOlder = decodeS2C(encodeS2C(older)) as Array<{ monsters: Array<{ id: string; name: string; health?: number; experience?: number }> }> | null;
    expect(decodedOlder?.[0]?.monsters[0]?.id).toBe('rat');
    expect(decodedOlder?.[0]?.monsters[0]?.name).toBe('Rat');
    expect(decodedOlder?.[0]?.monsters[0]).not.toHaveProperty('health');
    expect(decodedOlder?.[0]?.monsters[0]).not.toHaveProperty('experience');
  });

  it('round trips monster class, and an older node decodes with it absent (SV-20, #356)', () => {
    const withClass = {
      type: 'catalogue',
      hunts: [],
      bot: {
        vocabularyVersion: 1,
        slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
        spells: [], supplies: [],
      },
      items: [],
      monsters: [{ id: 'rat', name: 'Rat', class: 'mammal', health: 20, experience: 5 }],
    } as unknown as S2CMessage;
    const decoded = decodeS2C(encodeS2C(withClass)) as Array<{ monsters: Array<{ id: string; name: string; class?: string; health?: number; experience?: number }> }> | null;
    expect(decoded?.[0]?.monsters).toEqual([{ id: 'rat', name: 'Rat', class: 'mammal', health: 20, experience: 5 }]);

    const withoutClass = {
      ...withClass,
      monsters: [{ id: 'rat', name: 'Rat', health: 20, experience: 5 }],
    } as unknown as S2CMessage;
    const decodedWithout = decodeS2C(encodeS2C(withoutClass)) as Array<{ monsters: Array<{ id: string; name: string; class?: string; health?: number; experience?: number }> }> | null;
    expect(decodedWithout?.[0]?.monsters[0]?.id).toBe('rat');
    expect(decodedWithout?.[0]?.monsters[0]?.name).toBe('Rat');
    expect(decodedWithout?.[0]?.monsters[0]).not.toHaveProperty('class');
  });

  describe('vocation statics in the catalogue — speed and regen (#361, SV-25)', () => {
    const baseCatalogue = {
      type: 'catalogue',
      hunts: [],
      bot: {
        vocabularyVersion: 1,
        slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
        spells: [], supplies: [],
      },
      items: [],
      monsters: [],
      vocations: [],
      vocationLevel: 8,
    };

    it('round-trips with progression present in catalogue', () => {
      const withProgression = {
        ...baseCatalogue,
        progression: {
          startingSpeed: 278,
          speedPerLevel: 2,
          regen: {
            healthPerSecond: 1,
            manaPerSecond: 1,
          },
        },
      } as unknown as S2CMessage;
      const decoded = decodeS2C(encodeS2C(withProgression));
      expect(decoded).toEqual([withProgression]);
    });

    it('round-trips without progression in catalogue: decoded message has progression: undefined (key not present)', () => {
      const withoutProgression = {
        ...baseCatalogue,
      } as unknown as S2CMessage;
      const decoded = decodeS2C(encodeS2C(withoutProgression)) as Array<Record<string, unknown>> | null;
      expect(decoded).not.toBeNull();
      expect(decoded?.[0]?.['progression']).toBeUndefined();
      expect(decoded?.[0]).not.toHaveProperty('progression');
    });

    it('rejects invalid progression values (non-positive speed, negative regen)', () => {
      expect(S2C_SCHEMAS.catalogue.safeParse({
        ...baseCatalogue,
        progression: { startingSpeed: 0, speedPerLevel: 2, regen: { healthPerSecond: 1, manaPerSecond: 1 } },
      }).success).toBe(false);

      expect(S2C_SCHEMAS.catalogue.safeParse({
        ...baseCatalogue,
        progression: { startingSpeed: 278, speedPerLevel: -1, regen: { healthPerSecond: 1, manaPerSecond: 1 } },
      }).success).toBe(false);

      expect(S2C_SCHEMAS.catalogue.safeParse({
        ...baseCatalogue,
        progression: { startingSpeed: 278, speedPerLevel: 2, regen: { healthPerSecond: -1, manaPerSecond: 1 } },
      }).success).toBe(false);
    });
  });
});

describe('vocation choice (#154)', () => {
  it('is intention only: the client names the vocation, and the opcode is 15', () => {
    // O 14 está QUEIMADO (era o `select-ammo`, #152); a ADR 0026 registra o 15. Mutação que
    // mata: reciclar o 14 (duplicado) ou apagar a linha (o schema fica órfão).
    expect(BURNED_OPCODES_C2S).toContain(14);
    expect(OPCODE_TO_NAME_C2S.has(14)).toBe(false);
    expect(CLIENT_TO_SERVER['choose-vocation']).toBe(15);
    expect(C2S_SCHEMAS['choose-vocation'].safeParse({ vocationId: 'knight' }).success).toBe(true);
    expect(C2S_SCHEMAS['choose-vocation'].safeParse({ vocationId: '' }).success).toBe(false);
    // Nada além do id: a arma, o slot e os stats são do servidor (invariante 4).
    expect(C2S_SCHEMAS['choose-vocation'].safeParse({ vocationId: 'knight', weapon: 'steel-axe' }).success).toBe(true);
  });

  it('carries the vocation in player-stats and session-state, null until chosen', () => {
    // `default(null)`: um nó `game` anterior manda sem, e o cliente não abre o diálogo por
    // isso — `vocationLevel` também vem `0` do catálogo antigo.
    const stats = S2C_SCHEMAS['player-stats'].parse({
      health: 1, maxHealth: 1, mana: 1, maxMana: 1, level: 8, xp: 0, capacity: 0, gold: 0, staminaMs: 0,
    });
    expect(stats.vocationId).toBeNull();
    expect(S2C_SCHEMAS['player-stats'].parse({ ...stats, vocationId: 'knight' }).vocationId).toBe('knight');
    const catalogue = S2C_SCHEMAS.catalogue.parse({
      hunts: [], items: [],
      bot: { vocabularyVersion: 1, slots: {}, spells: [], supplies: [] },
    });
    expect(catalogue.vocations).toEqual([]);
    expect(catalogue.vocationLevel).toBe(0);
  });
});

describe('skills, magic level and speed in player-stats and session-state (#340, SV-04)', () => {
  const fullStats: S2CMessage = {
    type: 'player-stats',
    health: 150, maxHealth: 150, mana: 20, maxMana: 20,
    level: 8, xp: 4200, capacity: 400, gold: 100, staminaMs: 86400000,
    targetId: null,
    vocationId: 'knight',
    speed: 292,
    skills: {
      melee: { level: 15, percentToNext: 45 },
      distance: { level: 10, percentToNext: 0 },
      magic: { level: 2, percentToNext: 80 },
    },
    magicLevel: { level: 2, percentToNext: 80 },
  };

  it('round-trips player-stats with the 3 fields', () => {
    expect(decodeS2C(encodeS2C(fullStats))).toEqual([fullStats]);
  });

  it('decodes player-stats without the 3 fields using defaults (compatibilidade com nó anterior)', () => {
    const rawOlderNode = {
      type: 'player-stats',
      health: 100, maxHealth: 100, mana: 50, maxMana: 50,
      level: 1, xp: 0, capacity: 400, gold: 0, staminaMs: 1000,
      vocationId: null,
    };
    const decoded = decodeS2C(encodeS2C(rawOlderNode as S2CMessage));
    expect(decoded).toEqual([{
      ...rawOlderNode,
      targetId: null,
      speed: 0,
      skills: {},
      magicLevel: { level: 0, percentToNext: 0 },
    }]);
  });

  const fullSessionState: S2CMessage = {
    type: 'session-state',
    sessionType: 'hunt',
    elapsedMs: 12000,
    self: {
      creatureId: 1, characterId: 'c1',
      health: 150, maxHealth: 150, mana: 20, maxMana: 20,
      level: 8, xp: 4200, vocationId: 'knight',
      speed: 292,
      skills: {
        melee: { level: 15, percentToNext: 45 },
      },
      magicLevel: { level: 2, percentToNext: 80 },
    },
    world: { groundItems: [], mapId: 'arena', creatures: [] },
    aggregates: { durationMs: 12000, xpGained: 500, goldGained: 100, goldSpent: 0, kills: 5, deaths: 0 },
    notableEvents: [],
  };

  it('round-trips session-state.self with the 3 fields', () => {
    expect(decodeS2C(encodeS2C(fullSessionState))).toEqual([fullSessionState]);
  });

  it('decodes session-state.self without the 3 fields using defaults (compatibilidade com nó anterior)', () => {
    const { speed: _s, skills: _sk, magicLevel: _m, ...selfWithoutNewFields } = fullSessionState.self;
    const olderSessionState = {
      ...fullSessionState,
      self: selfWithoutNewFields,
    };
    const decoded = decodeS2C(encodeS2C(olderSessionState as S2CMessage));
    expect(decoded).toEqual([{
      ...fullSessionState,
      self: {
        ...selfWithoutNewFields,
        speed: 0,
        skills: {},
        magicLevel: { level: 0, percentToNext: 0 },
      },
    }]);
  });

  it('rejects invalid speed, level or percentToNext in SkillProgress', () => {
    expect(S2C_SCHEMAS['player-stats'].safeParse({ ...fullStats, speed: -1 }).success).toBe(false);
    expect(S2C_SCHEMAS['player-stats'].safeParse({ ...fullStats, speed: 1.5 }).success).toBe(false);
    expect(S2C_SCHEMAS['player-stats'].safeParse({
      ...fullStats,
      magicLevel: { level: -1, percentToNext: 0 },
    }).success).toBe(false);
    expect(S2C_SCHEMAS['player-stats'].safeParse({
      ...fullStats,
      magicLevel: { level: 1, percentToNext: 100 },
    }).success).toBe(false);
    expect(S2C_SCHEMAS['player-stats'].safeParse({
      ...fullStats,
      magicLevel: { level: 1, percentToNext: -1 },
    }).success).toBe(false);
    expect(S2C_SCHEMAS['player-stats'].safeParse({
      ...fullStats,
      magicLevel: { level: 1, percentToNext: 50.5 },
    }).success).toBe(false);
  });
});

describe('move-item (#160)', () => {
  it('is intention only — two places — and the opcode is 16', () => {
    expect(CLIENT_TO_SERVER['move-item']).toBe(16);
    const schema = C2S_SCHEMAS['move-item'];
    expect(schema.safeParse({ from: { container: 'backpack', index: 3 }, to: { container: 'satchel', index: 0 } }).success).toBe(true);
    expect(schema.safeParse({ from: { container: 'backpack', index: 3 }, to: { slot: 'hand' } }).success).toBe(true);
    // Nem quantidade nem item: o servidor sabe o que está em cada lugar (invariante 4).
    expect(schema.safeParse({ from: { container: 'chest', index: 0 }, to: { slot: 'hand' } }).success).toBe(false);
    expect(schema.safeParse({ from: { container: 'backpack', index: -1 }, to: { slot: 'hand' } }).success).toBe(false);
  });
});

describe('party presentation messages (#196, #339, SV-03)', () => {
  it('round trips party-state with vocationId, level and manaPercent', () => {
    const message: S2CMessage = {
      type: 'party-state',
      leaderId: 'p1',
      mode: 'shared',
      members: [
        {
          characterId: 'p1',
          name: 'Alice',
          alive: true,
          healthPercent: 100,
          vocationId: 'knight',
          level: 20,
          manaPercent: 80,
        },
        {
          characterId: 'p2',
          name: 'Bob',
          alive: false,
          healthPercent: 0,
          vocationId: null,
          level: 5,
          manaPercent: 0,
        },
      ],
    };
    expect(decodeS2C(encodeS2C(message))).toEqual([message]);
  });

  it('round trips party-state with shareCosts and splitLoot (#359)', () => {
    const message: S2CMessage = {
      type: 'party-state',
      leaderId: 'p1',
      mode: 'split',
      shareCosts: true,
      splitLoot: false,
      members: [
        {
          characterId: 'p1',
          name: 'Alice',
          alive: true,
          healthPercent: 100,
          vocationId: 'knight',
        },
      ],
    };
    expect(decodeS2C(encodeS2C(message))).toEqual([message]);
  });

  it('decodes older party-state without vocationId, level, or manaPercent as vocationId: null, level: undefined, manaPercent: undefined', () => {
    const older = {
      type: 'party-state',
      leaderId: 'p1',
      mode: 'split',
      members: [
        {
          characterId: 'p1',
          name: 'Alice',
          alive: true,
          healthPercent: 100,
        },
      ],
    } as unknown as S2CMessage;

    const decoded = decodeS2C(encodeS2C(older)) as Array<{
      type: 'party-state';
      members: Array<{
        characterId: string;
        vocationId: string | null;
        level?: number;
        manaPercent?: number;
      }>;
    }> | null;
    const member = decoded?.[0]?.members[0];
    expect(member?.vocationId).toBeNull();
    expect(member?.level).toBeUndefined();
    expect(member?.manaPercent).toBeUndefined();
    expect(member).not.toHaveProperty('level');
    expect(member).not.toHaveProperty('manaPercent');
  });

  it('rejects manaPercent greater than 100, fractional, or negative', () => {
    const base = {
      type: 'party-state',
      leaderId: 'p1',
      mode: 'shared',
      members: [
        {
          characterId: 'p1',
          name: 'Alice',
          alive: true,
          healthPercent: 100,
          vocationId: 'sorcerer',
          level: 25,
          manaPercent: 50,
        },
      ],
    } as unknown as S2CMessage;

    expect(decodeS2C(encodeS2C({
      ...base,
      members: [{ characterId: 'p1', name: 'Alice', alive: true, healthPercent: 100, manaPercent: 101 }],
    } as unknown as S2CMessage))).toBeNull();

    expect(decodeS2C(encodeS2C({
      ...base,
      members: [{ characterId: 'p1', name: 'Alice', alive: true, healthPercent: 100, manaPercent: 50.5 }],
    } as unknown as S2CMessage))).toBeNull();

    expect(decodeS2C(encodeS2C({
      ...base,
      members: [{ characterId: 'p1', name: 'Alice', alive: true, healthPercent: 100, manaPercent: -1 }],
    } as unknown as S2CMessage))).toBeNull();
  });
});

describe('active-conditions, hunt identity and targetId (#341, SV-05)', () => {
  it('round trips active-conditions (opcode 27)', () => {
    expect(SERVER_TO_CLIENT['active-conditions']).toBe(27);
    const msg: S2CMessage = {
      type: 'active-conditions',
      conditions: [
        { kind: 'haste', remainingMs: 30000 },
        { kind: 'buff', remainingMs: 10000 },
        { kind: 'mana-shield', remainingMs: 5000 },
        { kind: 'heal-over-time', remainingMs: 60000 },
      ],
    };
    expect(decodeS2C(encodeS2C(msg))).toEqual([msg]);
  });

  it('round trips active-conditions with empty list', () => {
    const emptyMsg: S2CMessage = {
      type: 'active-conditions',
      conditions: [],
    };
    expect(decodeS2C(encodeS2C(emptyMsg))).toEqual([emptyMsg]);
  });

  it('rejects active-conditions with invalid remainingMs or unknown kind', () => {
    expect(decodeS2C(encodeS2C({
      type: 'active-conditions',
      conditions: [{ kind: 'haste', remainingMs: -1 }],
    } as unknown as S2CMessage))).toBeNull();

    expect(decodeS2C(encodeS2C({
      type: 'active-conditions',
      conditions: [{ kind: 'haste', remainingMs: 12.5 }],
    } as unknown as S2CMessage))).toBeNull();

    expect(decodeS2C(encodeS2C({
      type: 'active-conditions',
      conditions: [{ kind: 'poison', remainingMs: 1000 }],
    } as unknown as S2CMessage))).toBeNull();
  });

  it('round trips instance-enter with and without huntId and difficulty', () => {
    const withHunt: S2CMessage = {
      type: 'instance-enter',
      instanceId: 'inst-1',
      map: 'rats-cave',
      huntId: 'rats',
      difficulty: 'easy',
      ambience: 'cavern',
    };
    expect(decodeS2C(encodeS2C(withHunt))).toEqual([withHunt]);

    const withoutHunt: S2CMessage = {
      type: 'instance-enter',
      instanceId: 'inst-2',
      map: 'city-square',
    };
    expect(decodeS2C(encodeS2C(withoutHunt))).toEqual([withoutHunt]);
  });

  it('round trips session-state with and without huntId and difficulty', () => {
    const baseSession: S2CMessage = {
      type: 'session-state',
      sessionType: 'hunt',
      elapsedMs: 5000,
      huntId: 'rats',
      difficulty: 'hard',
      self: {
        creatureId: 1,
        characterId: 'c1',
        health: 100,
        maxHealth: 100,
        mana: 50,
        maxMana: 50,
        level: 1,
        xp: 0,
        vocationId: null,
        speed: 200,
        skills: {},
        magicLevel: { level: 0, percentToNext: 0 },
      },
      world: { mapId: 'rats-cave', creatures: [], groundItems: [] },
      aggregates: { durationMs: 5000, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    };
    expect(decodeS2C(encodeS2C(baseSession))).toEqual([baseSession]);

    const { huntId: _h, difficulty: _d, ...citySession } = baseSession;
    expect(decodeS2C(encodeS2C(citySession as S2CMessage))).toEqual([citySession]);
  });

  it('round trips player-stats with targetId (number and null)', () => {
    const statsWithTarget: S2CMessage = {
      type: 'player-stats',
      health: 100,
      maxHealth: 100,
      mana: 50,
      maxMana: 50,
      level: 5,
      xp: 1000,
      capacity: 300,
      gold: 50,
      staminaMs: 50000,
      targetId: 42,
      vocationId: 'knight',
      speed: 250,
      skills: {},
      magicLevel: { level: 0, percentToNext: 0 },
    };
    expect(decodeS2C(encodeS2C(statsWithTarget))).toEqual([statsWithTarget]);

    const statsNullTarget: S2CMessage = {
      ...statsWithTarget,
      targetId: null,
    };
    expect(decodeS2C(encodeS2C(statsNullTarget))).toEqual([statsNullTarget]);

    // An older node sending player-stats without targetId decodes to targetId: null
    const { targetId: _t, ...olderStats } = statsWithTarget;
    expect(decodeS2C(encodeS2C(olderStats as S2CMessage))).toEqual([statsNullTarget]);
  });
});


