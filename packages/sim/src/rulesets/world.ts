// A sessão do mundo aberto (OW-13, ADR 0060 decisões 2 e 4).
//
// O Tibia é um `Game` só, com um tipo de mundo só (`canary/src/game/game.hpp:95, 927`); aqui, um
// mundo é UMA sessão compartilhada, com relógio, sem fim, que vive num processo `game`. Não é um
// ruleset novo: é o `HuntRuleset` — o motor do Tibia que a hunt já usa, com combate, IA, campos,
// movimento por tile e regeneração — montado com a topologia de mundo (`worldTopology`), que troca
// as perguntas que supunham "sessão = party" (ver `topology.ts`). O ADR descartou o `WorldRuleset`
// do zero e a extração do núcleo antes de qualquer coisa jogável: seria reescrever 11.794 linhas
// com a hunt idle no caminho.
//
// **O que esta classe acrescenta ao `HuntRuleset` é só a identidade** — o que o hospedeiro lê para
// saber que sessão é esta:
//
// - `type: 'world'`, `shared: true` ("sair é `leave`") e `progress: 'checkpointed'` (credita em
//   extratos parciais, `Session.checkpoint`, OW-03): o mundo é o shard que credita;
// - `hz: () => 10`, com ou sem visualizador. O mundo é conteúdo em que o personagem é vulnerável
//   (ADR 0003:27-32), e desde o ADR 0020 `hz` só agrupa trabalho: o resultado é o mesmo a 1 Hz e a
//   10 Hz, e a taxa fixa é o que mantém a apresentação sem salto;
// - o gate de serviço de Cidade por tile (`acceptsCityServices`) e a tradução da posição para a
//   coordenada absoluta (`worldPositionOf`);
// - a SAÍDA do Tibia (OW-14): o `logout` que passa por `canLogout` (`requestLogout`) e a perda de
//   conexão (`presenceLost`/`presenceRestored`), que solta o alvo, para a automação e tenta sair aos
//   60 s — e, em luta, quando a janela de luta vence. O `sim` decide e EMITE `departure-requested`
//   ou `logout-refused`; tirar o personagem da sessão com o checkpoint é I/O, do hospedeiro.
//
// Nada disto é novo motor, e nada aqui roda por tick (invariante 2): o que o mundo faz continua
// sendo evento da fila da sessão. E a sessão é a do hospedeiro — este arquivo só a monta.

import type { Content, Hunt, Point, Route, Tilemap, World } from '@draconya/content';
import { absoluteToLocal, localToAbsolute } from '@draconya/content';
import type { CharacterRuntime } from '../character.js';
import { IN_FIGHT_WINDOW_MS } from '../combat/in-fight.js';
import { Rng } from '../rng.js';
import { EventPriority } from '../schedule.js';
import type { ScheduledEvent } from '../schedule.js';
import { Session } from '../session.js';
import type { SessionLimits } from '../session.js';
import { NO_WORLD_POSITION, XLOG_DELAY_MS } from '../world-exit.js';
import type { WorldDepartureReason } from '../world-exit.js';
import { canLogout, hasZoneFlag } from '../zones.js';
import type { LogoutVerdict } from '../zones.js';
import { HuntRuleset, contentOptionsOf } from './hunt.js';
import type { HuntRulesetOptions } from './hunt.js';
import { instanceTopology, worldTopology } from './topology.js';

/** A taxa de atualização do mundo, em Hz, com ou sem visualizador (ADR 0060 d.5, ADR 0003). */
export const WORLD_HZ = 10;

/**
 * A tentativa de sair do personagem sem conexão (OW-14). O subject é o id dele, como o de todo
 * evento de personagem: `Session.cancelEvents(character.id)` — o que `onEnter` faz — a leva junto,
 * e `presenceRestored` a cancela pelo par `(kind, subject)`.
 */
const XLOG_ATTEMPT = 'xlog-attempt';

