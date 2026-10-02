// A `Session` é a unidade de simulação, e é o coração da arquitetura (ADR 0001).
//
// Todo personagem está sempre em exatamente uma sessão, cidade inclusive (invariante 8) — o
// que transforma o estado exclusivo de regra policiada em propriedade estrutural, e serve de
// controle de concorrência sobre o estado quente sem lock nenhum.
//
// A sessão roda com ZERO visualizadores. Se algum caminho presumir que existe um, quebra na
// primeira hunt AFK — que é o modo padrão do jogo.

import { CharacterRuntime } from './character.js';
import type { CharacterState, SessionClock } from './character.js';
import { resolveDeath } from './death.js';
import type { KillCredit, Victim } from './death.js';
import type { Rng, RngState } from './rng.js';
import type { CharacterNotice, CombatEvent, PartyEvent } from './combat-events.js';
import type { CreatureMoved, MoveResult } from './movement.js';
import type { PresenceEvent } from './presence.js';
import type { WorldExitEvent } from './world-exit.js';
import type { EquipmentChanged } from './inventory.js';
import type { GridPoint } from './monster/step.js';
import { Schedule } from './schedule.js';
import type { ScheduleState, ScheduledEvent, TieBreak } from './schedule.js';

/**
 * Um acontecimento de GAMEPLAY, produzido haja ou não alguém olhando (§12 do documento de
 * referência OpenTibia).
 *
 * Não é mensagem de protocolo. Quem traduz um destes num pacote é o servidor, que é o único
 * lado que conhece socket — e é isso que mantém a matemática igual entre a hunt anexada e a
 * desanexada: o evento nasce dos dois lados, e só num deles alguém o serializa.
 */
export type DomainEvent =
  | CreatureMoved | PresenceEvent | CombatEvent | PartyEvent | EquipmentChanged | CharacterNotice
  | WorldExitEvent;

/**
 * Teto de eventos de domínio guardados à espera de quem os leia.
 *
 * O hospedeiro drena a cada ciclo, então na prática o buffer nunca passa de um avanço. O teto
 * existe para a sessão que ninguém drena — um nó sem visualizador nenhum não pode acumular
 * memória por horas de hunt. Estourar DESCARTA os mais antigos, e é a escolha certa: isto é
 * apresentação, e apresentação é perdível. Gameplay não passa por aqui.
 *
 * É o DEFAULT: desde a OW-03 (ADR 0060 d.5) cada sessão pode ter o seu (`SessionLimits`), porque
 * um mundo com duzentos personagens não cabe no teto de uma hunt solo.
 */
export const MAX_PENDING_DOMAIN_EVENTS = 512;

/**
 * Versão do FORMATO de snapshot — não do conteúdo, não do servidor.
 *
 * Existe desde o primeiro snapshot de propósito: sem ela, o primeiro deploy que mudar o
 * formato descarta em silêncio milhares de sessões em voo, e ninguém liga uma coisa à outra.
 * Mudou o formato, sobe o número e decide explicitamente entre migrar e descartar.
 *
 * **3 (FUN-68):** `lastTickMs` — relógio de processo — deu lugar a `logicalNowMs` e à fila de
 * eventos. Um snapshot de formato 2 não é migrável: os acumuladores de cooldown que ele grava
 * não dizem quando cada ação vence, só quanto já esperou, e inventar vencimento a partir
 * disso é inventar simulação. Quem lê recusa e credita, que é o caminho que o ADR 0018 já
 * mandava seguir.
 */
export const SNAPSHOT_FORMAT_VERSION = 3;

/**
 * Teto de eventos num único `advanceBy`.
 *
 * O sucessor do `MAX_CATCH_UP` dos cooldowns, e existe pela mesma razão: uma engasgada de
 * processo — GC longo, depurador, máquina suspensa — não pode virar horas de combate
 * resolvidas de uma vez. Ao estourar, o que venceu é empurrado para o alvo e o atraso é
 * DESCARTADO, nunca acumulado (ADR 0018).
 *
 * O número é folgado de propósito: uma hunt cheia carrega ~100 eventos com cadência de
 * centenas de milissegundos, então isto só é alcançado por volta de quinze segundos de
 * intervalo num único avanço. O ciclo do nó é de 100 ms.
 *
 * Também é o DEFAULT de `SessionLimits.maxEventsPerAdvance` (OW-03).
 */
export const MAX_EVENTS_PER_ADVANCE = 4096;

export interface SessionSnapshot {
  readonly formatVersion: number;
  readonly contentVersion: string;
  readonly id: string;
  readonly type: SessionType;
  readonly createdAtMs: number;
  /**
   * Relógio LÓGICO da sessão: começa em zero e só anda com `advanceBy`.
   *
   * É o que torna a retomada trivial. O `lastTickMs` de antes era o monotônico do processo que
   * morreu, e monotônico não é comparável entre processos — daí o `rebaseClock`, que existia
   * só para consertar isso. Um relógio que nasce em zero e é próprio da sessão não tem o que
   * rebasear: retomar é continuar de onde parou, e o intervalo pulado nunca chega a existir.
   */
  readonly logicalNowMs: number;
  readonly schedule: ScheduleState;
  readonly rng: RngState;
  readonly participants: readonly CharacterState[];
  /** A SOMA — o que o analisador lê. Por participante está em `aggregatesByCharacter`. */
  readonly aggregates: Aggregates;
  /**
   * Os agregados de CADA participante (#187, ADR 0027). Opcional: snapshot anterior não tem, e
   * a restauração atribui `aggregates` inteiro ao único participante que existia então.
   */
  readonly aggregatesByCharacter?: Readonly<Record<string, Aggregates>>;
  /**
   * O instante lógico em que cada participante entrou (#397, ADR 0035 decisão 6). Opcional:
   * snapshot anterior não tem, e a ausência de uma chave equivale a `0` — o comportamento de
   * hoje, em que o extrato leva TODOS os eventos notáveis da sessão.
   */
  readonly joinedAtMs?: Readonly<Record<string, number>>;
  readonly notableEvents: readonly NotableEvent[];
  readonly ledgerSeq: number;
  readonly endedReason: EndReason | null;
  /** Opaco: quem entende do formato é o próprio ruleset. */
  readonly ruleset?: unknown;
}

/**
 * O tipo da sessão. **`'world'` é o mundo aberto** (OW-13, ADR 0060 d.2): uma sessão compartilhada,
 * com relógio e sem fim, em que o personagem anda e caça com outros. É o `HuntRuleset` com a
 * topologia de mundo (`worldTopology`, `rulesets/world.ts`), e nada a cria atrás da flag
 * `OPEN_WORLD` ainda — o hospedeiro a hospeda na OW-18.
 */
export type SessionType = 'city' | 'hunt' | 'world' | 'training' | 'quest' | 'boss' | 'guild-war';

export type EndReason =
  | 'manual-exit'
  | 'exit-rule'
  | 'death'
  | 'drain'
  | 'completed'
  /**
   * A party votou encerrar para todos (#432, ADR 0032 d.14): o líder propôs, todos os presentes
   * aprovaram dentro de 60 s. Sair sozinho continua `manual-exit`; isto é o encerramento
   * coletivo, e é o único motivo novo que o ADR 0032 acrescenta.
   */
  | 'party-vote';

