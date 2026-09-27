import { describe, expect, it } from 'vitest';
import type { TilemapInteractable } from '@draconya/content';
import {
  interactableIdOf, isToggleable, otherState, overrideFromInteractable, TileOverrides,
} from './tile-overrides.js';

// Um punhado de interativos, um por `kind` do T1 (#728, ADR 0050 d.6): porta comum, capim,
// stone pile, alavanca — e um baú, que não alterna nada, para provar que `isToggleable` recusa
// o resto sem precisar de um teste por `kind` fora do escopo.
const door: TilemapInteractable = {
  at: { x: 3, y: 2, z: 7 }, kind: 'door', initialState: 'closed', appearanceKey: 'door-1',
};
const grass: TilemapInteractable = {
  at: { x: 5, y: 2, z: 7 }, kind: 'grass', initialState: 'uncut', appearanceKey: 'grass-1',
  requires: { tool: 'machete' }, revertMs: 60_000,
};
const stonePile: TilemapInteractable = {
  at: { x: 7, y: 2, z: 7 }, kind: 'stone-pile', initialState: 'pile', appearanceKey: 'pile-1',
  requires: { tool: 'shovel' }, revertMs: 30_000,
};
const lever: TilemapInteractable = {
  at: { x: 9, y: 2, z: 7 }, kind: 'lever', initialState: 'down', appearanceKey: 'lever', aid: 2772,
  links: ['9001'],
};
const linkedDoor: TilemapInteractable = {
  at: { x: 9, y: 4, z: 7 }, kind: 'door', initialState: 'closed', appearanceKey: 'door-2', aid: 9001,
};
const chest: TilemapInteractable = {
  at: { x: 11, y: 2, z: 7 }, kind: 'chest', initialState: 'default', appearanceKey: 'chest-1', uid: 5,
};
// T2 (#732, ADR 0050 d.6): porta de level e porta de chave.
const levelDoor: TilemapInteractable = {
  at: { x: 13, y: 2, z: 7 }, kind: 'level-door', initialState: 'closed', appearanceKey: 'level-door-1',
  aid: 1010, requires: { level: 10 },
};
const keyDoor: TilemapInteractable = {
  at: { x: 15, y: 2, z: 7 }, kind: 'locked-door', initialState: 'locked', appearanceKey: 'key-door-1',
  aid: 42, requires: { tool: 'key', keyId: 42 },
};
// Teleporte e placa de pressão (T3, #734, ADR 0050 d.6).
const teleport: TilemapInteractable = {
  at: { x: 19, y: 2, z: 7 }, kind: 'teleport', initialState: 'default', appearanceKey: 'teleport-1',
  target: { x: 40, y: 2, z: 7 },
};
const gatedTeleport: TilemapInteractable = {
  at: { x: 21, y: 2, z: 7 }, kind: 'teleport', initialState: 'closed', appearanceKey: 'teleport-2',
  target: { x: 41, y: 2, z: 7 }, revertMs: 10_000,
};
const leverForTeleport: TilemapInteractable = {
  at: { x: 21, y: 4, z: 7 }, kind: 'lever', initialState: 'down', appearanceKey: 'lever', aid: 3001,
  links: ['3002'],
};
const gatedTeleportWithAid: TilemapInteractable = { ...gatedTeleport, aid: 3002 };
const plate: TilemapInteractable = {
  at: { x: 23, y: 2, z: 7 }, kind: 'pressure-plate', initialState: 'up', appearanceKey: 'plate-1',
};

