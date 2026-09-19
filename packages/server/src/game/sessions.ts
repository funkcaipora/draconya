// De personagem para sessão de Cidade (FUN-13).
//
// Todo personagem está sempre em EXATAMENTE uma sessão, cidade inclusive (invariante 8).
// Entrar no jogo, portanto, nunca é "ficar sem sessão até escolher uma hunt": é entrar na
// sessão de Cidade, que é orientada a evento e custa perto de zero.

import { randomUUID } from 'node:crypto';
import {
  CharacterRuntime, Rng, Session, createCityRuleset, createHuntSession,
  huntRulesetFromSnapshot, materializeStamina, statsForLevel,
} from '@draconya/sim';
import type {
  HuntDifficultyName, InventoryState, Ruleset, SessionSnapshot, SkillsState,
} from '@draconya/sim';
import {
  BOT_VOCABULARY_VERSION, BOT_VOCABULARY_VERSION_V1, migrateBotConfigV1, validateBotConfigV2,
} from '@draconya/content';
import type { BotConfigV2, Content } from '@draconya/content';
import type {
  SessionBuilder, SessionFactory, SessionRestorer, TransitionRequest,
} from './host.js';
import type { InitialCharacter, PartyTicket } from '../tickets.js';

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
  admit(character: CharacterRuntime): Session {
    this.#copies = this.#copies.filter(
      (copy) => copy.ended === null && copy.participants.length > 0,
    );
    const room = this.#copies.find((copy) => copy.participants.length < this.#capacity);
    const session = room ?? this.#create();
    if (room === undefined) this.#copies.push(session);
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

export function createCitySessionFactory(
  content: Content,
  now: () => number = () => Date.now(),
  shard: CityShard = new CityShard(content, now),
): SessionFactory {
  return (characterId, initialCharacter = { level: 1, xp: 0 }, party): Session => {
    // A party (#195, ADR 0027): o primeiro ticket a chegar cria a hunt com os N — e ela nasce
    // hunt, não Cidade. Os seguintes não passam por aqui: o host encontra a sessão pelo id.
    if (party !== undefined) return partyHuntFor(content, party, now);
    const character = characterFromTicket(content, characterId, initialCharacter, now);
    // Entra na cópia compartilhada, e não numa Cidade só dele (FUN-71).
    return shard.admit(character);
  };
}

/**
 * A hunt de uma party, com os N membros dentro (#195): o mesmo `createHuntSession` da
 * transição, com `partyOptions` fixadas e o bot de cada um — validado AQUI, com o conteúdo,
 * porque chega cru do ticket como o solo chega, e o host só valida o do personagem que entrou.
 */
function partyHuntFor(content: Content, party: PartyTicket, now: () => number): Session {
  const accept = createBotConfigValidator(content);
  const botConfigs: Record<string, BotConfigV2> = {};
  for (const member of party.members) {
    const raw = member.initialCharacter.botConfig;
    if (raw === undefined) continue;
    const decision = accept(raw, member.initialCharacter.level);
    if (decision.ok) botConfigs[member.characterId] = decision.config;
  }
  const session = createHuntSession({
    id: party.sessionId,
    content,
    huntId: party.huntId,
    difficulty: party.difficulty as HuntDifficultyName,
    createdAtMs: now(),
    partyOptions: { leaderId: party.leaderId, mode: party.mode },
    botConfigs,
  });
  for (const member of party.members) {
    session.enter(characterFromTicket(content, member.characterId, member.initialCharacter, now));
  }
  return session;
}

/** O `CharacterRuntime` que um ticket descreve (FUN-12 … #154): o que o `api` leu do banco. */
function characterFromTicket(
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
      vocationId,
      health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: stats.maxMana, maxMana: stats.maxMana,
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
      // A mochila vem do ticket porque a arma equipada decide o dano (FUN-82). Entrada
      // quebrada vira "sem item", não sessão que não abre.
      ...(isInventoryState(initialCharacter.inventory)
        ? { inventory: initialCharacter.inventory }
        : {}),
      staminaMs: initialCharacter.staminaMs ?? null,
      ...(initialCharacter.staminaUpdatedAtMs === undefined
        ? {}
        : { staminaUpdatedAtMs: initialCharacter.staminaUpdatedAtMs }),
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
  // Cidade e hunt são as duas que existem. Treino, quest, boss e guild war ainda não têm
  // ruleset — e forçar um conhecido em cima produziria uma sessão que mente sobre o que é.
  if (snapshot.type === 'city') return cityRulesetFor(content);
  if (snapshot.type === 'hunt') return huntRulesetFromSnapshot(snapshot, content);
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
): SessionBuilder {
  return (request, from, characterId): Session | null => {
    // Quem atravessa é UM personagem, mesmo quando a origem tem duzentos (FUN-71). Mover
    // `from.participants` inteiro faria um jogador clicando em caçar levar a praça junto — e
    // a hunt recusa o segundo participante, então o sintoma seria a transição falhar para
    // todo mundo sempre que houvesse mais alguém na praça.
    const character = from.participants.find((p) => p.id === characterId);
    if (character === undefined) return null;

    // Materializar a stamina é da FRONTEIRA, e toda transição é uma (§10). Fazer aqui, e não
    // dentro de cada destino, é o que garante que nenhum caminho novo esqueça.
    materializeStamina(character, now(), content.stamina);

    if (request.to === 'city') return cityFor(shard, from, character);
    if (request.to === 'hunt') return huntFor(content, request, character, now);
    // Treino, quest, boss e guild war ainda não têm ruleset. `null` recusa a transição com
    // erro claro, que é melhor que construir uma sessão que mente sobre o que é.
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

function huntFor(
  content: Content,
  request: TransitionRequest,
  character: CharacterRuntime,
  now: () => number,
): Session | null {
  if (request.huntId === undefined || request.difficulty === undefined) return null;
  try {
    const session = createHuntSession({
      id: randomUUID(),
      content,
      huntId: request.huntId,
      // A dificuldade chega como string do cliente e é validada pelo CONTEÚDO, não por um
      // enum no protocolo: uma hunt define as dificuldades que fazem sentido para ela.
      difficulty: request.difficulty as HuntDifficultyName,
      createdAtMs: now(),
      // A configuração do bot já vem VALIDADA (FUN-81): quem a aceitou foi o host, no socket
      // ou ao ler o ticket. Aqui ela só é compilada — e é a hunt que a guarda no snapshot.
      ...(request.botConfig === undefined ? {} : { botConfig: request.botConfig }),
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
 * O juiz único da configuração do bot (FUN-81, AB-09). Migra v1→v2 e valida contra o conteúdo
 * fixado na sessão (invariante 7). A migração é pura e idempotente (AB-03): v2 volta só
 * parseada, v1 vira v2. Versão desconhecida é recusa com motivo — o portão de versão.
 */
export function createBotConfigValidator(
  content: Content,
): (raw: unknown, level: number) => BotConfigDecision {
  return (raw, _level) => {
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

    let config: BotConfigV2;
    try {
      config = migrateBotConfigV1(raw);
    } catch {
      return { ok: false, reason: 'configuração fora do vocabulário' };
    }

    const problems = validateBotConfigV2(config, content);
    if (problems.length > 0) {
      // Só o primeiro problema vai para o socket. A lista inteira é da UI (M10), que consegue
      // apontar slot por slot; numa linha de chat, cinco motivos viram ruído.
      return { ok: false, reason: problems[0] as string };
    }

    return { ok: true, config };
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