export interface NotableEvent {
  readonly atMs: number;
  readonly type: string;
  readonly detail?: string;
  /**
   * DE QUEM é o evento — só onde a sessão o escopa ao dono (`Ruleset.scopesEventsToOwner`, o
   * mundo). Ausente é "de todos": o evento da sessão (`advance-truncated`) e, na instância, TODO
   * evento — a party compartilha a lista, e a hunt solo tem um dono só. Um extrato (`Receipt`) e o
   * analisador ao vivo levam os eventos sem dono e os do próprio personagem: num mundo de
   * estranhos, a morte e a perda de XP de um não podem aparecer na tela de retorno de outro.
   */
  readonly characterId?: string;
}

/** O evento é visível a `characterId`? Sem dono é de todos; com dono, só do dono. */
export function isNotableEventVisibleTo(event: NotableEvent, characterId: string): boolean {
  return event.characterId === undefined || event.characterId === characterId;
}

/**
 * O que a hunt rendeu (§16.1, §16.2).
 *
 * **Nada aqui é "por hora".** A derivada é `valor / durationMs`, e o cliente a faz — mandar a
 * divisão pela rede é mandar o mesmo número duas vezes, e as duas divergem na primeira pausa
 * entre calcular e enviar.
 *
 * Todo agregado é escrito ONDE O FATO ACONTECE, pela sessão dona (invariante 9): o maior hit
 * no golpe, o loot no abate, o supply no uso. Reconstruir por varredura seria contar de novo o
 * que já foi contado, e é assim que dois números que deveriam bater param de bater.
 */
export interface Aggregates {
  durationMs: number;
  xpGained: number;
  goldGained: number;
  goldSpent: number;
  kills: number;
  deaths: number;
  /**
   * Quantos ITENS caíram (§16.1). Contagem, não valor: o preço de venda é do Market, que é F6,
   * e um "valor do loot" hoje seria um número inventado passando por medida.
   */
  itemsLooted: number;
  /** Quantos supplies foram usados. O gold deles já está em `goldSpent`. */
  suppliesUsed: number;
  /** O maior golpe de arma da sessão. Zero é "ainda não bateu em ninguém". */
  bestBasicHit: number;
  /** O maior dano de magia da sessão, do ALVO que levou mais — não a soma de uma área. */
  bestSpellHit: number;
  /**
   * O dano TOTAL que o personagem causou na sessão (#431, ADR 0032 d.14). É a soma do que saiu
   * da barra do alvo (`applied.healthDamage`), não o resolvido do `best*Hit` — overkill e
   * absorção por mana shield não inflam o DPS. O recorte dos últimos 60 s é `dpsOf`, lido da
   * janela de amostras, nunca recontado por tick.
   */
  damageDealt: number;
  /** A cura TOTAL que o personagem FEZ na sessão — quem lançou, nunca quem recebeu. */
  healingDone: number;
}

/**
 * A janela do DPS/HPS, em milissegundos (#431, ADR 0032 d.14). É a régua de `dpsOf`/`hpsOf`, e
 * o divisor da taxa é `PERFORMANCE_WINDOW_MS / 1000` — 60 s. O número é de conteúdo e pode
 * mudar sem ADR; o que o ADR fixa é a forma.
 */
export const PERFORMANCE_WINDOW_MS = 60_000;

/** Uma amostra carimbada no relógio LÓGICO da sessão: quanto, e em que instante aconteceu. */
interface PerformanceSample {
  readonly atMs: number;
  readonly amount: number;
}

/**
 * O extrato de UM participante (#187, ADR 0027 decisão 2).
 *
 * Uma sessão com N donos produz N extratos, cada um com os agregados DAQUELE personagem e um
 * `seq` próprio: o ledger é `UNIQUE (session_id, seq)` (invariante 10), e quatro extratos da
 * mesma sessão precisam de quatro chaves. O `seq` é alocado no instante em que o extrato é
 * emitido — no `end`, na ordem de entrada; no `leave`, na hora da saída; no `checkpoint`, a
 * qualquer momento, e então o extrato é PARCIAL: leva só o que rendeu desde o anterior do mesmo
 * personagem (ADR 0060 d.10b).
 */
export interface Receipt {
  readonly sessionId: string;
  readonly characterId: string;
  readonly reason: EndReason;
  readonly seq: number;
  readonly aggregates: Aggregates;
  readonly notableEvents: readonly NotableEvent[];
  /**
   * As instâncias destruídas por `sell-items`/`discard-item` nesta sessão, ainda não entregues
   * a um extrato aceito (#724, ADR 0048 d.8). É o `jobs` que apaga as linhas de `item_instance`,
   * na mesma transação do ledger — a sessão nunca escreve o banco (invariante 9/10). Drenada de
   * `CharacterRuntime.removedInstances`, como `goldDelta` drena para `aggregates.goldGained`.
   */
  readonly removedInstances: readonly string[];
}

/** O que `leave` devolve: quem saiu, e o extrato dele. */
export interface Departure {
  readonly character: CharacterRuntime;
  readonly receipt: Receipt;
}

/** O que um ruleset declara em `Ruleset.progress`. Ver lá. */
export type RulesetProgress = 'none' | 'checkpointed';

/**
 * `progress` já resolvido, sem ausência: `'at-end'` é a sessão privada que credita uma vez, no
 * `end`, que é o que a ausência do campo sempre quis dizer.
 */
export type ResolvedProgress = RulesetProgress | 'at-end';

/**
 * Lê `Ruleset.progress` com o sentido de hoje para a ausência (ADR 0060 d.10b): a sessão privada
 * credita no fim, a compartilhada não credita. É a leitura que o hospedeiro faz no lugar de
 * `ruleset.shared === true` toda vez que a pergunta é "esta sessão credita?".
 */
export function progressOf(ruleset: Pick<Ruleset, 'progress' | 'shared'>): ResolvedProgress {
  if (ruleset.progress !== undefined) return ruleset.progress;
  return ruleset.shared === true ? 'none' : 'at-end';
}

const NO_RECEIPTS: readonly Receipt[] = [];

/** As chaves que SOMAM. `bestBasicHit` e `bestSpellHit` são máximo — ver `Session.credit`. */
const MAX_AGGREGATE_KEYS: ReadonlySet<keyof Aggregates> = new Set(['bestBasicHit', 'bestSpellHit']);

export function zeroAggregates(): Aggregates {
  return {
    durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0,
    itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
    damageDealt: 0, healingDone: 0,
  };
}

/**
 * O que um ruleset define — e são as MESMAS quatro coisas para hunt, treino, quest, boss e
 * guild war. Se a Guild War não couber aqui depois, ela foi modelada em cima de hunt, e
 * descobrir isso na F5 custa semanas.
 */
export interface Ruleset {
  readonly type: SessionType;
  readonly huntId?: string;
  readonly difficulty?: string;

  /**
   * Esta sessão é um SHARD — uma cópia compartilhada por muitos personagens (FUN-71)?
   *
   * Ausente é `false`, que é a sessão de sempre: um personagem, dono do que ela produz. O
   * invariante 8 continua de pé na letra — todo personagem está em exatamente uma sessão —, e
   * o que muda é a leitura: a sessão é que passa a ter muitos.
   *
   * Marcar `true` muda o que "sair" significa. Numa sessão privada, sair é encerrar; num
   * shard, sair é `leave`, e quem fica não perde nada. Ver o ADR 0023.
   *
   * **Só isto.** `shared` NÃO diz se a sessão credita o que os donos rendem: isso é `progress`
   * (ADR 0060 d.10b). Os dois andavam juntos enquanto a Cidade era o único shard, e o mundo é um
   * shard que credita.
   */
  readonly shared?: boolean;

