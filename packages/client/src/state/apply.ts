// A costura entre o socket e o estado (FUN-22).
//
// Este arquivo é o único lugar onde uma mensagem do servidor vira estado do cliente, e é onde
// a divisão do ADR 0007 fica visível numa tela: cada `case` decide MUNDO ou HUD, e a coluna
// que cada mensagem cai é a decisão de desempenho inteira.
//
// A regra, em uma linha: se uma pessoa lê como texto ou barra, é HUD; se o canvas desenha, é
// mundo. `creature-*` é sempre mundo — e é por isso que dezenas de deltas por segundo não
// tocam o React.

import type {
  CreatureLight, CreatureVoices, MonsterRace, OutfitColors, S2CMessage,
  SkillProgress as ProtocolSkillProgress,
} from '@draconya/protocol';
import { appendCapped, hud, slotKey, type PlayerSkills, type SkillProgress, type SlotState } from './hud.js';
import { aimTracker } from './aim.js';
import { targetTracker } from './target.js';
import { botResult, loadConfig } from '../bot/store.js';
import { partyEntered, partyExited } from '../party/store.js';

/**
 * As skills que o painel mostra (#340, SV-04; #568 as separa por tipo de arma), do `skills` de
 * `player-stats`/`session-state` — um registro por id de skill do conteúdo. Vazio é um nó `game`
 * anterior à SV-04 (o `default` do protocolo): mantém o que a tela já tinha em vez de zerar as
 * barras. Ausência de UMA chave (nó anterior ao #567, que ainda manda só `melee`) preserva o
 * valor anterior daquela skill em vez de zerar — a mesma regra de campo opcional de sempre.
 */
