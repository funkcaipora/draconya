import type { S2CMessage } from '@draconya/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMessage } from './apply.js';
import { INITIAL_HUD, hud, perHour, subscribeSlice } from './hud.js';
import { INITIAL_BOT, bot, emptyDraft, toConfig } from '../bot/store.js';
import { MISSILE_BASE_MS, MISSILE_PER_TILE_MS } from '../world/effects.js';
import { TRANSIENT_CAP, clearTransients, interpolate, world } from './world.js';

const at = (x: number, y: number, z = 7) => ({ x, y, z });

beforeEach(() => {
  world.creatures.clear();
  world.instanceId = null;
  world.mapId = null;
  clearTransients();
  hud.set(() => INITIAL_HUD);
  bot.set(() => INITIAL_BOT);
});

function spawn(id: number, position = at(0, 0)): S2CMessage {
  return {
    type: 'creature-appear',
    id, position, appearanceId: 100, name: `rat-${id}`, health: 20, maxHealth: 20,
  };
}

describe('world deltas', () => {
  it('never reaches a HUD subscriber, with forty creatures moving', () => {
    // É O TESTE QUE DEFINE ESTA ISSUE. O critério de aceite fala em "commits do React
    // próximos de zero"; um commit só acontece se alguém for avisado, então o que se mede
    // aqui é a causa, e de forma determinística — o número tem que ser ZERO, não "baixo".
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state, notified);

    for (let id = 0; id < 40; id++) applyMessage(spawn(id, at(id, 0)), 0);
    // Dez passos por criatura: uma segunda inteira de jogo a 10 Hz.
    for (let tick = 1; tick <= 10; tick++) {
      for (let id = 0; id < 40; id++) {
        applyMessage(
          { type: 'creature-move', id, from: at(id, tick - 1), to: at(id, tick), durationMs: 400 },
          tick * 100,
        );
      }
      for (let id = 0; id < 40; id++) {
        applyMessage({ type: 'creature-health', id, health: 20 - tick, maxHealth: 20 }, tick * 100);
      }
    }

    expect(world.creatures.size).toBe(40);
    expect(notified).toHaveBeenCalledTimes(0);
  });

  it('keeps the step so the canvas can interpolate instead of teleporting', () => {
    applyMessage(spawn(1, at(0, 0)), 0);
    applyMessage(
      { type: 'creature-move', id: 1, from: at(0, 0), to: at(1, 0), durationMs: 400 },
      1_000,
    );

    const creature = world.creatures.get(1);
    expect(creature).toBeDefined();
    if (creature === undefined) return;

    expect(interpolate(creature, 1_000)).toEqual(at(0, 0));
    expect(interpolate(creature, 1_200)).toEqual({ x: 0.5, y: 0, z: 7 });
    expect(interpolate(creature, 1_400)).toEqual(at(1, 0));
    // Passado o fim, PARA no destino. Extrapolar seria prever o passo dos outros, que o
    // AGENTS.md do pacote proíbe.
    expect(interpolate(creature, 9_000)).toEqual(at(1, 0));
  });

  it('ignores a step for a creature it never saw appear', () => {
    // Normal, não erro: pode ter sido filtrado por interest management ou chegado fora de
    // ordem. Inventar a criatura desenharia um fantasma sem aparência.
    applyMessage(
      { type: 'creature-move', id: 99, from: at(0, 0), to: at(1, 0), durationMs: 400 },
      0,
    );
    expect(world.creatures.size).toBe(0);
  });

  it('clears the world when entering another instance', () => {
    applyMessage(spawn(1), 0);
    applyMessage({ type: 'instance-enter', instanceId: 'i2', map: 'rat-cellars' }, 0);

    expect(world.creatures.size).toBe(0);
    expect(world.instanceId).toBe('i2');
    expect(world.mapId).toBe('rat-cellars');
  });

  it('instance-enter followed by session-state sets the map once, and the ambience (FUN-121)', () => {
    // O `instance-enter` é a troca de cena e o `session-state` povoa a cena nova; os dois
    // dizem o mesmo mapa, e o ambiente só viaja no primeiro — ausente é superfície.
    applyMessage({ type: 'instance-enter', instanceId: 'i2', map: 'thais' }, 0);
    expect(world.ambience).toBe('surface');
    applyMessage({ type: 'instance-enter', instanceId: 'i3', map: 'rat-cellars', ambience: 'cavern' }, 0);
    expect(world.mapId).toBe('rat-cellars');
    expect(world.ambience).toBe('cavern');
    applyMessage({
      type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
      self: { creatureId: 1, characterId: 'c', health: 1, maxHealth: 1, mana: 0, maxMana: 0, level: 1, xp: 0 },
      world: { mapId: 'rat-cellars', creatures: [] },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0, itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0 },
      notableEvents: [],
    }, 0);
    expect(world.mapId).toBe('rat-cellars');
    expect(world.ambience).toBe('cavern');
  });

  it('removes a creature that disappeared', () => {
    applyMessage(spawn(1), 0);
    applyMessage({ type: 'creature-disappear', id: 1 }, 0);
    expect(world.creatures.has(1)).toBe(false);
  });
});

