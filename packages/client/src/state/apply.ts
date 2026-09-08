// A costura entre o socket e o estado (FUN-22).
//
// Este arquivo é o único lugar onde uma mensagem do servidor vira estado do cliente, e é onde
// a divisão do ADR 0007 fica visível numa tela: cada `case` decide MUNDO ou HUD, e a coluna
// que cada mensagem cai é a decisão de desempenho inteira.
//
// A regra, em uma linha: se uma pessoa lê como texto ou barra, é HUD; se o canvas desenha, é
// mundo. `creature-*` é sempre mundo — e é por isso que dezenas de deltas por segundo não
// tocam o React.

import type { S2CMessage } from '@draconya/protocol';
import { appendCapped, hud } from './hud.js';
import { enterInstance, world, type Creature } from './world.js';

export function applyMessage(message: S2CMessage, nowMs: number): void {
  switch (message.type) {
    // --- mundo: nada aqui notifica ninguém ------------------------------------------------
    case 'instance-enter':
      enterInstance(message.instanceId, message.map);
      return;

    case 'creature-appear':
      world.creatures.set(message.id, {
        id: message.id,
        appearanceId: message.appearanceId,
        name: message.name,
        health: message.health,
        maxHealth: message.maxHealth,
        position: message.position,
        step: null,
      });
      return;

    case 'creature-move': {
      const creature = world.creatures.get(message.id);
      // Passo de criatura desconhecida é normal, não erro: o `creature-appear` pode ter sido
      // filtrado por interest management (FUN-33) ou chegado fora de ordem. Ignorar é o
      // comportamento certo — inventar uma criatura desenharia um fantasma sem aparência.
      if (creature === undefined) return;
      creature.position = message.to;
      creature.step = {
        from: message.from,
        to: message.to,
        startedAtMs: nowMs,
        durationMs: message.durationMs,
        pushed: message.pushed ?? false,
      };
      return;
    }

    case 'creature-health': {
      const creature = world.creatures.get(message.id);
      if (creature === undefined) return;
      creature.health = message.health;
      creature.maxHealth = message.maxHealth;
      return;
    }

    case 'creature-disappear':
      world.creatures.delete(message.id);
      return;

    // --- HUD: só o que uma pessoa lê ------------------------------------------------------
    case 'welcome':
      hud.set((state) => ({
        ...state,
        characterId: message.characterId,
        contentVersion: message.contentVersion,
      }));
      return;

    case 'player-stats':
      hud.set((state) => ({
        ...state,
        health: message.health, maxHealth: message.maxHealth,
        mana: message.mana, maxMana: message.maxMana,
        level: message.level, xp: message.xp,
        capacity: message.capacity, gold: message.gold,
        staminaMs: message.staminaMs,
      }));
      return;

    case 'experience-gain':
      hud.set((state) => ({ ...state, xp: state.xp + message.amount }));
      return;

    case 'chat-message':
      hud.set((state) => ({
        ...state,
        chat: appendCapped(state.chat, {
          channel: message.channel, author: message.author, text: message.text, atMs: nowMs,
        }),
      }));
      return;

    case 'system-message':
      hud.set((state) => ({
        ...state,
        systemMessages: appendCapped(state.systemMessages, {
          level: message.level, text: message.text, atMs: nowMs,
        }),
      }));
      return;

    case 'pong':
      // `t` é o instante que o cliente mandou no `ping`; a volta inteira é a latência.
      hud.set((state) => ({ ...state, latencyMs: nowMs - message.t }));
      return;

    case 'session-state':
      // FUN-32 define o formato de `self`, `world` e `aggregates`, que hoje são `unknown` no
      // schema. Aplicar por adivinhação criaria um contrato que o servidor ainda não tem.
      return;

    default:
      // `never` de propósito: mensagem nova no protocolo quebra a COMPILAÇÃO aqui, em vez de
      // ser silenciosamente ignorada em produção.
      message satisfies never;
  }
}