describe('overrideFromInteractable — o estado inicial vem do conteúdo', () => {
  it('porta comum fechada bloqueia', () => {
    expect(overrideFromInteractable(door)).toEqual({
      interactableId: '3,2,7', kind: 'door', state: 'closed', blocked: true, floorChange: null,
    });
  });

  it('capim intacto bloqueia', () => {
    expect(overrideFromInteractable(grass).blocked).toBe(true);
  });

  it('stone pile intacta bloqueia, e ainda não muda de andar', () => {
    const state = overrideFromInteractable(stonePile);
    expect(state.blocked).toBe(true);
    expect(state.floorChange).toBeNull();
  });

  it('alavanca nunca bloqueia, em nenhum dos dois estados', () => {
    expect(overrideFromInteractable(lever).blocked).toBe(false);
    expect(overrideFromInteractable({ ...lever, initialState: 'up' }).blocked).toBe(false);
  });

  it('baú não bloqueia e não tem par de estados', () => {
    expect(overrideFromInteractable(chest).blocked).toBe(false);
    expect(isToggleable('chest')).toBe(false);
    expect(otherState('chest', 'default')).toBeNull();
  });

  it('porta de level fechada bloqueia; porta de chave TRANCADA e FECHADA bloqueiam (#732)', () => {
    expect(overrideFromInteractable(levelDoor).blocked).toBe(true);
    expect(overrideFromInteractable(keyDoor).blocked).toBe(true);
    expect(overrideFromInteractable({ ...keyDoor, initialState: 'closed' }).blocked).toBe(true);
    expect(overrideFromInteractable({ ...keyDoor, initialState: 'open' }).blocked).toBe(false);
  });
});

describe('otherState — a porta de chave alterna `locked` direto para `open` (#732)', () => {
  it('`locked` sempre vira `open`, para qualquer kind com esse estado', () => {
    expect(otherState('locked-door', 'locked')).toBe('open');
  });

  it('destrancada, a porta de chave alterna `closed`/`open` como uma porta comum', () => {
    expect(otherState('locked-door', 'closed')).toBe('open');
    expect(otherState('locked-door', 'open')).toBe('closed');
  });

  it('porta de level alterna `closed`/`open`, sem estado `locked`', () => {
    expect(otherState('level-door', 'closed')).toBe('open');
    expect(otherState('level-door', 'open')).toBe('closed');
  });
});