describe('as cores de outfit (FUN-104)', () => {
  const colors = { head: 114, body: 3, legs: 40, feet: 95 };

  it('a creature that appears WITH colours keeps them', () => {
    // É o que o viewport lê para pintar. Mutação que mata: tirar `...colorsOf(message)` do
    // `case 'creature-appear'` — toda criatura voltaria às cores de reserva sem nada acusar.
    applyMessage({
      type: 'creature-appear', id: 1, position: at(0, 0), appearanceId: 128, name: 'me',
      health: 20, maxHealth: 20, colors,
    }, 0);
    expect(world.creatures.get(1)?.colors).toEqual(colors);
  });

  it('a creature that appears WITHOUT colours has the field ABSENT, not undefined', () => {
    // "Não disse" é a falta do campo — o viewport escolhe a reserva por `??`, e o store não
    // inventa cor. A chave explícita também é o que `exactOptionalPropertyTypes` recusa.
    // Mutação que mata: `colors: message.colors` direto no literal.
    applyMessage(spawn(1), 0);
    const creature = world.creatures.get(1);
    expect(creature).toBeDefined();
    expect(creature?.colors).toBeUndefined();
    expect(Object.hasOwn(creature ?? {}, 'colors')).toBe(false);
  });

  it('a session-state carries them per creature, and only where they came', () => {
    // O mesmo caminho do `creature-appear` (o protocolo usa o MESMO schema nos dois): a
    // reconexão não pode devolver o personagem com outra roupa que a que ele tinha antes da
    // queda. Mutação que mata: tirar `...colorsOf(creature)` do laço do `session-state`.
    const other = { head: 0, body: 132, legs: 66, feet: 1 };
    applyMessage({
      type: 'session-state',
      sessionType: 'hunt',
      elapsedMs: 0,
      self: {
        creatureId: 1, characterId: 'char-1',
        health: 1, maxHealth: 1, mana: 0, maxMana: 0, level: 1, xp: 0,
      },
      world: {
        mapId: 'rat-cellars',
        creatures: [
          { id: 1, position: at(0, 0), appearanceId: 128, name: 'me', health: 1, maxHealth: 1, colors },
          { id: 2, position: at(1, 0), appearanceId: 128, name: 'you', health: 1, maxHealth: 1, colors: other },
          { id: 3, position: at(2, 0), appearanceId: 21, name: 'rat', health: 1, maxHealth: 1 },
        ],
      },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    }, 0);

    expect(world.creatures.get(1)?.colors).toEqual(colors);
    expect(world.creatures.get(2)?.colors).toEqual(other);
    expect(world.creatures.get(3)?.colors).toBeUndefined();
  });
});

