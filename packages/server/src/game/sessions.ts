// De personagem para sessão de Cidade (FUN-13).
//
// Todo personagem está sempre em EXATAMENTE uma sessão, cidade inclusive (invariante 8).
// Entrar no jogo, portanto, nunca é "ficar sem sessão até escolher uma hunt": é entrar na
// sessão de Cidade, que é orientada a evento e custa perto de zero.

import { randomUUID } from 'node:crypto';
import {
  CharacterRuntime, DEFAULT_DIFFICULTY_NAME, Rng, Session, createCityRuleset, createHuntSession,
  createTrainingSession, createWorldSession, holdStamina, huntRulesetFromSnapshot, materializeStamina,
  statsForLevel, trainingRulesetFromSnapshot,
} from '@draconya/sim';
import type {
  HuntDifficultyName, InventoryState, Ruleset, SessionLimits, SessionSnapshot, SkillsState,
} from '@draconya/sim';
import {
  BOT_VOCABULARY_VERSION, BOT_VOCABULARY_VERSION_V1, migrateBotConfigV1, sanitizeBotConfigV2,
  validateBotConfigV2,
} from '@draconya/content';
import type { BotConfigV2, Content, RemovedBotSlot } from '@draconya/content';
import type {
  SessionBuilder, SessionFactory, SessionRestorer, TransitionRequest,
} from './host.js';
import type { InitialCharacter, PartyTicket, TicketEntry } from '../tickets.js';
import { carryRestoredConditions } from '../world-state.js';
import type { WorldQueue } from '../world-queue.js';
import { HuntEntryUnavailableError, WorldFullError, createWorldEntryGate } from './rest-entry.js';
import type { WorldEntryGate } from './rest-entry.js';

// A recusa do mundo cheio mora em `world-entry.ts` (o hospedeiro a conhece sem importar este arquivo); daqui
// continua exportada, que é onde a OW-18 a pôs e onde os testes a procuram.
export { WorldFullError };

/**
 * Campos ainda não persistidos pela FUN-11. Nível e XP chegam no ticket autenticado; nenhum
 * dado enviado pelo cliente participa da criação da sessão.
 *
 * HP e mana NÃO estão aqui: eles saem da tabela de progressão, como todo stat derivado de
 * level (FUN-34). Números fixos aqui davam um personagem que subia de level e ENCOLHIA — o
 * level up recalcula o máximo pela tabela (FUN-37), e um valor inventado na criação não
 * sobrevive ao primeiro abate que importa.
 *
 * A POSIÇÃO também não está aqui desde a FUN-69. Ela era `(0,0)`, que é parede na borda de
 * qualquer tilemap (FUN-60), e ninguém notava porque nada consultava posição na Cidade. Quem
 * coloca é o `onEnter` da Cidade, pelo `entryPoint` do mapa — conteúdo, validado no boot.
 */
const INITIAL_FLAGS = { goldDelta: 0, alive: true, cooldowns: {} } as const;

/** Onde nascer antes de o `onEnter` colocar: fora do mapa de propósito, para não ocupar tile. */
const UNPLACED = { x: -1, y: -1, z: 0 } as const;

/** O ruleset da Cidade, com o mapa e a duração de passo que o conteúdo diz. */
function cityRulesetFor(content: Content, entryTiles?: number) {
  return createCityRuleset({
    ...(content.city === undefined ? {} : { map: content.city }),
    // O passo da Cidade é FIXO (FUN-119, ADR 0025): vem de `city.json`, não da progressão.
    ...(content.citySettings === undefined ? {} : { stepDurationMs: content.citySettings.stepDurationMs }),
    ...(entryTiles === undefined ? {} : { entryTiles }),
    // Os containers ganham os tamanhos iniciais na entrada (#160), como na hunt.
    containers: { items: content.items, progression: content.progression },
    vocations: content.vocations,
    // Conjuração na Cidade (#792, ADR 0044 d.2): `useSlot` precisa do catálogo de magias e dos
    // coeficientes de combate para chamar `castSpell`, mesmo que conjurar não role nada.
    spells: content.spells,
    combat: content.combat,
  });
}

/**
 * Teto de população por cópia da Cidade (FUN-33, §13 do documento técnico).
 *
 * Duzentos é o número da issue, e ele não sai de medição nossa: é o ponto em que "todo mundo
 * junto" deixa de ser sensação de mundo vivo e vira multidão ilegível — mais gente na praça do
 * que cabe na tela, várias vezes.
 *
 * **É configuração de NÓ, não conteúdo.** Não descreve balanceamento de jogo; descreve quanto
 * um processo aguenta hospedar junto. Por isso mora aqui, e não em `packages/content`.
 */
export const CITY_SHARD_CAPACITY = 200;

/**
 * As cópias da Cidade deste nó — os SHARDS (FUN-71, ADR 0023; teto na FUN-33).
 *
 * Uma cópia, muitos personagens. Antes da FUN-71 cada personagem tinha a própria Cidade e
 * ninguém via ninguém: a praça existia N vezes, vazia em todas.
 *
 * **A cópia enche e abre outra** — é a "Cidade 2" do §13. Duas defesas contra o custo de N
 * jogadores no mesmo lugar, e esta é a mais barata das duas: mesmo com interest management, uma
 * cópia sem teto acumula estado, snapshot e varredura sem limite. A outra defesa é a AOI, em
 * `game/aoi.ts`.
 *
 * **Enche na ORDEM**, e não espalha. Espalhar daria praças pela metade, e praça pela metade é
 * pior que praça cheia: o valor de estar na Cidade é haver gente nela.
 *
 * A cópia vazia é ESQUECIDA. Mantê-la de pé é custo puro — e, pior, ela envelheceria: a versão
 * de conteúdo é fixada na criação (invariante 7), então uma praça que atravessa três deploys
 * continuaria rodando a versão do primeiro.
 */
export interface CityShardOptions {
  /** Teto de população por cópia. Padrão: `CITY_SHARD_CAPACITY`. */
  readonly capacity?: number;
  /**
   * Quantos tiles a busca por tile livre visita ao chegar (`placeReachable`, FUN-120).
   *
   * Quem chega entra no ponto de entrada ou no livre mais próximo a pé; o teto é a praça
   * cheia. `pnpm bench:city` o alarga para caber quinhentas pessoas de uma vez.
   */
  readonly entryTiles?: number;
}

export class CityShard {
  readonly #content: Content;
  readonly #now: () => number;
  readonly #capacity: number;
  readonly #entryTiles: number | undefined;
  #copies: Session[] = [];