/**
 * Os tetos da sessão do mundo (ADR 0060 d.5): `MAX_EVENTS_PER_ADVANCE` e `MAX_PENDING_DOMAIN_
 * EVENTS` viram limites POR SESSÃO, porque os defaults foram medidos para uma hunt de um
 * personagem (~100 eventos com cadência de centenas de milissegundos) e o mundo é duzentos deles
 * mais o que a região tiver de monstro.
 *
 * **Ponto de partida, não medida.** Os números são os defaults da hunt multiplicados pelo que o
 * mundo carrega a mais, e o `bench:world` (OW-35) os fixa na máquina de destino (ADR 0013):
 *
 * - `maxEventsPerAdvance` 65.536 — dezesseis vezes os 4.096 da hunt. O teto existe para a
 *   engasgada de processo (GC, depurador) não virar horas de combate de uma vez; num mundo de 200
 *   personagens de passo a ~3 eventos por segundo cada, mais monstros, 4.096 eventos são uns dois
 *   segundos de atraso, e o mundo não pode descartar atraso a cada pausa de GC de 100–195 ms;
 * - `maxPendingDomainEvents` 8.192 — dezesseis vezes os 512. O hospedeiro drena a cada ciclo, e o
 *   teto só vale para o ciclo que atrasou; descartar é apresentação, perdível;
 * - `maxNotableEventsPerCharacter` 64 — o mundo dura dias e a lista, sem teto, é vazamento. O
 *   extrato por checkpoint (60 s) leva o que veio desde o anterior, e 64 por personagem folgam.
 */
export const WORLD_SESSION_LIMITS: Readonly<Required<SessionLimits>> = Object.freeze({
  maxPendingDomainEvents: 8_192,
  maxEventsPerAdvance: 65_536,
  maxNotableEventsPerCharacter: 64,
});

/**
 * O `HuntRuleset` do mundo. Só o monta quem passa a topologia de mundo (`worldTopology`): sem ela,
 * ou com a de instância, ele seria um mundo que acaba quando esvazia, e a construção recusa.
 */
export class WorldRuleset extends HuntRuleset {
  override readonly type = 'world' as const;

  /** "Sair é `leave`": o mundo é compartilhado, e quem sai não o encerra (ADR 0023). */
  readonly shared = true as const;

  /**
   * O mundo credita em extratos parciais (`Session.checkpoint`, OW-03): vive muito além de qualquer
   * dono, e o hospedeiro grava o delta de cada um de tempos em tempos e na saída (ADR 0060 d.10).
   */
  readonly progress = 'checkpointed' as const;

  readonly #map: Tilemap;

  constructor(options: HuntRulesetOptions) {
    super(options);
    // A topologia É a identidade do mundo: sem a de mundo (ausente é a de instância, o default do
    // `HuntRuleset`), `type: 'world'` seria uma mentira que `session.end('death')` desmentiria na
    // primeira morte solo.
    if (options.topology === undefined || options.topology === instanceTopology) {
      throw new Error('a WorldRuleset needs the world topology (worldTopology)');
    }
    this.#map = options.map;
  }

  /** 10 Hz sempre: ver `WORLD_HZ`. O argumento (`attached`) não decide nada no mundo. */
  override hz(): number {
    return WORLD_HZ;
  }