describe('combat transients (FUN-106)', () => {
  // Efeito, projétil e número flutuante NÃO são HUD: chegam dezenas por segundo numa hunt, e o
  // caminho deles termina no `world`, que o viewport lê direto e expira sozinho.

  it('an effect enters the world stamped with the LOCAL instant it arrived', () => {
    // O relógio que anima é o do quadro, não o do servidor: um lote aplicado de uma vez ao
    // voltar de aba de fundo ganha o MESMO instante, e tudo toca junto em vez de reproduzir
    // dez minutos de golpes. Mutação que mata: `startedAtMs: 0` fixo em `addEffect`.
    applyMessage({ type: 'effect', position: at(3, 4), effectId: 12 }, 5_000);

    expect(world.effects).toHaveLength(1);
    expect(world.effects[0]).toMatchObject({ position: at(3, 4), effectId: 12, startedAtMs: 5_000 });
  });

  it('a missile enters with its flight time computed from the distance', () => {
    // A duração é do cliente — o servidor manda de onde para onde, e o tempo de voo é
    // apresentação (ADR 0007). Mutação que mata: `durationMs: 0` no `case 'missile'`.
    applyMessage({ type: 'missile', from: at(0, 0), to: at(3, 1), missileId: 5 }, 2_000);

    expect(world.missiles).toHaveLength(1);
    expect(world.missiles[0]).toMatchObject({
      from: at(0, 0), to: at(3, 1), missileId: 5, startedAtMs: 2_000,
      durationMs: MISSILE_BASE_MS + 3 * MISSILE_PER_TILE_MS,
    });
  });

  it('a hit becomes a floating text over where the creature IS, mid-step included', () => {
    // A posição é fotografada ao entrar, pela interpolação do instante: um golpe no meio do
    // passo nasce no meio do passo, não no tile de onde a criatura saiu.
    // Mutação que mata: `position: creature.position` em vez de `interpolate(...)`.
    applyMessage(spawn(1, at(0, 0)), 0);
    applyMessage(
      { type: 'creature-move', id: 1, from: at(0, 0), to: at(1, 0), durationMs: 400 },
      1_000,
    );
    applyMessage({ type: 'creature-hit', id: 1, amount: 37, kind: 'melee' }, 1_200);

    expect(world.texts).toHaveLength(1);
    expect(world.texts[0]).toMatchObject({
      creatureId: 1, amount: 37, kind: 'melee', startedAtMs: 1_200, position: { x: 0.5, y: 0, z: 7 },
    });
  });

  it('a hit on a creature that already left STILL enters: the killing blow is the one to see', () => {
    // O golpe que mata chega no mesmo lote que o `creature-disappear`, e recusar aqui apagaria
    // justamente o número que o jogador mais quer ver. O texto some sozinho, pelo viewport.
    // Mutação que mata: `if (!world.creatures.has(message.id)) return;` no `case`.
    applyMessage(spawn(1, at(2, 2)), 0);
    applyMessage({ type: 'creature-hit', id: 1, amount: 99, kind: 'spell' }, 100);
    applyMessage({ type: 'creature-disappear', id: 1 }, 100);
    applyMessage({ type: 'creature-hit', id: 1, amount: 5, kind: 'heal' }, 100);

    expect(world.texts).toHaveLength(2);
    expect(world.texts[0]?.position).toEqual(at(2, 2));
    // Criatura que este cliente NUNCA viu: entra sem lugar, e o viewport não desenha.
    expect(world.texts[1]?.position).toBeNull();
    // O TIPO do golpe viaja com o número: é ele que escolhe a cor — roxo de magia, verde de
    // cura — e os outros testes só mandam `melee`, então um `kind` fixo passava em todos.
    // Mutação que mata: `'melee'` no lugar de `message.kind` no `case 'creature-hit'`.
    expect(world.texts[0]?.kind).toBe('spell');
    expect(world.texts[1]?.kind).toBe('heal');
  });

  it('never reaches a HUD subscriber', () => {
    // A mesma prova do movimento: dano é o que mais chega numa hunt, e um commit do React
    // por golpe é o que o ADR 0007 existe para evitar.
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state, notified);

    applyMessage(spawn(1), 0);
    for (let i = 0; i < 100; i++) {
      applyMessage({ type: 'creature-hit', id: 1, amount: i, kind: 'melee' }, i);
      applyMessage({ type: 'effect', position: at(0, 0), effectId: 1 }, i);
      applyMessage({ type: 'missile', from: at(0, 0), to: at(1, 1), missileId: 1 }, i);
    }

    expect(notified).toHaveBeenCalledTimes(0);
  });

  it('local ids are sequential and never reused, even across instances', () => {
    // O id é a chave do pool de sprites do viewport. Reiniciar ao trocar de instância faria um
    // efeito novo herdar o sprite de um antigo que ainda não saiu do pool.
    // Mutação que mata: zerar `lastTransientId` em `clearTransients`.
    applyMessage({ type: 'effect', position: at(0, 0), effectId: 1 }, 0);
    const first = world.effects[0]?.id ?? -1;
    applyMessage({ type: 'instance-enter', instanceId: 'i2', map: 'rat-cellars' }, 0);
    applyMessage({ type: 'effect', position: at(0, 0), effectId: 1 }, 0);

    expect(world.effects[0]?.id).toBeGreaterThan(first);
  });

  it('entering another instance clears the three lists', () => {
    // O que estava no ar pertence à cena anterior: um efeito do mapa velho tocando sobre o
    // novo é o mesmo defeito do monstro que nunca some, no primeiro quadro que o jogador vê.
    // Mutação que mata: tirar `clearTransients()` de `enterInstance`.
    applyMessage(spawn(1), 0);
    applyMessage({ type: 'effect', position: at(0, 0), effectId: 1 }, 0);
    applyMessage({ type: 'missile', from: at(0, 0), to: at(1, 0), missileId: 1 }, 0);
    applyMessage({ type: 'creature-hit', id: 1, amount: 1, kind: 'melee' }, 0);
    applyMessage({ type: 'instance-enter', instanceId: 'i2', map: 'rat-cellars' }, 0);

    expect(world.effects).toHaveLength(0);
    expect(world.missiles).toHaveLength(0);
    expect(world.texts).toHaveLength(0);
  });

  it('a session-state clears them too: it replaces the scene, transients included', () => {
    // Mutação que mata: tirar `clearTransients()` do `case 'session-state'`.
    applyMessage({ type: 'effect', position: at(0, 0), effectId: 1 }, 0);
    applyMessage({ type: 'missile', from: at(0, 0), to: at(1, 0), missileId: 1 }, 0);
    applyMessage({ type: 'creature-hit', id: 7, amount: 1, kind: 'melee' }, 0);
    applyMessage({
      type: 'session-state',
      sessionType: 'hunt',
      elapsedMs: 0,
      self: {
        creatureId: 1, characterId: 'char-1',
        health: 1, maxHealth: 1, mana: 0, maxMana: 0, level: 1, xp: 0,
      },
      world: { mapId: 'rat-cellars', creatures: [] },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    }, 0);

    expect(world.effects).toHaveLength(0);
    expect(world.missiles).toHaveLength(0);
    expect(world.texts).toHaveLength(0);
  });

  it('each list is capped, dropping the OLDEST', () => {
    // Em aba de fundo o `requestAnimationFrame` para e o socket não: horas de hunt entrariam
    // sem ninguém expirar nada. O mais antigo é o que já teria acabado de tocar.
    // Mutação que mata: `list.splice(0, ...)` → `list.length = TRANSIENT_CAP` (cortaria o novo).
    for (let i = 0; i < TRANSIENT_CAP + 10; i++) {
      applyMessage({ type: 'effect', position: at(0, 0), effectId: i }, i);
    }

    expect(world.effects).toHaveLength(TRANSIENT_CAP);
    expect(world.effects[0]?.effectId).toBe(10);
    expect(world.effects.at(-1)?.effectId).toBe(TRANSIENT_CAP + 9);
  });
});

