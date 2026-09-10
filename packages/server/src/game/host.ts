// Hospedagem de sessões num nó de jogo (FUN-13).
//
// O modelo inteiro está na relação entre estas duas coisas:
//
//   sessão      vive aqui, avança sozinha, sobrevive ao socket e ao restart
//   visualizador  um socket olhando uma sessão; entra e sai sem consequência nenhuma
//
// Se desanexar encerrar, pausar, creditar ou zerar qualquer coisa, o modelo está errado —
// é o ADR 0001 em uma frase, e é o teste que define esta issue.
//
// A `Session` do `sim` guarda só IDS de visualizador, porque ela não pode conhecer socket
// (invariante 1). Os objetos ficam aqui. A ponte entre os dois é `session.attached`, que é o
// que decide a taxa de tick — a sessão sabe SE alguém olha, nunca QUEM.

import { performance } from 'node:perf_hooks';
import type {
  EndReason, GridPoint, PresenceEvent, Receipt, Session, SessionSnapshot, SessionType,
} from '@draconya/sim';
import type { C2SMessage, S2CMessage, S2CProps } from '@draconya/protocol';
import { ITEM_SLOTS } from '@draconya/content';
import type { BotConfig, Item, ItemSlot, Monster } from '@draconya/content';
import type { CharacterRuntime, HuntRuleset, InventoryRefusal, InventoryResult } from '@draconya/sim';
import type { SessionDirectory } from '../directory.js';
import type { SnapshotStore } from '../snapshots.js';
import type { ReceiptStore } from '../receipts.js';
import type { BoxedItem, LootBoxStore } from '../loot-box.js';
import type { Logger } from '../log.js';
import type { InitialCharacter } from '../tickets.js';
import { AreaOfInterest } from './aoi.js';
import { Viewer, type ViewerOptions, type ViewerSocket } from './viewer.js';
import { REFUSAL_TEXT, TransitionError, refuseTransition } from './transitions.js';
import { TICK_LAG_BUDGET_MS, type GameMetrics } from './metrics.js';

/** Cria a sessão de um personagem que ainda não tem uma. */
export type SessionFactory = (characterId: string, initialCharacter?: InitialCharacter) => Session;

/** Reconstrói uma sessão a partir de um snapshot. `null` = não dá para retomar (FUN-28). */
export type SessionRestorer = (snapshot: SessionSnapshot) => Session | null;

/** Para onde o personagem quer ir. `huntId` e `difficulty` só valem para `to: 'hunt'`. */
export interface TransitionRequest {
  readonly to: SessionType;
  readonly huntId?: string;
  readonly difficulty?: string;
  /**
   * A configuração do bot deste personagem, JÁ VALIDADA (FUN-81). Preenchida pelo host, nunca
   * pelo cliente — o cliente manda a configuração numa mensagem própria, e o que chega aqui é
   * o que o servidor aceitou.
   */
  readonly botConfig?: BotConfig;
}

/**
 * Constrói a sessão de destino de uma transição (FUN-30, FUN-38).
 *
 * `null` significa "não sei construir essa": a transição é recusada, e no caminho da morte a
 * sessão é solta. É a MESMA costura para a morte que devolve à cidade e para o jogador que
 * entra numa hunt — dois caminhos separados dariam duas chances de o estado exclusivo furar,
 * e é o estado exclusivo que dispensa lock sobre o gold (invariante 9).
 */
/**
 * Constrói a sessão de destino de uma transição, para UM personagem.
 *
 * O `characterId` não é redundante com `from`: desde a FUN-71 a Cidade é compartilhada, e uma
 * sessão de origem pode ter duzentas pessoas. Sem ele, "quem está transicionando" viraria
 * "todo mundo que está nesta sessão" — e um jogador clicando em caçar levaria a praça junto.
 */
export type SessionBuilder = (
  request: TransitionRequest,
  from: Session,
  characterId: string,
) => Session | null;

export interface SessionHostOptions {
  readonly nodeId: string;
  readonly contentVersion: string;
  readonly createSession: SessionFactory;
  readonly logger: Logger;
  readonly directory?: SessionDirectory;
  /** Onde as sessões são guardadas para sobreviver à queda do processo (FUN-28). */
  readonly snapshots?: SnapshotStore;
  /** Onde o extrato de uma sessão encerrada espera virar linha de ledger (FUN-29). */
  readonly receipts?: ReceiptStore;
  readonly restoreSession?: SessionRestorer;
  /** Constrói a sessão de destino de uma transição — a PZ na morte, a hunt no menu. */
  readonly buildSession?: SessionBuilder;
  readonly viewer?: ViewerOptions;
  /** Métricas do nó (FUN-47). Ausente: o host roda igual, só não conta nada. */
  readonly metrics?: GameMetrics;
  /** Relógio monotônico da simulação. Injetável para o teste não depender de tempo real. */
  readonly now?: () => number;
  /**
   * Aceita ou recusa uma configuração de bot (FUN-81). Ausente: `bot-config` é ignorada e o
   * jogador recebe um aviso — um host montado sem conteúdo não tem como julgar vocabulário.
   */
  readonly acceptBotConfig?: (raw: unknown, level: number) => BotConfigDecision;
  /**
   * Persiste a configuração aceita. Ausente: ela vale nesta sessão e some no logout.
   *
   * É a ÚNICA escrita de banco do `game`, e é deliberada: a configuração é editada com o
   * jogador conectado, e o processo que tem a conexão é este. Mandá-la pelo `api` obrigaria o
   * cliente a manter sessão HTTP para uma ação de jogo, e ainda deixaria o `game` sem o valor.
   *
   * O caminho de LEITURA é outro e não se cruza com este: a configuração chega pelo ticket,
   * que o `api` monta lendo a linha do personagem.
   */
  readonly saveBotConfig?: (characterId: string, config: BotConfig) => Promise<void>;
  /**
   * O catálogo de itens (FUN-76), para as regras de equipar. Ausente: nada se veste, e a
   * recusa é honesta — um host sem conteúdo não sabe o que é uma espada.
   */
  readonly itemCatalog?: ReadonlyMap<string, Item>;
  /**
   * O catálogo de monstros (FUN-103), para nome e `outfitId` de quem nasce na hunt.
   *
   * O `sim` não conhece nome nem arte: o evento de nascimento traz só o `monsterId`, e é aqui
   * que ele vira algo desenhável. Ausente: o monstro aparece sem nome e com outfit 0 — a hunt
   * continua, mas a tela mostra um buraco onde deveria ter um rato. Lido do conteúdo fixado na
   * sessão (invariante 7): é um mapa carregado no boot, não uma consulta por criatura.
   */
  readonly monsterCatalog?: ReadonlyMap<string, Monster>;
  /**
   * O outfit de TODO personagem, enquanto ninguém escolhe o seu (FUN-103, §7.4 pendente).
   *
   * `CharacterRuntime` não tem outfit e o ticket não carrega um. Até isso existir, todo jogador
   * veste o mesmo — e o número vem do conteúdo, não de uma constante aqui, porque é arte e arte
   * não mora em código (invariante 6).
   */
  readonly playerOutfitId?: number;
  /**
   * Onde a Caixa de Loot da Sessão é guardada (FUN-88). Ausente: o que não coube se perde no
   * encerramento, e o log diz. Degradação, não falha.
   */
  readonly lootBoxes?: LootBoxStore;
  /**
   * Ligar o interest management por célula nas sessões compartilhadas (FUN-33). Padrão: sim.
   *
   * Existe desligável por duas razões, e nenhuma é "por precaução": é o GRUPO DE CONTROLE da
   * medição — `pnpm bench:city` roda os dois lados e é assim que "não cresce
   * quadraticamente" vira número —, e é a saída se um dia a AOI esconder quem não devia. Sem
   * ela, a praça volta a mandar tudo para todos: caro, e visivelmente correto.
   */
  readonly areaOfInterest?: boolean;
  /**
   * O catálogo do que existe: hunts (FUN-79) e vocabulário do bot (FUN-89).
   *
   * Função, e não o `Content`: o host não precisa conhecer balanceamento para mandar uma lista,
   * pela mesma razão que ele recebe `acceptBotConfig` em vez do conteúdo inteiro. Calculada uma
   * vez no boot — a versão de conteúdo é fixada e não muda enquanto o processo vive.
   */
  readonly catalogue?: () => S2CProps<'catalogue'>;
}

const EMPTY_ITEMS: ReadonlyMap<string, Item> = new Map();

/**
 * Por que o item não entrou, em português e para o jogador.
 *
 * A recusa do `sim` é tipada justamente para caber num mapa como este: sem ela, o host teria
 * que inventar a mensagem, e "não foi possível" é o que faz alguém abrir um chamado.
 */
const INVENTORY_REFUSAL: Readonly<Record<InventoryRefusal, string>> = {
  'over-capacity': 'Você não aguenta carregar mais isso.',
  'not-carried': 'Você não está com esse item.',
  'not-equippable': 'Esse item não se veste.',
  'level-too-low': 'Seu level ainda não permite usar esse item.',
  'wrong-vocation': 'Esse item é de outra vocação.',
  'stack-too-large': 'Essa pilha é grande demais.',
};

/**
 * Os itens que ESTA sessão criou e que estão na mochila (FUN-88).
 *
 * O id determinístico (`sessionId:n`) é o que permite reconhecê-los sem guardar uma lista à
 * parte: item com o prefixo desta sessão nasceu nela. O que veio de sessões anteriores já tem
 * linha no banco e não precisa ser inserido de novo.
 */
function acquiredBy(character: CharacterRuntime, sessionId: string): BoxedItem[] {
  const prefix = `${sessionId}:`;
  return character.inventory.backpack.filter((item) => item.instanceId.startsWith(prefix));
}

/** O layout de equipamento como o extrato o leva: `slot → instanceId`. */
function equipmentOf(character: CharacterRuntime): Record<string, string> {
  const equipped: Record<string, string> = {};
  for (const [slot, item] of Object.entries(character.inventory.getState().equipped)) {
    if (item !== undefined) equipped[slot] = item.instanceId;
  }
  return equipped;
}

/** Ver `createBotConfigValidator` em `sessions.ts`. */
export type BotConfigDecision =
  | { readonly ok: true; readonly config: BotConfig }
  | { readonly ok: false; readonly reason: string };

