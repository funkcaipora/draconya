import type { S2CMessage } from '@draconya/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMessage } from './apply.js';
import { INITIAL_HUD, hud, subscribeSlice } from './hud.js';
import { interpolate, world } from './world.js';

const at = (x: number, y: number, z = 7) => ({ x, y, z });

beforeEach(() => {
  world.creatures.clear();
  world.instanceId = null;
  world.mapId = null;
  hud.set(() => INITIAL_HUD);
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

  it('removes a creature that disappeared', () => {
    applyMessage(spawn(1), 0);
    applyMessage({ type: 'creature-disappear', id: 1 }, 0);
    expect(world.creatures.has(1)).toBe(false);
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