describe('HUD deltas', () => {
  it('applies stats and notifies once', () => {
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state.health, notified);

    applyMessage(
      {
        type: 'player-stats',
        health: 150, maxHealth: 185, mana: 30, maxMana: 35,
        level: 8, xp: 4_200, capacity: 400, gold: 0, staminaMs: 86_400_000,
      },
      0,
    );

    expect(hud.get().health).toBe(150);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it('measures latency from the round trip', () => {
    applyMessage({ type: 'pong', t: 1_000 }, 1_042);
    expect(hud.get().latencyMs).toBe(42);
  });

  it('caps the chat instead of growing forever', () => {
    // Chat de MMORPG roda o dia inteiro. Sem teto o sintoma chega horas depois como "o jogo
    // fica lento com o tempo", que ninguém liga ao chat.
    for (let i = 0; i < 250; i++) {
      applyMessage({ type: 'chat-message', channel: 'local', author: 'a', text: `${i}` }, i);
    }
    const chat = hud.get().chat;
    expect(chat).toHaveLength(200);
    expect(chat[chat.length - 1]?.text).toBe('249');
  });
});

describe('session-state', () => {
  const state = (creatures: Array<{ id: number; x: number; y: number }>) => ({
    type: 'session-state' as const,
    sessionType: 'hunt',
    elapsedMs: 600_000,
    self: {
      creatureId: 1, characterId: 'char-1',
      health: 120, maxHealth: 185, mana: 20, maxMana: 35, level: 8, xp: 4_200,
    },
    world: {
      mapId: 'rat-cellars',
      creatures: creatures.map((c) => ({
        id: c.id, position: at(c.x, c.y), appearanceId: 1,
        name: `c${c.id}`, health: 10, maxHealth: 10,
      })),
    },
    aggregates: {
      durationMs: 600_000, xpGained: 900, goldGained: 300, goldSpent: 0, kills: 12, deaths: 0,
    },
    notableEvents: [{ atMs: 1_000, type: 'level-up' }],
  });

  it('replaces the world instead of merging into it', () => {
    // Mesclar deixaria uma criatura que morreu enquanto ninguém olhava desenhada para
    // sempre — um monstro parado que nunca some, descoberto semanas depois.
    applyMessage(spawn(99, at(3, 3)), 0);
    applyMessage(state([{ id: 1, x: 5, y: 5 }]), 0);

    expect([...world.creatures.keys()]).toEqual([1]);
    expect(world.mapId).toBe('rat-cellars');
    expect(world.selfId).toBe(1);
  });

  it('arrives with no step in progress', () => {
    // O estado diz onde as coisas ESTÃO, não como chegaram lá. Reproduzir o movimento que
    // aconteceu enquanto ninguém olhava é o erro que o §16.2 nomeia.
    applyMessage(state([{ id: 1, x: 5, y: 5 }]), 0);
    const creature = world.creatures.get(1);
    expect(creature?.step).toBeNull();
    expect(interpolate(creature!, 999_999)).toEqual(at(5, 5));
  });

  it('fills the HUD from the player, in one notification', () => {
    const notified = vi.fn();
    subscribeSlice(hud, (s) => s.health, notified);

    applyMessage(state([{ id: 1, x: 5, y: 5 }]), 0);

    expect(hud.get().health).toBe(120);
    expect(hud.get().maxHealth).toBe(185);
    expect(hud.get().level).toBe(8);
    expect(notified).toHaveBeenCalledTimes(1);
  });
});

describe('session-ended', () => {
  it('shows why the session ended and what it yielded', () => {
    applyMessage({
      type: 'session-ended',
      reason: 'drain',
      aggregates: {
        durationMs: 1_800_000, xpGained: 4_200, goldGained: 900, goldSpent: 150,
        kills: 37, deaths: 0,
      },
      notableEvents: [],
    }, 0);

    const line = hud.get().systemMessages.at(-1);
    expect(line?.level).toBe('warning');
    expect(line?.text).toContain('manutenção');
    expect(line?.text).toContain('30 min');
    expect(line?.text).toContain('4200 XP');
    // Ganho MENOS gasto: é o que de fato muda o gold do personagem.
    expect(line?.text).toContain('750 gold');
  });

  it('leaving the hunt says "hunt", not "game": the player is standing in the city reading it', () => {
    // `manual-exit` também é o logout, mas esse fecha o socket e ninguém lê o extrato. Quem
    // lê é quem apertou "sair da hunt" — e "Você saiu do jogo" era o que ele lia (QA do MVP).
    applyMessage({
      type: 'session-ended', reason: 'manual-exit',
      aggregates: { durationMs: 120_000, xpGained: 155, goldGained: 73, goldSpent: 250, kills: 31, deaths: 0 },
      notableEvents: [],
    }, 0);
    const line = hud.get().systemMessages.at(-1);
    expect(line?.text).toContain('saiu da hunt');
    expect(line?.text).not.toContain('jogo');
    expect(line?.text).toContain('-177 gold');
  });

  it('does not clear the world along with the notice', () => {
    // A última coisa verdadeira fica na tela por trás da mensagem, em vez de o canvas
    // piscar vazio junto com a notícia.
    applyMessage(spawn(4, at(2, 2)), 0);
    applyMessage({
      type: 'session-ended', reason: 'death',
      aggregates: {
        durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 1,
      },
      notableEvents: [],
    }, 0);

    expect(world.creatures.has(4)).toBe(true);
  });
});

describe('o analisador (FUN-83)', () => {
  const sessionState = (over: Record<string, unknown> = {}): S2CMessage => ({
    type: 'session-state',
    sessionType: 'hunt',
    elapsedMs: 600_000,
    self: {
      creatureId: 1, characterId: 'char-1',
      health: 120, maxHealth: 185, mana: 20, maxMana: 35, level: 8, xp: 4_200,
    },
    world: { mapId: 'rat-cellars', creatures: [] },
    aggregates: {
      durationMs: 600_000, xpGained: 900, goldGained: 300, goldSpent: 120,
      kills: 12, deaths: 0, itemsLooted: 4, suppliesUsed: 7, bestBasicHit: 88,
      bestSpellHit: 140,
    },
    notableEvents: [{ atMs: 1_000, type: 'level-up' }],
    ...over,
  } as S2CMessage);

  it('guarda os agregados e o INSTANTE local em que eles chegaram', () => {
    // O instante é o que faz o relógio da janela andar entre dois `session-state`. Sem ele o
    // tempo de hunt ficaria congelado, e o "por hora" — que é uma divisão por ele — junto.
    applyMessage(sessionState(), 5_000);

    const { analyzer } = hud.get();
    expect(analyzer.aggregates?.xpGained).toBe(900);
    expect(analyzer.aggregates?.bestSpellHit).toBe(140);
    expect(analyzer.notableEvents).toEqual([{ atMs: 1_000, type: 'level-up' }]);
    expect(analyzer.receivedAtMs).toBe(5_000);
    expect(analyzer.sessionType).toBe('hunt');
    expect(analyzer.ended).toBe(false);
  });

  it('o extrato entra na MESMA janela, com o relógio parado', () => {
    // §16.2: a tela de retorno é o analisador com o que a sessão rendeu. Duas janelas para a
    // mesma pergunta divergiriam na terceira mudança — e continuar contando o tempo depois do
    // fim faria o "por hora" derreter na frente do jogador.
    applyMessage(sessionState(), 5_000);
    applyMessage({
      type: 'session-ended',
      reason: 'exit-rule',
      aggregates: {
        durationMs: 900_000, xpGained: 1_500, goldGained: 400, goldSpent: 200,
        kills: 20, deaths: 0,
      },
      notableEvents: [{ atMs: 2_000, type: 'stamina-exhausted' }],
    }, 9_000);

    const { analyzer } = hud.get();
    expect(analyzer.ended).toBe(true);
    expect(analyzer.aggregates?.xpGained).toBe(1_500);
    expect(analyzer.notableEvents).toEqual([{ atMs: 2_000, type: 'stamina-exhausted' }]);
  });

  it('campo que o servidor NÃO mandou fica ausente, e não zero', () => {
    // Um nó `game` anterior à FUN-78 manda os agregados sem estes campos. Zero é uma
    // afirmação; a janela precisa poder mostrar "—" em vez de dizer que nada caiu.
    applyMessage(sessionState({
      aggregates: {
        durationMs: 600_000, xpGained: 900, goldGained: 300, goldSpent: 0, kills: 12, deaths: 0,
      },
    }), 0);

    expect(hud.get().analyzer.aggregates?.itemsLooted).toBeUndefined();
  });

  it('não avisa quem assina outra fatia', () => {
    // A janela tem fatia própria justamente para não re-renderizar quando o HP mexe — e o
    // contrário também vale: o analisador chegando não pode redesenhar as barras.
    applyMessage(sessionState(), 0);
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state.chat, notified);

    applyMessage(sessionState({ aggregates: {
      durationMs: 700_000, xpGained: 1_000, goldGained: 300, goldSpent: 0, kills: 13, deaths: 0,
    } }), 1_000);

    expect(notified).not.toHaveBeenCalled();
  });
});