  /**
   * Os eventos notáveis desta sessão têm DONO (`NotableEvent.characterId`) e cada personagem vê só
   * os seus (OW-13)? Ausente é `false`, o de sempre: a lista é da sessão e quem a lê vê tudo — a
   * hunt solo tem um dono só, e a party compartilha a lista de propósito (cada membro lê o que o
   * grupo fez). O mundo é de estranhos: o extrato de um não leva a morte, a perda de XP ou a
   * subida de skill de outro.
   *
   * Decide só se `Session.record` GRAVA o dono que o ruleset informa; o filtro de quem lê é
   * `isNotableEventVisibleTo`, e um evento sem dono passa em qualquer filtro — por isso a instância
   * (que nunca grava dono) continua byte a byte a de antes.
   */
  readonly scopesEventsToOwner?: boolean;

  /**
   * O que a sessão faz com o PROGRESSO dos donos — XP, gold, abates, itens (ADR 0060 d.10b).
   *
   * - `'none'`: não credita. O que os donos rendem não vira linha de ledger (a Cidade).
   * - `'checkpointed'`: credita em extratos PARCIAIS. A sessão vive muito além de qualquer dono,
   *   e o hospedeiro chama `Session.checkpoint` de tempos em tempos, e na saída, com semântica de
   *   delta: cada extrato leva só o que rendeu desde o anterior (o mundo).
   * - ausente: o sentido de sempre, que `progressOf` resolve — a sessão privada credita no fim
   *   (`end`), a compartilhada não credita.
   *
   * Declarar o campo não muda nada no `sim`: quem decide o que gravar é o hospedeiro, e ele lê o
   * valor resolvido por `progressOf`. Cidade e hunt não declaram, de propósito (byte a byte).
   */
  readonly progress?: RulesetProgress;

  /**
   * O mapa desta sessão, pelo id do conteúdo (FUN-120). É o que `instance-enter` e
   * `session-state.world.mapId` levam ao cliente, para ele buscar a geometria e a pilha de
   * aparências certas. Ausente é sessão sem mapa — só fixture de teste; toda sessão de jogo
   * tem um.
   */
  readonly mapId?: string;

  /**
   * O ambiente da cena (FUN-121): `cavern` escurece o mundo no cliente. Ausente é superfície.
   * Apresentação pura — nada da simulação depende disto.
   */
  readonly ambience?: 'surface' | 'cavern' | undefined;

  /**
   * Com que frequência o HOSPEDEIRO avança esta sessão, em Hz. `0` significa orientada a
   * evento — sem laço.
   *
   * A política do ADR 0003 mora aqui, e não num `switch` em outro lugar: cada ruleset conhece
   * o próprio custo. Cidade e treino devolvem 0; hunt cai de 10 para 1–2 ao desanexar; quest,
   * boss e guild war ficam em 10 mesmo desanexados, porque o §6.2 mantém o personagem no mapa
   * e vulnerável.
   *
   * Desde a FUN-68 isto é uma taxa de ATUALIZAÇÃO, não de simulação: quem decide quando cada
   * ação acontece é a fila de eventos, e o resultado é idêntico em qualquer taxa. O que cai
   * ao desanexar é a granularidade com que o mundo é observado — e não há ninguém observando.
   */
  hz(attached: boolean): number;

  onEnter(session: Session, character: CharacterRuntime): void;

  /**
   * Esta sessão aceita, AGORA, as intenções de serviço de Cidade (ADR 0052 d.2) deste personagem —
   * loja, depósito, promoção, aprender magia, livro do treino? Ausente é "o ruleset não decide":
   * o hospedeiro cai no que sempre fez, que é aceitar só na sessão `city`.
   *
   * O mundo responde pelo TILE em que o personagem pisa: só em protect zone (OW-13, ADR 0060 d.4;
   * no Tibia as lojas e os santuários vivem em PZ). É a pergunta, e não a ação: quem recusa a
   * intenção, e diz ao jogador por quê, é o hospedeiro (OW-18). Só lê — não toca o personagem nem
   * sorteia.
   */
  acceptsCityServices?(session: Session, characterId: string): boolean;

  /**
   * O personagem saiu de uma sessão que CONTINUA viva (FUN-71). Só acontece em shard.
   *
   * Existe porque a saída tem consequência no mundo: o tile que ele ocupava precisa ser
   * liberado, senão sobra um bloqueio invisível que ninguém consegue pisar e nada explica.
   * Numa sessão privada isto nunca é chamado — lá a sessão inteira acaba, e `onEnd` basta.
   */
  onLeave?(session: Session, character: CharacterRuntime): void;

  /**
   * O hospedeiro VAI tirar o personagem desta sessão para outra que já o recebeu — e ainda não o
   * tirou (`Session.beforeLeave`). A transição constrói o destino ANTES de soltar a origem, para a
   * recusa do destino não deixar o personagem sem sessão; só que o destino lê, na entrada, o que
   * só a origem sabe (o restante do prazo de um anel que a fila dela carrega), e o `onLeave`/`onEnd`
   * da origem chegaria tarde. Aqui ela PUBLICA o que o destino vai ler.
   *
   * **Só publica; não desfaz nada.** A transição pode ser recusada depois, e o personagem então
   * continua aqui como estava — quem o tira de verdade é o `onLeave`/`onEnd`, e o que ele guarda de
   * novo é o mesmo valor (nenhum tempo lógico corre entre os dois). Sem efeito na fila, no sorteio
   * ou na posição: nada do que ela faz é observável pela simulação desta sessão.
   */
  onBeforeLeave?(session: Session, character: CharacterRuntime): void;

  /**
   * Um evento venceu. `session.nowMs` É o instante do vencimento — não "algum ponto do tick".
   *
   * Quem quiser repetir reagenda a partir daqui (`session.nowMs + intervalo`), e é isso que
   * dispensa acumulador: o evento roda no instante exato em que era devido, então a próxima
   * data não herda erro nenhum.
   */
  onEvent(session: Session, event: ScheduledEvent): void;

  /**
   * Uma criatura morreu — monstro ou personagem (FUN-63). O ruleset decide a CONSEQUÊNCIA; o
   * pipeline (`resolveDeath`) já congelou os eventos dela e já resolveu quem matou.
   *
   * Hunt: monstro vira recompensa e respawn; personagem encerra a sessão em PZ. Guild War:
   * personagem respawna pelas regras da partida. É por isso que isto não mora na criatura
   * (§30 da referência) — e é o que substituiu o `onDeath`, que só conhecia personagem.
   */
  onCreatureDied(session: Session, victim: Victim, credit: KillCredit): void;
  onEnd(session: Session, reason: EndReason): void;

  /**
   * Um jogador pediu para andar (FUN-69). INTENÇÃO, processada NA CHEGADA — nunca enfileirada
   * para o próximo evento: enfileirar põe até 100 ms de jitter em cima do ping, irrelevante na
   * hunt e inaceitável no PvP manual da F5.
   *
   * Passa pelo MESMO sistema de movimento que o bot e o monstro, e recebe a mesma razão de
   * recusa. Ausente no ruleset significa "esta sessão não anda".
   */
  requestMove?(session: Session, characterId: string, to: GridPoint): MoveResult;

