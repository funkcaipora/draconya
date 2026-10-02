import type { S2CMessage } from '@draconya/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMessage } from './apply.js';
import { INITIAL_HUD, hud, perHour, subscribeSlice } from './hud.js';
import { targetTracker } from './target.js';
import { INITIAL_BOT, bot, emptyDraft, toConfig } from '../bot/store.js';
import { INITIAL_PARTY, party } from '../party/store.js';
import { MISSILE_MS_PER_TILE, floatingTextColor } from '../world/effects.js';
import { TRANSIENT_CAP, clearTransients, interpolate, world } from './world.js';

const at = (x: number, y: number, z = 7) => ({ x, y, z });

beforeEach(() => {
  world.creatures.clear();
  world.instanceId = null;
  world.mapId = null;
  clearTransients();
  hud.set(() => INITIAL_HUD);
  bot.set(() => INITIAL_BOT);
  party.set(() => ({ ...INITIAL_PARTY, characterId: 'me' }));
  // O rastreador de alvo é um singleton da conexão, e o teste compartilha o módulo: sem o
  // reset, o `lastAppliedSeq` de um caso faria o `target-changed { seq: 1 }` do seguinte ser
  // descartado como obsoleto.
  targetTracker.reset();
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
      self: {
        creatureId: 1, characterId: 'c', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
        level: 1, xp: 0, vocationId: null, promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
      },
      world: { groundItems: [], tileUpdates: [], fields: [], mapId: 'rat-cellars', creatures: [] },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0, itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0 },
      notableEvents: [],
    }, 0);
    expect(world.mapId).toBe('rat-cellars');
    expect(world.ambience).toBe('cavern');
  });

  it('active-conditions com luz (#623) põe a luz do jogador no mundo; sem ela, tira; a troca de instância a apaga', () => {
    // O pintor lê `world.selfLight` sem assinatura: o servidor manda raio, cor e prazo, e o
    // decaimento é conta local (`world/light.ts`). Mutação que mata: guardar `remainingMs` sem o
    // instante de chegada — o nível não decairia.
    applyMessage({
      type: 'active-conditions',
      conditions: [{ kind: 'light', remainingMs: 300_000, light: { level: 6, color: 215, durationMs: 370_000 } }],
    }, 1_000);
    expect(world.selfLight).toEqual({
      level: 6, color: 215, durationMs: 370_000, remainingMs: 300_000, receivedAtMs: 1_000,
    });

    applyMessage({ type: 'active-conditions', conditions: [{ kind: 'haste', remainingMs: 10_000 }] }, 2_000);
    expect(world.selfLight).toBeNull();

    applyMessage({
      type: 'active-conditions',
      conditions: [{ kind: 'light', remainingMs: 300_000, light: { level: 6, color: 215, durationMs: 370_000 } }],
    }, 3_000);
    applyMessage({ type: 'instance-enter', instanceId: 'i9', map: 'rat-cellars', ambience: 'cavern' }, 3_500);
    expect(world.selfLight).toBeNull();
  });

  it('ground items: appear, disappear, and the session-state replaces them (FUN-123)', () => {
    // O cadáver é um item do chão com id próprio; some pelo id, e o estado completo o
    // substitui como substitui as criaturas — o que apodreceu sem ninguém olhar não fica.
    const before = world.groundItemsVersion;
    applyMessage({ type: 'ground-item-appear', id: 7, position: { x: 1, y: 2, z: 8 }, appearanceId: 5964 }, 0);
    expect(world.groundItems.get(7)).toEqual({ id: 7, position: { x: 1, y: 2, z: 8 }, appearanceId: 5964 });
    expect(world.groundItemsVersion).toBe(before + 1);
    applyMessage({ type: 'ground-item-disappear', id: 7 }, 0);
    expect(world.groundItems.has(7)).toBe(false);
    applyMessage({ type: 'ground-item-disappear', id: 7 }, 0);
    expect(world.groundItemsVersion).toBe(before + 2);
    applyMessage({ type: 'ground-item-appear', id: 8, position: { x: 1, y: 2, z: 8 }, appearanceId: 5964 }, 0);
    applyMessage({
      type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
      self: {
        creatureId: 1, characterId: 'c', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
        level: 1, xp: 0, vocationId: null, promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
      },
      world: {
        mapId: 'rat-cellars', creatures: [], tileUpdates: [], fields: [],
        groundItems: [{ id: 9, position: { x: 3, y: 3, z: 8 }, appearanceId: 5964 }],
      },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0, itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0 },
      notableEvents: [],
    }, 0);
    expect([...world.groundItems.keys()]).toEqual([9]);
  });

  it('fields: appear, disappear, and the session-state replaces them (#561, M31-06)', () => {
    // O campo é por id de CONTEÚDO (não numérico como o cadáver): relançar o MESMO id
    // substitui a entrada, e o estado completo substitui os que sumiram sem ninguém olhar.
    const before = world.fieldsVersion;
    applyMessage({
      type: 'field-appear', id: 'fire', tiles: [{ x: 1, y: 2, z: 8 }], appearanceId: 2118,
    }, 0);
    expect(world.fields.get('fire')).toEqual({ id: 'fire', tiles: [{ x: 1, y: 2, z: 8 }], appearanceId: 2118 });
    expect(world.fieldsVersion).toBe(before + 1);
    applyMessage({ type: 'field-disappear', id: 'fire' }, 0);
    expect(world.fields.has('fire')).toBe(false);
    applyMessage({ type: 'field-disappear', id: 'fire' }, 0);
    expect(world.fieldsVersion).toBe(before + 2);
    applyMessage({
      type: 'field-appear', id: 'poison', tiles: [{ x: 1, y: 2, z: 8 }], appearanceId: 2121,
    }, 0);
    applyMessage({
      type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
      self: {
        creatureId: 1, characterId: 'c', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
        level: 1, xp: 0, vocationId: null, promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 },
        soul: 0, soulMax: 0,
      },
      world: {
        mapId: 'rat-cellars', creatures: [], tileUpdates: [], groundItems: [],
        fields: [{ id: 'energy', tiles: [{ x: 3, y: 3, z: 8 }], appearanceId: 2122 }],
      },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0, itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0 },
      notableEvents: [],
    }, 0);
    expect([...world.fields.keys()]).toEqual(['energy']);
  });

  it('field-stage-change (#560): substitui a appearanceId do campo já conhecido, mantendo id/tiles', () => {
    applyMessage({
      type: 'field-appear', id: 'fire', tiles: [{ x: 1, y: 2, z: 8 }], appearanceId: 2118,
    }, 0);
    const before = world.fieldsVersion;
    applyMessage({ type: 'field-stage-change', id: 'fire', appearanceId: 2119 }, 0);
    expect(world.fields.get('fire')).toEqual({ id: 'fire', tiles: [{ x: 1, y: 2, z: 8 }], appearanceId: 2119 });
    expect(world.fieldsVersion).toBe(before + 1);
  });

  it('field-stage-change para um campo que a tela nunca viu é IGNORADO — nada para trocar ainda', () => {
    const before = world.fieldsVersion;
    applyMessage({ type: 'field-stage-change', id: 'unknown-field', appearanceId: 2120 }, 0);
    expect(world.fields.has('unknown-field')).toBe(false);
    expect(world.fieldsVersion).toBe(before);
  });

  it('removes a creature that disappeared', () => {
    applyMessage(spawn(1), 0);
    applyMessage({ type: 'creature-disappear', id: 1 }, 0);
    expect(world.creatures.has(1)).toBe(false);
  });
});