  constructor(
    content: Content,
    now: () => number = () => Date.now(),
    options: CityShardOptions = {},
  ) {
    const capacity = options.capacity ?? CITY_SHARD_CAPACITY;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`city shard capacity must be a positive integer: ${capacity}`);
    }
    this.#content = content;
    this.#now = now;
    this.#capacity = capacity;
    this.#entryTiles = options.entryTiles;
  }

  /**
   * Põe o personagem numa cópia com vaga, criando outra se todas estiverem cheias.
   *
   * **Cópia vazia não é reaproveitada**, e não é economia perdida: a versão de conteúdo é
   * fixada na criação (invariante 7), então uma praça que ninguém frequenta e atravessa três
   * deploys continuaria rodando a versão do primeiro. Vazia, ela não custa nada a ninguém para
   * ser refeita — e o hospedeiro já a esqueceu quando o último saiu.
   */
  admit(character: CharacterRuntime, fromTicket = false): Session {
    this.#copies = this.#copies.filter(
      (copy) => copy.ended === null && copy.participants.length > 0,
    );
    const room = this.#copies.find((copy) => copy.participants.length < this.#capacity);
    const session = room ?? this.#create();
    if (room === undefined) this.#copies.push(session);
    // O personagem que NASCE do ticket traz as condições como prazo restante (relógio zero, #836):
    // a cópia que já andou tem outro relógio, e `Session.enter` não traduz quem nunca esteve numa
    // sessão. Quem volta de uma hunt (`fromTicket` falso) já foi traduzido por `moveToClock`.
    if (fromTicket) carryRestoredConditions(character, session);
    session.enter(character);
    return session;
  }

  /** Quantos personagens estão na Cidade deste nó, somando as cópias. */
  get population(): number {
    return this.#copies.reduce((total, copy) => total + copy.participants.length, 0);
  }

  /** Quantas cópias existem agora. Uma praça cheia abre a segunda; é o que este número mostra. */
  get copies(): number {
    return this.#copies.length;
  }

  #create(): Session {
    const id = randomUUID();
    return new Session({
      id,
      // Fixada na criação e imutável até o fim (invariante 7): a sessão termina na versão
      // de conteúdo em que começou, mesmo que um deploy aconteça no meio.
      contentVersion: this.#content.version,
      ruleset: cityRulesetFor(this.#content, this.#entryTiles),
      // Semente derivada do id da sessão: o mesmo id reproduz a mesma sequência, que é o
      // que torna "por que esse loot não caiu" uma pergunta investigável.
      rng: Rng.fromSeed(id),
      createdAtMs: this.#now(),
    });
  }
}

/**
 * O mundo a que o personagem pertence quando o ticket não diz (OW-18). A escolha de mundo na criação
 * e o segundo mundo são da OW-50: até lá `characters.world_id` nasce `'main'` (migração `0029`) e o
 * ticket não o leva, então todo login e toda volta de instância caem neste.
 */
export const DEFAULT_WORLD_ID = 'main';

/**
 * De onde o personagem chega ao mundo, e é isto que decide o teto (ADR 0060 d.2b):
 *
 * - `'rest'`: do REPOUSO — o login, o ticket. Conta para o `capacity` do mundo, e o mundo cheio o
 *   recusa (`WorldFullError`). Quem converte a recusa em fila com posição é a porta do hospedeiro
 *   (`WorldEntryGate`, OW-21): o shard só diz que não cabe.
 * - `'instance'`: de uma hunt, do treino, de uma quest — quem JÁ ESTAVA no mundo antes de entrar nela,
 *   e voltar a ele não pode ser recusado: o teto vale só na entrada.
 */
export type WorldEntry = 'rest' | 'instance';

export interface WorldShardOptions {
  /**
   * Teto de personagens por mundo. Padrão: o `capacity` de `data/worlds/<id>.json` (`main.json`: 200),
   * que é conteúdo — o teto é uma propriedade do mundo, como o `maxPlayers` do Canary. Existe para o
   * teste e para o `bench:world` fixarem um valor sem reescrever o conteúdo.
   */
  readonly capacity?: number;
  /** Substitui, campo a campo, `WORLD_SESSION_LIMITS` do `sim` (o `bench:world` os fixa na máquina de destino). */
  readonly limits?: SessionLimits;
}

/**
 * Os mundos deste nó — UMA sessão por `world_id` (OW-18, ADR 0060 d.2a).
 *
 * É a `CityShard` do mundo aberto, e o que muda é a identidade, não o mecanismo: a Cidade é uma
 * praça que enche e abre outra cópia ("Cidade 2"); o mundo é UM, como o `Game` do Canary
 * (`canary/src/game/game.hpp:95, 927`) — "nunca se abre Thais 2". Para caber mais gente, cria-se outro
 * `world_id` (OW-50) e mais nós, nunca uma segunda cópia do mesmo mundo, e é por isso que aqui não há
 * lista de cópias: há um mapa de `world_id` para sessão.
 *
 * **O mundo vazio é ESQUECIDO**, como a cópia vazia da Cidade, pelo mesmo motivo (invariante 7): a
 * versão de conteúdo é fixada na criação, e um mundo que ninguém ocupa e atravessa três deploys
 * continuaria rodando a versão do primeiro. Vazio ele também não custa nada — o hospedeiro o larga
 * quando o último sai, e a próxima entrada cria outro, já na versão de agora. Monstros, cadáveres e
 * campos são efêmeros e recomeçam (ADR 0060 d.10a), como no Canary depois de um save global.
 *
 * **O teto vale só na ENTRADA do repouso** (d.2b): `admit(..., 'rest')` recusa o mundo cheio, e
 * `admit(..., 'instance')` nunca recusa — quem volta de uma hunt já estava no mundo antes de sair, e
 * barrá-lo prenderia o personagem numa sessão encerrada.
 *
 * **Uma sessão num processo só** (invariante 9). Com mais de um nó `game`, é a trava `world:{id}:owner`
 * (OW-59) que garante isso; até lá, `OPEN_WORLD` só liga com um `game` (`game/server.ts` recusa subir).
 */
export class WorldShard {
  readonly #content: Content;
  readonly #now: () => number;
  readonly #capacity: number | undefined;
  readonly #limits: SessionLimits | undefined;
  readonly #worlds = new Map<string, Session>();