interface HostedSession {
  readonly session: Session;
  readonly viewers: Set<Viewer>;
  /**
   * Quando esta sessão foi avançada pela última vez, no relógio monotônico DESTE processo.
   *
   * O relógio do processo mora aqui desde a FUN-68, e não mais dentro da `Session`: lá dentro
   * o tempo é lógico, começa em zero e é da sessão. É o que aposentou o `rebaseClock` — uma
   * sessão retomada de snapshot nasce com esta marca no agora do processo novo, então o
   * primeiro avanço dela é de milissegundos, e o intervalo em que o nó esteve fora nunca
   * chega a ser oferecido à simulação (ADR 0018).
   */
  lastAdvancedAtMs: number;
  /**
   * O extrato desta sessão já virou crédito? A drenagem grava e DEPOIS solta, e sem esta
   * marca o `release` gravaria de novo com um `seq` novo — que a chave única do ledger não
   * teria como recusar, e o jogador receberia o mesmo gold duas vezes.
   */
  credited: boolean;
  /**
   * Quantos itens esta sessão já entregou, na última vez que o inventário foi mandado.
   *
   * É o gatilho barato para reenviar a mochila durante a hunt (FUN-90): comparar um inteiro por
   * ciclo custa nada, e serializar o inventário a 10 Hz para quem está olhando custaria muito.
   */
  sentItemsLooted: number;
  /**
   * `characterId` (UUID) → id numérico de criatura na instância.
   *
   * O protocolo numera criatura com `number` porque isso vai no caminho quente: um id de 4
   * bytes por `creature-move`, dezenas de vezes por segundo, contra 36 de um UUID. A tradução
   * é do servidor — o `sim` não conhece protocolo, e o cliente não pode inventar número.
   */
  readonly creatureIds: Map<string, number>;
  /**
   * O próximo id numérico a distribuir. MONOTÔNICO, nunca `size + 1` (FUN-103).
   *
   * `size + 1` recicla depois de um `delete`: com {a:1, b:2, c:3}, remover b faz o próximo
   * receber 3 — e c já é 3. Com personagem isso é raro; com monstro morrendo e renascendo
   * é rotina, e o cliente passa a desenhar o morto no lugar do vivo.
   */
  nextCreatureId: number;
  /**
   * Quem enxerga quem, por célula (FUN-33). `null` na sessão privada.
   *
   * Só o SHARD precisa: numa hunt de um personagem, "todos os visualizadores" já são os dele, e
   * manter índice de célula ali seria custo puro no caminho quente das 5.000 instâncias.
   */
  readonly aoi: AreaOfInterest | null;
}

/** `created` diz se ESTA chamada trouxe a sessão à existência — ver `prepare`. */
export interface PrepareResult {
  readonly created: boolean;
}

/**
 * Teto de taxa do laço: 10 Hz. Uma sessão pode pedir menos — a política por tipo e por
 * presença de visualizador é do próprio ruleset (ADR 0003) e é lida a cada ciclo.
 */
const CYCLE_MS = 100;
/** Um terço do lease do diretório, pela mesma razão do batimento. */
const RENEW_INTERVAL_MS = 10_000;
/**
 * Cada quanto a sessão é gravada.
 *
 * É exatamente o que se perde numa queda: dez segundos de XP. Aceitável para progresso,
 * INACEITÁVEL para transação econômica — por isso o ledger é escrito à parte (invariante 10),
 * e não depende deste intervalo.
 */
const SNAPSHOT_INTERVAL_MS = 10_000;

/**
 * Quanto tempo uma sessão de REPOUSO fica de pé sem ninguém olhando (FUN-52).
 *
 * Cinco minutos é escolhido pelos dois lados do erro. Curto demais e recarregar a página vira
 * sessão nova a cada vez; longo demais e quem fechou o navegador segura um dos dois slots da
 * conta por horas — que era o defeito.
 *
 * Não vale para hunt: uma sessão que rende nunca é recolhida por ausência (ADR 0001).
 */
const RESTING_GRACE_MS = 5 * 60_000;

const DIRECTION_DX = { north: 0, east: 1, south: 0, west: -1 } as const;
const DIRECTION_DY = { north: -1, east: 0, south: 1, west: 0 } as const;

/** Intervalo mínimo entre dois avisos de atraso. Ver `#warnLag`. */
const LAG_WARNING_INTERVAL_MS = 60_000;

export class SessionHost {
  readonly #options: SessionHostOptions;
  readonly #logger: Logger;

  /** Por sessão. O índice por personagem existe porque uma sessão terá vários (guild war). */
  readonly #sessions = new Map<string, HostedSession>();
  readonly #sessionIdByCharacter = new Map<string, string>();
  readonly #accountIdByCharacter = new Map<string, string>();
  /** Nome de exibição, do ticket. Só o chat lê; o `sim` não conhece nome (FUN-58). */
  readonly #nameByCharacter = new Map<string, string>();
  /**
   * A configuração do bot vigente, por personagem (FUN-81).
   *
   * Nasce do ticket e é substituída pela mensagem `bot-config`. Vive aqui, e não no
   * `CharacterRuntime`, porque ela ACOMPANHA o personagem entre sessões: ele configura na
   * Cidade e entra na hunt, e é o host que constrói a hunt. Guardá-la no runtime a poria no
   * snapshot duas vezes — o do personagem e o do ruleset.
   */
  readonly #botByCharacter = new Map<string, BotConfig>();
  readonly #preparations = new Map<string, Promise<void>>();
  /** Transições em voo, por personagem. Ver `transition`. */
  readonly #transitions = new Map<string, Promise<void>>();
  #lastLagWarningMs = Number.NEGATIVE_INFINITY;
  /** Quanto tempo a retomada pulou, esperando o primeiro visualizador para ser contado. */
  readonly #resumedGapMs = new Map<string, number>();
  /**
   * `characterId` → desde quando ninguém olha para ELE, no relógio monotônico. `null` = tem
   * visualizador.
   *
   * Por PERSONAGEM, e não por sessão, desde a FUN-71: num shard, o jogador que fecha o
   * navegador não pode recolher a praça em que os outros estão. Numa sessão privada os dois
   * jeitos dão o mesmo número, porque lá o único personagem é o dono de todos os
   * visualizadores.
   *
   * Só importa para sessão de REPOUSO — a orientada a evento. Uma hunt desanexada nunca é
   * recolhida por isto, e é o ADR 0001 em uma linha.
   */
  readonly #restingSince = new Map<string, number | null>();

  #cycleTimer: NodeJS.Timeout | null = null;
  #renewTimer: NodeJS.Timeout | null = null;
  #snapshotTimer: NodeJS.Timeout | null = null;

  constructor(options: SessionHostOptions) {
    this.#options = options;
    this.#logger = options.logger;
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  get viewerCount(): number {
    let total = 0;
    for (const hosted of this.#sessions.values()) total += hosted.viewers.size;
    return total;
  }

  sessionFor(characterId: string): Session | undefined {
    const sessionId = this.#sessionIdByCharacter.get(characterId);
    return sessionId === undefined ? undefined : this.#sessions.get(sessionId)?.session;
  }

  /**
   * Quem enxerga este personagem no campo de visão (FUN-33). Vazio na sessão privada, que não
   * tem AOI — lá "quem enxerga" é a pergunta errada, porque só há um personagem.
   *
   * Existe para MEDIR: `pnpm bench:city` conta vizinhos com isto, e é esse número que decide se
   * a AOI cortou o que veio cortar. Ler daqui é ler a estrutura de verdade, não uma reprodução
   * dela no medidor — que passaria a poder concordar com um defeito.
   */
  interestOf(characterId: string): readonly string[] {
    const hosted = this.#hostedSession(characterId);
    return hosted?.aoi?.visibleTo(characterId) ?? [];
  }

  viewersOf(characterId: string): number {
    const sessionId = this.#sessionIdByCharacter.get(characterId);
    return sessionId === undefined ? 0 : (this.#sessions.get(sessionId)?.viewers.size ?? 0);
  }

  /**
   * Cria e registra a sessão antes de o handshake aceitar o socket. Chamadas simultâneas
   * compartilham a mesma promessa, portanto nunca criam duas sessões locais do personagem.
   */
  async prepare(
    characterId: string,
    initialCharacter?: InitialCharacter,
    accountId?: string,
  ): Promise<PrepareResult> {
    const startedAt = performance.now();
    try {
      return await this.#prepare(characterId, initialCharacter, accountId);
    } finally {
      // O que o jogador espera ao reconectar: resolver o diretório, carregar o snapshot e
      // hospedar. É o número que o teste de carga cobra, e ele NÃO inclui o tempo de rede —
      // essa metade é do cliente, e medir as duas juntas aqui esconderia qual delas piorou.
      this.#options.metrics?.observeReattach(performance.now() - startedAt);
    }
  }

  async #prepare(
    characterId: string,
    initialCharacter?: InitialCharacter,
    accountId?: string,
  ): Promise<PrepareResult> {
    const existing = this.sessionFor(characterId);
    if (existing !== undefined) {
      await this.#register(characterId, existing, accountId);
      return { created: false };
    }

    const pending = this.#preparations.get(characterId);
    if (pending !== undefined) {
      await pending;
      // Quem esperou a preparação de outro NÃO criou nada: soltar seria derrubar a sessão
      // que o outro handshake está prestes a usar.
      return { created: false };
    }

    const preparation = this.#createAndRegister(characterId, initialCharacter, accountId);
    this.#preparations.set(characterId, preparation);
    try {
      await preparation;
    } finally {
      if (this.#preparations.get(characterId) === preparation) {
        this.#preparations.delete(characterId);
      }
    }
    return { created: true };
  }

  /** Liga um socket a uma sessão já preparada. */
  attach(socket: ViewerSocket, characterId: string): Viewer {
    let hosted = this.#hostedSession(characterId);
    // Mantém o host sem diretório útil em testes e em consumidores locais. Em produção,
    // `prepare` é obrigatório porque o registro precisa terminar antes do upgrade.
    if (hosted === undefined && this.#options.directory === undefined) {
      this.#createLocal(characterId, this.#options.createSession(characterId));
      hosted = this.#hostedSession(characterId);
    }
    if (hosted === undefined) throw new Error(`session for ${characterId} was not prepared`);
    const metrics = this.#options.metrics;
    const viewer = new Viewer(socket, characterId, {
      ...this.#options.viewer,
      ...(metrics === undefined
        ? {}
        : { onFrame: (messages, bytes) => { metrics.observeFrame(messages, bytes); } }),
    });
    hosted.viewers.add(viewer);
    hosted.session.attach(viewer.id);
    this.#restingSince.set(characterId, null);

    viewer.sendNow({
      type: 'welcome',
      characterId,
      contentVersion: this.#options.contentVersion,
    });

    // O catálogo vem logo depois do `welcome`, e uma vez só: a versão de conteúdo é fixada na
    // sessão (invariante 7), então ele não muda enquanto ela vive. Mensagem própria, e não um
    // campo do `welcome`, porque são assuntos diferentes — quem sou eu, e o que existe para
    // jogar. Vai pela FILA, não por `sendNow`: não é resposta a nada, e furar a fila o poria
    // na frente de deltas que já esperavam.
    const catalogue = this.#options.catalogue;
    if (catalogue !== undefined) viewer.send({ type: 'catalogue', ...catalogue() });

    // E o que ele carrega agora (FUN-90). Sem isto a mochila abre vazia até o primeiro
    // equipar — e uma mochila que mente sobre estar vazia é pior que uma que diz "carregando".
    this.#sendInventory(characterId);

    // O jogador precisa SABER que houve retomada e o que se perdeu. Silenciar aqui é como o
    // modo idle perde a confiança de quem joga: o extrato não fecha e ninguém explica.
    const gapMs = this.#resumedGapMs.get(characterId);
    if (gapMs !== undefined) {
      this.#resumedGapMs.delete(characterId);
      const minutes = Math.round(gapMs / 60_000);
      viewer.send({
        type: 'system-message',
        level: 'warning',
        text: minutes > 0
          ? `Sessão retomada após queda do servidor. Cerca de ${minutes} min de progresso `
            + 'não foram simulados.'
          : 'Sessão retomada após queda do servidor, sem perda perceptível.',
      });
    }
    this.#logger.debug(
      { characterId, sessionId: hosted.session.id, viewers: hosted.viewers.size },
      'Viewer attached',
    );
    return viewer;
  }

  /**
   * Tira o visualizador da lista. NÃO encerra a sessão, não a pausa e não credita nada: a
   * sessão fica exatamente como estava, só que sem ninguém olhando.
   */
  detach(viewer: Viewer): void {
    const sessionId = this.#sessionIdByCharacter.get(viewer.characterId);
    const hosted = sessionId === undefined ? undefined : this.#sessions.get(sessionId);
    if (hosted === undefined) return;

    hosted.viewers.delete(viewer);
    hosted.session.detach(viewer.id);
    // Repouso é do PERSONAGEM: a outra aba dele ainda pode estar olhando, e num shard os
    // outros jogadores da praça certamente estão.
    if (this.#watchers(hosted, viewer.characterId) === 0) {
      this.#restingSince.set(viewer.characterId, this.#now());
    }
    this.#logger.debug(
      { characterId: viewer.characterId, sessionId, viewers: hosted.viewers.size },
      'Viewer detached',
    );
    // A sessão FICA, mesmo sem ninguém olhando — é o ADR 0001, e há teste de integração
    // exigindo que uma reconexão reencontre a MESMA sessão.
    //
    // O que muda com a FUN-52 é só a sessão de REPOUSO: a de cidade, orientada a evento, é
    // recolhida depois de um prazo de carência (ver `#collectResting`). Uma hunt desanexada
    // nunca é — ela é o modo padrão do jogo.
  }

