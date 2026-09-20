// A costura entre o socket e o estado (FUN-22).
//
// Este arquivo é o único lugar onde uma mensagem do servidor vira estado do cliente, e é onde
// a divisão do ADR 0007 fica visível numa tela: cada `case` decide MUNDO ou HUD, e a coluna
// que cada mensagem cai é a decisão de desempenho inteira.
//
// A regra, em uma linha: se uma pessoa lê como texto ou barra, é HUD; se o canvas desenha, é
// mundo. `creature-*` é sempre mundo — e é por isso que dezenas de deltas por segundo não
// tocam o React.

import type { OutfitColors, S2CMessage, SkillProgress as ProtocolSkillProgress } from '@draconya/protocol';
import { appendCapped, hud, slotKey, type PlayerSkills, type SkillProgress, type SlotState } from './hud.js';
import { targetTracker } from './target.js';
import { botResult, loadConfig } from '../bot/store.js';
import { partyEntered } from '../party/store.js';

/**
 * As três skills que o painel mostra (#340, SV-04), do `skills` de `player-stats`/`session-state`
 * — um registro por id de skill do conteúdo. Vazio é um nó `game` anterior à SV-04 (o `default`
 * do protocolo): mantém o que a tela já tinha em vez de zerar as barras.
 */
function skillsOf(
  skills: Readonly<Record<string, ProtocolSkillProgress>>, previous: PlayerSkills,
): PlayerSkills {
  if (Object.keys(skills).length === 0) return previous;
  const of = (id: keyof PlayerSkills): SkillProgress => {
    const progress = skills[id];
    return progress === undefined ? previous[id] : { level: progress.level, percent: progress.percentToNext };
  };
  return { melee: of('melee'), distance: of('distance'), magic: of('magic') };
}

/** Por que a sessão acabou, em palavras que o jogador entende. */
const REASON = {
  // `manual-exit` é o `leave-hunt` E o `logout`, mas só o primeiro chega a ser LIDO: o logout
  // fecha o socket. Dizer "saiu do jogo" a quem acabou de voltar para a Cidade era o que o
  // extrato dizia até o passe de QA do MVP.
  'manual-exit': 'Você saiu da hunt',
  'exit-rule': 'A hunt encerrou por uma regra de saída',
  death: 'Você morreu',
  drain: 'Sua sessão foi encerrada por manutenção',
  completed: 'Concluído',
  // O encerramento coletivo (#432, ADR 0032 d.14): todos os presentes aprovaram.
  'party-vote': 'A party encerrou a caçada',
} as const;
import { missileDuration } from '../world/effects.js';
import {
  addEffect, addFloatingText, addMissile, clearTransients, enterInstance, world, type Creature,
} from './world.js';

/**
 * As cores de outfit de uma criatura, SÓ quando o servidor as mandou (FUN-104).
 *
 * Sem elas o campo fica AUSENTE do `Creature`, e não `undefined`: "não disse" é a falta do
 * campo, e é o viewport quem põe as de reserva no lugar. O tipo do protocolo admite
 * `undefined` (é o que `.optional()` do zod infere) e o do store não
 * (`exactOptionalPropertyTypes`) — pela razão certa —, e é por isso que os dois `case` que
 * montam criatura (`creature-appear` e `session-state`) passam por aqui em vez de copiar
 * `message.colors` no literal.
 */
function colorsOf(
  creature: { readonly colors?: OutfitColors | undefined },
): Pick<Creature, 'colors'> {
  return creature.colors === undefined ? {} : { colors: creature.colors };
}