describe('o analisador ao vivo (FUN-110)', () => {
  const live = (over: Record<string, unknown> = {}): S2CMessage => ({
    type: 'analyzer',
    aggregates: {
      durationMs: 650_000, xpGained: 1_000, goldGained: 340, goldSpent: 120,
      kills: 13, deaths: 0, itemsLooted: 5, suppliesUsed: 7, bestBasicHit: 88, bestSpellHit: 140,
    },
    notableEvents: [{ atMs: 1_000, type: 'level-up' }, { atMs: 640_000, type: 'level-up' }],
    ...over,
  } as S2CMessage);
  const attach = (): void => {
    applyMessage({
      type: 'session-state', sessionType: 'hunt', elapsedMs: 600_000,
      self: { creatureId: 1, characterId: 'char-1', health: 120, maxHealth: 185, mana: 20, maxMana: 35, level: 8, xp: 4_200 },
      world: { mapId: 'rat-cellars', creatures: [] },
      aggregates: { durationMs: 600_000, xpGained: 900, goldGained: 300, goldSpent: 120, kills: 12, deaths: 0 },
      notableEvents: [{ atMs: 1_000, type: 'level-up' }],
    }, 5_000);
  };

  it('troca os agregados, ACRESCENTA os eventos novos e recarimba o instante — o relógio local rebaseia', () => {
    // Era o defeito: a janela ficava com os números do `session-attach` a hunt inteira.
    // Os eventos vêm só os novos (a lista inteira a cada abate custava 13 MB em oito horas),
    // então entram no fim dos que o `session-state` trouxe. Mutação que mata: não recarimbar
    // `receivedAtMs` (o tempo andaria em dobro), ou SUBSTITUIR a lista (o level-up do começo
    // sumiria).
    attach();
    applyMessage(live({ notableEvents: [{ atMs: 640_000, type: 'level-up', detail: '9' }] }), 9_000);
    const { analyzer } = hud.get();
    expect(analyzer.aggregates?.kills).toBe(13);
    expect(analyzer.aggregates?.durationMs).toBe(650_000);
    expect(analyzer.notableEvents).toEqual([
      { atMs: 1_000, type: 'level-up' }, { atMs: 640_000, type: 'level-up', detail: '9' },
    ]);
    expect(analyzer.receivedAtMs).toBe(9_000);
    expect(analyzer.sessionType).toBe('hunt');
    expect(analyzer.ended).toBe(false);
  });

  it('sem evento novo, a lista fica a mesma — e o mesmo objeto, para a janela não redesenhar', () => {
    attach();
    const before = hud.get().analyzer.notableEvents;
    applyMessage(live({ notableEvents: [] }), 9_000);
    expect(hud.get().analyzer.notableEvents).toBe(before);
  });

  it('sem janela — antes de qualquer session-state — não inventa uma', () => {
    // A Cidade não credita nada (§37) e a janela não existe lá; um `analyzer` perdido não
    // pode fazê-la aparecer com `sessionType` nulo.
    applyMessage(live(), 9_000);
    expect(hud.get().analyzer.sessionType).toBeNull();
    expect(hud.get().analyzer.aggregates).toBeNull();
  });

  it('não avisa quem assina outra fatia', () => {
    attach();
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state.chat, notified);
    applyMessage(live(), 9_000);
    expect(notified).not.toHaveBeenCalled();
  });
});

