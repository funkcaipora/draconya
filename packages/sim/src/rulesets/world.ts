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
//   coordenada absoluta (`worldPositionOf`).
//
// Nada disto é novo motor, e nada aqui roda por tick (invariante 2): o que o mundo faz continua
// sendo evento da fila da sessão. E a sessão é a do hospedeiro — este arquivo só a monta.

import type { Content, Hunt, Point, Route, Tilemap, World } from '@draconya/content';
import { absoluteToLocal, localToAbsolute } from '@draconya/content';
import type { CharacterRuntime } from '../character.js';
import { Rng } from '../rng.js';
import { Session } from '../session.js';
import type { SessionLimits } from '../session.js';
import { hasZoneFlag } from '../zones.js';
import { HuntRuleset, contentOptionsOf } from './hunt.js';
import type { HuntRulesetOptions } from './hunt.js';
import { instanceTopology, worldTopology } from './topology.js';

/** A taxa de atualização do mundo, em Hz, com ou sem visualizador (ADR 0060 d.5, ADR 0003). */
export const WORLD_HZ = 10;

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