export function applyMessage(message: S2CMessage, nowMs: number): void {
  switch (message.type) {
    // --- mundo: nada aqui notifica ninguém ------------------------------------------------
    case 'instance-enter':
      enterInstance(message.instanceId, message.map, message.ambience ?? 'surface');
      hud.set((state) => ({
        ...state,
        huntId: message.huntId ?? null,
        difficulty: message.difficulty ?? null,
      }));
      return;

    case 'ground-item-appear':
      world.groundItems.set(message.id, {
        id: message.id, position: message.position, appearanceId: message.appearanceId,
      });
      world.groundItemsVersion += 1;
      return;

    case 'ground-item-disappear':
      if (world.groundItems.delete(message.id)) world.groundItemsVersion += 1;
      return;

    case 'creature-appear':
      world.creatures.set(message.id, {
        id: message.id,
        appearanceId: message.appearanceId,
        ...colorsOf(message),
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
      // Morte/despawn limpa a moldura NA HORA (RF-05), sem depender do ciclo do alvo: o
      // cadáver some e o alvo junto, e não há servidor a esperar para isso.
      targetTracker.handleTargetGone(message.id);
      return;

    // --- transitórios do combate (FUN-106): entram com o instante local, e é o viewport quem
    // os expira. `startedAtMs = nowMs` porque o relógio que os anima é o do quadro, e um lote
    // aplicado de uma vez ao voltar de aba de fundo ganha o MESMO instante: tudo toca junto e
    // acaba junto, em vez de reproduzir dez minutos de golpes (AGENTS.md do pacote).
    case 'effect':
      addEffect(message.position, message.effectId, nowMs);
      return;

    case 'missile':
      addMissile(
        message.from, message.to, message.missileId, nowMs,
        missileDuration(message.from, message.to),
      );
      return;

    case 'creature-hit':
      // Entra mesmo que a criatura já não exista: o texto tem vida própria e some sozinho, e
      // recusar aqui apagaria o número do golpe que matou — que chega no mesmo lote que o
      // `creature-disappear`, e é o que o jogador mais quer ver. O elemento (#479) viaja junto
      // quando veio; ausente, a cor sai do `kind`.
      addFloatingText(message.id, message.amount, message.kind, nowMs, message.damageType);
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
        // O alvo NÃO vem mais daqui (#470): ele tem `target-changed`, logo abaixo. Manter um
        // `targetId` neste `set` reintroduziria o batimento geral que a DT-01 aposentou.
        // A munição escolhida por família (#152): `null` é "nenhuma", e a tela mostra o que veio.
        ammo: message.ammo,
        vocationId: message.vocationId,
        speed: message.speed,
        skills: skillsOf(message.skills, state.skills),
      }));
      return;

    // `target-changed` (#470/#471): o alvo autoritativo, confirmado ou trocado pelo auto-target.
    // O rastreador aplica a confirmação e descarta o ack obsoleto por `seq` (RF-03); `null` é
    // cancelamento confirmado e LIMPA a moldura.
    case 'target-changed':
      targetTracker.handleTargetChanged(message.creatureId, message.seq);
      return;

    // `target-cancel` (#471): a recusa do `select-target`. Desfaz a seleção otimista e devolve a
    // moldura ao último alvo confirmado pelo servidor (RF-03/RF-04), nunca à tentativa recusada.
    case 'target-cancel':
      targetTracker.handleTargetCancel(message.seq);
      return;

    case 'experience-gain':
      hud.set((state) => ({ ...state, xp: state.xp + message.amount }));
      return;

    case 'analyzer':
      // O analisador ao vivo (FUN-110): os números novos e o INSTANTE em que chegaram — é o
      // carimbo que rebaseia o relógio local da janela, como no `session-state`. Os eventos
      // vêm só os NOVOS, e entram no fim da lista que o `session-state` trouxe. Sem janela
      // (a Cidade não credita nada, §37) não há o que atualizar.
      hud.set((state) => state.analyzer.sessionType === null ? state : ({
        ...state,
        analyzer: {
          ...state.analyzer,
          aggregates: message.aggregates,
          notableEvents: message.notableEvents.length === 0
            ? state.analyzer.notableEvents
            : [...state.analyzer.notableEvents, ...message.notableEvents],
          receivedAtMs: nowMs,
          // A seção PARTY (§32, ADR 0035 d.11): o bloco vem no MESMO `analyzer` que os
          // agregados. `undefined` é solo/nó anterior — a caixa não monta (D8).
          party: message.party,
        },
      }));
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

    case 'catalogue':
      // Uma vez por sessão: a versão de conteúdo é fixada (invariante 7), então o catálogo não
      // muda enquanto ela vive. SUBSTITUI, e não acumula — reconectar reenvia o mesmo, e
      // concatenar daria hunts duplicadas na tela a cada queda de rede.
      // `monsters` e `bestiary` são da tela do Bestiário (FUN-113): nome onde o contador tem
      // id, e os marcos. `bestiary` fica ausente quando o servidor não o mandou — é a tela
      // quem decide o que mostrar sem marco, não este `case`.
      hud.set((state) => ({
        ...state,
        catalogue: {
          hunts: message.hunts,
          monsters: message.monsters,
          bot: message.bot,
          items: message.items,
          // A munição abstrata (#152): o seletor do slot do escudo lista a família do bow por aqui.
          ammunition: message.ammunition,
          // As vocações e o level da escolha (#154): o diálogo do level 8 lê daqui.
          vocations: message.vocations,
          vocationLevel: message.vocationLevel,
          ...(message.bestiary === undefined ? {} : { bestiary: message.bestiary }),
        },
      }));
      return;

    case 'inventory':
      // SUBSTITUI. O servidor manda o estado inteiro da mochila, não um delta: montar o
      // conjunto a partir de pedaços daria uma mochila que diverge da do servidor sem nada
      // acusar — e é o servidor quem decide o que cabe.
      hud.set((state) => ({
        ...state,
        inventory: {
          backpack: message.backpack,
          // A bolsa (#160): `default([])` no protocolo — um nó anterior manda sem.
          satchel: message.satchel,
          equipped: message.equipped,
          capacity: message.capacity,
        },
      }));
      return;

    case 'bestiary':
      // SUBSTITUI, como o inventário: é o contador INTEIRO de cada monstro, não um delta. O
      // servidor manda no attach e sempre que um contador muda (FUN-113), e somar aqui daria
      // um Bestiário que diverge do dele na primeira reconexão — que reenvia o mesmo total.
      hud.set((state) => ({ ...state, bestiary: message.counts }));
      return;

    case 'bot-config-result':
      // A resposta é da TELA do bot, não do chat: ela precisa saber se o que o jogador escreveu
      // virou verdade, e uma recusa não pode descartar o que ele digitou.
      botResult(message.ok, message.reason ?? null);
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
          // A sessão acabou: a seção PARTY não existe mais no extrato.
          party: undefined,
        },
        // A votação de encerrar não sobrevive ao fim da sessão (#432): a tela de retorno não
        // mostra o diálogo de uma proposta que já cumpriu o efeito.
        partyEndVote: null,
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
      // O chão também é substituído (FUN-123): o cadáver que apodreceu enquanto ninguém olhava
      // sumiria da mesma forma que o monstro que morreu.
      world.groundItems.clear();
      for (const item of message.world.groundItems) world.groundItems.set(item.id, item);
      world.groundItemsVersion += 1;
      // Os transitórios também: o que estava no ar pertence à cena que este estado substitui,
      // e um efeito do mapa anterior tocando sobre o novo é o mesmo defeito do monstro que
      // nunca some — por menos de um segundo, mas no primeiro quadro que o jogador vê.
      clearTransients();
      for (const creature of message.world.creatures) {
        world.creatures.set(creature.id, {
          id: creature.id,
          appearanceId: creature.appearanceId,
          ...colorsOf(creature),
          name: creature.name,
          health: creature.health,
          maxHealth: creature.maxHealth,
          position: creature.position,
          // Sem passo em curso: o estado diz onde as coisas ESTÃO, não como chegaram lá.
          // Reproduzir o movimento que aconteceu enquanto ninguém olhava é o erro do §16.2.
          step: null,
        });
      }
      // A configuração de bot em vigor (FUN-111), para a tela abrir com o que a hunt executa.
      // Store própria, pela mesma razão do resto do bot: o HP mexendo não redesenha um campo.
      if (message.botConfig !== undefined) loadConfig(message.botConfig);
      // A reanexação zera a sequência do alvo: um `target-cancel` atrasado da sessão anterior
      // não pode fazer rollback para um alvo que já não existe (#471).
      targetTracker.reset();
      hud.set((state) => ({
        ...state,
        health: message.self.health, maxHealth: message.self.maxHealth,
        mana: message.self.mana, maxMana: message.self.maxMana,
        level: message.self.level, xp: message.self.xp,
        vocationId: message.self.vocationId,
        speed: message.self.speed,
        skills: skillsOf(message.self.skills, state.skills),
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
          // A seção PARTY (§32, ADR 0035 d.11): `session-state.party` já é o roster, então o
          // bloco do analisador viaja como `partySummary`. `undefined` é solo/nó anterior (D8).
          party: message.partySummary,
        },
        // A party (#196): o estado SUBSTITUI, como o inventário. Ausente é solo.
        party: message.party ?? null,
        partyBag: message.partyBag ?? null,
        lastSettlement: null,
        // A votação de encerrar (#432) volta a `null`: o servidor a reenvia no attach se ainda
        // corre, e até ele chegar a tela não mostra o diálogo da sessão anterior.
        partyEndVote: null,
        // O Follow (#406) volta a `null` na reanexação: o servidor o reenvia no attach, e até
        // ele chegar a tela NÃO deve mostrar o "interrompido" da sessão anterior (§7).
        followState: null,
        onlinePlayers: message.onlinePlayers ?? null,
        // Alvo e condições NÃO viajam no `session-state`: o host manda `player-stats`,
        // `target-changed` (#470) e `active-conditions` logo depois dele, no mesmo attach
        // (#341, SV-05). Zerar aqui é o que impede a moldura e a barra de uma sessão anterior
        // de sobreviverem à reanexação.
        targetId: null,
        huntId: message.huntId ?? null,
        difficulty: message.difficulty ?? null,
        conditions: [],
        conditionsReceivedAtMs: nowMs,
        // A reanexação zera o que era da sessão anterior: o estado de slot e a recusa da tecla
        // não podem sobreviver a uma sessão que já não é esta (o servidor reenvia `slot-state`).
        slotStates: {},
        slotResults: {},
      }));
      // A hunt da party começou de verdade (#197): a tela de formação fecha.
      if (message.party !== undefined) partyEntered();
      return;
    }

    case 'party-state':
      hud.set((state) => ({ ...state, party: message }));
      return;

    case 'party-bag':
      hud.set((state) => ({ ...state, partyBag: message }));
      return;

    case 'party-settlement':
      hud.set((state) => ({ ...state, lastSettlement: message }));
      return;

    case 'active-conditions':
      hud.set((state) => ({
        ...state,
        conditions: message.conditions,
        conditionsReceivedAtMs: nowMs,
      }));
      return;

    case 'player-count':
      // Sem `sameX`/comparação (a #343 documenta por quê: republicado a cada 30 s sem checar
      // mudança). Aplicar direto é a única regra — não há "e se for igual" a considerar aqui.
      hud.set((state) => ({ ...state, onlinePlayers: message.count }));
      return;

    case 'party-spending':
      // O gasto de cada membro e a prévia de rateio (#354, SV-18). A "Sua parte" do analisador
      // lê daqui (DT-03): era descartado, e o `estimatedShare` se perdia.
      hud.set((state) => ({ ...state, partySpending: message }));
      return;

    case 'party-end-vote':
      // A votação de encerrar a hunt para todos (#432). É um PUSH do servidor, como o Follow:
      // a tela só a espelha, e o `active: false` é o que fecha o diálogo — nunca um clique.
      hud.set((state) => ({ ...state, partyEndVote: message }));
      return;

    case 'follow-state':
      // O estado do Follow do bot (#406, ADR 0035 d.9). É um PUSH do servidor, não a resposta de
      // uma intenção: mora no `hud` (como `party`/`active-conditions`), e a tela só o espelha —
      // nunca decide sozinha que o follow parou (DT-01).
      hud.set((state) => ({ ...state, followState: message }));
      return;

    // `slot-state` (AB-10): o estado do conjunto ATIVO por slot. SUBSTITUI o mapa — o servidor
    // manda o estado inteiro, não um delta — e limpa a recusa dos slots que ele reavaliou: o
    // `slot-result` velho não pode sobreviver a um estado novo do servidor.
    case 'slot-state': {
      const states: Record<string, SlotState> = {};
      for (const state of message.slots) states[slotKey(state.set, state.slot)] = state;
      hud.set((current) => {
        const results = { ...current.slotResults };
        for (const key of Object.keys(states)) delete results[key];
        return { ...current, slotStates: states, slotResults: results };
      });
      return;
    }

    // `slot-result` (AB-10): a recusa do `use-slot`. `ok:true` limpa o motivo do slot; `ok:false`
    // guarda o texto do servidor para o tooltip (a barra lê `slotResults`).
    case 'slot-result': {
      const key = slotKey(message.set, message.slot);
      hud.set((current) => {
        if (message.ok) {
          const results = { ...current.slotResults };
          delete results[key];
          return { ...current, slotResults: results };
        }
        return {
          ...current,
          slotResults: { ...current.slotResults, [key]: message.reason ?? '' },
        };
      });
      return;
    }

    default:
      // `never` de propósito: mensagem nova no protocolo quebra a COMPILAÇÃO aqui, em vez de
      // ser silenciosamente ignorada em produção.
      message satisfies never;
  }
}
