// Apresentação E2E do combate no cliente (M24-12, #477; RF-06 e as bordas do milestone).
//
// O servidor é a autoridade (invariante 4); aqui se prova o que o CLIENTE faz com o que chega:
// reconcilia o ack de alvo por `seq` mesmo com latência fora de ordem, mantém o projétil e o
// número do golpe que mata, e trata um lote de aba de fundo como UM instante — sem reproduzir
// dez minutos de animação. Nada aqui simula: `applyMessage` é a costura do socket para o store,
// e o relógio é o `nowMs` passado à mão (ADR 0007).

import type { C2SMessage, S2CMessage } from '@draconya/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMessage } from './apply.js';
import { INITIAL_HUD, hud } from './hud.js';
import { targetTracker } from './target.js';
import { clearTransients, world } from './world.js';
import { slotTitle } from '../shell/action-bar.js';

const at = (x: number, y: number, z = 7) => ({ x, y, z });

beforeEach(() => {
  world.creatures.clear();
  clearTransients();
  hud.set(() => INITIAL_HUD);
  targetTracker.reset();
});

function spawn(id: number, position = at(0, 0)): S2CMessage {
  return {
    type: 'creature-appear',
    id, position, appearanceId: 100, name: `rat-${id}`, health: 20, maxHealth: 20,
  };
}