  /**
   * O personagem pode usar os serviços de Cidade (ADR 0052 d.2) onde está AGORA? Só em tile PZ
   * (ADR 0060 d.4): no Tibia a loja, o depósito e os santuários vivem em protect zone, e o mundo
   * aberto é onde a Cidade deixa de ser um lugar e passa a ser uma zona. Lê o BIT da PZ
   * (`hasZoneFlag`), não o tipo: o tile `P` (PZ + no-logout) é `'protection'` e o no-logout não o
   * tira de lá.
   *
   * É a pergunta; quem recusa a intenção e avisa o jogador é o hospedeiro (OW-18). Morto, ausente
   * da sessão e mapa sem a camada `zones` respondem `false` — "sem dado, sem serviço" aqui é o
   * lado seguro, ao contrário de `canLogout`, que sem dado não prende ninguém.
   */
  acceptsCityServices(session: Session, characterId: string): boolean {
    const character = session.participants.find((participant) => participant.id === characterId);
    return character !== undefined && character.alive
      && hasZoneFlag(this.#map, character.position, 'protection');
  }

  /**
   * Onde o personagem está no mundo AGORA, em coordenada absoluta do Tibia (a que
   * `characters.world_x/y/z` persiste, ADR 0060 d.3.b): o `position` local traduzido pelo
   * `source.region` do recorte. É o que o dono da sessão grava como âncora
   * (`CharacterRuntime.worldPosition`) na saída e no checkpoint.
   *
   * Só LÊ — não escreve a âncora, porque quem sabe QUANDO ela vale é o hospedeiro: numa transição
   * ele constrói o destino ANTES de encerrar a origem, e a essa altura o `position` do personagem
   * já é o do destino (o defeito que `onLeave` da Cidade explica). Ler antes de mover é dele.
   */
  worldPositionOf(character: CharacterRuntime): Point | undefined {
    return localToAbsolute(this.#map, character.position);
  }

  // --- a saída do Tibia (OW-14, ADR 0060 d.7) ---------------------------------------------------

  /**
   * O jogador pediu para sair (a intenção `logout`): passa por `canLogout` (OW-10, a regra de
   * `Player::canLogout`, `canary/src/creatures/players/player.cpp:6960-6979`) e resulta em UM de
   * dois eventos de domínio — nunca nos dois, e nunca em nenhum:
   *
   * - `departure-requested { reason: 'logout' }`, com a posição absoluta, quando o Tibia deixaria;
   * - `logout-refused { reason }`, com o motivo do Canary (`protocolgame.cpp:1151-1162`) — tile de
   *   no-logout ou luta fora da PZ —, e o personagem fica como está.
   *
   * Na PZ a saída é imediata, em luta ou não; fora dela, só depois de a janela de luta vencer.
   * O veredicto é o MESMO a 1 Hz e a 10 Hz: `canLogout` lê o relógio lógico, não o de parede.
   *
   * Quem pede o logout é o cliente (invariante 4: só intenção), e a decisão é do servidor. A saída
   * em si — o checkpoint e soltar o personagem para o repouso — é do hospedeiro, que lê o evento:
   * o `sim` não faz I/O, e o personagem continua na sessão até ele chamar `Session.leave`.
   *
   * Devolve o veredicto para quem quer responder na hora; `null` — e nada é emitido — para quem não
   * está na sessão ou já morreu (a morte tem a saída dela, OW-32).
   */
  requestLogout(session: Session, characterId: string): LogoutVerdict | null {
    const character = this.#presentCharacter(session, characterId);
    if (character === null) return null;
    const verdict = canLogout(character, this.#map, session.nowMs);
    if (verdict.ok) this.#requestDeparture(session, character, 'logout');
    else session.emit({ kind: 'logout-refused', characterId, reason: verdict.reason });
    return verdict;
  }

  /**
   * O último visualizador do personagem se soltou, ou ele chegou ao mundo sem nenhum: uma intenção
   * de SERVIDOR — o cliente nunca a manda, e o protocolo não tem opcode para ela (invariante 4).
   * Quem a entrega é o hospedeiro, no instante lógico em que a conexão caiu (ADR 0060 d.7).
   *
   * No Tibia o personagem sem conexão não some: fica parado, vulnerável, e sai depois — por isso
   * isto NÃO o tira do mundo, só o deixa só:
   *
   * 1. o alvo é solto e a automação dele para (`suspendAutomation`: targeting, bot, barra de
   *    ações, caminhada, follow e postura) — `Player::sendPing`, `player.cpp:2323-2325`;
   * 2. agenda a tentativa de saída em `XLOG_DELAY_MS` (60 s, `player.cpp:2327`).
   *
   * Na tentativa (`#onXlogAttempt`), `canLogout` decide: passa, e sai (`departure-requested`, motivo
   * `'xlog'`); em luta, reagenda para o instante em que a janela de luta vence — um evento, não uma
   * varredura. O Canary tenta UMA vez e deixa o idle kick resolver (`player.cpp:2335-2337`); o TFS
   * derruba mesmo em luta (`tfs/src/player.cpp:895-908`); o Draconya fica com o `canLogout` do
   * Canary e o "sai quando a luta acaba" do Tibia, com o idle kick (OW-47) como teto — nenhum dos
   * dois desenhos deixa fugir de uma luta fechando o navegador nem deixa o personagem vulnerável
   * até 16 minutos depois de a luta acabar (ADR 0060, "Alternativas consideradas").
   *
   * Idempotente: o segundo `presence-lost` de quem já está sem conexão é ignorado, e NÃO reinicia a
   * contagem — senão cada reconexão que falha empurraria a saída. Quem não está na sessão ou já
   * morreu também é ignorado.
   *
   * Nada aqui depende de `attached` (invariante 3): o hospedeiro entrega a intenção, e o resultado
   * é o mesmo a 1 Hz e a 10 Hz.
   */
  presenceLost(session: Session, characterId: string): void {
    if (this.#presentCharacter(session, characterId) === null) return;
    if (!this.suspendAutomation(characterId)) return;
    this.#scheduleXlogAttempt(session, characterId, XLOG_DELAY_MS);
  }

  /**
   * Um visualizador voltou ao personagem (`presence-restored`, também intenção de servidor):
   * cancela a tentativa de saída e devolve o personagem a quem o dirige — o alvo é reeleito e a
   * automação retoma de onde estava. Reanexar ANTES dos 60 s cancela a saída; depois deles, só
   * importa se o personagem ainda está na sessão (o hospedeiro o soltou, ou não).
   *
   * Ignorado, sem efeito, para quem não estava sem conexão.
   */
  presenceRestored(session: Session, characterId: string): void {
    session.cancelEvent(XLOG_ATTEMPT, characterId);
    this.resumeAutomation(session, characterId);
  }

  override onEvent(session: Session, event: ScheduledEvent): void {
    // Primeiro o que o `HuntRuleset` faz antes de qualquer evento (a ocupação, a cascata pendente,
    // o tempo cobrado), que ignora o tipo que não conhece; depois a tentativa de saída.
    super.onEvent(session, event);
    if (event.kind === XLOG_ATTEMPT) this.#onXlogAttempt(session, event.subject);
  }

  /**
   * A tentativa de saída do personagem sem conexão venceu. Decide pelo estado de AGORA — onde ele
   * está e quando foi o último golpe —, não pelo de quando a tentativa foi agendada: ele pode ter
   * apanhado de novo nos 60 s, e a janela de luta recomeça do último golpe.
   */
  #onXlogAttempt(session: Session, characterId: string): void {
    const character = this.#presentCharacter(session, characterId);
    // Saiu da sessão antes (o evento "vence, não encontra o personagem"), ou morreu: a morte tem a
    // saída dela (OW-32).
    if (character === null) return;
    const verdict = canLogout(character, this.#map, session.nowMs);
    if (verdict.ok) {
      this.#requestDeparture(session, character, 'xlog');
      return;
    }
    // Tile de no-logout: o Canary desiste (`shouldForceLogout = false`, `player.cpp:2335-2337`), e
    // não há o que esperar — o personagem não anda sem dono, então o tile não muda. É o idle kick
    // (OW-47) que o tira dali. Esperar uma luta que não existe seria polling.
    if (verdict.reason !== 'in-fight') return;
    const lastCombatMs = character.lastCombatActionAtMs;
    // `canLogout` só diz 'in-fight' com o carimbo presente; a guarda é do tipo, não do jogo.
    if (lastCombatMs === null) return;
    // O primeiro instante em que `isInFight` deixa de valer, se ninguém bater de novo: quando
    // bater, o carimbo anda e a tentativa seguinte reagenda outra vez.
    this.#scheduleXlogAttempt(session, characterId, lastCombatMs + IN_FIGHT_WINDOW_MS - session.nowMs);
  }

  #scheduleXlogAttempt(session: Session, characterId: string, delayMs: number): void {
    session.scheduleIn(XLOG_ATTEMPT, delayMs, {
      // Por último no instante, sobre o mundo já resolvido: o golpe que vence junto com a tentativa
      // renova a janela de luta antes de ela ser lida.
      priority: EventPriority.Housekeeping, subject: characterId,
    });
  }

  /**
   * Emite o pedido de saída, com a posição de AGORA. Só emite: o personagem continua na sessão até
   * o hospedeiro gravar o checkpoint e chamar `Session.leave` (ver `DepartureRequested`).
   */
  #requestDeparture(session: Session, character: CharacterRuntime, reason: WorldDepartureReason): void {
    session.emit({
      kind: 'departure-requested',
      characterId: character.id,
      reason,
      worldPosition: this.worldPositionOf(character) ?? NO_WORLD_POSITION,
    });
  }

  /** O participante VIVO, ou `null`: quem não está na sessão e quem já morreu não saem por aqui. */
  #presentCharacter(session: Session, characterId: string): CharacterRuntime | null {
    const character = session.participants.find((participant) => participant.id === characterId);
    return character !== undefined && character.alive ? character : null;
  }
}

/**
 * O ruleset do mundo `world`, sobre o mapa `map`, com o conteúdo `content`. O `Hunt` e a `Route`
 * que o motor exige são sintéticos: o mundo não tem rota (o personagem não a percorre, ADR 0009)
 * nem spawn nesta etapa (a OW-25 traz os do Canary), e o `Hunt` só empresta o id e o ambiente. A
 * rota guarda o templo — o tile onde o walker diria estar — porque o `RouteWalker` não admite uma
 * rota vazia, e `routeStart` é ignorado pela topologia.
 *
 * Lança quando o mundo e o mapa não casam ou o templo não cabe no recorte: o boot (`buildContent`)
 * já os recusa, e quem monta à mão num teste lê o motivo aqui.
 */
export function createWorldRuleset(content: Content, world: World, map: Tilemap): WorldRuleset {
  if (world.map !== map.id) {
    throw new Error(`world "${world.id}" is built on map "${world.map}", not on "${map.id}"`);
  }
  const town = world.towns[0];
  if (town === undefined) throw new Error(`world "${world.id}" has no town`);
  const temple = absoluteToLocal(map, town.temple);
  if (temple === undefined) {
    throw new Error(`the temple of world "${world.id}" is outside the region of map "${map.id}"`);
  }
  const topology = worldTopology({ map, temple: town.temple });

  const id = `world:${world.id}`;
  const hunt: Hunt = {
    id, name: world.name, recommendedLevel: 1, mapId: map.id, routeId: id,
  };
  const route: Route = { id, mapId: map.id, tiles: [temple], spawnPoints: [] };
  return new WorldRuleset({
    hunt,
    // Ignorada desde o ADR 0039 (fim do pull por dificuldade); o campo ainda é obrigatório.
    difficulty: 'world',
    map,
    route,
    ...contentOptionsOf(content),
    topology,
  });
}

export interface WorldSessionOptions {
  /**
   * O id desta ENCARNAÇÃO do mundo. É único por sessão criada, não por mundo: o ledger é
   * `UNIQUE (session_id, seq)` (invariante 10) e o `seq` recomeça em zero a cada sessão — o
   * reinício do save diário (ADR 0060 d.12) ou da queda constrói uma sessão nova, e reusar o id
   * do mundo colidiria com os extratos da anterior. Quem escolhe é o hospedeiro.
   */
  readonly id: string;
  /** O mapa do mundo (`world.map`), já resolvido pelo chamador. */
  readonly map: Tilemap;
  readonly world: World;
  readonly content: Content;
  /** A semente do `Rng` da sessão: a mesma semente reproduz o mesmo mundo (invariante 3). */
  readonly seed: string;
  /** Instante do HOSPEDEIRO na criação — só para quem investiga; o relógio da simulação nasce em 0. */
  readonly createdAtMs: number;
  /** Substitui, campo a campo, `WORLD_SESSION_LIMITS`. */
  readonly limits?: SessionLimits;
}

/**
 * Cria a sessão do mundo (OW-13): compartilhada, `checkpointed`, a 10 Hz, sem rota, sem regra de
 * saída e sem líder — e que nunca termina por esvaziar. A versão de conteúdo é congelada aqui
 * (invariante 7); o personagem entra depois, com `session.enter`, e nenhum evento do mundo depende
 * de haver alguém nele ou olhando (invariante 3).
 *
 * **Falta a fila estável.** O ADR 0060 d.5c quer a fila do mundo ordenada por `(dueAtMs, priority,
 * subject, kind, seq)` (`tieBreak: 'stable'`, OW-06), e é este o lugar onde ela se pede. A OW-06
 * (#827) ainda não pousou na `tibia-parity`; sem ela a fila do mundo desempata por inserção, como a
 * da instância, que é correto enquanto o mundo não tem monstro dormente (a OW-30 é quem depende da
 * ordem estável).
 */
export function createWorldSession(options: WorldSessionOptions): Session {
  const { world, map, content } = options;
  return new Session({
    id: options.id,
    contentVersion: content.version,
    ruleset: createWorldRuleset(content, world, map),
    rng: Rng.fromSeed(options.seed),
    createdAtMs: options.createdAtMs,
    ...WORLD_SESSION_LIMITS,
    ...options.limits,
  });
}