  async #logout(characterId: string): Promise<void> {
    try {
      await this.release(characterId, 1000, 'logout');
    } catch (error) {
      this.#logger.error({ error, characterId }, 'Failed to log the character out');
    }
  }

  /**
   * Tira a sessão deste nó e devolve o slot da conta. Encerra antes de soltar, para o
   * ruleset ter a chance de creditar o que for dele.
   *
   * Fecha TODOS os visualizadores do personagem, não só quem pediu: sair do jogo é do
   * personagem, não da aba. Deixar a outra aba aberta olhando uma sessão que já não existe
   * seria uma tela que não atualiza mais e não diz por quê.
   */
  async release(characterId: string, closeCode?: number, closeReason?: string): Promise<void> {
    const hosted = this.#hostedSession(characterId);
    if (hosted === undefined) return;
    const accountId = this.#accountIdByCharacter.get(characterId);
    const shared = hosted.session.ruleset.shared === true;

    this.#dropViewers(hosted, characterId, closeCode, closeReason);

    if (shared) {
      // Num shard, sair é SAIR — não encerrar (FUN-71, ADR 0023). O jogador que fecha o jogo
      // na praça não pode levar a praça junto, e nada há a creditar: a Cidade não gera
      // progresso (§37).
      hosted.session.leave(characterId);
      this.#announceDeparture(hosted, characterId);
      // A cópia vazia deixa de ser hospedada. A próxima entrada cria outra, já na versão de
      // conteúdo do momento — ver `CityShard.admit`.
      if (hosted.session.participants.length === 0) this.#sessions.delete(hosted.session.id);
    } else {
      if (hosted.session.ended === null) hosted.session.end('manual-exit');
      // Creditar ANTES de soltar. Sem isto, sair do jogo dentro de uma hunt jogaria fora a XP
      // da sessão inteira: desde a FUN-54 o extrato é o único caminho até o banco, e logo
      // abaixo o snapshot — a outra cópia do progresso — é apagado.
      const receipt = hosted.session.receipt();
      if (receipt !== null) await this.#saveReceipt(characterId, hosted, receipt);
      this.#sessions.delete(hosted.session.id);
    }

    this.#sessionIdByCharacter.delete(characterId);
    this.#accountIdByCharacter.delete(characterId);
    this.#nameByCharacter.delete(characterId);
    this.#botByCharacter.delete(characterId);
    this.#restingSince.delete(characterId);

    // A sessão ACABOU: deixar o snapshot faria a próxima conexão ressuscitar uma sessão
    // encerrada, com os agregados de antes.
    await this.#options.snapshots?.remove(characterId).catch(() => undefined);

    const directory = this.#options.directory;
    if (directory === undefined) return;
    try {
      await directory.release(characterId);
      if (accountId !== undefined) await directory.releaseSlot(accountId, characterId);
    } catch (error) {
      // Falhar aqui deixa o slot preso até o lease expirar, que é ruim mas se resolve
      // sozinho. Silenciar seria pior: é a única pista de por que uma conta ficou sem slot.
      this.#logger.error({ error, characterId }, 'Failed to release session from the directory');
    }
    this.#logger.info({ characterId, sessionId: hosted.session.id }, 'Session released');
  }

  /** Ações do jogador são tratadas NA CHEGADA, não enfileiradas para o tick (ver AGENTS.md). */
  handle(viewer: Viewer, message: C2SMessage): void {
    switch (message.type) {
      case 'ping':
        // Fora da fila: `pong` que espera o ciclo mede a fila, não a rede.
        viewer.sendNow({ type: 'pong', t: message.t });
        return;
      case 'session-attach': {
        const hosted = this.#hostedSession(viewer.characterId);
        if (hosted === undefined) return;
        // ENFILEIRADO, nunca `sendNow`. A troca de "estado completo" para "só deltas" precisa
        // ser atômica: mandar o estado na frente da fila o colocaria DEPOIS de deltas que já
        // estavam esperando, e o cliente aplicaria um passo antigo por cima do estado atual.
        // A própria fila é a atomicidade — basta não furá-la.
        viewer.send(this.#sessionState(hosted, viewer.characterId));
        return;
      }
      case 'enter-hunt':
        // INTENÇÃO, nunca resultado (invariante 4): o cliente diz qual hunt e qual
        // dificuldade, e quem decide se cabe, cria a instância e credita é o servidor.
        void this.#requestTransition(viewer, {
          to: 'hunt', huntId: message.huntId, difficulty: message.difficulty,
          // A hunt nasce compilada com a configuração que o servidor aceitou — do ticket ou
          // da última `bot-config` desta conexão.
          ...(this.#botByCharacter.has(viewer.characterId)
            ? { botConfig: this.#botByCharacter.get(viewer.characterId) as BotConfig }
            : {}),
        });
        return;
      case 'leave-hunt':
        // Sair é voltar para a cidade, não ficar sem sessão: todo personagem está em
        // exatamente uma (invariante 8).
        void this.#requestTransition(viewer, { to: 'city' });
        return;
      case 'logout':
        // Sair do jogo ENCERRA a sessão e devolve o slot; fechar o socket não.
        //
        // A distinção é a que o ADR 0001 faz: desconectar não é sair. Uma hunt precisa
        // sobreviver ao navegador fechado, e é por isso que o `detach` não encerra nada. Mas
        // um `logout` explícito é o jogador dizendo que terminou — e enquanto ele não
        // encerrava nada, o slot de personagem ativo não tinha NENHUMA forma de voltar
        // (FUN-52): dois personagens que já tivessem conectado esgotavam o teto até o
        // processo reiniciar, e nem apagar o personagem funcionava.
        void this.#logout(viewer.characterId);
        return;
      case 'walk':
        // INTENÇÃO: direção, nunca posição resolvida (invariante 4). Processada NA CHEGADA,
        // não enfileirada para o próximo evento — enfileirar põe até 100 ms de jitter em cima
        // do ping, irrelevante na hunt e inaceitável no PvP manual da F5.
        this.#requestWalk(viewer, message.direction);
        return;
      case 'walk-to':
        this.#requestWalk(viewer, message.destination);
        return;
      case 'equip':
        // INTENÇÃO (invariante 4): o cliente diz QUAL item, e quem decide se ele cabe, se o
        // level basta e em que slot vai é o servidor.
        this.#requestEquip(viewer, message.instanceId);
        return;
      case 'unequip':
        this.#requestUnequip(viewer, message.slot);
        return;
      case 'bot-config':
        // INTENÇÃO (invariante 4): o jogador manda as REGRAS, e quem decide se elas valem —
        // vocabulário, slots, catálogo e gate de level — é o servidor.
        void this.#configureBot(viewer, message.config);
        return;
      case 'say':
        // Chat NÃO passa pelo `sim`: ele não muda resultado de simulação nenhuma, e pôr
        // texto de jogador dentro do motor puro só criaria estado para snapshotar sem
        // motivo. O host roteia direto para os visualizadores da sessão (FUN-58).
        this.#say(viewer, message.channel, message.text);
        return;
      case 'authenticate':
      case 'client-ready':
        // Vestigiais, e ignoradas de propósito. A autenticação é do handshake (FUN-12);
        // aceitar credencial pelo socket seria um SEGUNDO caminho de autenticação, que é
        // pior que nenhum. `client-ready` não tem consumidor: `welcome` sai no handshake e
        // `session-state` sai no `session-attach`.
        return;
    }
  }

  /**
   * `say` (FUN-58): o único canal é `local`, e o alcance é a SESSÃO inteira — quem está na
   * mesma instância recebe, o autor inclusive, e ninguém de fora. Raio em tiles é interest
   * management (FUN-33), e inventar um aqui seria decidir duas vezes.
   *
   * Toda recusa é silenciosa: um cliente com bug mandando em laço não pode gerar tráfego de
   * volta. Canal desconhecido é recusado no servidor, e não no schema — um canal que aceita
   * qualquer nome vira dez canais fantasma no primeiro cliente com bug.
   */
  #say(from: Viewer, channel: string, text: string): void {
    if (channel !== 'local') return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    // Controle de caracteres fora, como no nome de personagem (FUN-11). `\p{C}` pega
    // zero-width e bidi override, que é como se falsifica nome de autor na tela.
    if (/\p{C}/u.test(trimmed)) return;

    const hosted = this.#hostedSession(from.characterId);
    if (hosted === undefined) return;
    const author = this.#nameByCharacter.get(from.characterId) ?? from.characterId;
    const message = {
      type: 'chat-message', channel: 'local', author, text: trimmed,
    } as const;
    // ENFILEIRADO, no lote do ciclo — não `sendNow`. Chat não é `pong`: 100 ms de atraso é
    // invisível, e furar a fila põe a mensagem na frente de deltas que já esperavam.
    //
    // O alcance é o CAMPO DE VISÃO (FUN-33), e é o que `local` sempre quis dizer. Até aqui era
    // a sessão inteira, com o `docs/product/chat.md` registrando que o raio era desta issue —
    // e numa praça de duzentos "local" alcançando duzentos é o canal global com outro nome.
    if (hosted.aoi === null) {
      for (const viewer of hosted.viewers) viewer.send(message);
      return;
    }
    this.#sendToViewersOf(hosted, from.characterId, message);
    for (const other of hosted.aoi.visibleTo(from.characterId)) {
      this.#sendToViewersOf(hosted, other, message);
    }
  }

  /**
   * Um passo pedido pelo jogador (FUN-69): direção ou destino, resolvidos aqui em um tile e
   * entregues ao MESMO sistema de movimento que o bot e o monstro usam.
   *
   * Recusa é silenciosa de propósito: `walk` sai dezenas de vezes por segundo de um cliente
   * segurando a tecla, e responder cada recusa geraria tráfego de volta a partir de tráfego
   * de entrada. Morto não anda, e é decidido antes de chegar ao sistema.
   */
  #requestWalk(viewer: Viewer, target: 'north' | 'east' | 'south' | 'west' | GridPoint): void {
    const hosted = this.#hostedSession(viewer.characterId);
    if (hosted === undefined) return;
    const session = hosted.session;
    const ruleset = session.ruleset;
    if (ruleset.requestMove === undefined) return;
    const character = session.participants.find((p) => p.id === viewer.characterId);
    if (character === undefined || !character.alive) return;

    const from = character.position;
    const to = typeof target === 'string'
      ? { x: from.x + DIRECTION_DX[target], y: from.y + DIRECTION_DY[target] }
      : { x: target.x, y: target.y };

    const result = ruleset.requestMove(session, viewer.characterId, to);
    if (!result.ok) return;
    // A Cidade não tem ciclo (`hz` 0): o evento precisa virar pacote agora, senão ele fica
    // no buffer da sessão até alguém drenar — e ninguém drena o que não tica.
    this.#presentMoves(hosted);
  }

  /**
   * Executa a transição pedida pelo jogador e conta o que aconteceu.
   *
   * A recusa vira MENSAGEM, e é o produto: "você não pode fazer isso" é o texto que faz
   * alguém achar que o jogo travou. Cada recusa diz o que fazer em seguida.
   */
  /**
   * Vestir um item (§21.4, FUN-82). Processado NA CHEGADA, como o passo — o jogador clicou.
   *
   * Quem valida é o `sim`: level, vocação, slot e capacidade são regra de jogo, e regra de jogo
   * não mora no host. O host traduz a recusa em mensagem, e é só isso que ele faz.
   */
  #requestEquip(viewer: Viewer, instanceId: string): void {
    const character = this.#ownerOf(viewer.characterId);
    if (character === undefined) return;
    this.#answerInventory(
      viewer,
      character.inventory.equip(instanceId, character, this.#options.itemCatalog ?? EMPTY_ITEMS),
    );
  }

  #requestUnequip(viewer: Viewer, slot: string): void {
    const character = this.#ownerOf(viewer.characterId);
    if (character === undefined) return;
    // O slot chega como string do cliente e é conferido pelo CONTEÚDO, como a dificuldade de
    // hunt: repetir a lista no protocolo criaria um segundo lugar para ela divergir.
    if (!(ITEM_SLOTS as readonly string[]).includes(slot)) {
      viewer.send({ type: 'system-message', level: 'warning', text: 'Esse lugar não existe.' });
      return;
    }
    this.#answerInventory(viewer, character.inventory.unequip(slot as ItemSlot));
  }

  #ownerOf(characterId: string): CharacterRuntime | undefined {
    return this.#hostedSession(characterId)?.session.participants
      .find((p) => p.id === characterId);
  }

  /**
   * Traduz a recusa do `sim` em algo que o jogador entenda, ou manda o inventário novo.
   *
   * O sucesso NÃO vira mensagem de sistema — vira o estado. "Equipado com sucesso" é ruído; o
   * item mudando de lugar na tela é a confirmação.
   */
  #answerInventory(viewer: Viewer, result: InventoryResult): void {
    if (!result.ok) {
      viewer.send({
        type: 'system-message', level: 'warning',
        text: INVENTORY_REFUSAL[result.reason] as string,
      });
      return;
    }
    this.#sendInventory(viewer.characterId);
  }

  /**
   * O que o personagem carrega e veste, para quem estiver olhando ELE (FUN-90).
   *
   * **O peso é calculado aqui**, e não no cliente: quem sabe o que cabe é quem recusa, e a
   * mesma conta em dois lugares diverge no primeiro item com peso fracionário.
   */
  #sendInventory(characterId: string): void {
    const hosted = this.#hostedSession(characterId);
    const character = this.#ownerOf(characterId);
    if (hosted === undefined || character === undefined) return;

    const catalog = this.#options.itemCatalog ?? EMPTY_ITEMS;
    const state = character.inventory.getState();
    const equipped: Record<string, string> = {};
    for (const [slot, item] of Object.entries(state.equipped)) {
      if (item !== undefined) equipped[slot] = item.instanceId;
    }

    this.#sendToViewersOf(hosted, characterId, {
      type: 'inventory',
      backpack: state.backpack.map((item) => ({
        instanceId: item.instanceId, itemId: item.itemId, quantity: item.quantity,
      })),
      equipped,
      capacity: { used: character.inventory.weight(catalog), total: character.capacity },
    });
  }

  /**
   * O jogador salvou uma configuração de bot (FUN-81, §13).
   *
   * A ordem importa e é: aceitar → aplicar → persistir. Aplicar antes de gravar é deliberado —
   * a hunt em curso passa a usar a regra nova na hora, e uma falha do Postgres não pode fazer
   * o jogador ficar sem a cura que acabou de configurar. O preço é uma configuração que vale
   * nesta sessão e não volta na próxima, e esse é o lado certo para errar.
   */
  async #configureBot(viewer: Viewer, raw: unknown): Promise<void> {
    const accept = this.#options.acceptBotConfig;
    if (accept === undefined) {
      viewer.send({
        type: 'bot-config-result', ok: false,
        reason: 'Este servidor não aceita configuração de bot.',
      });
      return;
    }

    const hosted = this.#hostedSession(viewer.characterId);
    const character = hosted?.session.participants
      .find((p) => p.id === viewer.characterId);
    if (hosted === undefined || character === undefined) return;

    const decision = accept(raw, character.level);
    if (!decision.ok) {
      viewer.send({ type: 'bot-config-result', ok: false, reason: decision.reason });
      return;
    }

    this.#botByCharacter.set(viewer.characterId, decision.config);
    this.#applyBotConfig(hosted, decision.config);
    viewer.send({ type: 'bot-config-result', ok: true });

    // Persistir é o último passo, e falhar nele não desfaz o que já vale. O log é para quem
    // investiga "salvei e voltou o antigo"; o jogador não pode fazer nada com esse erro.
    try {
      await this.#options.saveBotConfig?.(viewer.characterId, decision.config);
    } catch (error) {
      this.#logger.error(
        { error, characterId: viewer.characterId }, 'Failed to persist bot configuration',
      );
    }
  }

  /**
   * A configuração que veio no ticket (FUN-81). Recusada é IGNORADA, nunca fatal.
   *
   * O caso real é conteúdo mudando debaixo de uma configuração salva: uma magia renomeada, um
   * vocabulário novo. Derrubar a conexão por isso trancaria o personagem fora do jogo por um
   * arquivo de balanceamento — entrar sem bot e avisar é a degradação certa.
   */
  #adoptTicketBotConfig(
    characterId: string, session: Session, initial: InitialCharacter | undefined,
  ): void {
    const raw = initial?.botConfig;
    const accept = this.#options.acceptBotConfig;
    if (raw === undefined || accept === undefined) return;

    const level = session.participants.find((p) => p.id === characterId)?.level
      ?? initial?.level ?? 1;
    const decision = accept(raw, level);
    if (!decision.ok) {
      this.#logger.warn(
        { characterId, reason: decision.reason }, 'Stored bot configuration refused',
      );
      return;
    }
    this.#botByCharacter.set(characterId, decision.config);
  }

  /** Troca a configuração da hunt em curso. Ruleset que não tem bot ignora, e é o normal. */
  #applyBotConfig(hosted: HostedSession, config: BotConfig): void {
    const ruleset = hosted.session.ruleset as Partial<HuntRuleset>;
    // A sessão dona é quem escreve (invariante 9), e é ela que está aqui: `configureBot`
    // recompila dentro do ruleset, não de fora.
    ruleset.configureBot?.(hosted.session, config);
  }

  async #requestTransition(viewer: Viewer, request: TransitionRequest): Promise<void> {
    try {
      await this.transition(viewer.characterId, request);
    } catch (error) {
      if (error instanceof TransitionError) {
        viewer.send({
          type: 'system-message', level: 'warning', text: REFUSAL_TEXT[error.refusal],
        });
        return;
      }
      // Falha inesperada: o personagem continua onde estava, que é o estado seguro.
      this.#logger.error(
        { error, characterId: viewer.characterId, to: request.to },
        'Transition failed',
      );
      viewer.send({
        type: 'system-message', level: 'error', text: 'Não foi possível mudar de atividade.',
      });
    }
  }

  /**
   * Um ciclo: avança quem tem tick a dever e manda um frame por visualizador.
   *
   * A taxa é perguntada ao ruleset A CADA ciclo porque ela muda com a presença de
   * visualizador — anexar acelera, desanexar desacelera, e nada disso altera o resultado
   * (invariante 2).
   */
  cycle(nowMs: number = this.#now()): void {
    for (const hosted of [...this.#sessions.values()]) {
      const hz = hosted.session.currentHz();
      // `0` é orientada a evento: cidade e treino não têm laço nenhum.
      if (hz <= 0) {
        this.#collectResting(hosted, nowMs);
        continue;
      }
      if (hosted.session.ended !== null) continue;
      const periodMs = 1000 / hz;
      // Contra a marca DESTE processo, e não contra o relógio da sessão: desde a FUN-68 o
      // tempo lá dentro é lógico, começa em zero, e comparar os dois compararia grandezas
      // diferentes — uma hunt com dez minutos de relógio lógico pareceria dez minutos
      // atrasada no primeiro ciclo depois de retomada.
      const overdueMs = nowMs - hosted.lastAdvancedAtMs;
      if (overdueMs < periodMs) continue;
      hosted.lastAdvancedAtMs = nowMs;
      const startedAt = this.#options.metrics === undefined ? 0 : performance.now();
      try {
        hosted.session.advanceBy(overdueMs);
      } catch (error) {
        // Uma sessão que explode não pode derrubar as outras do nó.
        this.#logger.error({ error, sessionId: hosted.session.id }, 'Session tick failed');
      }
      // O ATRASO é quanto o tick passou do período que ele mesmo pediu, não o intervalo. Um
      // tick de 1 Hz que roda a cada 1000 ms está no prazo; o mesmo intervalo num tick de
      // 10 Hz é 900 ms de atraso, e é essa diferença que diz que o nó saturou.
      const lagMs = Math.max(0, overdueMs - periodMs);
      this.#options.metrics?.observeTick(
        hosted.session.ruleset.type,
        (performance.now() - startedAt) * 1000,
        lagMs,
      );
      // O alerta que a issue pede, no único lugar onde este nó consegue falar hoje. Um pico
      // isolado não acorda ninguém — só o primeiro de uma rajada, para o log não virar a
      // própria causa do atraso quando o nó satura de verdade.
      if (lagMs > TICK_LAG_BUDGET_MS) this.#warnLag(hosted.session.ruleset.type, lagMs, nowMs);
      // A sessão pode ter acabado DENTRO do tick — a morte é o caso (§26.1), e ela acontece
      // com o jogador ausente na maior parte das vezes. Se a sucessão dependesse de alguém
      // estar olhando, o invariante 3 estaria quebrado.
      // O mundo que aconteceu neste avanço vira pacote AQUI, e não dentro do `sim` — que não
      // conhece socket nem numeração de criatura do fio (invariante 1, §12).
      this.#presentMoves(hosted);
      // Caiu loot desde o último ciclo: a mochila mudou, e quem está olhando precisa ver.
      // Comparar um inteiro é o que evita serializar o inventário dez vezes por segundo.
      if (hosted.session.aggregates.itemsLooted !== hosted.sentItemsLooted) {
        hosted.sentItemsLooted = hosted.session.aggregates.itemsLooted;
        for (const characterId of this.#charactersOf(hosted.session.id)) {
          this.#sendInventory(characterId);
        }
      }
      if (hosted.session.ended !== null) void this.#succeed(hosted);
    }
    this.flush();
    this.#observeSessions();
  }

  /**
   * Traduz os eventos de domínio do avanço em `creature-move` para quem está olhando.
   *
   * É o `PresentationAdapter` do §12: o `sim` produz `CreatureMoved` haja ou não visualizador,
   * e é aqui que se decide se aquilo vira bytes. A hunt desanexada — o modo padrão do jogo —
   * produz exatamente os mesmos eventos e não serializa nenhum.
   *
   * **Drena SEMPRE**, inclusive sem visualizador. O buffer é da sessão, e uma hunt que ninguém
   * olha não pode acumular apresentação por horas; a `Session` tem teto próprio, mas depender
   * dele seria deixar o descarte acontecer no lugar errado.
   */
  #presentMoves(hosted: HostedSession): void {
    const events = hosted.session.drainEvents();
    if (events.length === 0 || hosted.viewers.size === 0) return;

    for (const event of events) {
      // Discriminar por `kind` ANTES de tocar em qualquer campo: a união cresceu na FUN-103, e
      // um cast em vez de um switch aqui leria um nascimento como se fosse um passo.
      if (event.kind !== 'creature-moved') {
        this.#presentPresence(hosted, event);
        continue;
      }
      // O protocolo exige duração positiva: um passo é enviado UMA vez, com origem, destino e
      // duração, e o cliente interpola o intervalo inteiro (ADR 0001). Duração zero é
      // colocação, não passo — aparecer no mundo é `creature-appear`.
      if (event.durationMs <= 0) continue;
      const subject = String(event.creatureId);
      const message = {
        type: 'creature-move',
        id: this.#creatureId(hosted, subject),
        from: event.from,
        to: event.to,
        durationMs: event.durationMs,
      } as const;

      const aoi = hosted.aoi;
      if (aoi === null) {
        // Sessão privada: os visualizadores já são todos do mesmo personagem.
        for (const viewer of hosted.viewers) viewer.send(message);
        continue;
      }

      // No shard, o passo vai para quem TEM ele no campo (FUN-33) — não para a praça. É esta
      // linha que troca O(N²) por O(vizinhos), e vizinhos não crescem com a população: o mapa
      // é o mesmo, e tile é exclusivo.
      const change = aoi.move(subject, event.to);
      this.#applyVisibility(hosted, subject, change);
      this.#sendToViewersOf(hosted, subject, message);
      for (const other of aoi.visibleTo(subject)) {
        // Quem ACABOU de vê-lo já recebeu `creature-appear`, com a posição de chegada. Mandar
        // o passo também faria o cliente animar uma caminhada a partir de um tile em que a
        // criatura nunca esteve, para ele.
        if (change.appeared.includes(other)) continue;
        this.#sendToViewersOf(hosted, other, message);
      }
    }
  }

  /**
   * Nascimento, sumiço e vida de MONSTRO viram `creature-appear`, `creature-disappear` e
   * `creature-health` (FUN-103).
   *
   * Vai para TODOS os visualizadores da sessão, e não pelo campo de visão: monstro só existe em
   * hunt, e hunt é privada — `hosted.aoi` é `null` ali, e "todos" já é a resposta certa. Se um
   * dia um monstro viver num shard, é `#applyVisibility` que precisa aprender a lidar com
   * criatura sem visualizador, e não este método que precisa de um `if`.
   *
   * O `sim` manda só o `monsterId`; nome e `outfitId` saem do catálogo fixado na sessão. Sem
   * catálogo o monstro ainda aparece — sem nome, outfit 0 —, porque sumir com ele esconderia
   * de quem olha que a simulação está de pé.
   */
  #presentPresence(hosted: HostedSession, event: PresenceEvent): void {
    const key = String(event.creatureId);
    let message: S2CMessage;
    if (event.kind === 'creature-appeared') {
      const definition = this.#options.monsterCatalog?.get(event.monsterId);
      message = {
        type: 'creature-appear',
        id: this.#creatureId(hosted, key),
        position: event.position,
        appearanceId: definition?.outfitId ?? 0,
        name: definition?.name ?? event.monsterId,
        health: event.health,
        maxHealth: event.maxHealth,
      };
    } else if (event.kind === 'creature-vanished') {
      const id = hosted.creatureIds.get(key);
      // Nunca anunciado — morreu antes de alguém olhar. Não há o que retirar da tela.
      if (id === undefined) return;
      message = { type: 'creature-disappear', id };
      // O número NÃO é reaproveitado (ver `nextCreatureId`); só a chave sai do mapa, senão
      // ele cresce um item por respawn até o fim da hunt.
      hosted.creatureIds.delete(key);
    } else {
      const id = hosted.creatureIds.get(key);
      if (id === undefined) return;
      message = { type: 'creature-health', id, health: event.health, maxHealth: event.maxHealth };
    }
    for (const viewer of hosted.viewers) viewer.send(message);
  }

  /** Esta sessão tem campo de visão por célula? Só shard, e só com a opção ligada (FUN-33). */
  #interestManaged(session: Session): boolean {
    return session.ruleset.shared === true && this.#options.areaOfInterest !== false;
  }

  /** Manda para todos os visualizadores de UM personagem. Abas contam separado. */
  #sendToViewersOf(hosted: HostedSession, characterId: string, message: S2CMessage): void {
    for (const viewer of hosted.viewers) {
      if (viewer.characterId === characterId) viewer.send(message);
    }
  }

  /**
   * Traduz uma mudança de campo de visão em `creature-appear` e `creature-disappear` (FUN-33).
   *
   * **Os dois lados**, porque a visibilidade é simétrica: quem apareceu para mim é exatamente
   * quem eu passei a enxergar. Mandar só um lado deixa um dos dois com um fantasma na tela —
   * um boneco parado que não corresponde a ninguém — ou com um vizinho invisível.
   */
  #applyVisibility(
    hosted: HostedSession,
    subject: string,
    change: { readonly appeared: readonly string[]; readonly vanished: readonly string[] },
  ): void {
    for (const other of change.appeared) {
      this.#sendToViewersOf(hosted, other, this.#appearance(hosted, subject));
      this.#sendToViewersOf(hosted, subject, this.#appearance(hosted, other));
    }
    for (const other of change.vanished) {
      // O id numérico NÃO é reciclado aqui: sumir de vista não é sair da sessão, e um id novo
      // no reaparecimento deixaria o sprite antigo parado para sempre na tela do cliente.
      const gone = hosted.creatureIds.get(subject);
      const theirs = hosted.creatureIds.get(other);
      if (gone !== undefined) {
        this.#sendToViewersOf(hosted, other, { type: 'creature-disappear', id: gone });
      }
      if (theirs !== undefined) {
        this.#sendToViewersOf(hosted, subject, { type: 'creature-disappear', id: theirs });
      }
    }
  }

  /** O `creature-appear` de um personagem, como quem está por perto precisa vê-lo. */
  #appearance(hosted: HostedSession, characterId: string): S2CMessage {
    const character = hosted.session.participants.find((p) => p.id === characterId);
    return {
      type: 'creature-appear',
      id: this.#creatureId(hosted, characterId),
      position: character?.position ?? { x: 0, y: 0, z: 0 },
      appearanceId: this.#options.playerOutfitId ?? 0,
      name: this.#nameByCharacter.get(characterId) ?? characterId,
      health: character?.health ?? 0,
      maxHealth: character?.maxHealth ?? 0,
    };
  }

  /**
   * Um aviso por minuto, no máximo. Um nó saturado atrasa TODAS as sessões ao mesmo tempo, e
   * uma linha de log por sessão por ciclo transformaria o sintoma em causa.
   */
  #warnLag(type: SessionType, lagMs: number, nowMs: number): void {
    if (nowMs - this.#lastLagWarningMs < LAG_WARNING_INTERVAL_MS) return;
    this.#lastLagWarningMs = nowMs;
    this.#logger.warn(
      { type, lagMs: Math.round(lagMs), budgetMs: TICK_LAG_BUDGET_MS },
      'Tick ran past its budget; the node is saturating',
    );
  }

  /**
   * Recontagem por ciclo, não por sessão: um contador incremental espalhado por `attach`,
   * `detach`, `release` e `#replace` erra na primeira aresta que alguém esquecer, e erra
   * DEVAGAR — o painel vai ficando errado sem nada quebrar.
   */
  #observeSessions(): void {
    const metrics = this.#options.metrics;
    if (metrics === undefined) return;

    const counts = new Map<string, number>();
    for (const hosted of this.#sessions.values()) {
      const key = `${hosted.session.ruleset.type}|${hosted.viewers.size > 0}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    metrics.observeSessions(counts);

    const perAccount = new Map<string, number>();
    for (const accountId of this.#accountIdByCharacter.values()) {
      perAccount.set(accountId, (perAccount.get(accountId) ?? 0) + 1);
    }
    metrics.observeSlots(perAccount.size === 0 ? 0 : Math.max(...perAccount.values()));
  }

  /**
   * A sessão acabou sozinha: credita, avisa, e põe o personagem na próxima (FUN-38).
   *
   * A ORDEM é o assunto todo, e cada troca tem uma consequência:
   *
   *   1. o extrato é gravado ANTES de qualquer aviso — morrer e o processo cair em seguida
   *      deixa o crédito no Redis esperando o `jobs`, que é a metade certa de perder;
   *   2. o `session-ended` sai antes do estado novo, senão o jogador vê a Cidade aparecer e
   *      só depois descobre que morreu;
   *   3. a sessão nova é registrada no diretório ANTES de substituir a local — registrar
   *      depois deixaria o personagem apontando para uma sessão que este nó já esqueceu;
   *   4. a cura vem com a Cidade, e a Cidade vem DEPOIS do encerramento. Restaurar HP antes
   *      de encerrar gravaria no extrato uma sessão que "terminou com vida cheia", o que
   *      estraga a tela de retorno e o analisador.
   */
  async #succeed(hosted: HostedSession): Promise<void> {
    const characters = this.#charactersOf(hosted.session.id);
    const characterId = characters[0];
    if (characterId === undefined) return;
    if (characters.length > 1) {
      // Party divide uma sessão, e um extrato por personagem é decisão de produto que ainda
      // não foi tomada. Creditar o mesmo agregado N vezes seria pior que não creditar.
      this.#logger.error(
        { sessionId: hosted.session.id, characters: characters.length },
        'Cannot succeed a session shared by more than one character',
      );
      return;
    }
    const receipt = hosted.session.receipt();
    if (receipt === null) return;

    try {
      await this.#saveReceipt(characterId, hosted, receipt);
      for (const viewer of hosted.viewers) {
        viewer.send({
          type: 'session-ended',
          reason: receipt.reason,
          aggregates: receipt.aggregates,
          notableEvents: receipt.notableEvents.map((event) => ({ ...event })),
        });
      }

      // Toda sessão que acaba sozinha devolve o personagem à Cidade (§6): "a hunt acabou"
      // nunca pode significar "ficou sem sessão" (invariante 8).
      const next = this.#options.buildSession?.({ to: 'city' }, hosted.session, characterId)
        ?? null;
      if (next === null) {
        await this.release(characterId, 1000, receipt.reason);
        return;
      }
      await this.#replace(characterId, hosted, next);
    } catch (error) {
      // Falhar aqui deixa o personagem numa sessão encerrada, que o ciclo ignora — ruim, e
      // recuperável na próxima conexão. Soltar no meio de uma falha seria pior: sem saber em
      // que ponto parou, soltar pode significar perder o crédito que talvez tenha gravado.
      this.#logger.error(
        { error, characterId, sessionId: hosted.session.id },
        'Failed to move the character to the next session',
      );
    }
  }

  /**
   * Muda o personagem de atividade (FUN-30, §6).
   *
   * Lança `TransitionError` quando a transição não é válida — e a recusa é o produto, não um
   * detalhe: "você não pode fazer isso" é a mensagem que faz alguém achar que o jogo travou.
   *
   * A ORDEM é a que falha seguro. A troca no diretório é ATÔMICA (`succeed`), então não
   * existe o instante em que o personagem está em duas sessões nem o instante em que ele não
   * está em nenhuma — que é o requisito difícil desta issue, e a razão de não haver aqui um
   * "reservar depois liberar" em dois passos.
   */
  async transition(characterId: string, request: TransitionRequest): Promise<void> {
    const hosted = this.#hostedSession(characterId);
    if (hosted === undefined) throw new Error(`character ${characterId} has no session here`);

    const refusal = refuseTransition(hosted.session.ruleset.type, request.to);
    if (refusal !== null) throw refusal;

    // Duas transições disputadas: exatamente UMA vence, e a outra sabe que perdeu.
    //
    // Sem esta trava as duas leriam a mesma sessão de origem, e a segunda tentaria trocar um
    // registro de diretório que a primeira já trocou — a CAS recusaria, e o caminho de recusa
    // SOLTA o personagem. Perder a corrida derrubaria o jogador do jogo.
    if (this.#transitions.has(characterId)) {
      throw new TransitionError(
        'already-transitioning', `uma transição de ${characterId} já está em andamento`,
      );
    }

    const running = this.#runTransition(characterId, hosted, request);
    this.#transitions.set(characterId, running);
    try {
      await running;
    } finally {
      if (this.#transitions.get(characterId) === running) this.#transitions.delete(characterId);
    }
  }

  async #runTransition(
    characterId: string,
    hosted: HostedSession,
    request: TransitionRequest,
  ): Promise<void> {
    // Construir ANTES de encerrar: se o destino não existe — hunt que saiu do conteúdo,
    // dificuldade que a hunt não define — o personagem fica exatamente onde estava, em vez de
    // ficar sem sessão porque a antiga já tinha sido fechada.
    const next = this.#options.buildSession?.(request, hosted.session, characterId) ?? null;
    if (next === null) {
      throw new TransitionError(
        'unknown-destination', `este servidor não constrói uma sessão de "${request.to}"`,
      );
    }

    // Sair de um SHARD não encerra nada e não credita nada (FUN-71, ADR 0023): a praça fica
    // de pé com quem ficou, e a Cidade não gera progresso (§37). Encerrar aqui mandaria um
    // extrato de Cidade — zerado — para todo mundo que estivesse lá dentro.
    if (hosted.session.ruleset.shared !== true) {
      const receipt = hosted.session.ended === null
        ? hosted.session.end('manual-exit')
        : hosted.session.receipt();
      if (receipt !== null) {
        await this.#saveReceipt(characterId, hosted, receipt);
        for (const viewer of hosted.viewers) {
          if (viewer.characterId !== characterId) continue;
          viewer.send({
            type: 'session-ended',
            reason: receipt.reason,
            aggregates: receipt.aggregates,
            notableEvents: receipt.notableEvents.map((event) => ({ ...event })),
          });
        }
      }
    }
    await this.#replace(characterId, hosted, next);
  }

  /** Troca a sessão do personagem por outra, no diretório e aqui dentro. */
  async #replace(characterId: string, hosted: HostedSession, next: Session): Promise<void> {
    const accountId = this.#accountIdByCharacter.get(characterId);
    const directory = this.#options.directory;
    if (directory !== undefined && accountId !== undefined) {
      const moved = await directory.succeed(
        characterId,
        accountId,
        { sessionId: hosted.session.id, nodeId: this.#options.nodeId,
          type: hosted.session.ruleset.type },
        { sessionId: next.id, nodeId: this.#options.nodeId, type: next.ruleset.type },
      );
      // O registro não é mais nosso: outro nó assumiu, ou o lease expirou. Insistir seria
      // escrever por cima de um dono que já não somos.
      if (!moved) {
        this.#logger.warn({ characterId }, 'Directory entry changed hands; releasing instead');
        await this.release(characterId, 1000, 'session-moved');
        return;
      }
    }

    // Os visualizadores acompanham o PERSONAGEM, não a sessão. Fechar o socket porque a hunt
    // acabou faria quem estava assistindo levar uma desconexão em vez de ver a volta à cidade.
    //
    // Só os DELE: num shard os outros continuam na sessão anterior, e levá-los junto seria
    // arrastar a praça inteira para dentro da hunt de um jogador.
    const following = [...hosted.viewers].filter((v) => v.characterId === characterId);
    for (const viewer of following) {
      hosted.viewers.delete(viewer);
      hosted.session.detach(viewer.id);
    }

    // Sai da anterior. Num shard isso é `leave`; numa sessão privada ela já foi encerrada por
    // quem chamou, e some daqui inteira.
    if (hosted.session.ruleset.shared === true) {
      hosted.session.leave(characterId);
      this.#announceDeparture(hosted, characterId);
    }
    if (hosted.session.ruleset.shared !== true || hosted.session.participants.length === 0) {
      this.#sessions.delete(hosted.session.id);
    }

    // A próxima pode JÁ estar hospedada — voltar da hunt é chegar na praça em que os outros
    // estão (FUN-71). Montar um `HostedSession` novo aqui jogaria fora os visualizadores e os
    // ids de criatura de quem já estava lá.
    const existing = this.#sessions.get(next.id);
    const successor: HostedSession = existing ?? {
      session: next, viewers: new Set(), creatureIds: new Map(), nextCreatureId: 1,
      aoi: this.#interestManaged(next) ? new AreaOfInterest() : null,
      lastAdvancedAtMs: this.#now(),
      credited: false,
      sentItemsLooted: next.aggregates.itemsLooted,
    };
    this.#sessions.set(next.id, successor);
    this.#sessionIdByCharacter.set(characterId, next.id);
    this.#announceArrival(successor, characterId);

    for (const viewer of following) {
      successor.viewers.add(viewer);
      next.attach(viewer.id);
      viewer.send(this.#sessionState(successor, characterId));
    }
    this.#restingSince.set(characterId, following.length > 0 ? null : this.#now());

    // A morte é MARCO de snapshot (FUN-27). Perder a transição por estar entre dois
    // intervalos é o pior caso: o jogador volta vivo, na hunt, e a penalidade aparece do nada
    // um pouco depois.
    //
    // Shard não tem snapshot (ADR 0023): não há progresso a guardar, e o que ele guardaria
    // seria a praça inteira, uma cópia por participante. Mas o snapshot da sessão ANTERIOR
    // precisa sumir — ele é apagado, não simplesmente não reescrito.
    //
    // Não fazer as duas coisas é o defeito silencioso: quem morre volta para a praça, o
    // snapshot da hunt encerrada fica em pé no Redis, e a próxima conexão RETOMA a hunt que
    // já foi creditada. Antes desta issue o `save` da Cidade cobria essa linha por acidente.
    const snapshots = this.#options.snapshots;
    if (snapshots !== undefined && accountId !== undefined) {
      await (next.ruleset.shared === true
        ? snapshots.remove(characterId)
        : snapshots.save(characterId, accountId, this.#options.nodeId, next.snapshot()));
    }
    this.#logger.info(
      { characterId, from: hosted.session.id, to: next.id, type: next.ruleset.type },
      'Character moved to the next session',
    );
  }

  /** Quem está nesta sessão. Busca linear num mapa pequeno, e só quando uma sessão acaba. */
  #charactersOf(sessionId: string): string[] {
    const found: string[] = [];
    for (const [characterId, id] of this.#sessionIdByCharacter) {
      if (id === sessionId) found.push(characterId);
    }
    return found;
  }

  /**
   * Recolhe a sessão de REPOUSO que ninguém está olhando há tempo demais (FUN-52).
   *
   * O problema que isto resolve: quem fecha o navegador e não volta deixava a sessão de
   * cidade hospedada e renovada para sempre, segurando um dos dois slots da conta. O sintoma
   * aparecia longe da causa — o terceiro personagem não conectava, e o primeiro não podia ser
   * apagado. Reiniciar o nó "resolvia", o que escondia o problema em desenvolvimento e o
   * deixava aparecer só em produção, onde o processo fica de pé por dias.
   *
   * **Só a sessão orientada a evento é recolhida.** Uma hunt desanexada roda a 1 Hz e nunca
   * passa por aqui — desconectar não pode encerrar nada, ou a hunt AFK deixa de existir
   * (ADR 0001). É essa linha que separa "repouso" de "progresso sem ninguém olhando".
   *
   * E o invariante 8 continua de pé na leitura que importa: a Cidade é o estado de REPOUSO, e
   * repouso não precisa de nó. Sem sessão hospedada o personagem continua na cidade, pela
   * coluna `characters.state` — o que a API já reporta assim (FUN-30).
   *
   * A carência existe para reconexão não virar rotatividade: recarregar a página, trocar de
   * rede ou perder o Wi-Fi por um instante não pode custar uma sessão nova.
   */
  #collectResting(hosted: HostedSession, nowMs: number): void {
    // Um por um, e não a sessão inteira (FUN-71): num shard, cada personagem tem o próprio
    // relógio de repouso, e recolher pelo estado da sessão tiraria da praça quem está ali
    // jogando junto de quem fechou o navegador.
    for (const characterId of this.#charactersOf(hosted.session.id)) {
      const since = this.#restingSince.get(characterId);
      if (since === undefined || since === null) continue;
      if (this.#watchers(hosted, characterId) > 0) continue;
      if (nowMs - since < RESTING_GRACE_MS) continue;

      // Marca antes de soltar: `release` é assíncrono, e o ciclo seguinte não pode tentar de
      // novo enquanto o primeiro ainda está no meio do caminho.
      this.#restingSince.set(characterId, null);
      this.#logger.info(
        { characterId, sessionId: hosted.session.id },
        'Collecting a resting character nobody is watching',
      );
      void this.release(characterId).catch((error: unknown) => {
        this.#logger.error({ error, characterId }, 'Failed to collect a resting character');
      });
    }
  }

  /**
   * Tira da sessão os visualizadores DESTE personagem, fechando-os se houver código.
   *
   * Só os dele: num shard os outros continuam olhando a mesma sessão, e limpar a lista
   * inteira desconectaria a praça porque um jogador saiu. Fecha TODAS as abas dele, porém —
   * sair do jogo é do personagem, não da aba.
   */
  #dropViewers(
    hosted: HostedSession,
    characterId: string,
    closeCode?: number,
    closeReason?: string,
  ): void {
    for (const viewer of [...hosted.viewers]) {
      if (viewer.characterId !== characterId) continue;
      if (closeCode !== undefined) viewer.close(closeCode, closeReason ?? '');
      hosted.viewers.delete(viewer);
      hosted.session.detach(viewer.id);
    }
  }

  /** Quantos visualizadores estão olhando ESTE personagem. Abas contam separado. */
  #watchers(hosted: HostedSession, characterId: string): number {
    let count = 0;
    for (const viewer of hosted.viewers) if (viewer.characterId === characterId) count += 1;
    return count;
  }

  /** Manda o acumulado e derruba quem não está drenando. */
  flush(): void {
    for (const hosted of this.#sessions.values()) {
      for (const viewer of hosted.viewers) {
        viewer.flush();
        if (!viewer.dead) continue;
        this.#logger.warn(
          { characterId: viewer.characterId },
          'Dropping viewer that stopped draining',
        );
        viewer.close(1013, 'backpressure');
        this.detach(viewer);
      }
    }
  }

  start(): void {
    this.#cycleTimer = setInterval(() => this.cycle(), CYCLE_MS);
    this.#renewTimer = setInterval(() => void this.#renewLeases(), RENEW_INTERVAL_MS);
    this.#snapshotTimer = setInterval(() => void this.saveAll(), SNAPSHOT_INTERVAL_MS);
  }

  stop(): void {
    if (this.#cycleTimer) clearInterval(this.#cycleTimer);
    if (this.#renewTimer) clearInterval(this.#renewTimer);
    if (this.#snapshotTimer) clearInterval(this.#snapshotTimer);
    this.#cycleTimer = null;
    this.#renewTimer = null;
    this.#snapshotTimer = null;
  }

  /**
   * Encerra TODAS as sessões creditando o progresso, e avisa quem estiver olhando (FUN-29).
   *
   * É o que um deploy faz: encerrar creditando, e não migrar ao vivo (ADR 0010). Sem isto,
   * um deploy com milhares de sessões desanexadas em voo destrói progresso de gente que nem
   * está lá para reagir — e o §38.4 é explícito que hunt AFK não pode sumir em silêncio.
   *
   * A ORDEM importa. O extrato é gravado ANTES de o visualizador ser avisado: se o processo
   * morrer no meio, o jogador ficou sem a mensagem mas o crédito está no Redis esperando o
   * `jobs`. O contrário — avisar e morrer antes de gravar — mostraria um extrato que nunca
   * vai existir, que é a pior das duas metades.
   */
  async drainAll(reason: EndReason = 'drain'): Promise<number> {
    let ended = 0;
    for (const [characterId, sessionId] of [...this.#sessionIdByCharacter]) {
      const hosted = this.#sessions.get(sessionId);
      if (hosted === undefined) continue;
      try {
        // Shard não credita e não encerra por personagem (FUN-71, ADR 0023): a praça não gera
        // progresso (§37), e chamar `end` uma vez por participante mandaria o mesmo extrato
        // zerado para duzentas pessoas. Sair basta, e `release` faz isso logo abaixo.
        if (hosted.session.ruleset.shared !== true) {
          const receipt = hosted.session.end(reason);
          await this.#saveReceipt(characterId, hosted, receipt);
          for (const viewer of hosted.viewers) {
            if (viewer.characterId !== characterId) continue;
            viewer.sendNow({
              type: 'session-ended',
              reason: receipt.reason,
              aggregates: receipt.aggregates,
              notableEvents: receipt.notableEvents.map((event) => ({ ...event })),
            });
          }
        }
        // Creditada: o snapshot e o registro no diretório TÊM que sumir.
        //
        // Deixar o snapshot criaria um caminho de crédito DOBRADO — a próxima conexão
        // retomaria (FUN-28) o estado de antes do encerramento, e uma segunda drenagem
        // creditaria os mesmos agregados de novo, com um `seq` novo que a chave única do
        // ledger não consegue recusar. E deixar o registro no diretório apontando para um nó
        // que já saiu é a definição de sessão órfã.
        await this.release(characterId, 1001, 'drain');
        ended += 1;
      } catch (error) {
        // Uma sessão que falha não pode impedir as outras de creditar: drenagem que para no
        // meio é pior que drenagem nenhuma, porque metade credita e metade some.
        //
        // A que falhou FICA com snapshot e registro: é o caminho da FUN-28, e voltar
        // retomável é melhor que sumir sem crédito.
        this.#logger.error({ error, characterId, sessionId }, 'Failed to drain a session');
      }
    }
    return ended;
  }

  async #saveReceipt(
    characterId: string,
    hosted: HostedSession,
    receipt: Receipt,
  ): Promise<void> {
    const receipts = this.#options.receipts;
    const accountId = this.#accountIdByCharacter.get(characterId);
    if (receipts === undefined || accountId === undefined) return;
    // Uma sessão credita UMA vez. A drenagem grava e depois solta, e sem esta guarda o
    // `release` gravaria de novo com um `seq` novo — que a chave única do ledger não teria
    // como recusar, e o jogador receberia o mesmo gold duas vezes.
    if (hosted.credited) return;
    hosted.credited = true;
    // `seq` avança na sessão: é metade da chave de idempotência do ledger (invariante 10), e
    // é o que impede uma drenagem repetida por retry de creditar duas vezes.
    hosted.session.ledgerSeq += 1;
    // A stamina do dono da sessão vai junto (FUN-54): sem ela, o tempo de hunt gasto nunca
    // chegaria ao banco, e reconectar devolveria a stamina de antes da hunt.
    const owner = hosted.session.participants.find((p) => p.id === characterId);
    await receipts.save({
      sessionId: receipt.sessionId,
      characterId,
      accountId,
      reason: receipt.reason,
      seq: hosted.session.ledgerSeq,
      aggregates: receipt.aggregates,
      notableEvents: receipt.notableEvents,
      ...(owner?.staminaMs === undefined || owner.staminaMs === null
        ? {}
        : { staminaMs: owner.staminaMs, staminaUpdatedAtMs: owner.staminaUpdatedAtMs }),
      // As skills do dono também (FUN-75). Sem elas, o que ele praticou na hunt nunca chegaria
      // ao banco — e a hunt seguinte começaria do zero de novo, sem nada explicando.
      ...(owner === undefined ? {} : { skills: owner.skills.getState() }),
      // E o que ele está vestindo (FUN-82). Item não muda de dono dentro da hunt; o que muda é
      // onde ele está, e é só isso que precisa atravessar.
      ...(owner === undefined ? {} : { equipment: equipmentOf(owner) }),
      // O que caiu nesta sessão (FUN-88): o que coube vira linha de `item_instance`, o que não
      // coube vira Caixa de Loot da Sessão.
      ...(owner === undefined ? {} : { acquired: acquiredBy(owner, receipt.sessionId) }),
      ...(owner === undefined || owner.lootBox.length === 0
        ? {}
        : { lootBox: owner.lootBox }),
    });

    // A caixa é escrita AQUI, e não na liquidação: o relógio de 30 minutos começa no
    // encerramento (§21.6), e quem sabe que a sessão encerrou é quem a encerrou. Deixar para o
    // `jobs` faria o prazo começar até dez segundos depois, e por acaso.
    if (owner !== undefined && owner.lootBox.length > 0) {
      await this.#options.lootBoxes?.save(receipt.sessionId, owner.lootBox)
        .catch((error: unknown) => {
          this.#logger.error(
            { error, characterId, sessionId: receipt.sessionId },
            'Failed to save the session loot box',
          );
        });
    }
  }

  /** Grava todas as sessões hospedadas. Chamado pelo timer e pela drenagem. */
  async saveAll(): Promise<void> {
    const snapshots = this.#options.snapshots;
    if (snapshots === undefined) return;
    for (const [characterId, sessionId] of this.#sessionIdByCharacter) {
      const hosted = this.#sessions.get(sessionId);
      const accountId = this.#accountIdByCharacter.get(characterId);
      if (hosted === undefined || accountId === undefined) continue;
      // Shard não tem snapshot (FUN-71, ADR 0023). Não há progresso a guardar na praça, e o
      // que seria guardado é a praça INTEIRA — uma cópia por participante, duzentas vezes o
      // mesmo estado a cada dez segundos.
      if (hosted.session.ruleset.shared === true) continue;
      try {
        await snapshots.save(
          characterId, accountId, this.#options.nodeId, hosted.session.snapshot(),
        );
      } catch (error) {
        // Falhar aqui é perder o próximo intervalo, não a sessão. Silenciar seria perder a
        // única pista de por que uma retomada voltou mais atrasada do que devia.
        this.#logger.error({ error, characterId }, 'Failed to save session snapshot');
      }
    }
  }

  /**
   * Id numérico da criatura, criado na primeira vez que alguém precisa dele.
   *
   * A chave é o `characterId` do personagem ou o `subject` do monstro (`m:<n>`): os dois
   * moram no mesmo mapa porque o cliente numera criatura num espaço só. Ver `nextCreatureId`
   * para por que o contador nunca volta.
   */
  #creatureId(hosted: HostedSession, key: string): number {
    const existing = hosted.creatureIds.get(key);
    if (existing !== undefined) return existing;
    const assigned = hosted.nextCreatureId;
    hosted.nextCreatureId += 1;
    hosted.creatureIds.set(key, assigned);
    return assigned;
  }

  /**
   * O estado ATUAL, montado do zero a cada pedido.
   *
   * Não existe fila de eventos guardada para reproduzir depois, e isso é decisão, não
   * economia: guardar seis horas de eventos para reproduzir na volta é o erro que o §16.2
   * nomeia. O que a sessão guarda é onde tudo está agora, os agregados e a lista curta de
   * eventos notáveis.
   */
  #sessionState(hosted: HostedSession, characterId: string): S2CMessage {
    const { session } = hosted;
    const self = session.participants.find((participant) => participant.id === characterId);

    // Quem está no CAMPO DE VISÃO, e não a sessão inteira (FUN-33). Numa praça de duzentos, o
    // `session-state` completo seria o pior pacote do jogo — e mandaria para a tela gente que
    // ela não tem como desenhar, porque está fora da câmera.
    //
    // Sessão privada não tem AOI: ali "todos os participantes" já é a resposta certa.
    const visible = hosted.aoi === null
      ? session.participants
      : session.participants.filter((participant) => participant.id === characterId
        || hosted.aoi?.visibleTo(characterId).includes(participant.id) === true);

    const creatures = visible.map((participant) => ({
      id: this.#creatureId(hosted, participant.id),
      position: participant.position,
      appearanceId: this.#options.playerOutfitId ?? 0,
      name: this.#nameByCharacter.get(participant.id) ?? participant.id,
      health: participant.health,
      maxHealth: participant.maxHealth,
    }));

    // Os monstros VIVOS da hunt entram na mesma lista (FUN-103): quem reanexa no meio precisa
    // ver o que já está lá, e não só o que nascer depois. O getter vem do ruleset pelo mesmo
    // cast que `#applyBotConfig` usa — sessão sem monstro devolve `undefined`, e é o normal.
    const ruleset = session.ruleset as Partial<HuntRuleset>;
    for (const monster of ruleset.monsters ?? []) {
      if (!monster.alive) continue;
      const definition = this.#options.monsterCatalog?.get(monster.monsterId);
      creatures.push({
        id: this.#creatureId(hosted, monster.subject),
        position: { ...monster.position, z: ruleset.floor ?? 0 },
        appearanceId: definition?.outfitId ?? 0,
        name: definition?.name ?? monster.monsterId,
        health: monster.health,
        maxHealth: definition?.health ?? monster.health,
      });
    }

    return {
      type: 'session-state',
      sessionType: session.ruleset.type,
      elapsedMs: session.aggregates.durationMs,
      self: {
        creatureId: this.#creatureId(hosted, characterId),
        characterId,
        health: self?.health ?? 0,
        maxHealth: self?.maxHealth ?? 0,
        mana: self?.mana ?? 0,
        maxMana: self?.maxMana ?? 0,
        level: self?.level ?? 0,
        xp: self?.xp ?? 0,
      },
      world: {
        mapId: null,
        creatures,
      },
      aggregates: { ...session.aggregates },
      notableEvents: session.notableEvents.map((event) => ({ ...event })),
    };
  }

  #hostedSession(characterId: string): HostedSession | undefined {
    const sessionId = this.#sessionIdByCharacter.get(characterId);
    return sessionId === undefined ? undefined : this.#sessions.get(sessionId);
  }

  async #createAndRegister(
    characterId: string,
    initialCharacter: InitialCharacter | undefined,
    accountId: string | undefined,
  ): Promise<void> {
    const resumed = await this.#resume(characterId, accountId);
    const session = resumed?.session ?? this.#options.createSession(characterId, initialCharacter);
    await this.#register(characterId, session, accountId);
    this.#createLocal(characterId, session, accountId);
    if (initialCharacter?.name !== undefined) this.#nameByCharacter.set(characterId, initialCharacter.name);
    this.#adoptTicketBotConfig(characterId, session, initialCharacter);
    if (resumed !== null) {
      this.#resumedGapMs.set(characterId, resumed.gapMs);
      this.#logger.info(
        { characterId, sessionId: session.id, gapMs: resumed.gapMs },
        'Session resumed from snapshot',
      );
    }
  }

  /**
   * Retoma do snapshot, se houver um e se ele for reconstruível.
   *
   * A exclusão mútua de verdade NÃO está aqui: está no `register`, que é atômico e recusa
   * registrar um `sessionId` diferente enquanto o lease de outro vive. Duas retomadas
   * simultâneas produzem duas sessões locais, mas só uma consegue se registrar — e a outra
   * levanta antes de existir para alguém. É por isso que a trava do `jobs` é contra trabalho
   * duplicado, e não contra duas cópias rodando.
   */
  async #resume(
    characterId: string,
    accountId: string | undefined,
  ): Promise<{ session: Session; gapMs: number } | null> {
    const snapshots = this.#options.snapshots;
    const restore = this.#options.restoreSession;
    if (snapshots === undefined || restore === undefined) return null;

    let stored;
    try {
      stored = await snapshots.load(characterId);
    } catch (error) {
      this.#logger.error({ error, characterId }, 'Failed to load session snapshot');
      return null;
    }
    if (stored === null) return null;

    const session = restore(stored.snapshot);
    if (session === null) {
      // Não dá para reconstruir: formato antigo, ruleset desconhecido, ou versão de conteúdo
      // diferente da deste nó (invariante 7).
      //
      // CREDITAR ANTES DE APAGAR. Descartar em silêncio é o oposto do que o ADR 0010 decide
      // para o mesmo problema — encerrar creditando, não jogar fora — e o §38.4 é explícito
      // que hunt AFK não pode sumir sem explicação. O snapshot carrega agregados, eventos
      // notáveis e `ledgerSeq`, que é tudo o que o extrato precisa.
      await this.#creditUnrestorable(characterId, accountId, stored.snapshot);
      this.#logger.warn(
        { characterId, sessionId: stored.snapshot.id, type: stored.snapshot.type },
        'Snapshot could not be restored; credited its progress and discarded it',
      );
      await snapshots.remove(characterId).catch(() => undefined);
      return null;
    }
    return { session, gapMs: Math.max(0, Date.now() - stored.savedAtMs) };
  }

  /**
   * Extrato de uma sessão que não volta mais, montado a partir do snapshot.
   *
   * O `seq` sai de `ledgerSeq + 1`, que é a MESMA regra do caminho normal — e é ela que torna
   * isto idempotente: se aquela sessão já tinha creditado esse `seq`, a chave única do ledger
   * recusa o segundo, e o jogador não recebe duas vezes. Sem essa aritmética, um snapshot que
   * sobreviveu a uma drenagem parcial creditaria o mesmo progresso de novo.
   */
  async #creditUnrestorable(
    characterId: string,
    accountId: string | undefined,
    snapshot: SessionSnapshot,
  ): Promise<void> {
    const receipts = this.#options.receipts;
    if (receipts === undefined || accountId === undefined) return;
    const owner = snapshot.participants.find((participant) => participant.id === characterId);
    try {
      await receipts.save({
        sessionId: snapshot.id,
        characterId,
        accountId,
        // `drain` porque foi o servidor que encerrou, não o jogador: é a mesma família de
        // "sua sessão foi encerrada por manutenção", que é o que de fato aconteceu.
        reason: 'drain',
        seq: snapshot.ledgerSeq + 1,
        aggregates: snapshot.aggregates,
        notableEvents: snapshot.notableEvents,
        ...(owner?.staminaMs === undefined || owner.staminaMs === null
          ? {}
          : {
            staminaMs: owner.staminaMs,
            staminaUpdatedAtMs: owner.staminaUpdatedAtMs ?? 0,
          }),
      });
    } catch (error) {
      // Falhar aqui perde o crédito, e é por isso que o snapshot NÃO é apagado em seguida
      // quando isto lança: a próxima conexão tenta de novo.
      this.#logger.error(
        { error, characterId, sessionId: snapshot.id },
        'Failed to credit an unrestorable snapshot',
      );
      throw error;
    }
  }

  #createLocal(characterId: string, session: Session, accountId?: string): void {
    // A sessão pode JÁ estar hospedada: num shard (FUN-71), o segundo personagem a entrar
    // recebe a mesma `Session` que o primeiro. Criar um `HostedSession` novo aqui jogaria fora
    // os visualizadores e os ids de criatura de quem já estava lá — e o sintoma seria o
    // primeiro jogador parar de receber tudo no instante em que o segundo entrasse.
    const existing = this.#sessions.get(session.id);
    const hosted: HostedSession = existing ?? {
      session,
      viewers: new Set(),
      creatureIds: new Map(),
      nextCreatureId: 1,
      // Só o shard tem AOI (FUN-33): numa hunt de um personagem ela seria índice para nada.
      aoi: this.#interestManaged(session) ? new AreaOfInterest() : null,
      // Vale tanto para a sessão nova quanto para a retomada de snapshot: as duas começam a
      // ser cobradas a partir de agora, e não de um relógio que não é deste processo.
      lastAdvancedAtMs: this.#now(),
      credited: false,
      sentItemsLooted: session.aggregates.itemsLooted,
    };
    this.#sessions.set(session.id, hosted);
    this.#sessionIdByCharacter.set(characterId, session.id);
    if (accountId !== undefined) this.#accountIdByCharacter.set(characterId, accountId);
    // Nasce em repouso: um ticket emitido e nunca usado deixaria a sessão de pé para sempre,
    // segurando um slot que ninguém está usando. O repouso é por PERSONAGEM desde a FUN-71 —
    // num shard, um jogador fechando o navegador não pode recolher a praça dos outros.
    this.#restingSince.set(characterId, this.#now());

    // Quem já estava na praça precisa VER quem chegou. Sem isto, o novo só apareceria no
    // primeiro passo que ele desse — e ficaria invisível enquanto estivesse parado.
    //
    // Vale também para o PRIMEIRO a chegar, que não avisa ninguém: é ele entrando no índice de
    // células, e sem isso quem chegasse depois não teria como encontrá-lo.
    this.#announceArrival(hosted, characterId);

    this.#logger.info(
      { characterId, sessionId: session.id, type: session.ruleset.type },
      existing === undefined ? 'Session created' : 'Character joined a shared session',
    );
  }

  /**
   * Alguém chegou na sessão (FUN-71), e quem está POR PERTO precisa saber (FUN-33).
   *
   * "Por perto" e não "todo mundo": numa praça de duzentos, avisar a praça inteira de cada
   * entrada é o mesmo O(N²) que a AOI existe para cortar, só que no evento mais barulhento do
   * dia — todo login passa por aqui.
   */
  #announceArrival(hosted: HostedSession, characterId: string): void {
    const arrival = hosted.session.participants.find((p) => p.id === characterId);
    if (arrival === undefined) return;
    const aoi = hosted.aoi;
    if (aoi === null) return;
    this.#applyVisibility(hosted, characterId, aoi.enter(characterId, arrival.position));
  }

  /** Alguém saiu da sessão (FUN-71). Some da tela de quem o enxergava, e só dela. */
  #announceDeparture(hosted: HostedSession, characterId: string): void {
    const aoi = hosted.aoi;
    if (aoi !== null) {
      this.#applyVisibility(hosted, characterId, aoi.leave(characterId));
    }
    // O id numérico é liberado AQUI, e só aqui: sumir de vista é reversível, sair da sessão
    // não. Reciclar no primeiro caso deixaria o sprite antigo parado para sempre na tela.
    hosted.creatureIds.delete(characterId);
  }

  async #register(
    characterId: string,
    session: Session,
    accountId: string | undefined,
  ): Promise<void> {
    const directory = this.#options.directory;
    if (directory === undefined) return;
    if (accountId === undefined) throw new Error('account is required to register a session');
    const registered = await directory.register(characterId, {
      sessionId: session.id,
      nodeId: this.#options.nodeId,
      type: session.ruleset.type satisfies SessionType,
    }, accountId);
    if (!registered) throw new Error('active reservation expired before session registration');
  }

  async #renewLeases(): Promise<void> {
    const directory = this.#options.directory;
    if (directory === undefined || this.#sessionIdByCharacter.size === 0) return;
    try {
      await directory.renew([...this.#accountIdByCharacter].map(([characterId, accountId]) => ({
        characterId,
        accountId,
      })));
    } catch (error) {
      // Lease não renovado vira sessão órfã para a FUN-28. Registrar alto: é o sintoma que
      // antecede uma sessão sendo retomada em outro nó sem necessidade.
      this.#logger.error({ error }, 'Failed to renew session leases');
    }
  }

  #now(): number {
    return this.#options.now?.() ?? performance.now();
  }
}