function skillsOf(
  skills: Readonly<Record<string, ProtocolSkillProgress>>, previous: PlayerSkills,
): PlayerSkills {
  if (Object.keys(skills).length === 0) return previous;
  const of = (id: keyof PlayerSkills): SkillProgress => {
    const progress = skills[id];
    if (progress === undefined) return previous[id];
    // O nível com Loyalty (#628) só vem quando o bônus muda o nível; a ausência é "igual ao base".
    return {
      level: progress.level, percent: progress.percentToNext,
      ...(progress.loyaltyLevel === undefined ? {} : { loyaltyLevel: progress.loyaltyLevel }),
    };
  };
  return {
    fist: of('fist'), club: of('club'), sword: of('sword'), axe: of('axe'),
    distance: of('distance'), magic: of('magic'),
  };
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

/**
 * Por que o TREINO acabou. As frases da hunt não servem: "Você saiu da hunt" a quem parou o treino
 * na Cidade, ou "Concluído" para uma arma que acabou, não dizem o que aconteceu. `manual-exit` é o
 * `leave-hunt` (o jogador parou) e `completed` é a arma esgotada ou perdida da mochila — as duas
 * saídas que o ruleset do Treino produz; o resto (manutenção) é o de sempre.
 */
const TRAINING_REASON: Partial<Record<keyof typeof REASON, string>> = {
  'manual-exit': 'Você saiu do treino',
  completed: 'A exercise weapon acabou',
  drain: REASON.drain,
};
import { missileDuration } from '../world/effects.js';
import {
  addEffect, addFloatingText, addMissile, applyTileUpdate, clearTransients, enterInstance,
  replaceTileOverrides, world, type Creature,
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

/**
 * A apresentação do monstro (#620) — addons, raça, luz e falas —, SÓ o que o servidor mandou.
 *
 * O mesmo motivo de `colorsOf`: o tipo do protocolo admite `undefined` e o do store não
 * (`exactOptionalPropertyTypes`), e "o servidor não disse" tem que chegar ao desenho como a
 * FALTA do campo — é o viewport quem aplica o neutro (sem addon, `blood`, sem luz, mudo).
 */
function presentationOf(creature: {
  readonly addons?: number | undefined;
  readonly race?: MonsterRace | undefined;
  readonly light?: CreatureLight | undefined;
  readonly voices?: CreatureVoices | undefined;
}): Pick<Creature, 'addons' | 'race' | 'light' | 'voices'> {
  return {
    ...(creature.addons === undefined ? {} : { addons: creature.addons }),
    ...(creature.race === undefined ? {} : { race: creature.race }),
    ...(creature.light === undefined ? {} : { light: creature.light }),
    ...(creature.voices === undefined ? {} : { voices: creature.voices }),
  };
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
        // Cadáver de uma cena que acabou de ficar para trás (#722) — nenhum cadáver da
        // instância nova pode ter o mesmo id por acidente sem que a janela mostre a coisa certa.
        corpse: null,
      }));
      return;

    case 'ground-item-appear':
      world.groundItems.set(message.id, {
        id: message.id, position: message.position, appearanceId: message.appearanceId,
        // `exactOptionalPropertyTypes`: só entra quando o servidor mandou (#722, ADR 0048 d.4).
        ...(message.lootable === undefined ? {} : { lootable: message.lootable }),
      });
      world.groundItemsVersion += 1;
      return;

    case 'ground-item-disappear':
      if (world.groundItems.delete(message.id)) world.groundItemsVersion += 1;
      // O cadáver decaiu: se a janela aberta é a DELE, ela fecha — nada mais tem o que mostrar
      // (#722, ADR 0048 d.4). Uma janela de outro cadáver não é afetada.
      hud.set((state) => (
        state.corpse !== null && state.corpse.groundItemId === message.id
          ? { ...state, corpse: null }
          : state
      ));
      return;

    // O tile mudou de aparência (#729, ADR 0050 d.7): a porta abriu, o capim foi cortado. O
    // viewport aplica o `replace` por cima da pilha estática no próprio pintor de tile — nada
    // aqui redesenha nada (ADR 0007).
    case 'tile-update':
      applyTileUpdate(message.position, message.replace);
      return;

    // Um campo apareceu ou reiniciou (#561, M31-06): `set` pelo MESMO id substitui — relançar
    // o mesmo campo não deixa uma cópia velha para trás, exatamente como `ground-item-appear`.
    case 'field-appear':
      world.fields.set(message.id, {
        id: message.id, tiles: message.tiles, appearanceId: message.appearanceId,
      });
      world.fieldsVersion += 1;
      return;

    case 'field-disappear':
      if (world.fields.delete(message.id)) world.fieldsVersion += 1;
      return;

    // O campo trocou de estágio (#560, `decayTo`): mesmo `id` e `tiles`, aparência NOVA já
    // resolvida pelo servidor — o cliente só substitui a entrada, nunca redesenha por conta
    // própria (invariante 6). Campo que a tela nunca viu (reconectou entre o `field-appear` e
    // esta troca, e o `session-state` ainda não chegou) é ignorado: nada para trocar ainda.
    case 'field-stage-change': {
      const field = world.fields.get(message.id);
      if (field === undefined) return;
      world.fields.set(message.id, { ...field, appearanceId: message.appearanceId });
      world.fieldsVersion += 1;
      return;
    }

    // A resposta ao `look` (#729): o texto do "You see …" entra no mesmo canal do
    // `system-message`, nível info — não é recusa, é o que a placa/o cenário dizem.
    case 'look-result':
      hud.set((state) => ({
        ...state,
        systemMessages: appendCapped(state.systemMessages, {
          level: 'info', text: message.text, atMs: nowMs,
        }),
      }));
      return;

    case 'creature-appear':
      world.creatures.set(message.id, {
        id: message.id,
        appearanceId: message.appearanceId,
        ...colorsOf(message),
        ...presentationOf(message),
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
        // Promovido (#566, ADR 0042 decisão 1): a tela troca o nome exibido pelo
        // `promotion.name` da vocação quando `true`.
        promoted: message.promoted,
        // A postura de luta (#550): a que o servidor confirmou — o botão marca ESTA, não a do clique.
        fightMode: message.fightMode,
        speed: message.speed,
        skills: skillsOf(message.skills, state.skills),
        loyaltyBonusPercent: message.loyaltyBonusPercent ?? 0,
        soul: message.soul,
        soulMax: message.soulMax,
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
          // Os 25 Charms (M39-02, #602, ADR 0053 d.3): custo, chance e categoria de cada um,
          // fixados na sessão — a tela do Cyclopedia lê daqui.
          charms: message.charms,
          // Os níveis do Bosstiary (#629): a tabela por raridade, fixada na sessão. Ausente quando o
          // servidor não a mandou — a tela decide o que mostrar sem ela, não este `case`.
          ...(message.bosstiary === undefined ? {} : { bosstiary: message.bosstiary }),
          // O Treino (#631, ADR 0059): o que uma carga rende, os tetos e o livro do offline
          // training, fixados na sessão — a tela de Treino lê daqui. Ausente quando o servidor não
          // tem Treino (o pill "Treino" não existe).
          ...(message.training === undefined ? {} : { training: message.training }),
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
          // O estoque abstrato visível (#726, ADR 0049 decisão 4): `default([])` no protocolo.
          supplies: message.supplies,
          ammunition: message.ammunition,
        },
      }));
      return;

    case 'corpse-contents':
      // O que ainda está no cadáver, depois do Quick Loot automático do abate (#722, ADR 0048
      // d.4) — SUBSTITUI, como `inventory`: é o estado inteiro do cadáver, não um delta.
      hud.set((state) => ({ ...state, corpse: { ...message } }));
      return;

    case 'bestiary':
      // SUBSTITUI, como o inventário: é o contador INTEIRO de cada monstro, não um delta. O
      // servidor manda no attach e sempre que um contador muda (FUN-113), e somar aqui daria
      // um Bestiário que diverge do dele na primeira reconexão — que reenvia o mesmo total.
      hud.set((state) => ({ ...state, bestiary: message.counts }));
      return;

    case 'bosstiary':
      // SUBSTITUI, como o Bestiário: são os contadores INTEIROS de cada boss e os pontos, não um
      // delta — o servidor manda no attach e a cada abate de boss (#629, ADR 0052 d.1).
      hud.set((state) => ({ ...state, bosstiary: { kills: message.kills, points: message.points } }));
      return;

    case 'charms':
      // SUBSTITUI, como o Bestiário: é o registro INTEIRO (pontos/echoes gastos, tiers,
      // atribuições), não um delta — o servidor manda no attach e a cada intenção aceita
      // (M39-02, #602, ADR 0052 d.1).
      hud.set((state) => ({
        ...state,
        charms: {
          pointsSpent: message.pointsSpent,
          echoesSpent: message.echoesSpent,
          tiers: message.tiers,
          assignments: message.assignments,
        },
      }));
      return;

    case 'learned-spells':
      // SUBSTITUI, como as bênçãos: é o registro INTEIRO das magias aprendidas (#624, ADR 0058),
      // não um delta — o servidor manda no attach e a cada `learn-spell` aceito. A tela resolve
      // nome, preço e requisito pelo catálogo (invariante 6).
      hud.set((state) => ({ ...state, learnedSpells: message.spellIds }));
      return;

    case 'training-state':
      // SUBSTITUI, como `charms`: o estado INTEIRO do Treino (banco, skill do livro, exercise weapons
      // com as cargas restantes, e a instância em uso) — o servidor manda no attach, a cada mudança
      // da mochila e a cada golpe do Treino (#631, ADR 0059).
      hud.set((state) => ({
        ...state,
        training: {
          offlineBankMs: message.offlineBankMs,
          offlineSkill: message.offlineSkill,
          weapons: message.weapons,
          activeInstanceId: message.activeInstanceId,
        },
      }));
      return;

    case 'blessings':
      // O BITMASK inteiro (#570, ADR 0052) — nunca um delta. Compra e consumo na morte chegam
      // pela mesma mensagem, e a tela resolve os nomes pelo catálogo (invariante 6).
      hud.set((state) => ({ ...state, blessings: message.mask }));
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
      partyExited();
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
        // Nem a saída pendente (#802): ela acabou de se cumprir.
        exitPending: null,
        systemMessages: appendCapped(state.systemMessages, {
          level: 'warning',
          // O Treino não rende XP, gold nem abate: o extrato dele é o tempo e o porquê (#631).
          text: state.analyzer.sessionType === 'training'
            ? `Treino: ${TRAINING_REASON[message.reason] ?? REASON[message.reason]} · ${Math.round(aggregates.durationMs / 60_000)} min`
            : `${REASON[message.reason]} · ${Math.round(aggregates.durationMs / 60_000)} min`
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
      for (const item of message.world.groundItems) {
        world.groundItems.set(item.id, {
          id: item.id, position: item.position, appearanceId: item.appearanceId,
          ...(item.lootable === undefined ? {} : { lootable: item.lootable }),
        });
      }
      world.groundItemsVersion += 1;
      // O overlay de cenário também é substituído (#729): o mesmo argumento do cadáver — uma
      // porta que fechou enquanto ninguém olhava não pode continuar desenhada aberta.
      // `?? []`: nó `game` anterior a esta issue manda sem o campo (default do protocolo).
      replaceTileOverrides(message.world.tileUpdates ?? []);
      // Os campos também são substituídos (#561, M31-06): quem reanexa vê os ATIVOS agora, e
      // um que apagou enquanto ninguém olhava não pode continuar desenhado. `?? []`: nó `game`
      // anterior a esta issue manda sem o campo (default do protocolo).
      world.fields.clear();
      for (const field of message.world.fields ?? []) {
        world.fields.set(field.id, { id: field.id, tiles: field.tiles, appearanceId: field.appearanceId });
      }
      world.fieldsVersion += 1;
      // Os transitórios também: o que estava no ar pertence à cena que este estado substitui,
      // e um efeito do mapa anterior tocando sobre o novo é o mesmo defeito do monstro que
      // nunca some — por menos de um segundo, mas no primeiro quadro que o jogador vê.
      clearTransients();
      for (const creature of message.world.creatures) {
        world.creatures.set(creature.id, {
          id: creature.id,
          appearanceId: creature.appearanceId,
          ...colorsOf(creature),
          ...presentationOf(creature),
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
      // A mira da sessão anterior não pode sobreviver nem voltar (ADR 0049 decisão 2, #725):
      // um `use-slot` armado antes da queda mandaria contra o alvo errado da hunt retomada.
      aimTracker.reset();
      hud.set((state) => ({
        ...state,
        health: message.self.health, maxHealth: message.self.maxHealth,
        mana: message.self.mana, maxMana: message.self.maxMana,
        level: message.self.level, xp: message.self.xp,
        vocationId: message.self.vocationId,
        promoted: message.self.promoted,
        speed: message.self.speed,
        skills: skillsOf(message.self.skills, state.skills),
        loyaltyBonusPercent: message.self.loyaltyBonusPercent ?? 0,
        soul: message.self.soul,
        soulMax: message.self.soulMax,
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
        // A saída pendente (#802) também volta a `null` na reanexação: o servidor a reenvia no
        // attach se ainda houver uma, com o que falta AGORA — e a contagem de antes, contada
        // no relógio local, estaria errada.
        exitPending: null,
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

    case 'active-conditions': {
      hud.set((state) => ({
        ...state,
        conditions: message.conditions,
        conditionsReceivedAtMs: nowMs,
      }));
      // A luz (#623) mora também no mundo, que o pintor lê sem assinatura: o servidor manda o
      // raio, a cor e o prazo, e o pintor calcula o decaimento a cada quadro.
      const light = message.conditions.find((condition) => condition.kind === 'light');
      world.selfLight = light?.light === undefined
        ? null
        : { ...light.light, remainingMs: light.remainingMs, receivedAtMs: nowMs };
      return;
    }

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

    case 'exit-pending':
      // A saída da hunt pendente (#802) é um PUSH do servidor, como o Follow: a tela só a
      // espelha. `active: false` — ou uma mensagem incompleta, que o protocolo permite mas o
      // servidor não manda — zera; o cliente nunca fabrica o que o servidor não disse (D8).
      hud.set((state) => ({
        ...state,
        exitPending: message.active && message.reason !== undefined
          && message.phase !== undefined && message.remainingMs !== undefined
          ? {
            reason: message.reason, phase: message.phase,
            remainingMs: message.remainingMs, receivedAtMs: nowMs,
          }
          : null,
      }));
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

    // `use-result` (#726, ADR 0049 decisão 3/7): a resposta a `use-item`/`use-item-on`.
    // `ok: true` não faz nada aqui — sucesso é o `inventory`/`player-stats`/`creature-hit` de
    // sempre (decisão 7), inclusive quando a ação foi adiada pela exaustão (decisão 6) e só
    // executou depois. `ok: false` vira o mesmo toast curto do `system-message`, sobre a
    // mochila — o menu de contexto/seção Suprimentos que o dispara fica para uma entrega
    // seguinte (ver desvios da spec desta issue); a MENSAGEM já chega tipada e traduzida hoje.
    case 'use-result':
      if (message.ok) return;
      hud.set((state) => ({
        ...state,
        systemMessages: appendCapped(state.systemMessages, {
          level: 'warning', text: message.reason ?? '', atMs: nowMs,
        }),
      }));
      return;

    default:
      // `never` de propósito: mensagem nova no protocolo quebra a COMPILAÇÃO aqui, em vez de
      // ser silenciosamente ignorada em produção.
      message satisfies never;
  }
}