  constructor(
    content: Content,
    now: () => number = () => Date.now(),
    options: WorldShardOptions = {},
  ) {
    const capacity = options.capacity;
    if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1)) {
      throw new Error(`world shard capacity must be a positive integer: ${String(capacity)}`);
    }
    // O mundo padrão tem de existir, com o mapa dele: é o que todo login pede, e descobrir que não
    // existe no primeiro ticket seria uma sessão recusada por jogador em vez de um nó que não sobe.
    // O `buildContent` já confere que cada mundo aponta para um mapa que existe.
    if (!content.worlds.has(DEFAULT_WORLD_ID)) {
      throw new Error(
        `OPEN_WORLD needs the world "${DEFAULT_WORLD_ID}" in the content (data/worlds/${DEFAULT_WORLD_ID}.json)`,
      );
    }
    this.#content = content;
    this.#now = now;
    this.#capacity = capacity;
    this.#limits = options.limits;
  }

  /**
   * Põe o personagem na sessão do mundo `worldId`, criando-a se não há. `entry` diz de onde ele vem
   * (`WorldEntry`) e, com isso, se o teto o alcança. Lança `WorldFullError` quando o mundo está cheio e a
   * entrada é do repouso, e `Error` para um mundo que o conteúdo não tem.
   *
   * O personagem que NASCE do ticket (`'rest'`) traz as condições como prazo restante (relógio zero,
   * #836): a sessão que já andou tem outro relógio, e `Session.enter` não traduz quem nunca esteve numa
   * sessão — `carryRestoredConditions`, antes do `enter`, o leva para o dela. Quem volta de uma
   * instância (`'instance'`) já foi traduzido por `moveToClock`.
   */
  admit(worldId: string, character: CharacterRuntime, entry: WorldEntry): Session {
    const world = this.#content.worlds.get(worldId);
    if (world === undefined) throw new Error(`unknown world "${worldId}"`);
    const existing = this.#worlds.get(worldId);
    // Vazia ou encerrada: esquece. O hospedeiro já largou a que esvaziou (`release`), e a que acabou
    // por fora não aceita ninguém.
    const live = existing !== undefined && existing.ended === null && existing.participants.length > 0
      ? existing
      : undefined;
    if (live === undefined && existing !== undefined) this.#worlds.delete(worldId);

    const capacity = this.#capacity ?? world.capacity;
    if (entry === 'rest' && live !== undefined && live.participants.length >= capacity) {
      throw new WorldFullError(worldId, capacity);
    }
    const session = live ?? this.#create(worldId);
    if (live === undefined) this.#worlds.set(worldId, session);
    if (entry === 'rest') carryRestoredConditions(character, session);
    session.enter(character);
    return session;
  }

  /** O mundo `worldId` está no teto? A fila da OW-21 pergunta por vagas (`vacanciesOf`), que é o número que ela compara. */
  isFull(worldId: string): boolean {
    const world = this.#content.worlds.get(worldId);
    const live = this.#worlds.get(worldId);
    if (world === undefined || live === undefined || live.ended !== null) return false;
    return live.participants.length >= (this.#capacity ?? world.capacity);
  }

  /**
   * Quantas vagas o mundo `worldId` tem agora: o teto menos quem está nele, nunca negativo. Mundo sem sessão
   * viva tem o teto inteiro, e mundo que o conteúdo não tem, nenhuma. É o número que a fila da OW-21 compara
   * com a posição de quem espera (`WaitingList::clientLogin`: `players online + slot <= maxPlayers`).
   */
  vacanciesOf(worldId: string): number {
    const world = this.#content.worlds.get(worldId);
    if (world === undefined) return 0;
    const live = this.sessionOf(worldId);
    return Math.max(0, (this.#capacity ?? world.capacity) - (live?.participants.length ?? 0));
  }

  /** Quantos personagens o mundo `worldId` tem agora neste nó. */
  populationOf(worldId: string): number {
    return this.#worlds.get(worldId)?.participants.length ?? 0;
  }

  /** Quantos personagens há nos mundos deste nó, somados. */
  get population(): number {
    let total = 0;
    for (const session of this.#worlds.values()) total += session.participants.length;
    return total;
  }

  /** Quantos mundos têm sessão agora. Vazio é esquecido na próxima entrada: o nó sem ninguém mostra zero. */
  get worlds(): number {
    let live = 0;
    for (const session of this.#worlds.values()) {
      if (session.ended === null && session.participants.length > 0) live += 1;
    }
    return live;
  }

  /** A sessão viva do mundo `worldId`, se há uma. */
  sessionOf(worldId: string): Session | undefined {
    const session = this.#worlds.get(worldId);
    return session !== undefined && session.ended === null && session.participants.length > 0 ? session : undefined;
  }

  #create(worldId: string): Session {
    const world = this.#content.worlds.get(worldId);
    const map = world === undefined ? undefined : this.#content.maps.get(world.map);
    if (world === undefined || map === undefined) throw new Error(`world "${worldId}" has no map in the content`);
    // O id é desta ENCARNAÇÃO do mundo (invariante 10): o ledger é `UNIQUE (session_id, seq)` e o `seq`
    // recomeça em zero a cada sessão, então reusar o id do mundo colidiria com os extratos da anterior.
    const id = randomUUID();
    return createWorldSession({
      id, map, world, content: this.#content,
      // Semente derivada do id, como a Cidade: o mesmo id reproduz a mesma sequência.
      seed: id,
      createdAtMs: this.#now(),
      ...(this.#limits === undefined ? {} : { limits: this.#limits }),
    });
  }
}

export function createCitySessionFactory(
  content: Content,
  now: () => number = () => Date.now(),
  shard: CityShard = new CityShard(content, now),
): SessionFactory {
  // O 4º argumento (`entry`, OW-21) é do mundo aberto e não está aqui: com a flag desligada o repouso é a
  // Cidade e o primeiro contato sempre cria a sessão dela — a hunt se escolhe no menu, como sempre foi.
  return (characterId, initialCharacter = { level: 1, xp: 0 }, party): Session => {
    // A party (#195, ADR 0027): o primeiro ticket a chegar cria a hunt com os N — e ela nasce
    // hunt, não Cidade. Os seguintes não passam por aqui: o host encontra a sessão pelo id.
    if (party !== undefined) return partyHuntFor(content, party, now);
    const character = characterFromTicket(content, characterId, initialCharacter, now);
    // Entra na cópia compartilhada, e não numa Cidade só dele (FUN-71).
    return shard.admit(character, true);
  };
}

/**
 * A fábrica de sessões do nó com `OPEN_WORLD` ligado (OW-18): o login cai no MUNDO, no templo ou na
 * posição salva, em vez da Cidade. É a `createCitySessionFactory` com o shard trocado — o ticket de party
 * continua nascendo hunt, e o personagem do ticket é o mesmo (`characterFromTicket`) —, e por isso o
 * mundo é uma sessão de DUAS ou mais pessoas desde o primeiro dia: o segundo login entra na mesma sessão.
 *
 * O mundo vem do ticket quando ele o levar (OW-50); até lá é `DEFAULT_WORLD_ID`. Lança `WorldFullError`
 * quando o mundo está no teto — e o hospedeiro, que consulta a fila ANTES de chamar a fábrica
 * (`WorldEntryGate`), a recebe só na corrida entre a fila e a entrada. Com `entry: { hunt }` (OW-21) a
 * primeira sessão do personagem é a hunt, e o mundo nem é tocado.
 */
export function createWorldSessionFactory(
  content: Content,
  now: () => number,
  worlds: WorldShard,
  worldId: string = DEFAULT_WORLD_ID,
): SessionFactory {
  return (characterId, initialCharacter = { level: 1, xp: 0 }, party, entry): Session => {
    if (party !== undefined) return partyHuntFor(content, party, now);
    const character = characterFromTicket(content, characterId, initialCharacter, now);
    // A hunt idle direta (OW-21, ADR 0060 d.6b): a PRIMEIRA sessão do personagem é a hunt, sem passar pelo
    // mundo — é criação, não transição (invariante 8). É o que mantém a base econômica acessível com o
    // mundo cheio, fora do ar ou atrás da flag.
    if (entry !== undefined) return huntEntryFor(content, entry.hunt, character, initialCharacter, now);
    return worlds.admit(worldId, character, 'rest');
  };
}

/**
 * A hunt como primeira sessão de quem sai do repouso (OW-21): a MESMA construção da transição do menu
 * (`huntFor`), e é por isso que o resultado é o de sempre — o personagem do ticket entra nela como entraria
 * vindo da praça, com a boosted do dia que o ticket fixou.
 *
 * A configuração do bot vem do ticket e entra COMPILADA na criação, como o `enter-hunt` a passa (e como
 * `partyHuntFor` faz com a de cada membro): o ruleset a compila junto com as regras de saída, e entrar sem ela
 * para configurá-la depois deixaria a hunt sem as regras. `createBotConfigLoader` — CARGA de uma configuração
 * persistida, que esvazia o slot torto em vez de recusar tudo (ADR 0014).
 *
 * Lança `HuntEntryUnavailableError` quando a hunt não existe mais ou o ruleset a recusa. NÃO cai no mundo: ver
 * o erro.
 */
function huntEntryFor(
  content: Content,
  huntId: string,
  character: CharacterRuntime,
  initialCharacter: InitialCharacter,
  now: () => number,
): Session {
  const raw = initialCharacter.botConfig;
  const loaded = raw === undefined ? undefined : createBotConfigLoader(content)(raw, character.level);
  const session = huntFor(content, {
    to: 'hunt', huntId,
    ...(loaded?.ok === true ? { botConfig: loaded.config } : {}),
  }, character, now);
  if (session === null) throw new HuntEntryUnavailableError(huntId);
  return session;
}

/**
 * As duas costuras de sessão do nó `game` — a que cria a sessão do login e a que constrói o destino de uma
 * transição —, montadas com o MESMO conjunto de shards (FUN-71, OW-18).
 *
 * É o lugar onde a flag `OPEN_WORLD` escolhe o espaço compartilhado do nó, e por isso mora aqui e não no
 * `main.ts`: o que importa testar é que a flag desligada dá a Cidade de sempre e a ligada dá o mundo, e
 * o `main` é boot, sem teste.
 *
 * - **desligada** (o default): o login cai na Cidade, `to: 'world'` devolve `null` (o host recusa a
 *   transição) e o jogo é o de hoje, byte a byte. Nenhum `WorldShard` existe.
 * - **ligada**: o login cai no mundo, e `to: 'world'` volta a ele. A Cidade continua existindo, com o MESMO
 *   `CityShard` nos dois caminhos, mas nada a alcança: o fim de uma hunt vai ao mundo, com alguém olhando, ou
 *   ao repouso (`SessionHost#settleOne`, OW-20).
 *
 * O MESMO shard nos dois caminhos é o ponto: quem entra no jogo e quem volta de uma instância chegam no
 * mesmo lugar, e dois shards seriam dois mundos que nunca se veem — defeito invisível até alguém tentar
 * encontrar um amigo.
 */
export interface SessionWiringOptions {
  /** `OPEN_WORLD` (`config.ts`). Padrão: desligada. */
  readonly openWorld?: boolean;
  readonly cityShard?: CityShardOptions;
  readonly worldShard?: WorldShardOptions;
  /**
   * A fila do mundo cheio (OW-21), em Redis. Só vale com `OPEN_WORLD` ligado: é ela que transforma o
   * `WorldFullError` do login em posição e espera. Ausente, o mundo cheio recusa o handshake como a OW-18
   * o deixou — é o nó montado sem Redis, o teste de shard.
   */
  readonly worldQueue?: WorldQueue;
}

export interface SessionWiring {
  readonly createSession: SessionFactory;
  readonly buildSession: SessionBuilder;
  readonly cityShard: CityShard;
  /** Só com `OPEN_WORLD` ligado. */
  readonly worldShard: WorldShard | undefined;
  /** A porta do mundo para quem vem do repouso: só com `OPEN_WORLD` ligado E a fila (`worldQueue`) injetada. */
  readonly worldEntry: WorldEntryGate | undefined;
}

export function createSessionWiring(
  content: Content,
  now: () => number = () => Date.now(),
  options: SessionWiringOptions = {},
): SessionWiring {
  const cityShard = new CityShard(content, now, options.cityShard);
  const worldShard = options.openWorld === true ? new WorldShard(content, now, options.worldShard) : undefined;
  return {
    createSession: worldShard === undefined
      ? createCitySessionFactory(content, now, cityShard)
      : createWorldSessionFactory(content, now, worldShard),
    buildSession: createSessionBuilder(content, now, cityShard, worldShard),
    cityShard,
    worldShard,
    worldEntry: worldShard === undefined || options.worldQueue === undefined
      ? undefined
      : createWorldEntryGate(worldShard, options.worldQueue, DEFAULT_WORLD_ID),
  };
}

/**
 * O personagem de UM recém-chegado numa sessão que já existe (#402, ADR 0035 D7). Mesma costura
 * de `createSession`: função, e não `Content`, para o host não precisar conhecer balanceamento.
 */
export function createLateJoiner(
  content: Content,
  now: () => number = () => Date.now(),
): (characterId: string, initialCharacter: InitialCharacter) => CharacterRuntime {
  return (characterId, initialCharacter) => characterFromTicket(content, characterId, initialCharacter, now);
}

/**
 * A hunt de uma party, com os N membros dentro (#195): o mesmo `createHuntSession` da
 * transição, com `partyOptions` fixadas e o bot de cada um — carregado AQUI, com o conteúdo,
 * porque chega cru do ticket como o solo chega, e o host só carrega o do personagem que entrou.
 *
 * `createBotConfigLoader`, não `createBotConfigValidator` (ADR 0014): isto é CARGA de uma
 * configuração já persistida, não uma edição — um slot cuja magia/supply saiu do catálogo (o
 * #596, por exemplo) vira `null` em vez de derrubar a configuração inteira do membro.
 */
function partyHuntFor(content: Content, party: PartyTicket, now: () => number): Session {
  const load = createBotConfigLoader(content);
const botConfigs: Record<string, BotConfigV2> = {};
  const premiumByCharacter: Record<string, boolean> = {};
  for (const member of party.members) {
    // O Premium do personagem (ADR 0035 D3) entra no estado da party: o limite de venda é do
    // LÍDER, mas a penalidade de morte é de quem morre. Ausente no ticket é Free.
    premiumByCharacter[member.characterId] = member.initialCharacter.premium ?? false;
    const raw = member.initialCharacter.botConfig;
    if (raw === undefined) continue;
    const decision = load(raw, member.initialCharacter.level);
    if (decision.ok) botConfigs[member.characterId] = decision.config;
  }
  // A boosted do dia (#615) vem do TICKET do líder — é o mesmo valor para todo mundo que
  // entrou no jogo no mesmo dia, e um membro que entrou véspera da virada carrega o de ontem
  // (fixado no login dele, ADR 0052 decisão 5); o líder é quem decide a identidade da
  // instância nova, como já decide `partyOptions.leaderId`.
  const leaderBoostedMonsterId = party.members
    .find((member) => member.characterId === party.leaderId)?.initialCharacter.boostedMonsterId;
  const session = createHuntSession({
    id: party.sessionId,
    content,
    huntId: party.huntId,
    difficulty: party.difficulty as HuntDifficultyName,
    createdAtMs: now(),
    ...(leaderBoostedMonsterId === undefined ? {} : { boostedMonsterId: leaderBoostedMonsterId }),
    partyOptions: {
      leaderId: party.leaderId,
      // Coleta/venda nascem vazias — o líder configura depois de entrar, por `party-settings`.
      settings: { shareCosts: party.shareCosts, splitLoot: party.splitLoot, collect: null, autoSell: [] },
      premiumByCharacter,
    },
    botConfigs,
  });
  for (const member of party.members) {
    session.enter(characterFromTicket(content, member.characterId, member.initialCharacter, now));
  }
  return session;
}

/** O `CharacterRuntime` que um ticket descreve (FUN-12 … #154): o que o `api` leu do banco. */
export function characterFromTicket(
  content: Content, characterId: string, initialCharacter: InitialCharacter, now: () => number,
): CharacterRuntime {
  {
    // A vocação vem do ticket (#154): escolhida no level 8, escrita uma vez pelo `jobs`. A que
    // saiu do conteúdo cai para a tabela base — o id fica, os stats não (mesma regra da hunt).
    const vocationId = initialCharacter.vocation ?? null;
    const vocation = vocationId === null ? null : content.vocations.get(vocationId) ?? null;
    const stats = statsForLevel(initialCharacter.level, vocation, content.progression);
    const character = new CharacterRuntime({
      id: characterId,
      position: UNPLACED,
      ...INITIAL_FLAGS,
      level: initialCharacter.level,
      xp: initialCharacter.xp,
      soul: initialCharacter.soul ?? 0,
      vocationId,
      // Promovido (#566, ADR 0042 decisão 1): vem do ticket, como a vocação. Ausente é `false`
      // no construtor de `CharacterRuntime` — o normal de quem nunca promoveu.
      ...(initialCharacter.promoted === true ? { promoted: true } : {}),
      // A vida e a mana vêm do ticket quando ele as traz (#836, OW-15, ADR 0060 d.10.f): deslogar a
      // 10 HP volta com 10 HP, e é isto que faz o repouso não curar ninguém. LIMITADAS pelo máximo do
      // level — um level novo, uma vocação promovida ou conteúdo que mudou não deixam a vida acima do
      // teto —, e a vida nunca abaixo de 1: zero seria um morto no tile de entrada. Ausentes (a flag
      // `OPEN_WORLD` desligada, personagem que nunca saiu do mundo) o personagem nasce CHEIO, como
      // sempre nasceu.
      health: initialCharacter.health === undefined
        ? stats.maxHealth : Math.min(Math.max(1, initialCharacter.health), stats.maxHealth),
      maxHealth: stats.maxHealth,
      mana: initialCharacter.mana === undefined
        ? stats.maxMana : Math.min(Math.max(0, initialCharacter.mana), stats.maxMana),
      maxMana: stats.maxMana,
      capacity: stats.capacity,
      // O saldo de entrada vem do TICKET (invariante 4). Ausente é zero, e zero recusa gasto —
      // é o lado seguro do erro: não gastar o que não se sabe ter.
      gold: initialCharacter.gold ?? 0,
      // Skills vêm do ticket porque escalam o dano DURANTE a hunt (FUN-75). Ausentes, toda
      // skill vale o nível inicial do conteúdo — que é onde um personagem novo começa.
      ...(isSkillsState(initialCharacter.skills) ? { skills: initialCharacter.skills } : {}),
      // O Bestiário vem do ticket porque o bônus dos marcos escala a XP durante a hunt
      // (FUN-113). Já validado na emissão e no consumo (`isBestiaryState`), então entra sem
      // guarda; ausente, o personagem parte de `{}` — nenhum abate contado, sem marco, sem
      // bônus — e o próximo extrato traz de volta o que ele matar.
      ...(initialCharacter.bestiary === undefined ? {} : { bestiary: initialCharacter.bestiary }),
      // A munição escolhida (#152): validada na emissão e no consumo; ausente, atira a grátis.
      ...(initialCharacter.ammo === undefined ? {} : { ammo: initialCharacter.ammo }),
      // O estoque de supply/munição do loot (#520): validado como a munição; ausente, a
      // sessão parte sem estoque nenhum — a poção de ontem só entra se o ticket a trouxer.
      ...(initialCharacter.supplyStock === undefined
        ? {} : { supplyStock: initialCharacter.supplyStock }),
      ...(initialCharacter.ammunitionStock === undefined
        ? {} : { ammunitionStock: initialCharacter.ammunitionStock }),
      // A economia de Charms (M39-02, #602, ADR 0052 d.1): validada na emissão e no consumo
      // (`isCharmsState`); ausente, a sessão parte sem nenhum ponto/tier/atribuição — o mesmo
      // personagem novo que `bestiary` ausente já descreve.
      ...(initialCharacter.charms === undefined ? {} : { charms: initialCharacter.charms }),
      // O Bosstiary (#629, ADR 0052 d.1): validado na emissão e no consumo (`isBosstiaryState`);
      // ausente, a sessão parte sem nenhum abate de boss — o mesmo personagem novo que `bestiary`
      // ausente já descreve.
      ...(initialCharacter.bosstiary === undefined ? {} : { bosstiary: initialCharacter.bosstiary }),
      // As magias aprendidas (#624, ADR 0058 d.1): validadas na emissão e no consumo
      // (`isLearnedSpellsState`); ausente, a sessão parte sem nenhuma — personagem novo, que
      // não lança nada até comprar (quem já existia ganhou o registro pela migração 0024).
      ...(initialCharacter.learnedSpells === undefined
        ? {} : { learnedSpells: initialCharacter.learnedSpells }),
      // O familiar (M38-02, #599, ADR 0057 d.3): os carimbos de parede do cooldown e da recriação
      // — validados na emissão e no consumo (`isFamiliarState`); ausente, o personagem nunca
      // invocou, e a sessão parte sem carimbo.
      ...(initialCharacter.familiar === undefined ? {} : { familiar: initialCharacter.familiar }),
      // O registro do Treino (#631, ADR 0059 d.3): validado na emissão e no consumo; ausente, a
      // sessão parte de banco zero e nenhuma skill escolhida — o mesmo personagem novo.
      ...(initialCharacter.training === undefined ? {} : { training: initialCharacter.training }),
      // O Hazard (M44-14, #632, ADR 0052 d.5): o nível escolhido e o teto, validados na emissão e no
      // consumo (`isHazardState`); ausente, toda zona vale o `minLevel`.
      ...(initialCharacter.hazard === undefined ? {} : { hazard: initialCharacter.hazard }),
      // Os storages (#731, ADR 0050 d.6 T2): validados como o Bestiário; ausente, a sessão
      // parte sem storage nenhum setado — a mesma degradação de sempre.
      ...(initialCharacter.storages === undefined ? {} : { storages: initialCharacter.storages }),
      // Comida ativa (#726, ADR 0049 decisão 5): ausente, a sessão parte sem — ninguém comeu
      // ainda, o de sempre.
      ...(initialCharacter.fedMs === undefined ? {} : { fedMs: initialCharacter.fedMs }),
      // As bênçãos (#570, ADR 0052): ausente, a sessão parte sem — ninguém comprou ainda.
      ...(initialCharacter.blessings === undefined ? {} : { blessings: initialCharacter.blessings }),
      // A postura de luta (#550, M30-03): ausente, a sessão parte do `FIGHTMODE_ATTACK` do Canary.
      ...(initialCharacter.fightMode === undefined ? {} : { fightMode: initialCharacter.fightMode }),
      // A mochila vem do ticket porque a arma equipada decide o dano (FUN-82). Entrada
      // quebrada vira "sem item", não sessão que não abre.
      ...(isInventoryState(initialCharacter.inventory)
        ? { inventory: initialCharacter.inventory }
        : {}),
      staminaMs: initialCharacter.staminaMs ?? null,
      ...(initialCharacter.staminaUpdatedAtMs === undefined
        ? {}
        : { staminaUpdatedAtMs: initialCharacter.staminaUpdatedAtMs }),
      // A Boosted Creature do dia (#615, ADR 0052 decisão 5): fixada no personagem AGORA, como
      // a versão de conteúdo — não relida do mundo em transição nenhuma depois do login.
      ...(initialCharacter.boostedMonsterId === undefined
        ? {}
        : { boostedMonsterId: initialCharacter.boostedMonsterId }),
      // O mundo (#836, OW-15, ADR 0060 d.3.b e d.6): a âncora absoluta onde ele saiu — o mundo o
      // coloca ali, e cai no templo se o tile não existe mais (`placeOnEnter`) —, e a cidade, que o
      // dono da sessão devolve no extrato. Ausentes, o personagem nunca esteve no mundo: o templo.
      ...(initialCharacter.worldPosition === undefined ? {} : { worldPosition: initialCharacter.worldPosition }),
      ...(initialCharacter.townId === undefined ? {} : { townId: initialCharacter.townId }),
      // As condições que faltavam (#836, OW-15), como PRAZO RESTANTE: relógio zero, que
      // `carryRestoredConditions` leva para o da sessão que o recebe. O ruleset as rearma como
      // eventos no `onEnter` (`HuntRuleset#armConditions`) — a haste e o veneno que faltavam correm
      // outra vez, e a que não tinha mais prazo nem chegou ao ticket.
      ...(initialCharacter.conditions === undefined || initialCharacter.conditions.length === 0
        ? {} : { conditions: initialCharacter.conditions }),
      // O bônus de Loyalty (#628, ADR 0052 decisão 5): calculado pela `api` na emissão e fixado
      // AGORA, como a boosted — a sessão nunca relê conta nem relógio, e o valor atravessa toda
      // transição Cidade↔hunt e toda retomada de snapshot (vive no `CharacterState`).
      ...(initialCharacter.loyaltyBonusPercent === undefined
        ? {}
        : { loyaltyBonusPercent: initialCharacter.loyaltyBonusPercent }),
    });
    // Materializa na ENTRADA (§10): o personagem esteve fora de hunt desde a última vez, e
    // esse tempo é recuperação. Fazer a conta aqui, e não na leitura de cada consulta, é o
    // que mantém "quanto de stamina ele tem" uma pergunta barata durante a sessão.
    materializeStamina(character, now(), content.stamina);
    return character;
  }
}

/**
 * Reconstrói uma sessão a partir de um snapshot guardado (FUN-28).
 *
 * Recebe o conteúdo porque uma hunt não é reconstruível sem ele: mapa, rota e composição são
 * dados, e o ruleset precisa deles de volta antes de restaurar o estado.
 *
 * Devolve `null` quando o snapshot não pode ser reconstruído — formato de outra versão,
 * ruleset que este servidor não conhece, ou hunt que saiu do conteúdo. `null` é a resposta
 * certa: retomar errado é pior que não retomar, e quem chama sabe encerrar creditando.
 */
export function createSessionRestorer(content: Content): SessionRestorer {
  return (snapshot: SessionSnapshot): Session | null => {
    // A versão de conteúdo é fixada na sessão e não muda no meio dela (invariante 7).
    //
    // O ruleset é montado com o conteúdo DESTE processo, e a sessão retomada preserva a
    // versão que estava no snapshot. Se as duas diferirem, ela passaria a se declarar N — no
    // `welcome`, no extrato, no ledger — enquanto simula com os dados de N+1: stats de
    // monstro, curva de XP, coeficientes de combate, densidade de spawn.
    //
    // É exatamente o que o §7 existe para impedir. O caminho não é o deploy normal, que drena
    // creditando (ADR 0010) e não deixa snapshot para trás: é a QUEDA sem drenagem num nó
    // cujo substituto já subiu com conteúdo novo.
    //
    // Recusar aqui não perde nada, porque quem chama credita antes de descartar.
    if (snapshot.contentVersion !== content.version) return null;

    const ruleset = rulesetFor(snapshot, content);
    if (ruleset === null) return null;
    try {
      // Sem rebase de relógio desde a FUN-68: o tempo da sessão é LÓGICO e é dela, então
      // retomar é continuar de onde parou. O intervalo em que o nó esteve fora nunca chega a
      // ser oferecido à simulação, porque quem guarda relógio de processo é o hospedeiro —
      // o ADR 0018 deixou de precisar de uma operação para ser cumprido.
      return Session.fromSnapshot(snapshot, ruleset, Rng.fromSeed(snapshot.id));
    } catch {
      return null;
    }
  };
}

function rulesetFor(snapshot: SessionSnapshot, content: Content): Ruleset | null {
  // Cidade, hunt e Treino (#631) são as que existem. Quest, boss e guild war ainda não têm
  // ruleset — e forçar um conhecido em cima produziria uma sessão que mente sobre o que é.
  if (snapshot.type === 'city') return cityRulesetFor(content);
  if (snapshot.type === 'hunt') return huntRulesetFromSnapshot(snapshot, content);
  if (snapshot.type === 'training') return trainingRulesetFromSnapshot(snapshot, content);
  return null;
}


/**
 * Constrói a sessão de destino de uma transição (FUN-30, FUN-38).
 *
 * É a MESMA função para a morte que devolve à cidade e para o jogador que entra numa hunt.
 * Dois caminhos separados dariam duas chances de o estado exclusivo furar, e é o estado
 * exclusivo que dispensa lock sobre o gold (invariante 9).
 *
 * O personagem que atravessa é o MESMO objeto, não uma cópia reconstruída do banco. A
 * penalidade de morte (FUN-37) já mexeu no level e na XP dele quando isto roda, e reconstruir
 * a partir de dados duráveis que ainda não foram gravados devolveria o personagem de antes de
 * morrer — a penalidade sumiria, e ninguém ligaria uma coisa à outra.
 */
export function createSessionBuilder(
  content: Content,
  now: () => number = () => Date.now(),
  shard: CityShard = new CityShard(content, now),
  /**
   * Os mundos do nó (OW-18), só com `OPEN_WORLD` ligado. Ausente — o default —, `to: 'world'` devolve
   * `null` e o host recusa a transição (`unknown-destination`): o nó sem a flag não sabe construir um
   * mundo, e o jogo é o de hoje, byte a byte.
   */
  worlds?: WorldShard,
): SessionBuilder {
  return (request, from, characterId, departed): Session | null => {
    // Quem atravessa é UM personagem, mesmo quando a origem tem duzentos (FUN-71). Mover
    // `from.participants` inteiro faria um jogador clicando em caçar levar a praça junto — e
    // a hunt recusa o segundo participante, então o sintoma seria a transição falhar para
    // todo mundo sempre que houvesse mais alguém na praça.
    //
    // Quem já SAIU da origem (#802) vem em `departed`: o membro de uma party que a deixou por
    // dentro do `sim` — morte, regra de saída, a saída que o ruleset concluiu depois do
    // `exitDelayMs` — não está mais em `from.participants`. Sem isto o construtor devolvia
    // `null`, o host caía no `release`, e o `release` de uma sessão privada a ENCERRA: a saída
    // de UM membro acabava a party inteira, com `manual-exit`, para os que ficaram.
    const character = from.participants.find((p) => p.id === characterId) ?? departed;
    if (character === undefined) return null;

    // Materializar a stamina é da FRONTEIRA, e toda transição é uma (§10). Fazer aqui, e não
    // dentro de cada destino, é o que garante que nenhum caminho novo esqueça.
    //
    // A exceção é sair do TREINO (#631): a stamina não anda nele — o exercise training do Canary é
    // online, e o Canary só regenera stamina deslogado (ADR 0060 d.14c, emenda ao ADR 0059 d.1) —,
    // então o marco avança sem recuperar o tempo de treino. A entrada nele (Cidade → Treino)
    // materializa normalmente: o tempo que veio ANTES do treino ainda é recuperação.
    if (from.ruleset.type === 'training') holdStamina(character, now());
    else materializeStamina(character, now(), content.stamina);

    if (request.to === 'city') return cityFor(shard, from, character);
    if (request.to === 'world') return worlds === undefined ? null : worldFor(worlds, from, character);
    if (request.to === 'hunt') return huntFor(content, request, character, now);
    if (request.to === 'training') return trainingFor(content, request, character, now);
    // Quest, boss e guild war ainda não têm ruleset. `null` recusa a transição com erro claro,
    // que é melhor que construir uma sessão que mente sobre o que é.
    return null;
  };
}

/**
 * A Cidade não sucede a si mesma: uma sessão de Cidade que acaba é logout ou drenagem, e aí o
 * personagem está mesmo saindo do nó.
 *
 * Quem cura é o `onEnter` da Cidade — voltar à PZ restaura HP e mana cheios (§26.1). Curar
 * aqui duplicaria a regra em dois lugares, e um dia só um dos dois mudaria.
 */
function cityFor(shard: CityShard, from: Session, character: CharacterRuntime): Session | null {
  if (from.ruleset.type === 'city') return null;
  // A MESMA cópia em que os outros estão (FUN-71). Voltar da hunt é chegar na praça, não
  // abrir uma praça nova — que é o que uma sessão por personagem fazia.
  return shard.admit(character);
}

/**
 * O mundo não sucede a si mesmo: uma sessão de mundo que acaba é logout ou drenagem, como a Cidade.
 *
 * Quem chega aqui vem de uma INSTÂNCIA (`ALLOWED` não liga a Cidade ao mundo), então a entrada é
 * `'instance'`: o teto do mundo não a alcança (ADR 0060 d.2b) — o personagem já estava no mundo antes de
 * sair, e barrá-lo o deixaria numa sessão encerrada. É o MESMO objeto de personagem, com a âncora que a
 * saída do mundo gravou (`#anchorWorldPosition`): é ela que o `placeOnEnter` do mundo usa para recolocá-lo
 * no tile de onde ele saiu.
 *
 * **A volta só com alguém olhando é do hospedeiro** (OW-20, d.6c): este construtor não sabe quem olha, e
 * quem decide entre chamá-lo e levar o personagem ao repouso é `SessionHost#settleOne`. Quem chega aqui já foi
 * decidido: é a volta ASSISTIDA.
 */
function worldFor(worlds: WorldShard, from: Session, character: CharacterRuntime): Session | null {
  if (from.ruleset.type === 'world') return null;
  return worlds.admit(DEFAULT_WORLD_ID, character, 'instance');
}

function huntFor(
  content: Content,
  request: TransitionRequest,
  character: CharacterRuntime,
  now: () => number,
): Session | null {
  if (request.huntId === undefined) return null;
  try {
    const session = createHuntSession({
      id: randomUUID(),
      content,
      huntId: request.huntId,
      // #584: `difficulty` é aceito e IGNORADO pelo `sim` desde o #583 (ADR 0039, fim do
      // pull por dificuldade) — não seleciona mais nada no conteúdo. Ausente (cliente novo)
      // vira o único nome compat que o conteúdo ainda expõe, só para o snapshot/extrato
      // continuarem redondos; presente (cliente antigo) é aceito sem validar contra nada.
      difficulty: (request.difficulty ?? DEFAULT_DIFFICULTY_NAME) as HuntDifficultyName,
      createdAtMs: now(),
      // A configuração do bot já vem VALIDADA (FUN-81): quem a aceitou foi o host, no socket
      // ou ao ler o ticket. Aqui ela só é compilada — e é a hunt que a guarda no snapshot.
      ...(request.botConfig === undefined ? {} : { botConfig: request.botConfig }),
      // A Boosted Creature do dia (#615) vem do PERSONAGEM, fixada nele desde o ticket que o
      // trouxe para o jogo (ADR 0052 decisão 5) — não é relida do mundo nesta transição, para
      // a hunt nascer com a boosted de quando ele entrou, mesmo que o dia já tenha virado.
      ...(character.boostedMonsterId === undefined ? {} : { boostedMonsterId: character.boostedMonsterId }),
    });
    session.enter(character);
    return session;
  } catch {
    // Hunt inexistente, dificuldade que ela não define, rota que saiu do conteúdo. Recusar é
    // a resposta certa: o personagem fica onde estava, e o jogador vê o motivo.
    return null;
  }
}

/**
 * A sessão de Treino (#631, ADR 0059 d.1): o personagem entra sozinho, com a exercise weapon que
 * escolheu. `null` recusa a transição — instância que ele não carrega, item que não é exercise
 * weapon, arma sem carga, conteúdo sem `training/` ou sem o mapa da Cidade — e o personagem fica
 * onde estava, que é o estado seguro. O host confere e responde o motivo em palavras ANTES de
 * chegar aqui; esta é a segunda linha, porque o construtor é quem tem a autoridade sobre o que
 * uma sessão de Treino pode ser (invariante 4: o cliente só disse qual instância).
 */
function trainingFor(
  content: Content,
  request: TransitionRequest,
  character: CharacterRuntime,
  now: () => number,
): Session | null {
  if (request.itemInstanceId === undefined) return null;
  try {
    // O `training-exhaustion` do Canary (ADR 0052 d.6, cooldown de parede): um novo início só
    // passados `startCooldownMs` (10 s) do anterior. Recusar aqui é a segunda linha — o host já
    // respondeu em palavras —, e é a que carimba: o instante entra no registro do personagem, que o
    // extrato do Treino leva ao banco. Sem ele, entrar/sair/entrar a cada ciclo creditaria um golpe
    // por entrada (o primeiro vence em t = 0) e esgotaria a arma bem mais depressa que 1 carga / 2 s.
    const rules = content.training;
    const startedAtMs = now();
    if (rules !== undefined && character.training.exerciseCooldownLeftMs(startedAtMs, rules.startCooldownMs) > 0) {
      return null;
    }
    const session = createTrainingSession({
      id: randomUUID(), content, itemInstanceId: request.itemInstanceId, createdAtMs: startedAtMs,
    });
    session.enter(character);
    if (rules !== undefined) character.training.beginExerciseCooldown(startedAtMs, rules.startCooldownMs);
    return session;
  } catch {
    // Sem Treino no conteúdo, sem a arma, sem onde ficar (`TrainingUnavailableError`): recusar é a
    // resposta certa, como a hunt que saiu do conteúdo.
    return null;
  }
}

/**
 * Aceita — ou recusa com motivo — uma configuração de bot que chegou de fora (FUN-81).
 *
 * Função estreita injetada no host, e não o `Content` inteiro: o host não precisa conhecer o
 * vocabulário para rotear uma mensagem, e dar a ele o conteúdo todo seria dar acesso a
 * balanceamento a quem cuida de socket. É a mesma forma do `settleProgress` que o `api` recebe.
 *
 * As duas checagens, na ordem em que custam a descobrir:
 *
 *   1. **forma** — `botConfigSchema` recusa condição fora do vocabulário, operador que não
 *      existe, percentual fora de 0–100;
 *   2. **conteúdo** — slots, versão de vocabulário e referência cruzada de magia, supply e
 *      monstro, tudo contra o `content` deste nó.
 *
 * O gate de level do §13.2 foi revogado no AB-03 (ADR 0032 d.4): o `level` continua na
 * assinatura porque o host o carrega, mas não recusa mais nada.
 *
 * A recusa devolve TEXTO, não booleano, porque ele vai direto para o jogador num
 * `system-message`. "Sua configuração é inválida" sem dizer onde é o que faz alguém desistir
 * de configurar o bot.
 */
export type BotConfigDecision =
  | { readonly ok: true; readonly config: BotConfigV2 }
  | { readonly ok: false; readonly reason: string };

/**
 * O portão de versão mais a migração v1→v2, compartilhados por `createBotConfigValidator`
 * (EDIÇÃO — recusa com motivo) e `createBotConfigLoader` (CARGA — nunca recusa por conteúdo,
 * ver o comentário de `sanitizeBotConfigV2`). O que os dois têm em comum é só isto: o FORMATO
 * precisa ser reconhecível. Versão desconhecida ou vocabulário torto continuam recusa em
 * QUALQUER caminho — não é conteúdo que mudou sob a configuração, é a configuração que nunca
 * foi válida (corrompida, ou de um servidor que fala outra versão).
 */
function migrateBotConfigGate(raw: unknown): { readonly ok: true; readonly config: BotConfigV2 } | { readonly ok: false; readonly reason: string } {
  // O portão de versão ANTES da migração: `migrateBotConfigV1` aceita qualquer v1 bem formado,
  // e uma config com `version: 99` que trouxesse as cinco categorias migraria em silêncio.
  const version = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)['version']
    : undefined;
  if (version !== BOT_VOCABULARY_VERSION_V1 && version !== BOT_VOCABULARY_VERSION) {
    return {
      ok: false,
      reason: `configuração na versão ${String(version)} de vocabulário; este servidor `
        + `entende ${BOT_VOCABULARY_VERSION}`,
    };
  }
  try {
    return { ok: true, config: migrateBotConfigV1(raw) };
  } catch {
    return { ok: false, reason: 'configuração fora do vocabulário' };
  }
}

/**
 * O juiz único da configuração do bot (FUN-81, AB-09). Migra v1→v2 e valida contra o conteúdo
 * fixado na sessão (invariante 7). A migração é pura e idempotente (AB-03): v2 volta só
 * parseada, v1 vira v2. Versão desconhecida é recusa com motivo — o portão de versão.
 *
 * **Só para a EDIÇÃO** (`#configureBot`, uma configuração NOVA que o jogador acabou de salvar):
 * recusar tudo com o motivo é o certo aqui — é o jogador que escreveu a regra torta, e ele
 * precisa saber qual foi para corrigir. Quem CARREGA uma configuração já persistida usa
 * `createBotConfigLoader`, que nunca recusa por causa de conteúdo (ADR 0014).
 */
export function createBotConfigValidator(
  content: Content,
): (raw: unknown, level: number) => BotConfigDecision {
  return (raw, _level) => {
    const gated = migrateBotConfigGate(raw);
    if (!gated.ok) return gated;

    const problems = validateBotConfigV2(gated.config, content);
    if (problems.length > 0) {
      // Só o primeiro problema vai para o socket. A lista inteira é da UI (M10), que consegue
      // apontar slot por slot; numa linha de chat, cinco motivos viram ruído.
      return { ok: false, reason: problems[0] as string };
    }

    return { ok: true, config: gated.config };
  };
}

export type BotConfigLoadResult =
  | { readonly ok: true; readonly config: BotConfigV2; readonly removed: readonly RemovedBotSlot[] }
  | { readonly ok: false; readonly reason: string };

/**
 * O carregador de uma configuração JÁ PERSISTIDA (FUN-81, ADR 0014) — o que
 * `#adoptTicketBotConfig` e `partyHuntFor` usam para o bot que chega no TICKET, não o que o
 * jogador acabou de editar. Mesmo portão de versão/migração de `createBotConfigValidator`, mas
 * a referência cruzada (`sanitizeBotConfigV2`) esvazia o slot torto em vez de recusar tudo: o
 * personagem que entra na hunt não pode ficar sem NENHUM automatismo — o `swap-weapon-shield-
 * by-hp`, o `ringSwap`, os outros 23 slots do conjunto — só porque uma magia que ele configurou
 * meses atrás saiu do catálogo (#596). `ok: false` aqui continua existindo para o que É
 * corrupção de verdade: versão desconhecida, ou vocabulário que nem migra.
 */
export function createBotConfigLoader(
  content: Content,
): (raw: unknown, level: number) => BotConfigLoadResult {
  return (raw, _level) => {
    const gated = migrateBotConfigGate(raw);
    if (!gated.ok) return gated;

    return { ok: true, ...sanitizeBotConfigV2(gated.config, content) };
  };
}

/**
 * A forma mínima de `SkillsState` vinda do banco (FUN-75).
 *
 * Checagem estrutural e não schema Zod: o formato é do `sim`, e importar um validador de
 * domínio aqui só para conferir dois números seria mais acoplamento que garantia. O que
 * importa é não deixar lixo virar `NaN` dentro do motor — entrada quebrada vira "sem skills",
 * e o personagem começa no nível inicial em vez de a sessão não abrir.
 */
function isSkillsState(value: unknown): value is SkillsState {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const skill = entry as { level?: unknown; points?: unknown };
    return Number.isFinite(skill.level) && Number.isFinite(skill.points);
  });
}

/**
 * A forma mínima de `InventoryState` vinda do banco (FUN-82).
 *
 * Mesma escolha de `isSkillsState`: checagem estrutural, não schema. Entrada quebrada vira
 * "sem item" e o personagem entra de mãos vazias, em vez de a sessão não abrir por um JSON
 * torto — perder o inventário de uma hunt é ruim, não conseguir entrar é pior.
 */
function isInventoryState(value: unknown): value is InventoryState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as { backpack?: unknown; satchel?: unknown; equipped?: unknown };
  if (!Array.isArray(state.backpack)) return false;
  if (typeof state.equipped !== 'object' || state.equipped === null) return false;
  // Posicional (#160): `null` é lugar vazio, e a bolsa é opcional (ticket anterior).
  const place = (item: unknown): boolean => item === null || isCarried(item);
  if (state.satchel !== undefined && !(Array.isArray(state.satchel) && state.satchel.every(place))) return false;
  return state.backpack.every(place)
    && Object.values(state.equipped).every((item) => item === undefined || isCarried(item));
}

function isCarried(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as { instanceId?: unknown; itemId?: unknown; quantity?: unknown };
  return typeof item.instanceId === 'string'
    && typeof item.itemId === 'string'
    && Number.isInteger(item.quantity);
}