describe('TileOverrides — o índice por tile (ADR 0050 d.1: no máximo um por tile)', () => {
  it('blockedAt/floorChangeAt refletem o estado inicial, e nenhum outro tile é afetado', () => {
    const overrides = TileOverrides.fromInteractables([door, grass, stonePile, lever]);
    expect(overrides.blockedAt(3, 2, 7)).toBe(true);
    expect(overrides.blockedAt(5, 2, 7)).toBe(true);
    expect(overrides.blockedAt(7, 2, 7)).toBe(true);
    expect(overrides.blockedAt(9, 2, 7)).toBe(false);
    // Tile vizinho, sem interativo: nunca bloqueado por overlay.
    expect(overrides.blockedAt(4, 2, 7)).toBe(false);
    expect(overrides.floorChangeAt(7, 2, 7)).toBeNull();
  });

  it('toggle abre a porta: deixa de bloquear, e não decai (sem revertMs)', () => {
    const overrides = TileOverrides.fromInteractables([door]);
    const id = interactableIdOf(door.at);
    const opened = overrides.toggle(id, 1000);
    expect(opened).toEqual({
      interactableId: id, kind: 'door', state: 'open', blocked: false, floorChange: null,
    });
    expect(overrides.blockedAt(3, 2, 7)).toBe(false);
  });

  it('toggle corta o capim: para de bloquear e agenda a volta em revertMs', () => {
    const overrides = TileOverrides.fromInteractables([grass]);
    const id = interactableIdOf(grass.at);
    const cut = overrides.toggle(id, 1000);
    expect(cut?.state).toBe('cut');
    expect(cut?.blocked).toBe(false);
    expect(cut?.revertAtMs).toBe(1000 + 60_000);
    // Cortar de novo (o outro lado do par) NÃO decai — só o lado não-bloqueante decai.
    const regrown = overrides.toggle(id, 2000);
    expect(regrown?.state).toBe('uncut');
    expect(regrown?.blocked).toBe(true);
    expect(regrown?.revertAtMs).toBeUndefined();
  });

  it('toggle cava a stone pile: buraco desce um andar, e também decai', () => {
    const overrides = TileOverrides.fromInteractables([stonePile]);
    const id = interactableIdOf(stonePile.at);
    const dug = overrides.toggle(id, 0);
    expect(dug).toMatchObject({
      state: 'hole', blocked: false, floorChange: { x: 7, y: 2, z: 8 }, revertAtMs: 30_000,
    });
    expect(overrides.floorChangeAt(7, 2, 7)).toEqual({ x: 7, y: 2, z: 8 });
  });

  it('toggle num kind sem par (baú) devolve null e não muda nada', () => {
    const overrides = TileOverrides.fromInteractables([chest]);
    const id = interactableIdOf(chest.at);
    expect(overrides.toggle(id, 0)).toBeNull();
    expect(overrides.get(id)?.state).toBe('default');
  });

  it('links resolve por `aid`, nunca pela posição', () => {
    const overrides = TileOverrides.fromInteractables([lever, linkedDoor]);
    const leverId = interactableIdOf(lever.at);
    const resolved = overrides.links(leverId);
    expect(resolved).toEqual([interactableIdOf(linkedDoor.at)]);
  });

  it('closeDoorIfVacant fecha só uma porta ABERTA e VAZIA — nunca outro kind, nunca ocupada', () => {
    const overrides = TileOverrides.fromInteractables([door, lever]);
    const doorId = interactableIdOf(door.at);
    overrides.toggle(doorId, 0);
    expect(overrides.get(doorId)?.state).toBe('open');

    // Ainda ocupada: não fecha.
    overrides.closeDoorIfVacant(3, 2, 7, true);
    expect(overrides.get(doorId)?.state).toBe('open');

    // Vazia agora: fecha, e passa a bloquear de novo.
    overrides.closeDoorIfVacant(3, 2, 7, false);
    expect(overrides.get(doorId)).toEqual({
      interactableId: doorId, kind: 'door', state: 'closed', blocked: true, floorChange: null,
    });

    // A alavanca (outro tile, outro kind) nunca é afetada por um `vacate` em (3,2,7).
    expect(overrides.get(interactableIdOf(lever.at))?.state).toBe('down');
  });

  it('getState/fromState faz o mesmo round-trip que Fields — só o que mudou aparece', () => {
    const overrides = TileOverrides.fromInteractables([door, grass]);
    overrides.toggle(interactableIdOf(door.at), 500);
    const snapshot = overrides.getState();
    const restored = TileOverrides.fromState([door, grass], snapshot);
    expect(restored.blockedAt(3, 2, 7)).toBe(false); // porta restaurada aberta
    expect(restored.blockedAt(5, 2, 7)).toBe(true); // capim nunca foi usado
  });

  it('restoreState MUTA a instância (não substitui) — o mesmo objeto que TileOccupancy referencia', () => {
    const overrides = TileOverrides.fromInteractables([door]);
    const before = overrides;
    overrides.restoreState([{
      interactableId: interactableIdOf(door.at), kind: 'door', state: 'open', blocked: false, floorChange: null,
    }]);
    expect(overrides).toBe(before);
    expect(overrides.blockedAt(3, 2, 7)).toBe(false);
  });

  it('fromState ignora entrada de um interactableId que este mapa não tem (versão de conteúdo diferente)', () => {
    const overrides = TileOverrides.fromState([door], [
      { interactableId: 'nunca-existiu', kind: 'door', state: 'open', blocked: false, floorChange: null },
    ]);
    expect(overrides.get('nunca-existiu')).toBeNull();
    expect(overrides.blockedAt(3, 2, 7)).toBe(true);
  });

  it('toggle da porta de chave: `locked` vira `open` DIRETO — nunca passa por `closed` (#732)', () => {
    const overrides = TileOverrides.fromInteractables([keyDoor]);
    const id = interactableIdOf(keyDoor.at);
    const opened = overrides.toggle(id, 0);
    expect(opened).toEqual({
      interactableId: id, kind: 'locked-door', state: 'open', blocked: false, floorChange: null,
    });
    // Destrancada, alterna como uma porta comum — sem prazo de reversão.
    const closed = overrides.toggle(id, 1000);
    expect(closed?.state).toBe('closed');
    expect(closed?.blocked).toBe(true);
    expect(closed?.revertAtMs).toBeUndefined();
  });

  it('porta de level fecha sozinha ao esvaziar, como a porta comum (#732)', () => {
    const overrides = TileOverrides.fromInteractables([levelDoor]);
    const id = interactableIdOf(levelDoor.at);
    overrides.toggle(id, 0);
    expect(overrides.get(id)?.state).toBe('open');
    overrides.closeDoorIfVacant(13, 2, 7, false);
    expect(overrides.get(id)).toEqual({
      interactableId: id, kind: 'level-door', state: 'closed', blocked: true, floorChange: null,
    });
  });

  it('porta de chave ABERTA também fecha sozinha ao esvaziar (#732)', () => {
    const overrides = TileOverrides.fromInteractables([keyDoor]);
    const id = interactableIdOf(keyDoor.at);
    overrides.toggle(id, 0); // locked → open
    overrides.closeDoorIfVacant(15, 2, 7, false);
    expect(overrides.get(id)?.state).toBe('closed');
  });
});