describe('cenário usável: tile-update, look-result e o overlay do session-state (#729, ADR 0050 d.7)', () => {
  it('tile-update guarda o replace por tile e sobe a versão', () => {
    const before = world.tileOverridesVersion;
    applyMessage({
      type: 'tile-update', position: { x: 4, y: 2, z: 7 }, replace: [{ from: 1638, to: 1639 }],
    }, 0);
    expect(world.tileOverrides.get('4,2,7')).toEqual([{ from: 1638, to: 1639 }]);
    expect(world.tileOverridesVersion).toBe(before + 1);
  });

  it('um replace VAZIO apaga a entrada (a mesma regra de ground-item-disappear)', () => {
    applyMessage({
      type: 'tile-update', position: { x: 4, y: 2, z: 7 }, replace: [{ from: 1638, to: 1639 }],
    }, 0);
    applyMessage({ type: 'tile-update', position: { x: 4, y: 2, z: 7 }, replace: [] }, 0);
    expect(world.tileOverrides.has('4,2,7')).toBe(false);
  });

  it('look-result entra no chat como system-message de nível info', () => {
    applyMessage({ type: 'look-result', text: 'A wooden door.' }, 0);
    const last = hud.get().systemMessages.at(-1);
    expect(last).toMatchObject({ level: 'info', text: 'A wooden door.' });
  });

  it('session-state SUBSTITUI o overlay inteiro, como substitui groundItems', () => {
    applyMessage({
      type: 'tile-update', position: { x: 1, y: 1, z: 7 }, replace: [{ from: 1, to: 2 }],
    }, 0);
    applyMessage({
      type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
      self: {
        creatureId: 1, characterId: 'c', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
        level: 1, xp: 0, vocationId: null, promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 },
        soul: 0, soulMax: 0,
      },
      world: {
        mapId: 'rat-cellars', creatures: [], groundItems: [], fields: [],
        tileUpdates: [{ position: { x: 4, y: 2, z: 7 }, replace: [{ from: 1638, to: 1639 }] }],
      },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0, itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0 },
      notableEvents: [],
    }, 0);
    // A entrada de ANTES do session-state some (não é a mesclagem — é substituição inteira).
    expect(world.tileOverrides.has('1,1,7')).toBe(false);
    expect(world.tileOverrides.get('4,2,7')).toEqual([{ from: 1638, to: 1639 }]);
  });

  it('session-state sem tileUpdates (nó anterior a esta issue) esvazia o overlay sem lançar', () => {
    applyMessage({
      type: 'tile-update', position: { x: 1, y: 1, z: 7 }, replace: [{ from: 1, to: 2 }],
    }, 0);
    applyMessage({
      type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
      self: {
        creatureId: 1, characterId: 'c', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
        level: 1, xp: 0, vocationId: null, promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 },
        soul: 0, soulMax: 0,
      },
      world: { mapId: 'rat-cellars', creatures: [], groundItems: [] },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    } as unknown as S2CMessage, 0);
    expect(world.tileOverrides.size).toBe(0);
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
        health: 1, maxHealth: 1, mana: 0, maxMana: 0, level: 1, xp: 0, vocationId: null,
        promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
      },
      world: { groundItems: [], tileUpdates: [], fields: [],
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

describe('a apresentação do monstro: addons, raça, luz e falas (#620)', () => {
  const look = {
    addons: 3,
    race: 'venom' as const,
    light: { level: 4, color: 208 },
    voices: { intervalMs: 5000, chance: 10, lines: [{ text: 'Meep!' }, { text: 'GRR', yell: true }] },
  };

  it('uma criatura que aparece COM a apresentação a guarda inteira', () => {
    // Mutação que mata: tirar `...presentationOf(message)` do `case 'creature-appear'` — o monstro
    // perderia addon, luz e fala sem nada acusar, porque continuaria aparecendo.
    applyMessage({ ...spawn(1), ...look } as S2CMessage, 0);
    const creature = world.creatures.get(1);
    expect(creature?.addons).toBe(3);
    expect(creature?.race).toBe('venom');
    expect(creature?.light).toEqual({ level: 4, color: 208 });
    expect(creature?.voices).toEqual(look.voices);
  });

  it('SEM ela, os quatro campos ficam AUSENTES (não `undefined`): ausência é o neutro', () => {
    // O viewport aplica o neutro — sem addon, `blood`, sem luz, mudo — e o store não o inventa.
    // Mutação que mata: copiar `message.addons` etc. direto no literal.
    applyMessage(spawn(1), 0);
    const creature = world.creatures.get(1) ?? {};
    for (const key of ['addons', 'race', 'light', 'voices']) expect(Object.hasOwn(creature, key), key).toBe(false);
  });

  it('o session-state a carrega por criatura, para quem reanexa ver o monstro pintado e falante', () => {
    // Mutação que mata: tirar `...presentationOf(creature)` do laço do `session-state`.
    applyMessage({
      type: 'session-state',
      sessionType: 'hunt',
      elapsedMs: 0,
      self: {
        creatureId: 1, characterId: 'char-1',
        health: 1, maxHealth: 1, mana: 0, maxMana: 0, level: 1, xp: 0, vocationId: null,
        promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
      },
      world: { groundItems: [], tileUpdates: [], fields: [],
        mapId: 'rat-cellars',
        creatures: [
          { id: 1, position: at(0, 0), appearanceId: 128, name: 'me', health: 1, maxHealth: 1 },
          { id: 2, position: at(1, 0), appearanceId: 21, name: 'elemental', health: 1, maxHealth: 1, ...look },
        ],
      },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    }, 0);

    expect(world.creatures.get(2)?.light).toEqual({ level: 4, color: 208 });
    expect(world.creatures.get(2)?.voices).toEqual(look.voices);
    expect(world.creatures.get(2)?.addons).toBe(3);
    expect(world.creatures.get(2)?.race).toBe('venom');
    expect(world.creatures.get(1)?.light).toBeUndefined();
  });

  it('o golpe fotografa a RAÇA do alvo — inclusive o que mata, que chega junto do `creature-disappear`', () => {
    // A criatura já não existe quando o viewport desenha o número, então a cor tem que estar no
    // texto. Mutação que mata: ler a raça no viewport, em vez de fotografá-la em `addFloatingText`.
    applyMessage({ ...spawn(1, at(2, 2)), race: 'venom' } as S2CMessage, 0);
    applyMessage({ type: 'creature-hit', id: 1, amount: 40, kind: 'melee', damageType: 'physical' }, 100);
    applyMessage({ type: 'creature-disappear', id: 1 }, 100);
    const text = world.texts[0];
    expect(text?.race).toBe('venom');
    expect(floatingTextColor(text!.kind, text!.damageType, text!.race)).toBe(0x00ff00);
  });

  it('o monstro comum e o herói não trazem raça: o número é vermelho, como sempre', () => {
    applyMessage(spawn(1, at(2, 2)), 0);
    applyMessage({ type: 'creature-hit', id: 1, amount: 40, kind: 'melee', damageType: 'physical' }, 100);
    expect(Object.hasOwn(world.texts[0] ?? {}, 'race')).toBe(false);
    expect(floatingTextColor('melee', 'physical', world.texts[0]?.race)).toBe(0xff0000);
  });

  it('raças diferentes no mesmo tile não se somam: o jogador leria veneno como sangue', () => {
    applyMessage({ ...spawn(1, at(2, 2)), race: 'venom' } as S2CMessage, 0);
    applyMessage({ ...spawn(2, at(2, 2)), race: 'undead' } as S2CMessage, 0);
    applyMessage({ type: 'creature-hit', id: 1, amount: 10, kind: 'melee', damageType: 'physical' }, 0);
    applyMessage({ type: 'creature-hit', id: 2, amount: 20, kind: 'melee', damageType: 'physical' }, 10);
    expect(world.texts).toHaveLength(2);
    // E a mesma raça, no mesmo tile e na mesma janela, SOMA como sempre.
    applyMessage({ type: 'creature-hit', id: 2, amount: 5, kind: 'melee', damageType: 'physical' }, 20);
    expect(world.texts).toHaveLength(2);
    expect(world.texts[1]?.amount).toBe(25);
  });
});

describe('a aparência emprestada: creature-update e `object` (#621, M44-03)', () => {
  const colors = { head: 114, body: 3, legs: 40, feet: 95 };

  it('creature-update troca a aparência e SUBSTITUI o objeto — a posição e o passo em curso ficam', () => {
    // Mutação que mata: mutar `appearanceId` no lugar (é `readonly`) ou recriar a criatura do
    // zero, o que apagaria o passo em curso e teleportaria o sprite.
    applyMessage(spawn(1), 0);
    applyMessage({ type: 'creature-move', id: 1, from: at(0, 0), to: at(1, 0), durationMs: 400 }, 100);
    applyMessage({ type: 'creature-update', id: 1, appearanceId: 34 }, 200);
    const creature = world.creatures.get(1);
    expect(creature?.appearanceId).toBe(34);
    expect(creature?.position).toEqual(at(1, 0));
    expect(creature?.step?.to).toEqual(at(1, 0));
    expect(creature?.name).toBe('rat-1');
  });

  it('`object: true` vira a chave do store, e ausente ou `false` a apagam — nunca `undefined`', () => {
    applyMessage(spawn(1), 0);
    applyMessage({ type: 'creature-update', id: 1, appearanceId: 3976, object: true }, 0);
    expect(world.creatures.get(1)?.object).toBe(true);
    // Voltar ao outfit: o servidor manda a aparência PRÓPRIA, sem `object`.
    applyMessage({ type: 'creature-update', id: 1, appearanceId: 100 }, 0);
    const back = world.creatures.get(1);
    expect(back?.appearanceId).toBe(100);
    expect(Object.hasOwn(back ?? {}, 'object')).toBe(false);
    applyMessage({ type: 'creature-update', id: 1, appearanceId: 100, object: false }, 0);
    expect(Object.hasOwn(world.creatures.get(1) ?? {}, 'object')).toBe(false);
  });

  it('as cores seguem a mensagem: a ilusão as apaga, e quem volta ao próprio outfit as recebe de novo', () => {
    applyMessage({
      type: 'creature-appear', id: 1, position: at(0, 0), appearanceId: 128, name: 'me',
      health: 20, maxHealth: 20, colors,
    }, 0);
    applyMessage({ type: 'creature-update', id: 1, appearanceId: 21 }, 0);
    expect(Object.hasOwn(world.creatures.get(1) ?? {}, 'colors')).toBe(false);
    applyMessage({ type: 'creature-update', id: 1, appearanceId: 128, colors }, 0);
    expect(world.creatures.get(1)?.colors).toEqual(colors);
  });

  it('os addons seguem a mensagem como as cores; a raça, a luz e as falas (#620) ficam com a criatura', () => {
    // Mutação que mata: manter `addons` sobre a aparência nova (o outfit do outro ganharia o
    // addon do dono) ou apagar `race`/`light`/`voices` junto — esses são da criatura, não do outfit.
    const voices = { intervalMs: 5000, chance: 10, lines: [{ text: 'Meep!' }] };
    applyMessage({
      ...spawn(1), addons: 3, race: 'venom', light: { level: 4, color: 208 }, voices,
    } as S2CMessage, 0);
    applyMessage({ type: 'creature-update', id: 1, appearanceId: 34, colors, addons: 1 }, 0);
    const lent = world.creatures.get(1);
    expect(lent?.addons).toBe(1);
    expect(lent?.colors).toEqual(colors);
    expect(lent?.race).toBe('venom');
    expect(lent?.light).toEqual({ level: 4, color: 208 });
    expect(lent?.voices).toEqual(voices);

    // Sem addons na mensagem, o addon antigo SAI — nunca fica sobre o outfit novo.
    applyMessage({ type: 'creature-update', id: 1, appearanceId: 21 }, 0);
    expect(Object.hasOwn(world.creatures.get(1) ?? {}, 'addons')).toBe(false);
    expect(world.creatures.get(1)?.race).toBe('venom');
  });

  it('update de criatura desconhecida é ignorado — filtrada pelo interesse, ou ainda não anunciada', () => {
    applyMessage({ type: 'creature-update', id: 99, appearanceId: 34 }, 0);
    expect(world.creatures.has(99)).toBe(false);
  });

  it('creature-appear e session-state carregam `object`: quem entra no meio da ilusão a vê vestida', () => {
    applyMessage({
      type: 'creature-appear', id: 1, position: at(0, 0), appearanceId: 3976, object: true, name: 'tree',
      health: 20, maxHealth: 20,
    }, 0);
    expect(world.creatures.get(1)?.object).toBe(true);
    applyMessage({
      type: 'session-state',
      sessionType: 'hunt',
      elapsedMs: 0,
      self: {
        creatureId: 2, characterId: 'char-1',
        health: 1, maxHealth: 1, mana: 0, maxMana: 0, level: 1, xp: 0, vocationId: null,
        promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
      },
      world: { groundItems: [], tileUpdates: [], fields: [], mapId: 'rat-cellars',
        creatures: [
          { id: 2, position: at(0, 0), appearanceId: 7172, object: true, name: 'snowman', health: 1, maxHealth: 1 },
          { id: 3, position: at(1, 0), appearanceId: 21, name: 'rat', health: 1, maxHealth: 1 },
        ],
      },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    }, 0);
    expect(world.creatures.get(2)?.object).toBe(true);
    expect(Object.hasOwn(world.creatures.get(3) ?? {}, 'object')).toBe(false);
  });

  it('nunca avisa um assinante do HUD — a aparência é do mundo, como o passo', () => {
    applyMessage(spawn(1), 0);
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state, notified);
    applyMessage({ type: 'creature-update', id: 1, appearanceId: 34 }, 0);
    expect(notified).not.toHaveBeenCalled();
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
    // apresentação (ADR 0007). A distância é euclidiana: `(3, 1)` são `sqrt(10)` tiles.
    // Mutação que mata: `durationMs: 0` no `case 'missile'`.
    applyMessage({ type: 'missile', from: at(0, 0), to: at(3, 1), missileId: 5 }, 2_000);

    expect(world.missiles).toHaveLength(1);
    expect(world.missiles[0]).toMatchObject({
      from: at(0, 0), to: at(3, 1), missileId: 5, startedAtMs: 2_000,
      durationMs: Math.round(MISSILE_MS_PER_TILE * Math.sqrt(10)),
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

  it('two hits on the same tile and color within the window MERGE into one number (RF-05)', () => {
    // Múltiplos danos no mesmo monstro em menos de 200 ms somam num só sprite, em vez de
    // borrar um sobre o outro. Mutação que mata: sempre empurrar um texto novo.
    applyMessage(spawn(1, at(2, 2)), 0);
    applyMessage({ type: 'creature-hit', id: 1, amount: 30, kind: 'melee', damageType: 'physical' }, 100);
    applyMessage({ type: 'creature-hit', id: 1, amount: 12, kind: 'melee', damageType: 'physical' }, 150);

    expect(world.texts).toHaveLength(1);
    expect(world.texts[0]).toMatchObject({ amount: 42, startedAtMs: 100, damageType: 'physical' });
  });

  it('a different element or tile, or outside the window, does NOT merge (RF-05)', () => {
    // Cores diferentes no mesmo tile não somam: o jogador leria gelo como fogo. E depois da
    // janela é outro golpe, não o mesmo instante.
    applyMessage(spawn(1, at(2, 2)), 0);
    applyMessage({ type: 'creature-hit', id: 1, amount: 10, kind: 'spell', damageType: 'ice' }, 0);
    applyMessage({ type: 'creature-hit', id: 1, amount: 20, kind: 'spell', damageType: 'fire' }, 10);
    applyMessage({ type: 'creature-hit', id: 1, amount: 30, kind: 'spell', damageType: 'ice' }, 300);

    expect(world.texts).toHaveLength(3);
  });

  it('the element travels with the number and chooses the color (RF-02)', () => {
    // Dano de gelo aparece em azul claro, não no roxo que o `kind: spell` daria sozinho.
    // Mutação que mata: `floatingTextColor(text.kind)` ignorando `damageType`.
    applyMessage(spawn(1, at(1, 1)), 0);
    applyMessage({ type: 'creature-hit', id: 1, amount: 50, kind: 'spell', damageType: 'ice' }, 0);

    expect(world.texts[0]?.damageType).toBe('ice');
    const text = world.texts[0];
    expect(floatingTextColor(text!.kind, text!.damageType)).toBe(0x66ccff);
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
        health: 1, maxHealth: 1, mana: 0, maxMana: 0, level: 1, xp: 0, vocationId: null,
        promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
      },
      world: { groundItems: [], tileUpdates: [], fields: [], mapId: 'rat-cellars', creatures: [] },
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
  it('the posture the server confirmed replaces the HUD one, and only player-stats carries it (M30-03, #550)', () => {
    expect(hud.get().fightMode).toBe('attack');
    const stats = (fightMode: 'attack' | 'balanced' | 'defense') => ({
      type: 'player-stats' as const,
      health: 150, maxHealth: 185, mana: 30, maxMana: 35,
      level: 8, xp: 4_200, capacity: 400, gold: 0, staminaMs: 86_400_000,
      ammo: { arrow: null, bolt: null }, vocationId: null, promoted: false, fightMode,
      speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
    });

    applyMessage(stats('defense'), 0);
    expect(hud.get().fightMode).toBe('defense');
    applyMessage(stats('balanced'), 0);
    expect(hud.get().fightMode).toBe('balanced');
    applyMessage(stats('attack'), 0);
    expect(hud.get().fightMode).toBe('attack');
  });

  it('applies stats and notifies once', () => {
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state.health, notified);

    applyMessage(
      {
        type: 'player-stats',
        health: 150, maxHealth: 185, mana: 30, maxMana: 35,
        level: 8, xp: 4_200, capacity: 400, gold: 0, staminaMs: 86_400_000,
        ammo: { arrow: null, bolt: null },
        vocationId: null,
        promoted: false, fightMode: 'attack', speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
      },
      0,
    );

    expect(hud.get().health).toBe(150);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it('applies speed and skills from player-stats', () => {
    applyMessage(
      {
        type: 'player-stats',
        health: 150, maxHealth: 185, mana: 30, maxMana: 35,
        level: 8, xp: 4_200, capacity: 400, gold: 0, staminaMs: 86_400_000,
        ammo: { arrow: null, bolt: null },
        vocationId: null,
        promoted: false, fightMode: 'attack',
        speed: 125,
        skills: {
          fist: { level: 11, percentToNext: 60 },
          club: { level: 9, percentToNext: 10 },
          sword: { level: 12, percentToNext: 40 },
          axe: { level: 13, percentToNext: 5 },
          distance: { level: 14, percentToNext: 75 },
          magic: { level: 4, percentToNext: 20 },
        },
        magicLevel: { level: 4, percentToNext: 20 },
        soul: 0,
        soulMax: 0,
      },
      0,
    );

    expect(hud.get().speed).toBe(125);
    expect(hud.get().skills).toEqual({
      fist: { level: 11, percent: 60 },
      club: { level: 9, percent: 10 },
      sword: { level: 12, percent: 40 },
      axe: { level: 13, percent: 5 },
      distance: { level: 14, percent: 75 },
      magic: { level: 4, percent: 20 },
    });
  });

  it('applies the Loyalty bonus and each skill\'s effective level from player-stats (#628)', () => {
    applyMessage(
      {
        type: 'player-stats',
        health: 150, maxHealth: 185, mana: 30, maxMana: 35,
        level: 8, xp: 4_200, capacity: 400, gold: 0, staminaMs: 86_400_000,
        ammo: { arrow: null, bolt: null },
        vocationId: null,
        promoted: false, fightMode: 'attack',
        speed: 125,
        skills: {
          fist: { level: 11, percentToNext: 60 },
          club: { level: 9, percentToNext: 10 },
          sword: { level: 100, percentToNext: 40, loyaltyLevel: 104 },
          axe: { level: 13, percentToNext: 5 },
          distance: { level: 14, percentToNext: 75 },
          magic: { level: 20, percentToNext: 20, loyaltyLevel: 22 },
        },
        magicLevel: { level: 20, percentToNext: 20, loyaltyLevel: 22 },
        loyaltyBonusPercent: 50,
        soul: 0,
        soulMax: 0,
      },
      0,
    );

    expect(hud.get().loyaltyBonusPercent).toBe(50);
    // O nível efetivo só existe onde o servidor o mandou; o resto fica sem a chave.
    expect(hud.get().skills.sword).toEqual({ level: 100, percent: 40, loyaltyLevel: 104 });
    expect(hud.get().skills.magic).toEqual({ level: 20, percent: 20, loyaltyLevel: 22 });
    expect(hud.get().skills.fist).toEqual({ level: 11, percent: 60 });

    // Um `player-stats` sem o bônus (conta sem degrau, ou nó anterior) volta a zero — e o nível
    // efetivo some junto, em vez de ficar preso ao valor anterior.
    applyMessage(
      {
        type: 'player-stats',
        health: 150, maxHealth: 185, mana: 30, maxMana: 35,
        level: 8, xp: 4_200, capacity: 400, gold: 0, staminaMs: 86_400_000,
        ammo: { arrow: null, bolt: null },
        vocationId: null,
        promoted: false, fightMode: 'attack',
        speed: 125,
        skills: { sword: { level: 100, percentToNext: 40 }, magic: { level: 20, percentToNext: 20 } },
        magicLevel: { level: 20, percentToNext: 20 },
        soul: 0,
        soulMax: 0,
      },
      0,
    );
    expect(hud.get().loyaltyBonusPercent).toBe(0);
    expect(hud.get().skills.sword).toEqual({ level: 100, percent: 40 });
  });

  it('applies the Loyalty bonus from session-state.self too, for whoever reattaches (#628)', () => {
    applyMessage({
      type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
      self: {
        creatureId: 1, characterId: 'char-1', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
        level: 1, xp: 0, vocationId: null, promoted: false, speed: 0,
        skills: { sword: { level: 100, percentToNext: 0, loyaltyLevel: 104 } },
        magicLevel: { level: 0, percentToNext: 0 },
        loyaltyBonusPercent: 50,
        soul: 0, soulMax: 0,
      },
      world: { groundItems: [], tileUpdates: [], fields: [], mapId: null, creatures: [] },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    } as S2CMessage, 0);
    expect(hud.get().loyaltyBonusPercent).toBe(50);
    expect(hud.get().skills.sword).toEqual({ level: 100, percent: 0, loyaltyLevel: 104 });
  });

  it('keeps the skills a node older than SV-04 does not send, but takes its speed', () => {
    hud.set((state) => ({
      ...state,
      speed: 130,
      skills: {
        fist: { level: 22, percent: 10 },
        club: { level: 19, percent: 90 },
        sword: { level: 20, percent: 50 },
        axe: { level: 21, percent: 70 },
        distance: { level: 18, percent: 40 },
        magic: { level: 8, percent: 30 },
      },
    }));

    // O que o codec entrega de um `player-stats` sem `speed`/`skills`: os defaults do protocolo
    // (`speed: 0`, `skills: {}`). O registro vazio é "não sei", e não zera as barras.
    applyMessage(
      {
        type: 'player-stats',
        health: 140, maxHealth: 185, mana: 25, maxMana: 35,
        level: 8, xp: 4_200, capacity: 400, gold: 0, staminaMs: 86_400_000,
        ammo: { arrow: null, bolt: null },
        vocationId: null,
        promoted: false, fightMode: 'attack', speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
      },
      0,
    );

    expect(hud.get().health).toBe(140);
    expect(hud.get().speed).toBe(0);
    expect(hud.get().skills).toEqual({
      fist: { level: 22, percent: 10 },
      club: { level: 19, percent: 90 },
      sword: { level: 20, percent: 50 },
      axe: { level: 21, percent: 70 },
      distance: { level: 18, percent: 40 },
      magic: { level: 8, percent: 30 },
    });
  });

  it('clears the target when target-changed says there is none (#470)', () => {
    hud.set((state) => ({ ...state, targetId: 7 }));
    // `null` é cancelamento CONFIRMADO, e limpa a moldura.
    applyMessage({ type: 'target-changed', creatureId: null }, 0);
    expect(hud.get().targetId).toBeNull();

    // A seleção confirmada grava o id; a recusa (`target-cancel`) NÃO mexe no alvo.
    applyMessage({ type: 'target-changed', creatureId: 42, seq: 1 }, 0);
    expect(hud.get().targetId).toBe(42);
    applyMessage({ type: 'target-cancel', seq: 3 }, 0);
    expect(hud.get().targetId).toBe(42);
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

describe('o alvo e a reconciliação por seq no apply (#471)', () => {
  it('descarta o ack obsoleto: o seq mais novo manda', () => {
    // seq 2 confirmado antes do seq 1 (latência/ordem): o ack antigo não pode voltar a moldura.
    // Mutação que mata: aplicar `target-changed` sem consultar o `seq` (o `case` da #470).
    applyMessage({ type: 'target-changed', creatureId: 2, seq: 2 }, 0);
    applyMessage({ type: 'target-changed', creatureId: 1, seq: 1 }, 0);

    expect(hud.get().targetId).toBe(2);
  });

  it('target-cancel desfaz a seleção otimista e devolve o alvo confirmado (RF-04)', () => {
    applyMessage({ type: 'target-changed', creatureId: 5, seq: 1 }, 0);
    // O clique pinta a moldura antes do servidor; a recusa é o que faz voltar.
    targetTracker.selectTarget(9, () => {});
    expect(hud.get().targetId).toBe(9);

    applyMessage({ type: 'target-cancel', seq: 1 }, 0);
    expect(hud.get().targetId).toBe(5);
  });

  it('creature-disappear limpa o alvo da criatura que sumiu (RF-05)', () => {
    applyMessage({ type: 'target-changed', creatureId: 5, seq: 1 }, 0);
    applyMessage({ type: 'creature-disappear', id: 5 }, 0);

    expect(hud.get().targetId).toBeNull();
  });

  it('creature-disappear de OUTRA criatura não mexe no alvo', () => {
    applyMessage({ type: 'target-changed', creatureId: 5, seq: 1 }, 0);
    applyMessage({ type: 'creature-disappear', id: 6 }, 0);

    expect(hud.get().targetId).toBe(5);
  });
});

describe('session-state', () => {
  const state = (creatures: Array<{ id: number; x: number; y: number }>) => ({
    type: 'session-state' as const,
    sessionType: 'hunt',
    elapsedMs: 600_000,
    self: {
      creatureId: 1, characterId: 'char-1',
      health: 120, maxHealth: 185, mana: 20, maxMana: 35, level: 8, xp: 4_200, vocationId: null,
      promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
    },
    world: { groundItems: [], tileUpdates: [], fields: [],
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
      health: 120, maxHealth: 185, mana: 20, maxMana: 35, level: 8, xp: 4_200, vocationId: null,
      promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
    },
    world: { groundItems: [], tileUpdates: [], fields: [], mapId: 'rat-cellars', creatures: [] },
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
      self: {
        creatureId: 1, characterId: 'char-1', health: 120, maxHealth: 185, mana: 20, maxMana: 35,
        level: 8, xp: 4_200, vocationId: null, promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
      },
      world: { groundItems: [], tileUpdates: [], fields: [], mapId: 'rat-cellars', creatures: [] },
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

describe('a party v2 no estado (#405, ADR 0035)', () => {
  const partySummary = {
    players: 4, uniqueVocations: 3, xpPercent: 175, totalXp: 10_000,
    totalSupplies: 40, shareCosts: true, splitLoot: true,
    bagValue: 1_300, bagWeight: 120, autoSell: { used: 2, limit: 5 },
  };
  const attach = (over: Record<string, unknown> = {}): S2CMessage => ({
    type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
    self: {
      creatureId: 1, characterId: 'char-1', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
      level: 1, xp: 0, vocationId: null, promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
    },
    world: { groundItems: [], tileUpdates: [], fields: [], mapId: null, creatures: [] },
    aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
    notableEvents: [],
    ...over,
  } as S2CMessage);

  it('guarda `party-spending` em vez de descartar (RF-08, regressão do `return;`)', () => {
    // Era `case 'party-spending': return;` — o `estimatedShare` da "Sua parte" se perdia.
    applyMessage({
      type: 'party-spending',
      shares: [{ characterId: 'me', goldSpent: 20, estimatedShare: 44 }],
    }, 0);
    expect(hud.get().partySpending?.shares).toEqual([
      { characterId: 'me', goldSpent: 20, estimatedShare: 44 },
    ]);
  });

  it('session-state copia `partySummary` para `analyzer.party` (RF-07)', () => {
    applyMessage(attach({ partySummary }), 0);
    expect(hud.get().analyzer.party).toEqual(partySummary);
  });

  it('analyzer copia `.party` para `analyzer.party` (RF-07)', () => {
    applyMessage(attach(), 0);
    applyMessage({
      type: 'analyzer',
      aggregates: {
        durationMs: 650_000, xpGained: 1_000, goldGained: 340, goldSpent: 120,
        kills: 13, deaths: 0, itemsLooted: 5, suppliesUsed: 7, bestBasicHit: 88, bestSpellHit: 140,
      },
      notableEvents: [],
      party: partySummary,
    }, 1);
    expect(hud.get().analyzer.party).toEqual(partySummary);
  });

  it('sem o bloco, `analyzer.party` fica `undefined` — nunca "0 jogadores" (D8)', () => {
    applyMessage(attach(), 0);
    expect(hud.get().analyzer.party).toBeUndefined();
  });

  it('session-ended limpa a seção PARTY do extrato', () => {
    party.set(() => ({ ...INITIAL_PARTY, characterId: 'me', activePartyId: 'party-1' }));
    applyMessage(attach({ partySummary }), 0);
    applyMessage({
      type: 'session-ended', reason: 'manual-exit',
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    }, 1);
    expect(hud.get().analyzer.party).toBeUndefined();
    expect(party.get().activePartyId).toBeNull();
  });

  it('grava `party-end-vote` em vez de descartar (#432)', () => {
    // Mutação que mata: descartar a mensagem — a tela nunca abriria o diálogo de aprovação.
    expect(hud.get().partyEndVote).toBeNull();
    applyMessage({ type: 'party-end-vote', active: true, proposedAtMs: 0, approved: ['lead'] }, 0);
    expect(hud.get().partyEndVote).toMatchObject({ active: true, proposedAtMs: 0, approved: ['lead'] });
  });

  it('`active: false` fecha a votação (#432)', () => {
    applyMessage({ type: 'party-end-vote', active: true, proposedAtMs: 0, approved: ['lead'] }, 0);
    applyMessage({ type: 'party-end-vote', active: false, proposedAtMs: 0, approved: [] }, 1);
    expect(hud.get().partyEndVote).toMatchObject({ active: false });
  });

  it('session-state limpa a votação: o servidor a reenvia no attach se ainda correr (#432)', () => {
    applyMessage({ type: 'party-end-vote', active: true, proposedAtMs: 0, approved: ['lead'] }, 0);
    applyMessage(attach(), 1);
    expect(hud.get().partyEndVote).toBeNull();
  });
});

describe('o follow-state do bot (#406, ADR 0035 d.9)', () => {
  it('grava a mensagem INTEIRA em `state.followState`', () => {
    // Mutação que mata: descartar o `follow-state` (era `return;` antes desta issue) — a tela
    // nunca saberia que o follow parou.
    expect(hud.get().followState).toBeNull();
    applyMessage({ type: 'follow-state', active: false, targetId: 'p2', reason: 'unreachable' }, 0);
    expect(hud.get().followState).toMatchObject({ active: false, targetId: 'p2', reason: 'unreachable' });
  });

  it('`active: true` substitui o estado anterior — o follow retomou', () => {
    applyMessage({ type: 'follow-state', active: false, targetId: 'p2', reason: 'dead' }, 0);
    applyMessage({ type: 'follow-state', active: true, targetId: 'p2' }, 1);
    expect(hud.get().followState).toMatchObject({ active: true, targetId: 'p2' });
  });

  it('é PUSH do servidor: mora no `hud`, não no `bot` (DT-01)', () => {
    const before = bot.get().save;
    applyMessage({ type: 'follow-state', active: false, targetId: 'p2', reason: 'left' }, 0);
    expect(hud.get().followState).not.toBeNull();
    expect(bot.get().save).toBe(before);
  });

  it('session-state limpa o follow-state: a reanexação não mostra o "interrompido" antigo (§7)', () => {
    applyMessage({ type: 'follow-state', active: false, targetId: 'p2', reason: 'dead' }, 0);
    applyMessage({
      type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
      self: {
        creatureId: 1, characterId: 'char-1', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
        level: 1, xp: 0, vocationId: null, promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
      },
      world: { groundItems: [], tileUpdates: [], fields: [], mapId: null, creatures: [] },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    }, 1);
    expect(hud.get().followState).toBeNull();
  });
});

describe('a saída pendente da hunt (#802)', () => {
  const stateMessage = (): S2CMessage => ({
    type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
    self: {
      creatureId: 1, characterId: 'char-1', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
      level: 1, xp: 0, vocationId: null, promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
    },
    world: { groundItems: [], tileUpdates: [], fields: [], mapId: null, creatures: [] },
    aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
    notableEvents: [],
  } as S2CMessage);

  it('grava o motivo, a fase e o que falta, com o instante LOCAL em que chegou', () => {
    // Mutação que mata: descartar o `exit-pending` — a tela nunca saberia que a saída espera.
    expect(hud.get().exitPending).toBeNull();
    applyMessage({
      type: 'exit-pending', active: true, reason: 'manual-exit', phase: 'countdown', remainingMs: 5_000,
    }, 1_234);
    expect(hud.get().exitPending).toEqual({
      reason: 'manual-exit', phase: 'countdown', remainingMs: 5_000, receivedAtMs: 1_234,
    });
  });

  it('uma mensagem nova substitui a anterior — o golpe que empurrou o prazo', () => {
    applyMessage({
      type: 'exit-pending', active: true, reason: 'manual-exit', phase: 'in-combat', remainingMs: 30_000,
    }, 10);
    applyMessage({
      type: 'exit-pending', active: true, reason: 'manual-exit', phase: 'in-combat', remainingMs: 58_000,
    }, 20);
    expect(hud.get().exitPending).toMatchObject({ remainingMs: 58_000, receivedAtMs: 20 });
  });

  it('`active: false` zera — a saída foi cancelada', () => {
    applyMessage({
      type: 'exit-pending', active: true, reason: 'manual-exit', phase: 'countdown', remainingMs: 5_000,
    }, 0);
    applyMessage({ type: 'exit-pending', active: false }, 1);
    expect(hud.get().exitPending).toBeNull();
  });

  it('`active: true` sem os campos não fabrica uma espera que o servidor não descreveu', () => {
    applyMessage({ type: 'exit-pending', active: true }, 0);
    expect(hud.get().exitPending).toBeNull();
  });

  it('session-ended zera: a saída acabou de se cumprir', () => {
    applyMessage({
      type: 'exit-pending', active: true, reason: 'manual-exit', phase: 'countdown', remainingMs: 5_000,
    }, 0);
    applyMessage({
      type: 'session-ended', reason: 'manual-exit',
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    }, 1);
    expect(hud.get().exitPending).toBeNull();
  });

  it('session-state zera: o servidor reenvia no attach, com o que falta AGORA', () => {
    applyMessage({
      type: 'exit-pending', active: true, reason: 'manual-exit', phase: 'countdown', remainingMs: 5_000,
    }, 0);
    applyMessage(stateMessage(), 1);
    expect(hud.get().exitPending).toBeNull();
  });
});

describe('a sessão world no cliente (OW-23, #846)', () => {
  const stats = (over: Record<string, unknown> = {}): S2CMessage => ({
    type: 'player-stats',
    health: 150, maxHealth: 185, mana: 30, maxMana: 35,
    level: 8, xp: 4_200, capacity: 400, gold: 0, staminaMs: 86_400_000,
    ammo: { arrow: null, bolt: null }, vocationId: null, promoted: false, fightMode: 'attack',
    speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
    ...over,
  } as S2CMessage);
  const stateMessage = (sessionType = 'world'): S2CMessage => ({
    type: 'session-state', sessionType, elapsedMs: 0,
    self: {
      creatureId: 1, characterId: 'char-1', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
      level: 1, xp: 0, vocationId: null, promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
    },
    world: { groundItems: [], tileUpdates: [], fields: [], mapId: null, creatures: [] },
    aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
    notableEvents: [],
  } as S2CMessage);

  describe('a zona e a luta (player-stats)', () => {
    it('guarda a zona do tile e se está em luta — o que alimenta os dois ícones', () => {
      applyMessage(stats({ zone: 'protection', inFight: false }), 0);
      expect(hud.get().zone).toBe('protection');
      expect(hud.get().inFight).toBe(false);
      applyMessage(stats({ zone: 'normal', inFight: true }), 1);
      expect(hud.get().zone).toBe('normal');
      expect(hud.get().inFight).toBe(true);
    });

    it('ausente é "este servidor não diz" (null), e nunca "normal, sem luta"', () => {
      applyMessage(stats({ zone: 'protection', inFight: true }), 0);
      applyMessage(stats(), 1);
      // Mutação que mata: `message.zone ?? 'normal'` e `message.inFight ?? false` — a tela passaria a afirmar o
      // que o servidor não disse, e um nó anterior apagaria o ícone de PZ que o outro acabou de acender.
      expect(hud.get().zone).toBeNull();
      expect(hud.get().inFight).toBeNull();
    });

    it('o session-state zera a zona e a luta: eram de uma sessão que já não é esta', () => {
      applyMessage(stats({ zone: 'protection', inFight: true }), 0);
      applyMessage(stateMessage('hunt'), 1);
      expect(hud.get().zone).toBeNull();
      expect(hud.get().inFight).toBeNull();
    });

    it('a sessão world é guardada como o tipo que o servidor mandou, sem virar hunt', () => {
      applyMessage(stateMessage('world'), 0);
      expect(hud.get().analyzer.sessionType).toBe('world');
    });
  });

  describe('o logout recusado (logout-refused)', () => {
    it('guarda o motivo e o instante LOCAL da chegada, e não mexe no resto do HUD', () => {
      const before = hud.get();
      applyMessage({ type: 'logout-refused', reason: 'in-fight' }, 1_234);

      expect(hud.get().exitRefusal).toEqual({ reason: 'in-fight', atMs: 1_234 });
      expect(hud.get().health).toBe(before.health);
      expect(hud.get().analyzer).toBe(before.analyzer);
    });

    it('vira uma linha de aviso no registro, em português, com o motivo certo', () => {
      applyMessage({ type: 'logout-refused', reason: 'in-fight' }, 10);
      applyMessage({ type: 'logout-refused', reason: 'no-logout-tile' }, 20);

      expect(hud.get().systemMessages.map(({ level, text }) => ({ level, text }))).toEqual([
        { level: 'warning', text: 'Você não pode sair durante uma luta.' },
        { level: 'warning', text: 'Você não pode sair daqui.' },
      ]);
    });

    it('a recusa seguinte SUBSTITUI a anterior (o aviso novo aparece mesmo com o velho na tela)', () => {
      applyMessage({ type: 'logout-refused', reason: 'in-fight' }, 10);
      applyMessage({ type: 'logout-refused', reason: 'no-logout-tile' }, 20);
      expect(hud.get().exitRefusal).toEqual({ reason: 'no-logout-tile', atMs: 20 });
    });

    it('o session-state zera a recusa: a sessão nova não herda o aviso da anterior', () => {
      applyMessage({ type: 'logout-refused', reason: 'in-fight' }, 10);
      applyMessage(stateMessage('hunt'), 20);
      expect(hud.get().exitRefusal).toBeNull();
    });
  });

  describe('a fila do mundo cheio (world-full)', () => {
    it('guarda a posição, o prazo e a oferta da hunt, com o instante local em que chegou', () => {
      expect(hud.get().worldQueue).toBeNull();
      applyMessage({ type: 'world-full', position: 3, retryAfterMs: 10_000, huntAvailable: true }, 5_000);
      expect(hud.get().worldQueue).toEqual({
        position: 3, retryAfterMs: 10_000, huntAvailable: true, receivedAtMs: 5_000,
      });
    });

    it('cada tentativa SUBSTITUI a fila — a posição de agora, nunca a de antes', () => {
      applyMessage({ type: 'world-full', position: 7, retryAfterMs: 20_000, huntAvailable: true }, 1_000);
      applyMessage({ type: 'world-full', position: 4, retryAfterMs: 10_000, huntAvailable: false }, 21_000);
      expect(hud.get().worldQueue).toEqual({
        position: 4, retryAfterMs: 10_000, huntAvailable: false, receivedAtMs: 21_000,
      });
    });

    it('o session-state tira o personagem da fila: ele entrou', () => {
      applyMessage({ type: 'world-full', position: 1, retryAfterMs: 5_000, huntAvailable: true }, 1_000);
      applyMessage(stateMessage('world'), 6_000);
      expect(hud.get().worldQueue).toBeNull();
    });

    it('a fila não é uma sessão: o analisador e o tipo de sessão ficam como estavam', () => {
      const before = hud.get().analyzer;
      applyMessage({ type: 'world-full', position: 2, retryAfterMs: 5_000, huntAvailable: true }, 1);
      expect(hud.get().analyzer).toBe(before);
      expect(hud.get().analyzer.sessionType).toBeNull();
    });
  });
});

describe('a configuração do bot no session-state (FUN-111)', () => {
  const state = (over: Record<string, unknown> = {}): S2CMessage => ({
    type: 'session-state', sessionType: 'hunt', elapsedMs: 0,
    self: {
      creatureId: 1, characterId: 'char-1', health: 1, maxHealth: 1, mana: 0, maxMana: 0,
      level: 1, xp: 0, vocationId: null, promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
    },
    world: { groundItems: [], tileUpdates: [], fields: [], mapId: null, creatures: [] },
    aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
    notableEvents: [],
    ...over,
  } as S2CMessage);

  it('carrega a configuração em vigor na store do bot', () => {
    const config = toConfig(emptyDraft());
    const sets = config.sets.map((set, i) => i === 0
      ? { slots: set.slots.map((entry, j) => (j === 0
        ? { do: { kind: 'spell' as const, spellId: 'heal' }, when: [], auto: true }
        : entry)) }
      : set);
    applyMessage(state({ botConfig: { ...config, sets } }), 0);
    expect(bot.get().draft.sets[0]?.slots[0]?.do).toEqual({ kind: 'spell', spellId: 'heal' });
    expect(bot.get().save).toBe('saved');
  });

  it('sem configuração no estado, a store do bot não muda', () => {
    applyMessage(state(), 0);
    expect(bot.get().draft.sets[0]?.slots[0]).toBeNull();
    expect(bot.get().save).toBe('idle');
  });
});

describe('o estado de slot e a recusa da tecla (AB-10)', () => {
  it('slot-state substitui o mapa por `${set}:${slot}` e limpa a recusa do slot reavaliado', () => {
    hud.set((state) => ({
      ...state,
      slotResults: { '0:0': 'sem mana' },
    }));
    applyMessage({
      type: 'slot-state',
      slots: [{ set: 0, slot: 0, state: 'cooldown', remainingMs: 1500 }],
    }, 0);
    expect(hud.get().slotStates['0:0']).toEqual({ set: 0, slot: 0, state: 'cooldown', remainingMs: 1500 });
    expect(hud.get().slotResults['0:0']).toBeUndefined();
  });

  it('slot-result ok:false guarda o motivo; ok:true limpa', () => {
    applyMessage({ type: 'slot-result', set: 1, slot: 2, ok: false, reason: 'Sem mana.' }, 0);
    expect(hud.get().slotResults['1:2']).toBe('Sem mana.');
    applyMessage({ type: 'slot-result', set: 1, slot: 2, ok: true }, 0);
    expect(hud.get().slotResults['1:2']).toBeUndefined();
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
    vocabularyVersion: 1, slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
    spells: [{ id: 'heal', name: 'Cura', manaCost: 20, minLevel: 1, vocationId: null, effect: 'heal' }],
    supplies: [{ id: 'hp', name: 'Poção', price: 45, effect: 'heal' }],
  };
  const catalogue = (hunts: readonly unknown[]): S2CMessage => ({
    type: 'catalogue', hunts, bot: vocabulary,
  } as unknown as S2CMessage);

  it('chega e vira o que as duas telas oferecem', () => {
    applyMessage(catalogue([
      { id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1, difficulties: ['cautious'], lootDrops: 0 },
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
    const uma = [{ id: 'a', name: 'A', recommendedLevel: 1, difficulties: ['cautious'], lootDrops: 0 }];
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
      { id: 'b', name: 'B', recommendedLevel: 8, difficulties: ['reckless'], lootDrops: 0 },
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

describe('o Bosstiary (#629, ADR 0052 d.1)', () => {
  const vocabulary = { vocabularyVersion: 1, slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } };
  it('ausente e vazio são coisas DIFERENTES, como no Bestiário', () => {
    expect(hud.get().bosstiary).toBeNull();
    applyMessage({ type: 'bosstiary', kills: {}, points: 0 }, 0);
    expect(hud.get().bosstiary).toEqual({ kills: {}, points: 0 });
  });

  it('guarda o registro como veio, e SUBSTITUI em vez de somar', () => {
    applyMessage({ type: 'bosstiary', kills: { '639': 3 }, points: 40 }, 0);
    expect(hud.get().bosstiary).toEqual({ kills: { '639': 3 }, points: 40 });

    applyMessage({ type: 'bosstiary', kills: { '639': 5, '100': 1 }, points: 110 }, 1_000);
    expect(hud.get().bosstiary).toEqual({ kills: { '639': 5, '100': 1 }, points: 110 });
  });

  it('não avisa quem assina outra fatia', () => {
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state.inventory, notified);
    subscribeSlice(hud, (state) => state.bestiary, notified);

    applyMessage({ type: 'bosstiary', kills: { '639': 1 }, points: 10 }, 0);

    expect(notified).not.toHaveBeenCalled();
  });

  it('o catálogo leva a tabela de níveis e a raridade de cada boss, e sem tabela a chave fica AUSENTE', () => {
    const bosstiary = { levels: {
      bane: [{ kills: 25, points: 5 }], archfoe: [{ kills: 5, points: 10 }], nemesis: [{ kills: 1, points: 10 }],
    } };
    const monsters = [{ id: 'dreadmaw', name: 'Dreadmaw', bosstiary: { rarity: 'nemesis', raceId: 639 } }];
    applyMessage({
      type: 'catalogue', hunts: [], monsters, bosstiary, bot: vocabulary, items: [],
    } as unknown as S2CMessage, 0);
    expect(hud.get().catalogue?.bosstiary).toEqual(bosstiary);
    expect(hud.get().catalogue?.monsters).toEqual(monsters);

    applyMessage({
      type: 'catalogue', hunts: [], monsters: [], bot: vocabulary, items: [],
    } as unknown as S2CMessage, 0);
    expect(hud.get().catalogue).not.toHaveProperty('bosstiary');
  });
});

describe('o Hazard (M44-14, #632, ADR 0052 d.1)', () => {
  it('ausente e vazio são coisas DIFERENTES: `null` é "ainda não chegou"', () => {
    expect(hud.get().hazard).toBeNull();
    applyMessage({ type: 'hazard', maxLevel: {}, currentLevel: {} }, 0);
    expect(hud.get().hazard).toEqual({ maxLevel: {}, currentLevel: {} });
  });

  it('SUBSTITUI o registro inteiro, nunca acumula: o nível escolhido pode DESCER', () => {
    applyMessage({ type: 'hazard', maxLevel: { gardens: 5 }, currentLevel: { gardens: 5 } }, 0);
    applyMessage({ type: 'hazard', maxLevel: { gardens: 5 }, currentLevel: { gardens: 2 } }, 1_000);
    expect(hud.get().hazard).toEqual({ maxLevel: { gardens: 5 }, currentLevel: { gardens: 2 } });
  });

  it('não avisa quem assina outra fatia', () => {
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state.inventory, notified);
    subscribeSlice(hud, (state) => state.health, notified);
    applyMessage({ type: 'hazard', maxLevel: { gardens: 2 }, currentLevel: { gardens: 1 } }, 0);
    expect(notified).not.toHaveBeenCalled();
  });

  it('o catálogo leva as zonas, e sem elas a chave fica AUSENTE (nó anterior)', () => {
    const hazardZones = [{ id: 'gardens', name: 'Gnomprona Gardens', minLevel: 1, maxLevel: 12 }];
    applyMessage({
      type: 'catalogue', hunts: [], monsters: [], bot: {}, items: [], hazardZones,
    } as unknown as S2CMessage, 0);
    expect(hud.get().catalogue?.hazardZones).toEqual(hazardZones);

    applyMessage({
      type: 'catalogue', hunts: [], monsters: [], bot: {}, items: [],
    } as unknown as S2CMessage, 0);
    expect(hud.get().catalogue).not.toHaveProperty('hazardZones');
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

describe('as magias aprendidas (#624, ADR 0058)', () => {
  it('ausente e vazio são coisas DIFERENTES: `null` é "o servidor ainda não disse"', () => {
    // Um nó anterior à #624 nunca manda, e o primeiro segundo de toda conexão também não mandou.
    // Tratar "não sei" como "não aprendeu nada" marcaria TODO slot da barra antes da hora.
    expect(hud.get().learnedSpells).toBeNull();
    applyMessage({ type: 'learned-spells', spellIds: [] }, 0);
    expect(hud.get().learnedSpells).toEqual([]);
  });

  it('SUBSTITUI o registro inteiro, em vez de somar — a reconexão reenvia o mesmo total', () => {
    applyMessage({ type: 'learned-spells', spellIds: ['wound-cleansing'] }, 0);
    applyMessage({ type: 'learned-spells', spellIds: ['wound-cleansing', 'berserk'] }, 1_000);
    expect(hud.get().learnedSpells).toEqual(['wound-cleansing', 'berserk']);
    applyMessage({ type: 'learned-spells', spellIds: ['wound-cleansing', 'berserk'] }, 2_000);
    expect(hud.get().learnedSpells).toEqual(['wound-cleansing', 'berserk']);
  });

  it('não avisa quem assina outra fatia', () => {
    const notified = vi.fn();
    subscribeSlice(hud, (state) => state.inventory, notified);
    subscribeSlice(hud, (state) => state.health, notified);

    applyMessage({ type: 'learned-spells', spellIds: ['berserk'] }, 0);

    expect(notified).not.toHaveBeenCalled();
  });
});

describe('o Treino (#631, ADR 0059)', () => {
  const state: S2CMessage = {
    type: 'training-state', offlineBankMs: 3_600_000, offlineSkill: 'sword',
    weapons: [{ instanceId: 'w1', itemId: 'exercise-sword', charges: 431 }], activeInstanceId: 'w1',
  };

  it('o catálogo leva as regras do Treino e as exercise weapons — e sem elas o pill "Treino" não existe', () => {
    // Mutação que mata: `apply` copia o catálogo CAMPO A CAMPO, e um campo novo que não entra ali some
    // no caminho sem erro nenhum (foi o que o QA no navegador pegou: o `training` chegava e sumia).
    const base = {
      type: 'catalogue', hunts: [], monsters: [], charms: [], vocations: [], vocationLevel: 8,
      bot: { vocabularyVersion: 2, spells: [], supplies: [], automations: [] },
      items: [{
        id: 'exercise-sword', name: 'exercise sword', appearanceId: 1, weight: 10, slot: null, twoHanded: false,
        exercise: { skillId: 'sword', charges: 500 }, buyPrice: 347_222,
      }],
      ammunition: [],
    };
    const training = {
      perCharge: { tries: 7, manaSpent: 600 }, bankCapMs: 43_200_000, graceMs: 600_000,
      spendCapMs: { free: 21_600_000, premium: 43_200_000 },
      offlineSkills: [{ skillId: 'sword', name: 'Espada', kind: 'attacks' }],
      skills: [
        { skillId: 'sword', name: 'Espada', kind: 'attacks' },
        { skillId: 'shielding', name: 'Escudo', kind: 'attacks' },
      ],
    };
    applyMessage({ ...base, training } as unknown as S2CMessage, 0);
    expect(hud.get().catalogue?.training).toEqual(training);
    expect(hud.get().catalogue?.items[0]).toMatchObject({ exercise: { skillId: 'sword', charges: 500 }, buyPrice: 347_222 });

    applyMessage(base as unknown as S2CMessage, 0);
    expect(hud.get().catalogue).not.toHaveProperty('training');
  });

  it('ausente e vazio são coisas DIFERENTES: `null` até o servidor dizer', () => {
    // Um nó `game` sem Treino nunca manda — e o primeiro segundo de toda conexão também não mandou.
    expect(hud.get().training).toBeNull();
    applyMessage({
      type: 'training-state', offlineBankMs: 0, offlineSkill: null, weapons: [], activeInstanceId: null,
    }, 0);
    expect(hud.get().training).toEqual({ offlineBankMs: 0, offlineSkill: null, weapons: [], activeInstanceId: null });
  });

  it('SUBSTITUI o estado inteiro a cada mensagem — cada golpe do Treino reenvia as cargas', () => {
    applyMessage(state, 0);
    expect(hud.get().training?.weapons).toEqual([{ instanceId: 'w1', itemId: 'exercise-sword', charges: 431 }]);
    applyMessage({ ...state, weapons: [{ instanceId: 'w1', itemId: 'exercise-sword', charges: 430 }] } as S2CMessage, 2_000);
    expect(hud.get().training?.weapons).toEqual([{ instanceId: 'w1', itemId: 'exercise-sword', charges: 430 }]);
    // A arma acabou: some da lista, e a instância ativa some junto.
    applyMessage({ ...state, weapons: [], activeInstanceId: null } as S2CMessage, 4_000);
    expect(hud.get().training).toMatchObject({ weapons: [], activeInstanceId: null, offlineBankMs: 3_600_000 });
  });

  it('não avisa quem assina outra fatia', () => {
    // Chega a cada golpe (a cada ~2 s): não pode redesenhar o inventário nem as barras.
    const notified = vi.fn();
    subscribeSlice(hud, (current) => current.inventory, notified);
    subscribeSlice(hud, (current) => current.health, notified);
    applyMessage(state, 0);
    expect(notified).not.toHaveBeenCalled();
  });

  it('o extrato do Treino diz o porquê e o tempo — não XP, gold nem abate, que ele não rende', () => {
    applyMessage({
      type: 'session-state', sessionType: 'training', elapsedMs: 0,
      self: {
        creatureId: 1, characterId: 'me', health: 1, maxHealth: 1, mana: 0, maxMana: 0, level: 1, xp: 0,
        vocationId: null, promoted: false, speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 },
        soul: 0, soulMax: 0,
      },
      world: { mapId: 'city', creatures: [], groundItems: [], tileUpdates: [], fields: [] },
      aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    } as unknown as S2CMessage, 0);
    applyMessage({
      type: 'session-ended', reason: 'completed',
      aggregates: { durationMs: 960_000, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    }, 0);
    const line = hud.get().systemMessages.at(-1);
    // A arma acabou: não é "Concluído" (a frase da hunt), é o que de fato aconteceu.
    expect(line?.text).toBe('Treino: A exercise weapon acabou · 16 min');
    expect(line?.text).not.toContain('XP');

    // E parar o treino na Cidade não é "sair da hunt": o jogador está lendo isto em pé na praça.
    applyMessage({
      type: 'session-ended', reason: 'manual-exit',
      aggregates: { durationMs: 180_000, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
      notableEvents: [],
    }, 0);
    const manual = hud.get().systemMessages.at(-1);
    expect(manual?.text).toBe('Treino: Você saiu do treino · 3 min');
    expect(manual?.text).not.toContain('hunt');
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
    satchel: [],
    // O equipado vem INTEIRO (FUN-108): ele não está na mochila, então só o id não bastava
    // para a tela achar a definição.
    equipped: { chest: { instanceId: 'i2', itemId: 'plate', quantity: 1 } },
    capacity: { used: 130, total: 400 },
    supplies: [],
    ammunition: [],
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

describe('jogadores online (SV-07/SV-15, #351)', () => {
  const sessionState = (over: Record<string, unknown> = {}): S2CMessage => ({
    type: 'session-state',
    sessionType: 'hunt',
    elapsedMs: 0,
    self: {
      creatureId: 1, characterId: 'char-1',
      health: 100, maxHealth: 100, mana: 50, maxMana: 50, level: 1, xp: 0, vocationId: null,
      speed: 0, skills: {}, magicLevel: { level: 0, percentToNext: 0 }, soul: 0, soulMax: 0,
    },
    world: { groundItems: [], tileUpdates: [], fields: [], mapId: 'rat-cellars', creatures: [] },
    aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
    notableEvents: [],
    ...over,
  } as unknown as S2CMessage);

  it('player-count atualiza o total de jogadores online no HUD', () => {
    applyMessage({ type: 'player-count', count: 1284 }, 0);
    expect(hud.get().onlinePlayers).toBe(1284);
  });

  it('session-state com onlinePlayers define onlinePlayers', () => {
    applyMessage(sessionState({ onlinePlayers: 42 }), 0);
    expect(hud.get().onlinePlayers).toBe(42);
  });

  it('session-state sem onlinePlayers define onlinePlayers como null mesmo se já definido', () => {
    hud.set((state) => ({ ...state, onlinePlayers: 100 }));
    applyMessage(sessionState(), 0);
    expect(hud.get().onlinePlayers).toBeNull();
  });
});