describe('a configuração do bot no session-state (FUN-111)', () => {
  const state = (over: Record<string, unknown> = {}): S2CMessage => ({
    type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
    self: { creatureId: 1, characterId: 'char-1', health: 1, maxHealth: 1, mana: 0, maxMana: 0, level: 1, xp: 0 },
    world: { mapId: null, creatures: [] },
    aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
    notableEvents: [],
    ...over,
  } as S2CMessage);

  it('carrega a configuração em vigor na store do bot', () => {
    applyMessage(state({
      botConfig: {
        ...toConfig(emptyDraft()),
        heal: [{ when: { kind: 'hp', op: '<=', percent: 70 }, do: { kind: 'spell', spellId: 'heal' } }],
      },
    }), 0);
    expect(bot.get().draft.rules.heal).toHaveLength(1);
    expect(bot.get().save).toBe('saved');
  });

  it('sem configuração no estado, a store do bot não muda', () => {
    applyMessage(state(), 0);
    expect(bot.get().draft.rules.heal).toHaveLength(0);
    expect(bot.get().save).toBe('idle');
  });
});

describe('a derivada por hora (FUN-83, §16.1)', () => {
  it('converte para hora, e é o CLIENTE que faz a conta', () => {
    // O servidor não manda número redundante (FUN-78): mandar `xpGained` e `xpPerHour` é
    // mandar o mesmo número duas vezes, e os dois divergem na primeira pausa entre calcular
    // e enviar.
    expect(perHour(900, 600_000)).toBe(5_400);
    expect(perHour(300, 3_600_000)).toBe(300);
  });

  it('duração zero é ZERO, não infinito', () => {
    // Uma hunt que acabou de começar não rendeu "infinito por hora" — ela ainda não tem taxa.
    expect(perHour(10, 0)).toBe(0);
    expect(perHour(10, -1)).toBe(0);
  });
});