describe('apresentação de combate E2E (M24-12, #477)', () => {
  it('RF-06: acks fora de ordem com 0/50/150/300 ms de latência — o maior seq manda', () => {
    // A rede entrega o ack de B (seq 2) antes do de A (seq 1). O cliente descarta o obsoleto e
    // a moldura não volta para A. Mutação que mata: aplicar `target-changed` sem consultar o
    // `seq` — a última mensagem da lista venceria.
    applyMessage(spawn(1, at(1, 1)), 0);
    applyMessage(spawn(2, at(2, 2)), 0);

    applyMessage({ type: 'target-changed', creatureId: 2, seq: 2 }, 0);
    applyMessage({ type: 'target-changed', creatureId: 1, seq: 1 }, 50);
    applyMessage({ type: 'target-changed', creatureId: 2, seq: 2 }, 150);
    applyMessage({ type: 'target-changed', creatureId: 1, seq: 1 }, 300);

    expect(hud.get().targetId).toBe(2);
  });

  it('RF-06: A → B antes do ack — o otimista pinta B e o servidor confirma B', () => {
    applyMessage(spawn(1, at(1, 1)), 0);
    applyMessage(spawn(2, at(2, 2)), 0);
    const sent: C2SMessage[] = [];

    targetTracker.selectTarget(1, (message) => sent.push(message));
    targetTracker.selectTarget(2, (message) => sent.push(message));
    // A moldura muda no mesmo quadro do clique, sem esperar a volta.
    expect(hud.get().targetId).toBe(2);
    // Os dois são intenções seqüenciais no fio.
    expect(sent).toEqual([
      { type: 'select-target', creatureId: 1, seq: 1 },
      { type: 'select-target', creatureId: 2, seq: 2 },
    ]);

    // A confirmação de A chega DEPOIS da de B: o cliente fica com B.
    applyMessage({ type: 'target-changed', creatureId: 2, seq: 2 }, 100);
    applyMessage({ type: 'target-changed', creatureId: 1, seq: 1 }, 150);
    expect(hud.get().targetId).toBe(2);
  });

  it('RF-06: alvo morre no meio da troca — a moldura limpa e o ack atrasado não a reergue', () => {
    applyMessage(spawn(1, at(1, 1)), 0);
    applyMessage(spawn(2, at(2, 2)), 0);
    applyMessage({ type: 'target-changed', creatureId: 2, seq: 2 }, 0);
    applyMessage({ type: 'target-changed', creatureId: 1, seq: 1 }, 0);
    expect(hud.get().targetId).toBe(2);

    // B some: a moldura é limpa na hora (RF-05), sem esperar `target-changed { null }`.
    applyMessage({ type: 'creature-disappear', id: 2 }, 100);
    expect(hud.get().targetId).toBeNull();

    // Um ack antigo de A (seq 1) já foi aplicado: não ressuscita nada.
    applyMessage({ type: 'target-changed', creatureId: 1, seq: 1 }, 200);
    expect(hud.get().targetId).toBeNull();
  });

  it('o míssil em voo termina sobre o corpse, e o número ancora no ponto de impacto', () => {
    // O golpe que mata chega no mesmo lote que o `creature-disappear`. O projétil e o efeito de
    // área continuam aparecendo, e o número fica ONDE caiu — não segue a criatura que sumiu.
    applyMessage(spawn(2, at(2, 2)), 0);
    applyMessage({ type: 'missile', from: at(0, 0), to: at(2, 2), missileId: 29 }, 100);
    applyMessage({ type: 'effect', position: at(2, 2), effectId: 41 }, 100);
    applyMessage({ type: 'creature-hit', id: 2, amount: 99, kind: 'spell', damageType: 'ice' }, 100);
    applyMessage({ type: 'creature-disappear', id: 2 }, 100);

    expect(world.missiles).toHaveLength(1);
    expect(world.effects).toHaveLength(1);
    expect(world.effects[0]).toMatchObject({ position: at(2, 2), effectId: 41 });
    expect(world.texts).toHaveLength(1);
    expect(world.texts[0]).toMatchObject({ amount: 99, kind: 'spell', damageType: 'ice', position: at(2, 2) });
  });

  it('a ordem de um lote de área é preservada: o projétil, os 37 efeitos, os golpes', () => {
    // O host manda o lote já ordenado; o cliente empurra na mesma ordem. Vários efeitos no mesmo
    // instante mantêm a sequência (a chave de fase é do viewport, a lista é o contrato).
    applyMessage(spawn(1, at(3, 3)), 0);
    applyMessage({ type: 'missile', from: at(0, 0), to: at(3, 3), missileId: 29 }, 10);
    for (let i = 0; i < 37; i += 1) {
      applyMessage({ type: 'effect', position: at(i % 7, Math.floor(i / 7)), effectId: 41 }, 10);
    }
    applyMessage({ type: 'creature-hit', id: 1, amount: 12, kind: 'spell', damageType: 'ice' }, 10);

    expect(world.missiles).toHaveLength(1);
    expect(world.effects).toHaveLength(37);
    expect(world.effects.map((effect) => effect.effectId).every((id) => id === 41)).toBe(true);
    expect(world.texts).toHaveLength(1);
  });

  it('aba de fundo: um lote aplicado de uma vez toca JUNTO, no instante da chegada', () => {
    // Ao voltar de aba de fundo, o socket entregou tudo e o `requestAnimationFrame` não rodou:
    // os transientes ganham o MESMO instante local em vez de reproduzir a linha do tempo do
    // servidor. Mutação que mata: `startedAtMs` vindo do servidor (ou zero fixo).
    applyMessage(spawn(1, at(2, 2)), 0);
    for (let i = 0; i < 10; i += 1) {
      applyMessage({ type: 'effect', position: at(i, 0), effectId: 41 }, 9_000);
    }
    applyMessage({ type: 'creature-hit', id: 1, amount: 10, kind: 'spell', damageType: 'ice' }, 9_000);
    applyMessage({ type: 'creature-hit', id: 1, amount: 5, kind: 'spell', damageType: 'ice' }, 9_000);

    expect(world.effects.every((effect) => effect.startedAtMs === 9_000)).toBe(true);
    expect(world.texts).toHaveLength(1);
    // Mesmo tile e mesma cor dentro da janela: os dois números do lote somam num só.
    expect(world.texts[0]).toMatchObject({ amount: 15, startedAtMs: 9_000 });
  });

  it('o motivo do slot-state chega ao tooltip — o cliente explica por que a runa não rodou', () => {
    // O host traduz o código do `sim` em palavras (RF-02) e o cliente as leva ao `title` do
    // slot. Sem isso o jogador veria "bloqueado" sem saber que faltava magic level.
    applyMessage({
      type: 'slot-state',
      slots: [{ set: 0, slot: 0, state: 'blocked', remainingMs: 0, reason: 'Magic level insuficiente.' }],
    }, 0);
    const reason = hud.get().slotStates['0:0']?.reason ?? null;
    expect(reason).toBe('Magic level insuficiente.');
    const title = slotTitle(
      { label: 'Avalanche Rune', hotkey: undefined, element: undefined, cooldownMs: 0, blocked: true },
      reason,
    );
    expect(title).toContain('Magic level insuficiente.');
  });
});