describe('teleportTargetAt — teleporte por pisar (#734, ADR 0050 d.6 T3)', () => {
  it('teleporte "sempre ligado" (initialState default) devolve o target', () => {
    const overrides = TileOverrides.fromInteractables([teleport]);
    expect(overrides.teleportTargetAt(19, 2, 7)).toEqual({ x: 40, y: 2, z: 7 });
  });

  it('teleporte GATED por alavanca (initialState closed) não devolve nada antes de ser aberto', () => {
    const overrides = TileOverrides.fromInteractables([gatedTeleportWithAid, leverForTeleport]);
    expect(overrides.teleportTargetAt(21, 2, 7)).toBeNull();
  });

  it('a alavanca abre o teleporte por N s: toggle+links já fazem o resto (mesmo mecanismo do lever→door)', () => {
    const overrides = TileOverrides.fromInteractables([gatedTeleportWithAid, leverForTeleport]);
    const leverId = interactableIdOf(leverForTeleport.at);
    const opened = overrides.toggle(leverId, 0);
    expect(opened?.state).toBe('up');
    const linkedId = interactableIdOf(gatedTeleportWithAid.at);
    const teleportOpened = overrides.toggle(linkedId, 0);
    expect(teleportOpened).toMatchObject({ state: 'open', revertAtMs: 10_000 });
    expect(overrides.teleportTargetAt(21, 2, 7)).toEqual({ x: 41, y: 2, z: 7 });
    // Reverte (TILE_REVERT, no vencimento): fecha de novo e para de teleportar.
    overrides.toggle(linkedId, 10_000);
    expect(overrides.teleportTargetAt(21, 2, 7)).toBeNull();
  });

  it('nada no tile, ou um kind diferente de teleport: null', () => {
    const overrides = TileOverrides.fromInteractables([door]);
    expect(overrides.teleportTargetAt(3, 2, 7)).toBeNull();
    expect(overrides.teleportTargetAt(0, 0, 7)).toBeNull();
  });
});

describe('pressure-plate — o par up/down (#734, ADR 0050 d.6 T3)', () => {
  it('nunca bloqueia, em nenhum dos dois estados', () => {
    expect(overrideFromInteractable(plate).blocked).toBe(false);
    expect(overrideFromInteractable({ ...plate, initialState: 'down' }).blocked).toBe(false);
  });

  it('toggle pressiona (up→down) e solta (down→up), sem revertMs quando o conteúdo não declara', () => {
    const overrides = TileOverrides.fromInteractables([plate]);
    const id = interactableIdOf(plate.at);
    const pressed = overrides.toggle(id, 0);
    expect(pressed).toEqual({ interactableId: id, kind: 'pressure-plate', state: 'down', blocked: false, floorChange: null });
    const released = overrides.toggle(id, 0);
    expect(released?.state).toBe('up');
  });
});