describe('o catálogo (FUN-79, FUN-89)', () => {
  const vocabulary = {
    vocabularyVersion: 1, advancedFromLevel: 50,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [{ id: 'heal', name: 'Cura', manaCost: 20, minLevel: 1, vocationId: null, effect: 'heal' }],
    supplies: [{ id: 'hp', name: 'Poção', price: 45, effect: 'heal' }],
  };
  const catalogue = (hunts: readonly unknown[]): S2CMessage => ({
    type: 'catalogue', hunts, bot: vocabulary,
  } as unknown as S2CMessage);

  it('chega e vira o que as duas telas oferecem', () => {
    applyMessage(catalogue([
      { id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1, difficulties: ['beginner'] },
    ]), 0);

    expect(hud.get().catalogue?.hunts).toHaveLength(1);
    expect(hud.get().catalogue?.bot.slots).toEqual(vocabulary.slots);
  });

  it('ausente e vazio são coisas DIFERENTES', () => {
    // `null` é "ainda não chegou" e as telas mostram "carregando". Colapsar os dois faria a
    // tela dizer "não há hunt nenhuma" durante o primeiro segundo de toda conexão.
    expect(hud.get().catalogue).toBeNull();
    applyMessage(catalogue([]), 0);
    expect(hud.get().catalogue?.hunts).toEqual([]);
  });

  it('SUBSTITUI em vez de acumular', () => {
    // Reconectar reenvia o mesmo catálogo. Concatenar daria hunts duplicadas na tela a cada
    // queda de rede — e a segunda cópia pareceria uma hunt diferente com o mesmo nome.
    const uma = [{ id: 'a', name: 'A', recommendedLevel: 1, difficulties: ['beginner'] }];
    applyMessage(catalogue(uma), 0);
    applyMessage(catalogue(uma), 1_000);

    expect(hud.get().catalogue?.hunts).toHaveLength(1);
  });

  it('não avisa quem assina outra fatia', () => {
    // O catálogo chegando não pode redesenhar as barras de HP.
    applyMessage(catalogue([]), 0);
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state.chat, notified);

    applyMessage(catalogue([
      { id: 'b', name: 'B', recommendedLevel: 8, difficulties: ['hero'] },
    ]), 0);

    expect(notified).not.toHaveBeenCalled();
  });

  it('leva os monstros e os marcos do Bestiário, e sem marcos a chave fica AUSENTE (FUN-113)', () => {
    // A tela do Bestiário precisa de nome onde o contador tem id, e dos marcos para dizer
    // "próximo". Mutação que mata: o `case` copiar só `hunts`, `bot` e `items`, como antes.
    const monsters = [{ id: 'rat', name: 'Rat' }];
    const bestiary = { milestones: [10_000, 25_000], xpBonusPercentPerMilestone: 1 };
    applyMessage({
      type: 'catalogue', hunts: [], monsters, bestiary, bot: vocabulary, items: [],
    } as unknown as S2CMessage, 0);

    expect(hud.get().catalogue?.monsters).toEqual(monsters);
    expect(hud.get().catalogue?.bestiary).toEqual(bestiary);

    // Servidor sem Bestiário configurado: a chave não existe, e não é `undefined` escrito —
    // é o que `exactOptionalPropertyTypes` exige e o que "não sei" quer dizer.
    applyMessage({
      type: 'catalogue', hunts: [], monsters: [], bot: vocabulary, items: [],
    } as unknown as S2CMessage, 0);
    expect(hud.get().catalogue).not.toHaveProperty('bestiary');
  });
});

