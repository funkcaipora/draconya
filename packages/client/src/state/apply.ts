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

/** Por que a sessão acabou, em palavras que o jogador entende. */
const REASON = {
  'manual-exit': 'Você saiu do jogo',
  'exit-rule': 'A hunt encerrou por uma regra de saída',
  death: 'Você morreu',
  drain: 'Sua sessão foi encerrada por manutenção',
  completed: 'Concluído',
} as const;
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

    case 'hunt-catalogue':
      // Uma vez por sessão: a versão de conteúdo é fixada (invariante 7), então a lista não
      // muda enquanto ela vive. Substituir, e não acumular — reconectar reenvia a mesma lista,
      // e concatenar daria hunts duplicadas na tela a cada queda de rede.
      hud.set((state) => ({ ...state, hunts: message.hunts }));
      return;

    case 'pong':
      // `t` é o instante que o cliente mandou no `ping`; a volta inteira é a latência.
      hud.set((state) => ({ ...state, latencyMs: nowMs - message.t }));
      return;

    case 'session-ended': {
      // O extrato. A sessão acabou e o jogador precisa saber POR QUÊ e o que rendeu — sumir
      // sem explicação é como o modo idle perde a confiança de quem deixou o personagem
      // rendendo. O mundo NÃO é limpo: a última coisa verdadeira continua na tela por trás
      // da mensagem, em vez de o canvas piscar vazio junto com a notícia.
      const { aggregates } = message;
      hud.set((state) => ({
        ...state,
        // A tela de retorno é a MESMA janela (§16.2), com o relógio parado: o extrato é
        // definitivo, e continuar contando o tempo faria o "por hora" derreter depois do fim.
        analyzer: {
          sessionType: state.analyzer.sessionType,
          aggregates,
          notableEvents: message.notableEvents,
          receivedAtMs: nowMs,
          ended: true,
        },
        systemMessages: appendCapped(state.systemMessages, {
          level: 'warning',
          text: `${REASON[message.reason]} · ${Math.round(aggregates.durationMs / 60_000)} min`
            + ` · ${aggregates.xpGained} XP · ${aggregates.goldGained - aggregates.goldSpent} gold`
            + ` · ${aggregates.kills} abate(s)`,
          atMs: nowMs,
        }),
      }));
      return;
    }

    case 'session-state': {
      // Estado completo SUBSTITUI o mundo; não é acumulado por cima. Mesclar deixaria uma
      // criatura que morreu enquanto ninguém olhava desenhada para sempre, e o sintoma é um
      // monstro parado que nunca some — o tipo de coisa que se descobre semanas depois.
      world.mapId = message.world.mapId;
      world.selfId = message.self.creatureId;
      world.creatures.clear();
      for (const creature of message.world.creatures) {
        world.creatures.set(creature.id, {
          id: creature.id,
          appearanceId: creature.appearanceId,
          name: creature.name,
          health: creature.health,
          maxHealth: creature.maxHealth,
          position: creature.position,
          // Sem passo em curso: o estado diz onde as coisas ESTÃO, não como chegaram lá.
          // Reproduzir o movimento que aconteceu enquanto ninguém olhava é o erro do §16.2.
          step: null,
        });
      }
      hud.set((state) => ({
        ...state,
        health: message.self.health, maxHealth: message.self.maxHealth,
        mana: message.self.mana, maxMana: message.self.maxMana,
        level: message.self.level, xp: message.self.xp,
        // O analisador (§16.1, FUN-83). `elapsedMs` da mensagem é o mesmo
        // `aggregates.durationMs`, então o que se guarda é o pacote de agregados e o INSTANTE
        // LOCAL em que ele chegou — é esse instante que faz o relógio da janela andar entre
        // dois `session-state`, sem inventar XP nenhuma.
        analyzer: {
          sessionType: message.sessionType,
          aggregates: message.aggregates,
          notableEvents: message.notableEvents,
          receivedAtMs: nowMs,
          ended: false,
        },
      }));
      return;
    }

    default:
      // `never` de propósito: mensagem nova no protocolo quebra a COMPILAÇÃO aqui, em vez de
      // ser silenciosamente ignorada em produção.
      message satisfies never;
  }
}