  /**
   * Estado próprio do ruleset, para entrar no snapshot. Ruleset sem estado pode omitir.
   * O serializador trata o retorno como opaco — quem entende do formato é o ruleset.
   */
  getState?(): unknown;
  restore?(state: unknown): void;
  /**
   * Depois de `restore`, com os participantes já reconstruídos (#160). `onEnter` não roda na
   * retomada — o personagem já está dentro —, e o que a entrada repõe pela tabela (os tamanhos
   * de container) precisa de um lugar para ser reposto num snapshot anterior ao formato.
   */
  onResume?(session: Session): void;
}

/**
 * Os tetos de UMA sessão (OW-03, ADR 0060 d.5). Todos opcionais: sem eles valem os defaults de
 * hoje, e a hunt não muda um byte.
 */
export interface SessionLimits {
  /** Eventos de domínio à espera de quem os leia. Default `MAX_PENDING_DOMAIN_EVENTS`. */
  readonly maxPendingDomainEvents?: number;
  /** Eventos despachados por `advanceBy`. Default `MAX_EVENTS_PER_ADVANCE`. */
  readonly maxEventsPerAdvance?: number;
  /**
   * Eventos notáveis guardados, POR PERSONAGEM presente. Sem default: sem ele a lista cresce sem
   * limite, como sempre cresceu — e é o que a hunt quer, porque o extrato dela leva a sessão
   * inteira. Num mundo que dura dias isso é vazamento, e o teto é a saída.
   *
   * O evento notável não tem dono (`NotableEvent` é `{ atMs, type, detail? }`, e o `detail` ora é
   * um personagem, ora um item), então o teto é da LISTA: `maxNotableEventsPerCharacter × max(1,
   * participantes)`. Estourar descarta os mais antigos — apresentação, como os eventos de domínio.
   */
  readonly maxNotableEventsPerCharacter?: number;
}

export interface SessionOptions extends SessionLimits {
  readonly id: string;
  readonly contentVersion: string;
  readonly ruleset: Ruleset;
  readonly rng: Rng;
  readonly createdAtMs: number;
  /**
   * Como a fila desempata eventos do mesmo instante e prioridade (#827, ADR 0060 d.5c). Ausente é
   * `'insertion'`, que é o que a instância usa, byte a byte; só o mundo pede `'stable'`. Uma
   * sessão restaurada NÃO passa por aqui: o snapshot grava a escolha no próprio `schedule`.
   */
  readonly tieBreak?: TieBreak;
}