describe('o bestiário (FUN-113, §18)', () => {
  it('ausente e vazio são coisas DIFERENTES', () => {
    // `null` é "ainda não chegou": um nó anterior à FUN-113 nunca manda, e o primeiro
    // segundo de toda conexão também não mandou. Um Bestiário que abre em zero afirma
    // "nunca matou nada" antes de o servidor dizer.
    expect(hud.get().bestiary).toBeNull();
    applyMessage({ type: 'bestiary', counts: {} }, 0);
    expect(hud.get().bestiary).toEqual({});
  });

  it('guarda os contadores como vieram, e SUBSTITUI em vez de somar', () => {
    // É o contador inteiro, não um delta: o servidor manda o total a cada mudança e o
    // reenvia na reconexão. Somar daria o dobro a cada queda de rede.
    applyMessage({ type: 'bestiary', counts: { rat: 1_234 } }, 0);
    expect(hud.get().bestiary).toEqual({ rat: 1_234 });

    applyMessage({ type: 'bestiary', counts: { rat: 1_235, bat: 1 } }, 1_000);
    expect(hud.get().bestiary).toEqual({ rat: 1_235, bat: 1 });
  });

  it('não avisa quem assina outra fatia', () => {
    // Chega uma vez por abate numa hunt: não pode redesenhar o inventário nem as barras.
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state.inventory, notified);
    subscribeSlice(hud, (state) => state.health, notified);

    applyMessage({ type: 'bestiary', counts: { rat: 1 } }, 0);

    expect(notified).not.toHaveBeenCalled();
  });
});

describe('a resposta do bot (FUN-89)', () => {
  beforeEach(() => { bot.set(() => INITIAL_BOT); });

  it('confirmação marca salvo', () => {
    applyMessage({ type: 'bot-config-result', ok: true }, 0);
    expect(bot.get()).toMatchObject({ save: 'saved', reason: null });
  });

  it('recusa guarda o MOTIVO e NÃO descarta o rascunho', () => {
    // Descartar seria a pior resposta a "corrija isto": apagar justamente o que precisa ser
    // corrigido. O jogador acabou de escrever aquilo.
    bot.set((state) => ({ ...state, draft: { ...state.draft, exit: [{ kind: 'out-of-gold' }] } }));

    applyMessage({
      type: 'bot-config-result', ok: false, reason: 'bot avançado exige level 50',
    }, 0);

    expect(bot.get().save).toBe('refused');
    expect(bot.get().reason).toContain('level 50');
    expect(bot.get().draft.exit).toEqual([{ kind: 'out-of-gold' }]);
  });
});

describe('o inventário (FUN-90)', () => {
  const inventory = (over: Record<string, unknown> = {}): S2CMessage => ({
    type: 'inventory',
    backpack: [{ instanceId: 'i1', itemId: 'sword', quantity: 1 }],
    // O equipado vem INTEIRO (FUN-108): ele não está na mochila, então só o id não bastava
    // para a tela achar a definição.
    equipped: { chest: { instanceId: 'i2', itemId: 'plate', quantity: 1 } },
    capacity: { used: 130, total: 400 },
    ...over,
  } as S2CMessage);

  it('chega inteiro, e o peso vem do SERVIDOR', () => {
    // O cliente não soma peso: quem sabe o que cabe é quem recusa, e a mesma conta em dois
    // lugares diverge no primeiro item com peso fracionário.
    applyMessage(inventory(), 0);

    expect(hud.get().inventory?.capacity).toEqual({ used: 130, total: 400 });
    expect(hud.get().inventory?.equipped).toEqual({
      chest: { instanceId: 'i2', itemId: 'plate', quantity: 1 },
    });
  });

  it('ausente e vazio são coisas DIFERENTES', () => {
    // Uma mochila que abre vazia mente: "ainda não sei" é o estado normal do primeiro segundo
    // de conexão, e mostrá-lo como "não tem nada" é o tipo de erro que ninguém reporta.
    expect(hud.get().inventory).toBeNull();
    applyMessage(inventory({ backpack: [] }), 0);
    expect(hud.get().inventory?.backpack).toEqual([]);
  });

  it('SUBSTITUI, e não acumula', () => {
    // O servidor manda o estado inteiro, não um delta. Montar o conjunto a partir de pedaços
    // daria uma mochila que diverge da do servidor sem nada acusar.
    applyMessage(inventory(), 0);
    applyMessage(inventory({ backpack: [] }), 1_000);

    expect(hud.get().inventory?.backpack).toEqual([]);
  });
});