/** Valida um teto opcional: inteiro positivo, ou ausente. Zero e negativo são bug de quem configura. */
function limitOf(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer: ${String(value)}`);
  }
  return value;
}

const EMPTY_EVENTS: readonly DomainEvent[] = [];

export class Session implements SessionClock {
  readonly id: string;
  /** Congelada na criação (invariante 7): a sessão termina na versão em que começou. */
  readonly contentVersion: string;
  readonly ruleset: Ruleset;
  readonly rng: Rng;
  readonly createdAtMs: number;

  readonly participants: CharacterRuntime[] = [];
  readonly notableEvents: NotableEvent[] = [];
  /**
   * A SOMA materializada dos participantes (#187, DT-01). É o que o hospedeiro compara por ciclo
   * (`sameAnalyzer`) e o que o bench lê — varrer N participantes a cada leitura seria custo no
   * caminho quente. **Não escrever aqui diretamente**: `credit` escreve no participante e aqui
   * no mesmo passo, e é a única forma de os dois números continuarem batendo.
   */
  readonly aggregates: Aggregates = zeroAggregates();
  readonly #aggregatesByCharacter = new Map<string, Aggregates>();
  /**
   * As amostras carimbadas do DPS/HPS por participante (#431, ADR 0032 d.14). Não é estado do
   * snapshot: são a JANELA dos últimos 60 s, e uma sessão retomada recomeça a janela (os totais
   * da sessão vivem nos agregados). `creditDamage`/`creditHealing` aparam na ESCRITA para o vetor
   * não crescer numa hunt de oito horas sem leitor, e `dpsOf`/`hpsOf` aparam de novo na LEITURA —
   * nada por tick (invariante 2).
   */
  readonly #performanceSamples = new Map<string, {
    readonly damage: PerformanceSample[];
    readonly healing: PerformanceSample[];
  }>();
  /**
   * Instante lógico de entrada de cada participante (#397). Não é evento de domínio: é dado
   * estrutural da sessão, como `#aggregatesByCharacter` — só o `Session` escreve.
   */
  readonly #joinedAtMs = new Map<string, number>();
  /**
   * Onde o extrato de cada personagem que já fez `checkpoint` recomeça na lista de eventos
   * notáveis: uma posição ABSOLUTA, contada desde a criação da sessão e somada de
   * `#notableEventsDropped`, para o teto não deslocar o que já foi entregue.
   *
   * Existe ao lado de `#joinedAtMs` porque o tempo sozinho não decide: no instante do checkpoint
   * há eventos já entregues e, se uma intenção chegar no mesmo instante lógico, eventos que ainda
   * não foram — `atMs >= marco` repetiria os primeiros e `atMs > marco` perderia os segundos.
   * Não entra no snapshot (a sessão `checkpointed` não tem, ADR 0060 d.10a): restaurada sem ele,
   * o extrato cai no filtro por tempo, que no pior caso repete eventos do instante do marco —
   * apresentação, nunca valor.
   *
   * Nasce sob demanda: toda hunt é uma `Session`, e nenhuma delas faz checkpoint.
   */
  #notableCursor: Map<string, number> | null = null;
  /** Os extratos do `end`, memoizados: `end` duas vezes devolve os mesmos, sem `seq` novo. */
  #receipts: readonly Receipt[] | null = null;

  readonly #maxPendingDomainEvents: number;
  /** Quantos eventos de domínio o estouro descarta de uma vez: a metade mais antiga. */
  readonly #domainEventsTrim: number;
  readonly #maxEventsPerAdvance: number;
  readonly #maxNotableEventsPerCharacter: number | undefined;
  /**
   * Quantos eventos notáveis o teto já descartou desde que ESTA instância existe (não entra no
   * snapshot). Quem indexa `notableEvents` por posição — o analisador do hospedeiro guarda "já
   * mandei até aqui" — soma isto para a posição continuar valendo depois de um descarte.
   */
  #notableEventsDropped = 0;

  /** Sequência para idempotência econômica: `UNIQUE (session_id, seq)` (invariante 10). */
  ledgerSeq = 0;

  #viewers = new Set<string>();
  /** Relógio LÓGICO. Começa em zero, anda só com `advanceBy`. Ver `SessionSnapshot`. */
  #logicalNowMs = 0;
  #schedule = new Schedule();
  #domainEvents: DomainEvent[] = [];
  #endedReason: EndReason | null = null;

  /**
   * Reconstrói uma sessão a partir de um snapshot (FUN-27, FUN-28).
   *
   * Visualizadores NÃO são restaurados: são conexões, e conexão não sobrevive à queda de um
   * nó. Uma sessão retomada nasce desanexada, que é o estado correto — quem estava olhando
   * vai reanexar por conta própria.
   */
  static fromSnapshot(
    snapshot: SessionSnapshot,
    ruleset: Ruleset,
    rng: Rng,
    limits: SessionLimits = {},
  ): Session {
    if (snapshot.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
      throw new Error(
        `snapshot format version ${snapshot.formatVersion}; this server reads ` +
          `${SNAPSHOT_FORMAT_VERSION}. Migrate or explicitly discard.`,
      );
    }
    if (ruleset.type !== snapshot.type) {
      throw new Error(`ruleset "${ruleset.type}" does not match snapshot "${snapshot.type}"`);
    }

    const session = new Session({
      id: snapshot.id,
      contentVersion: snapshot.contentVersion,
      ruleset,
      rng,
      createdAtMs: snapshot.createdAtMs,
      ...limits,
    });
    session.#logicalNowMs = snapshot.logicalNowMs;
    session.#schedule = Schedule.fromState(snapshot.schedule);
    session.#endedReason = snapshot.endedReason;
    session.ledgerSeq = snapshot.ledgerSeq;
    Object.assign(session.aggregates, snapshot.aggregates);
    session.notableEvents.push(...snapshot.notableEvents);
    for (const state of snapshot.participants) {
      const character = new CharacterRuntime(state);
      // Os instantes dele são do relógio DESTA sessão (o snapshot gravou os dois juntos): liga sem
      // traduzir, para a transição seguinte saber de onde ele vem (#812).
      character.bindClock(session);
      session.participants.push(character);
    }
    if (snapshot.aggregatesByCharacter !== undefined) {
      for (const [id, own] of Object.entries(snapshot.aggregatesByCharacter)) {
        // `zeroAggregates()` preenche as chaves que o snapshot antigo não tinha (#431): `credit`
        // somaria em `undefined` e viraria `NaN` no primeiro golpe.
        session.#aggregatesByCharacter.set(id, { ...zeroAggregates(), ...own });
      }
    } else if (snapshot.participants.length === 1 && snapshot.participants[0] !== undefined) {
      // Snapshot anterior ao #187: um dono só, e a soma É o agregado dele.
      session.#aggregatesByCharacter.set(snapshot.participants[0].id, { ...snapshot.aggregates });
    }
    if (snapshot.joinedAtMs !== undefined) {
      for (const [id, atMs] of Object.entries(snapshot.joinedAtMs)) {
        session.#joinedAtMs.set(id, atMs);
      }
    }
    if (snapshot.ruleset !== undefined) ruleset.restore?.(snapshot.ruleset);
    ruleset.onResume?.(session);
    return session;
  }

  constructor(options: SessionOptions) {
    this.id = options.id;
    this.contentVersion = options.contentVersion;
    this.ruleset = options.ruleset;
    this.rng = options.rng;
    // Instante do HOSPEDEIRO, guardado para quem investiga — não é o relógio da simulação, e
    // desde a FUN-68 nada aqui dentro o consulta. A simulação começa em zero.
    this.createdAtMs = options.createdAtMs;
    if (options.tieBreak === 'stable') this.#schedule = new Schedule({ tieBreak: 'stable' });
    this.#maxPendingDomainEvents = limitOf('maxPendingDomainEvents', options.maxPendingDomainEvents)
      ?? MAX_PENDING_DOMAIN_EVENTS;
    // `>> 1` de 1 é 0, e um descarte de zero não descartaria nada: o teto mínimo tira ao menos um.
    this.#domainEventsTrim = Math.max(1, this.#maxPendingDomainEvents >> 1);
    this.#maxEventsPerAdvance = limitOf('maxEventsPerAdvance', options.maxEventsPerAdvance)
      ?? MAX_EVENTS_PER_ADVANCE;
    this.#maxNotableEventsPerCharacter = limitOf(
      'maxNotableEventsPerCharacter', options.maxNotableEventsPerCharacter,
    );
  }

  get attached(): boolean {
    return this.#viewers.size > 0;
  }

  get ended(): EndReason | null {
    return this.#endedReason;
  }

  /** Anexar e desanexar não têm efeito nenhum sobre a simulação — é o ADR 0001 em uma linha. */
  attach(viewerId: string): void {
    this.#viewers.add(viewerId);
  }

  detach(viewerId: string): void {
    this.#viewers.delete(viewerId);
  }

  /** Hz atual, dado quem está olhando. `0` = orientada a evento. */
  currentHz(): number {
    return this.ruleset.hz(this.attached);
  }

  enter(character: CharacterRuntime): void {
    if (this.#endedReason) throw new Error(`session ${this.id} has already ended`);
    this.participants.push(character);
    this.#joinedAtMs.set(character.id, this.#logicalNowMs);
    // O personagem atravessa a transição como o MESMO objeto (`createSessionBuilder`), mas o
    // relógio LÓGICO de cada sessão nasce em zero. O que ele guarda como DURAÇÃO (cooldown de
    // magia, condição, imunidade do Cleanse) está no relógio da sessão que o gravou e é traduzido
    // para este ANTES do `onEnter` (o prazo que faltava continua faltando — #812, ADR 0020), para o
    // ruleset que entra enxergar os instantes já no relógio dele e reagendar o que a fila da origem
    // levava consigo. O `undoClock` desfaz a tradução se a entrada for recusada.
    const undoClock = character.moveToClock(this);
    try {
      this.ruleset.onEnter(this, character);
    } catch (error) {
      // `onEnter` pode recusar por lotação (#397) sem que a sessão PRÉ-EXISTENTE seja afetada —
      // reverte a admissão para deixar `participants` exatamente como estava antes da tentativa.
      // Sem isto, os outros N-1 membros de uma hunt já em curso herdariam um (N+1)º fantasma:
      // contado em `session.participants`, sem runner, sem posição no mundo, sem bot armado.
      const index = this.participants.indexOf(character);
      if (index >= 0) this.participants.splice(index, 1);
      this.#joinedAtMs.delete(character.id);
      undoClock();
      throw error;
    }
    // Os CARIMBOS (o último golpe de arma, `lastAttackAtMs`, #550; o último ataque dado ou
    // recebido, `lastCombatActionAtMs`, #625; e os que `resetSessionClockState` lista) não são prazo e
    // não se traduzem: um carimbo de 57 700 ms da hunt anterior ficaria no FUTURO da nova — `isInFight`
    // o leria como "em combate" e travaria a saída por até um minuto que ninguém lutou, e
    // `attackedRecently` erraria assim que o relógio novo alcançasse o valor velho. (A trava de
    // stairhop, #554, não é mais carimbo: desde o #622 é a condição `pacified`, que é prazo e a
    // transição traduz como as outras.) O resultado do combate dependeria de por onde o
    // `CharacterRuntime` passou, e não do estado e da semente (invariante 3). Aqui, e não no
    // `onEnter` de cada ruleset, para nenhuma sessão futura (quest, boss) esquecer; DEPOIS do
    // `onEnter`, para a entrada recusada (party cheia) não apagar o estado de quem continua na
    // sessão de origem. O restore de snapshot NÃO passa por `enter` — o relógio é o mesmo, e a
    // janela quente atravessa.
    character.resetSessionClockState();
  }

  /**
   * Tira um personagem de uma sessão que CONTINUA viva (FUN-71) e devolve quem saiu.
   *
   * É a operação que faltava para a Cidade compartilhada existir: antes disto, "sair" só sabia
   * ser `end`, e um jogador saindo da praça encerraria a praça para todo mundo.
   *
   * Desde o #187 vale em QUALQUER sessão com mais de um dono — a party de hunt (ADR 0027) é a
   * outra: quem sai leva o próprio extrato, e a sessão continua para os outros. O que este
   * método garante: quem saiu sai da lista, o ruleset é avisado para desfazer o que a entrada
   * fez, o extrato dele é emitido com `seq` próprio, e a sessão não termina. Numa sessão de um
   * dono só o hospedeiro não chama isto — lá sair é `end`.
   */
  leave(characterId: string, reason: EndReason = 'manual-exit'): Departure | null {
    const index = this.participants.findIndex((participant) => participant.id === characterId);
    if (index < 0) return null;
    const [character] = this.participants.splice(index, 1);
    if (character === undefined) return null;
    // O instante EXATO da saída, antes de qualquer outra coisa: é dele que o próximo `enter`
    // traduz os prazos do personagem (`CharacterRuntime.markDeparture`).
    character.markDeparture(this);
    this.ruleset.onLeave?.(this, character);
    // O extrato sai DEPOIS do `onLeave`: o settlement da bolsa da party escreve o gold de quem
    // sai, e ele precisa estar no extrato dele. Numa sessão privada, o hospedeiro não chama
    // isto; num shard ele descarta o extrato (agregados zerados) — mas o `seq` é consumido do
    // mesmo jeito, e isso é inofensivo: o que o ledger exige é unicidade, não continuidade.
    const receipt = this.#receiptFor(character, reason);
    this.#aggregatesByCharacter.delete(characterId);
    this.#performanceSamples.delete(characterId);
    this.#notableCursor?.delete(characterId);
    return { character, receipt };
  }

  /**
   * Avisa o ruleset de que `characterId` vai sair desta sessão para outra que o recebe ANTES de ele
   * sair (a transição do hospedeiro: o destino é construído, e só então a origem solta o personagem).
   * Ver `Ruleset.onBeforeLeave`. Não tira ninguém e não emite extrato; quem não é participante, e a
   * sessão que já acabou, não têm o que publicar.
   */
  beforeLeave(characterId: string): void {
    if (this.#endedReason !== null) return;
    const character = this.participants.find((participant) => participant.id === characterId);
    if (character === undefined) return;
    this.ruleset.onBeforeLeave?.(this, character);
  }

  /**
   * Emite o extrato PARCIAL de um personagem que CONTINUA na sessão, e recomeça a contar dele do
   * zero (ADR 0060 d.10b). É o que faz o mundo creditar sem acabar nunca: o hospedeiro chama
   * isto de tempos em tempos e em toda saída, e cada extrato leva só o DELTA desde o anterior.
   *
   * Tem a semântica de delta de `leave`, sem tirar ninguém:
   * 1. emite o extrato (`#receiptFor`), com `seq` novo — `UNIQUE (session_id, seq)` (invariante
   *    10) exige unicidade, não continuidade;
   * 2. zera os agregados DAQUELE personagem — inclusive `durationMs`, que volta a correr no
   *    próximo `advanceBy` — e entrega o que a sessão guardava de instâncias removidas;
   * 3. move o marco de `joinedAtMs` para agora, e a posição da lista de eventos notáveis para o
   *    fim, para o próximo extrato não repetir os eventos deste (ver `#notableCursor`).
   *
   * **O que NÃO zera:**
   * - a SOMA `aggregates` da sessão, que continua o acumulado de tudo que ela produziu, como
   *   depois de um `leave`;
   * - a janela de DPS/HPS (`dpsOf`/`hpsOf`): é apresentação contínua, não parte do extrato;
   * - o outro participante, que não sabe que alguém tirou um extrato.
   *
   * Devolve `null` para quem não é participante e para a sessão que já acabou: o `end` já emitiu
   * os extratos finais, e os agregados dele continuam lá (o analisador os lê) — um extrato novo
   * os creditaria DE NOVO.
   *
   * Não consome sorteio nem agenda evento: o resultado da simulação é o mesmo com ou sem
   * checkpoint, a 1 Hz ou a 10 Hz (invariantes 2 e 3). Quem decide SE uma sessão credita em
   * extratos parciais é `Ruleset.progress`; este método é só o mecanismo.
   */
  checkpoint(characterId: string, reason: EndReason): Receipt | null {
    if (this.#endedReason !== null) return null;
    const character = this.participants.find((participant) => participant.id === characterId);
    if (character === undefined) return null;
    const receipt = this.#receiptFor(character, reason);
    this.#aggregatesByCharacter.set(characterId, zeroAggregates());
    this.#joinedAtMs.set(characterId, this.#logicalNowMs);
    (this.#notableCursor ??= new Map()).set(
      characterId, this.#notableEventsDropped + this.notableEvents.length,
    );
    return receipt;
  }

  /**
   * O instante LÓGICO em que `characterId` entrou na sessão (#397, D7). `undefined` para quem
   * não é participante — e para um snapshot anterior ao #397, que não gravou o campo. É a leitura
   * que o hospedeiro faz para montar `party-state.members[].joinedAtMs` (D12): sem ela, o
   * `joinedAtMs` ficaria preso no snapshot e nunca chegaria ao fio.
   *
   * É o marco de onde o extrato começa: um `checkpoint` o move para o instante em que rodou.
   */
  joinedAtMsOf(characterId: string): number | undefined {
    return this.#joinedAtMs.get(characterId);
  }

  /**
   * Quanto tempo LÓGICO `characterId` passou na sessão ATÉ AGORA: `nowMs` menos o instante em que
   * ele entrou. Dentro de um evento é exato (o relógio está no vencimento dele); entre `advanceBy`
   * é o fim da última janela. É a leitura certa para quem credita o tempo de sessão no INSTANTE em
   * que ela acaba — o `durationMs` dos agregados soma a janela INTEIRA antes de despachar os
   * eventos, então uma sessão que termina por evento no meio da janela contaria o resto dela e o
   * resultado dependeria de como o hospedeiro fatiou o tempo (invariante 3). Vale também dentro
   * de `onLeave`, que roda depois de quem sai ser tirado da lista — o `joinedAtMs` fica. Um
   * snapshot anterior ao #397 não gravou o instante de entrada: `?? 0`, o mesmo do extrato.
   */
  inSessionMsOf(characterId: string): number {
    return Math.max(0, this.#logicalNowMs - (this.#joinedAtMs.get(characterId) ?? 0));
  }

  /**
   * Os agregados DESTE participante (#187). Cria zerado na primeira leitura — um personagem que
   * entra numa sessão em curso começa do zero, inclusive em `durationMs`.
   */
  aggregatesOf(characterId: string): Aggregates {
    let own = this.#aggregatesByCharacter.get(characterId);
    if (own === undefined) {
      own = zeroAggregates();
      this.#aggregatesByCharacter.set(characterId, own);
    }
    return own;
  }

  /**
   * Soma `delta` no participante E na sessão, no mesmo passo. `best*Hit` é MÁXIMO, não soma —
   * é o único campo em que "somar" mentiria, e é por isso que o método existe em vez de
   * `aggregatesOf(id).x += n` espalhado pelo ruleset.
   */
  credit(characterId: string, key: keyof Aggregates, delta: number): void {
    const own = this.aggregatesOf(characterId);
    if (MAX_AGGREGATE_KEYS.has(key)) {
      own[key] = Math.max(own[key], delta);
      this.aggregates[key] = Math.max(this.aggregates[key], delta);
      return;
    }
    own[key] += delta;
    this.aggregates[key] += delta;
  }

  /**
   * O dano causado pelo personagem (#431): soma o total da sessão E carimba a amostra da janela.
   * Escreva por aqui — nunca `credit(id, 'damageDealt', n)` direto —, senão o total e a janela
   * divergem.
   */
  creditDamage(characterId: string, amount: number): void {
    if (amount <= 0) return;
    this.credit(characterId, 'damageDealt', amount);
    const samples = this.#recordPerformance(characterId).damage;
    samples.push({ atMs: this.#logicalNowMs, amount });
    this.#prunePerformance(samples, this.#logicalNowMs);
  }

  /** A cura feita pelo personagem (#431): quem LANÇOU, nunca quem recebeu. Ver `creditDamage`. */
  creditHealing(characterId: string, amount: number): void {
    if (amount <= 0) return;
    this.credit(characterId, 'healingDone', amount);
    const samples = this.#recordPerformance(characterId).healing;
    samples.push({ atMs: this.#logicalNowMs, amount });
    this.#prunePerformance(samples, this.#logicalNowMs);
  }

  /**
   * O DPS do personagem em `nowMs`: a soma das amostras dos últimos 60 s dividida por 60. A
   * janela é aparada AQUI, na leitura — o tempo que passou desde o último evento é o que tira a
   * amostra velha, e nada roda por tick (invariante 2).
   */
  dpsOf(characterId: string, nowMs: number): number {
    return this.#windowSum(this.#performanceSamples.get(characterId)?.damage, nowMs)
      / (PERFORMANCE_WINDOW_MS / 1_000);
  }

  /** O HPS do personagem em `nowMs`, pela mesma janela e a mesma régua de `dpsOf`. */
  hpsOf(characterId: string, nowMs: number): number {
    return this.#windowSum(this.#performanceSamples.get(characterId)?.healing, nowMs)
      / (PERFORMANCE_WINDOW_MS / 1_000);
  }

  #recordPerformance(characterId: string): {
    readonly damage: PerformanceSample[];
    readonly healing: PerformanceSample[];
  } {
    let samples = this.#performanceSamples.get(characterId);
    if (samples === undefined) {
      samples = { damage: [], healing: [] };
      this.#performanceSamples.set(characterId, samples);
    }
    return samples;
  }

  /**
   * Soma as amostras dentro da janela e apara as que já saíram. A poda na ESCRITA usa o relógio
   * do instante do fato; a da LEITURA enxerga o tempo que passou sem evento nenhum — as duas são
   * recortes da MESMA janela, nunca um acumulador paralelo.
   */
  #windowSum(samples: PerformanceSample[] | undefined, nowMs: number): number {
    if (samples === undefined) return 0;
    this.#prunePerformance(samples, nowMs);
    let sum = 0;
    for (const sample of samples) sum += sample.amount;
    return sum;
  }

  /** Tira da frente da lista o que passou da janela. A lista é ordenada por carimbo. */
  #prunePerformance(samples: PerformanceSample[], nowMs: number): void {
    let first = 0;
    while (first < samples.length
      && nowMs - (samples[first] as PerformanceSample).atMs > PERFORMANCE_WINDOW_MS) first += 1;
    if (first > 0) samples.splice(0, first);
  }

  #receiptFor(character: CharacterRuntime, reason: EndReason): Receipt {
    // `?? 0` cobre quem entrou antes desta issue existir (snapshot restaurado sem a chave) e o
    // próprio primeiro participante de uma sessão nova, cujo `joinedAtMs` é o instante zero da
    // sessão — os dois casos devem levar TODOS os eventos, que é o comportamento de hoje.
    const joinedAtMs = this.#joinedAtMs.get(character.id) ?? 0;
    // Quem já fez `checkpoint` recomeça na posição que ele guardou, não no tempo (ver
    // `#notableCursor`); o descarte do teto pode ter levado o que vinha antes dela.
    const cursor = this.#notableCursor?.get(character.id);
    const since = cursor === undefined ? 0 : Math.max(0, cursor - this.#notableEventsDropped);
    return {
      sessionId: this.id,
      characterId: character.id,
      reason,
      seq: ++this.ledgerSeq,
      aggregates: { ...this.aggregatesOf(character.id) },
      notableEvents: (since === 0 ? this.notableEvents : this.notableEvents.slice(since))
        .filter((event) => event.atMs >= joinedAtMs && isNotableEventVisibleTo(event, character.id)),
      removedInstances: character.drainRemovedInstances(),
    };
  }

  /**
   * Avança a simulação em `dtMs`, processando só os eventos que VENCEM na janela.
   *
   * Recebe o INTERVALO, não o instante: o relógio é da sessão, e quem hospeda não tem como
   * saber que horas são aqui dentro. Foi a troca que a FUN-68 fez, e é o que aposenta o
   * `rebaseClock` — o relógio do processo agora mora no hospedeiro, junto do dado que é dele.
   *
   * Antes de cada evento o relógio é posto EXATAMENTE no vencimento dele. É essa linha que faz
   * dez `advanceBy(100)` e um `advanceBy(1000)` produzirem o mesmo estado, e não uma
   * aproximação dele: os dois despacham os mesmos eventos, nos mesmos instantes, na mesma
   * ordem. A equivalência entre taxas deixou de depender de fórmula nenhuma ser escrita com
   * cuidado.
   */
  advanceBy(dtMs: number): void {
    if (dtMs < 0) throw new Error(`dtMs cannot be negative: ${dtMs}`);
    if (this.#endedReason) return;
    if (dtMs === 0) return;

    const targetMs = this.#logicalNowMs + dtMs;
    // Tempo de sessão, não de personagem: todo presente envelhece junto. É o único agregado que
    // o ruleset não escreve — e a soma NÃO é `N × dt`: durationMs da sessão é o tempo dela.
    this.aggregates.durationMs += dtMs;
    for (const participant of this.participants) this.aggregatesOf(participant.id).durationMs += dtMs;

    let processed = 0;
    for (;;) {
      const next = this.#schedule.peek();
      if (next === undefined || next.dueAtMs > targetMs) break;
      if (processed >= this.#maxEventsPerAdvance) {
        // Engasgada: o que venceu vai para o alvo e o atraso morre aqui. Ver
        // `maxEventsPerAdvance` e o ADR 0018 — intervalo pulado é descartado, não devido.
        this.#schedule.deferOverdue(targetMs);
        this.record('advance-truncated', String(dtMs));
        break;
      }
      this.#schedule.pop();
      processed++;
      // Nunca para trás: dois eventos podem vencer no mesmo instante, e um evento agendado
      // com atraso (vencimento já no passado) roda agora, não no passado.
      if (next.dueAtMs > this.#logicalNowMs) this.#logicalNowMs = next.dueAtMs;
      this.ruleset.onEvent(this, next);
      // Encerrou no meio: os eventos restantes não acontecem num mundo que acabou.
      if (this.#endedReason !== null) break;
    }

    this.#logicalNowMs = targetMs;
  }

  /**
   * O "agora" da simulação, em tempo lógico. Durante o despacho de um evento é o instante em
   * que ele venceu. Não é relógio de parede e não serve para exibir data.
   */
  get nowMs(): number {
    return this.#logicalNowMs;
  }

  /** Agenda para daqui a `delayMs`. É a forma que quase todo reagendamento usa. */
  scheduleIn(
    kind: string,
    delayMs: number,
    options: { readonly priority?: number; readonly subject?: string } = {},
  ): ScheduledEvent {
    if (delayMs < 0) throw new Error(`delayMs cannot be negative: ${delayMs}`);
    return this.#schedule.schedule(kind, this.#logicalNowMs + delayMs, options);
  }

  /** Cancela os eventos de um subject — o que um monstro que morre leva junto. */
  cancelEvents(subject: string): number {
    return this.#schedule.cancelSubject(subject);
  }

  /** Cancela só os eventos de um `kind` de um subject — reagendar um passo sem tocar no ataque. */
  cancelEvent(kind: string, subject: string): number {
    return this.#schedule.cancel(kind, subject);
  }

  /** O instante lógico em que vence o evento `kind`/`subject` pendente, ou `null` (ver `Schedule.dueAtOf`). */
  dueAtOf(kind: string, subject: string): number | null {
    return this.#schedule.dueAtOf(kind, subject);
  }

  /** Quantos eventos esperam. Existe para métrica e teste; não é regra de jogo. */
  get pendingEvents(): number {
    return this.#schedule.size;
  }

  /**
   * Registra um acontecimento de gameplay. Sempre — nunca condicionado a haver visualizador.
   *
   * Um `if (temViewer)` aqui mudaria a matemática conforme alguém estivesse olhando, que é o
   * invariante 3 quebrado e o que o §12 proíbe em letra. Viewer decide quem SERIALIZA, nunca
   * o que acontece.
   */
  emit(event: DomainEvent): void {
    this.#domainEvents.push(event);
    // Estourou: descarta a metade mais antiga de UMA vez, e não um por push. `shift()` num
    // vetor cheio é O(n) a cada passo, e numa sessão que ninguém drena isso é o coletor
    // rodando o tempo todo — medido no `pnpm bench:hunts`: 18,8 → 25,5 µs por tick.
    if (this.#domainEvents.length > this.#maxPendingDomainEvents) {
      this.#domainEvents.splice(0, this.#domainEventsTrim);
    }
  }

  /**
   * Retira e devolve o que aconteceu desde a última drenagem.
   *
   * NÃO entra no snapshot: é o que aconteceu, não o que a sessão é. Um evento gravado e
   * reentregue depois de uma retomada viraria um passo repetido na tela de quem reconectou.
   */
  drainEvents(): readonly DomainEvent[] {
    if (this.#domainEvents.length === 0) return EMPTY_EVENTS;
    const drained = this.#domainEvents;
    this.#domainEvents = [];
    return drained;
  }

  /**
   * A morte de um personagem: conta no extrato e entra no MESMO pipeline que a de um monstro.
   * O que ela significa — encerrar, respawnar — é do ruleset, em `onCreatureDied`.
   */
  kill(character: CharacterRuntime): void {
    character.alive = false;
    character.health = 0;
    this.credit(character.id, 'deaths', 1);
    this.record('death', character.id, character.id);
    resolveDeath(this, { kind: 'character', character });
  }

  /**
   * Lista curta para a tela de retorno (§16.2). Não é log: guarda só o que vale contar.
   *
   * `characterId` é o DONO do evento, quando ele tem um (o que aconteceu COM um personagem, e não
   * com a sessão). Só é gravado onde o ruleset escopa os eventos ao dono
   * (`Ruleset.scopesEventsToOwner`): nos demais é ignorado, e a lista continua `{ atMs, type,
   * detail }`, como sempre foi.
   */
  record(type: string, detail?: string, characterId?: string): void {
    const owner = this.ruleset.scopesEventsToOwner === true ? characterId : undefined;
    this.notableEvents.push({
      atMs: this.#logicalNowMs, type,
      ...(detail === undefined ? {} : { detail }),
      ...(owner === undefined ? {} : { characterId: owner }),
    });
    const perCharacter = this.#maxNotableEventsPerCharacter;
    if (perCharacter === undefined) return;
    const excess = this.notableEvents.length - perCharacter * Math.max(1, this.participants.length);
    if (excess > 0) {
      this.notableEvents.splice(0, excess);
      this.#notableEventsDropped += excess;
    }
  }

  /**
   * Os eventos notáveis que `characterId` pode ver, a partir da posição `from` da lista (o
   * "já mandei até aqui" do analisador ao vivo). É o que o hospedeiro lê no lugar de
   * `notableEvents` crua onde fala com UM personagem: o analisador e o `session-state`. Sem dono
   * nos eventos (a instância) devolve a fatia inteira, como a leitura crua devolvia.
   */
  notableEventsFor(characterId: string, from = 0): NotableEvent[] {
    return this.notableEvents.slice(from).filter((event) => isNotableEventVisibleTo(event, characterId));
  }

  /**
   * Quantos eventos notáveis o teto (`maxNotableEventsPerCharacter`) já descartou nesta instância
   * da sessão. Sempre zero sem teto. A posição ABSOLUTA de `notableEvents[i]` é este número + i —
   * é o que o analisador do hospedeiro precisa para o "já mandei até aqui" não apontar para o
   * lugar errado depois de um descarte.
   */
  get notableEventsDropped(): number {
    return this.#notableEventsDropped;
  }

  end(reason: EndReason): readonly Receipt[] {
    if (!this.#endedReason) {
      this.#endedReason = reason;
      // O instante EXATO do fim, de cada um que está dentro: o `advanceBy` que encerrou no meio de
      // um evento ainda empurra o relógio até o alvo depois, e é do fim — não do alvo — que o
      // próximo `enter` traduz os prazos (`CharacterRuntime.markDeparture`).
      for (const participant of this.participants) participant.markDeparture(this);
      this.ruleset.onEnd(this, reason);
      this.record('ended', reason);
      // Um por participante presente, na ordem de entrada — e emitidos AGORA, depois do
      // `onEnd`, para o que ele escreveu (settlement) estar dentro.
      this.#receipts = this.participants.map((participant) => this.#receiptFor(participant, reason));
    }
    return this.receipts();
  }

  /**
   * Os extratos da sessão encerrada, ou vazio enquanto ela vive.
   *
   * Existe porque quem encerra nem sempre é quem precisa do extrato: a morte encerra a hunt
   * de DENTRO do ruleset (§26.1), e o servidor descobre depois, no ciclo. Sem isto ele
   * precisaria chamar `end` de novo só para receber o extrato de volta — o que funciona, e
   * lê como se estivesse encerrando uma sessão já encerrada.
   */
  receipts(): readonly Receipt[] {
    if (this.#endedReason === null) return NO_RECEIPTS;
    // Sessão restaurada já encerrada (o snapshot foi gravado depois do `end`): os extratos
    // foram gravados por quem encerrou; aqui não há o que emitir de novo.
    return this.#receipts ?? NO_RECEIPTS;
  }

  getRngState(): RngState {
    return this.rng.getState();
  }

  /**
   * Snapshot para o Redis (FUN-27). Precisa reconstruir a sessão EXATAMENTE — cooldowns,
   * temporizadores em curso e o estado do gerador aleatório inclusive. Sem o gerador, a
   * sessão retomada continua com outra sequência de loot, e nenhuma investigação de "por
   * que não caiu" fica possível.
   */
  snapshot(): SessionSnapshot {
    const rulesetState = this.ruleset.getState?.();
    return {
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      contentVersion: this.contentVersion,
      id: this.id,
      type: this.ruleset.type,
      createdAtMs: this.createdAtMs,
      logicalNowMs: this.#logicalNowMs,
      schedule: this.#schedule.getState(),
      rng: this.rng.getState(),
      participants: this.participants.map((p) => p.getState()),
      aggregates: { ...this.aggregates },
      aggregatesByCharacter: Object.fromEntries(
        [...this.#aggregatesByCharacter].map(([id, own]) => [id, { ...own }]),
      ),
      ...(this.#joinedAtMs.size === 0 ? {} : {
        joinedAtMs: Object.fromEntries(this.#joinedAtMs),
      }),
      notableEvents: [...this.notableEvents],
      ledgerSeq: this.ledgerSeq,
      endedReason: this.#endedReason,
      ...(rulesetState === undefined ? {} : { ruleset: rulesetState }),
    };
  }
}
