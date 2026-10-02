// Extratos de sessão à espera de virar linha de ledger (FUN-29).
//
//   receipt:{sessionId}:{characterId}:{seq}   um extrato: UM por (sessão, personagem, seq)   TTL longo
//   receipts:char:v2:{characterId}            ZSET dos pendentes de um personagem,           TTL longo
//                                             score = `durableVersion` (0 se sem versão)
//
// Existe porque creditar é ESCRITA ECONÔMICA e o nó de jogo não fala com o Postgres: o
// caminho quente da simulação não pode ter banco no meio (ver AGENTS.md do pacote). O `game`
// grava o extrato no Redis ao encerrar, e o `jobs` o transforma em linha de ledger.
//
// O par grava-depois-apaga é o que torna isto seguro contra queda: a linha de ledger tem
// `UNIQUE (session_id, seq)` (invariante 10), então reinserir é operação nula. Morrer entre
// inserir e apagar custa uma tentativa repetida, nunca um crédito dobrado.
//
// O índice por personagem existe para a FUN-56: quem emite ticket precisa saber se AQUELE
// personagem tem crédito esperando, e descobrir isso com `SCAN` seria varrer o keyspace
// inteiro — dezenas de milhares de chaves com cinco mil sessões de pé — a cada login. O
// índice troca isso por um `ZRANGE` que quase sempre volta vazio.
//
// **A chave leva o `seq` e o índice é ordenado por versão (#823, OW-02, ADR 0060 decisão 10e).**
// Até aqui a chave era `receipt:{sessionId}:{characterId}`, gravada com `SET`: o segundo extrato
// do mesmo par SOBRESCREVIA o primeiro (Cidade → hunt → Cidade, e o checkpoint do mundo gera
// vários por par), e o índice era um SET, sem ordem — a varredura aplicava na ordem do `SCAN`, o
// ticket na do `SMEMBERS`. Agora nenhum extrato apaga outro, e `pendingFor` devolve os mais
// antigos primeiro.
//
// **O lote do mundo (#837, OW-16)** é `saveBatch`: o checkpoint do mundo grava, de uma vez, o extrato de
// todo personagem sujo num `MULTI` só — o Redis fica com o último lote inteiro, e nunca com a metade
// dele. Cada extrato do lote é um extrato como os outros (mesma chave, mesmo índice, mesma liquidação
// em ordem de versão): o que muda é que entram juntos.
//
// **O formato antigo continua LIDO por um ciclo de deploy (ADR 0014)**: o extrato em voo de um nó
// `game` anterior não pode se perder. São as chaves `receipt:{sessionId}:{characterId}` (#194) e
// `receipt:{sessionId}` (FUN-29), achadas pela varredura, e o SET `receipts:char:{characterId}`,
// que guardava a chave inteira (ou o `sessionId` cru, antes do #194). Um extrato assim não tem
// versão: o ledger o aplica pela regra de antes. A tolerância sai numa issue de limpeza depois.

import type { ChainableCommander, Redis } from 'ioredis';
import { isFamiliarState, isFightMode, isHazardState, readOfflineTrainingState } from '@draconya/sim';
import type {
  Aggregates, BestiaryState, BosstiaryState, CharacterStorageMap, CharmsState, EndReason, FamiliarState,
  FightMode, HazardState, ItemInstanceOverlay, LearnedSpellsState, NotableEvent, OfflineTrainingState, SkillsState,
} from '@draconya/sim';
import type { BoxedItem } from './loot-box.js';
import { readReceiptWorldState } from './world-state.js';
import type { WorldState } from './world-state.js';

/**
 * Por que o extrato foi emitido: o `EndReason` do `sim` — a sessão acabou, ou o personagem saiu — e,
 * só para o hospedeiro, `'checkpoint'`: o extrato PARCIAL que o mundo grava a cada
 * `WORLD_CHECKPOINT_MS` sem que ninguém tenha saído (#837, OW-16, ADR 0060 d.10d). O `sim` não o
 * conhece de propósito — `Session.checkpoint` pede um `EndReason` porque devolve um `Receipt` do
 * mesmo formato, mas o checkpoint não termina nada, e é o hospedeiro quem rotula a linha que grava.
 * Vira o `type` (`session-checkpoint`) da linha de ledger, que é como se distingue um crédito
 * periódico de uma saída ao ler o ledger.
 */
export type ReceiptReason = EndReason | 'checkpoint';

/**
 * **O mundo e os vitais (#836, OW-15, ADR 0060 d.10.f) vêm de `WorldState`:** `worldPosition`,
 * `townId`, `health`, `mana` e `conditions` — o estado de um personagem em REPOUSO, que faz deslogar a
 * 10 HP voltar com 10 HP. São todos ABSOLUTOS e última-escrita-vence, como `ammo`/`blessings`: o `jobs`
 * só os escreve quando `durableVersion > characters.durable_version`. O hospedeiro SÓ os leva com
 * `OPEN_WORLD` ligado — com a flag desligada o extrato é o de antes, e o ledger não toca nas colunas.
 * AUSENTE é "não toque"; `worldPosition: null` é "volta ao templo" e `conditions: []` é "nenhuma"
 * (ver `WorldState`). Quem emite o extrato de quem morreu leva a vida e a mana CHEIAS, a posição nula
 * e nenhuma condição: a morte do Tibia manda ao templo, de volta ao máximo (`player.cpp:4226-4252`).
 */
export interface SessionReceipt extends WorldState {
  readonly sessionId: string;
  readonly characterId: string;
  readonly accountId: string;
  readonly reason: ReceiptReason;
  /** Sequência dentro da sessão. É metade da chave de idempotência do ledger. */
  readonly seq: number;
  /**
   * A versão durável do personagem quando este extrato foi gravado (#823, OW-02, ADR 0060 decisão
   * 10e): um contador POR PERSONAGEM, mantido pelo hospedeiro (`game/host.ts`) — nasce no ticket
   * e sobe a cada extrato gravado, de qualquer sessão. É a ordem entre os extratos de UM
   * personagem, que a `seq` não dá (ela é por sessão, e a Cidade → hunt → Cidade cruza sessões).
   *
   * O `jobs` liquida os pendentes do personagem em ordem de versão, e só escreve um campo
   * ABSOLUTO quando `durableVersion > characters.durable_version`, subindo a coluna na MESMA
   * transação — extrato atrasado nunca desfaz estado mais novo. Os deltas (XP, gold, item) não
   * olham para ela. AUSENTE é extrato de um nó anterior (ou liquidado por fora do `game`, como
   * `pnpm dev:dragon-party --reset`): segue a regra de antes e não mexe na coluna.
   */
  readonly durableVersion?: number;
  readonly aggregates: Aggregates;
  readonly notableEvents: readonly NotableEvent[];
  readonly endedAtMs: number;
  /**
   * Stamina materializada no fim da sessão, e o instante de relógio em que ela valia (§10).
   *
   * Vai como VALOR ABSOLUTO, não como delta, porque stamina não é uma soma: ela cai dentro da
   * hunt e sobe fora dela, e o número que interessa é o de agora. O instante é o que impede
   * um extrato antigo, processado fora de ordem, de sobrescrever um mais novo.
   */
  readonly staminaMs?: number;
  readonly staminaUpdatedAtMs?: number;
  /**
   * As skills no fim da sessão (§9.4, FUN-75).
   *
   * Valor ABSOLUTO, como a stamina — e sem precisar de guarda de instante, porque skill é
   * monotônica: o ledger funde ficando com o maior de cada uma, e um extrato antigo
   * processado fora de ordem não tem como rebaixar nada.
   *
   * Absoluto e não delta porque a sessão já entrou com o valor de verdade (ele vem no
   * ticket): somar delta por cima do que está no banco daria o mesmo número, com uma chance a
   * mais de contar duas vezes.
   */
  readonly skills?: SkillsState;
  /**
   * Os abates por monstro no fim da sessão (§18, FUN-113): `monsterId → abates`.
   *
   * Valor ABSOLUTO, como as skills, e pela mesma razão: abate nunca desce, então o ledger
   * funde ficando com o MAIOR de cada monstro, e um extrato antigo processado fora de ordem
   * não tem como rebaixar nada — sem guarda de instante. Absoluto e não delta porque a sessão
   * já entrou com o valor de verdade (ele vem no ticket): somar delta por cima do que está no
   * banco daria o mesmo número, com uma chance a mais de contar duas vezes.
   */
  readonly bestiary?: BestiaryState;
  /**
   * O Bosstiary (#629, ADR 0052 d.1): abates por boss (chave = `raceId`), pontos de boss e a
   * versão. Valor ABSOLUTO, como o Bestiário, e pela mesma razão: abate e ponto só sobem, então o
   * ledger funde pelo MAIOR de cada boss e dos pontos — um extrato antigo processado fora de
   * ordem não tem como rebaixar nada, sem guarda de instante.
   */
  readonly bosstiary?: BosstiaryState;
  /**
   * A economia de Charms (M39-02, #602, ADR 0052 d.1): pontos/echoes gastos, tier de cada
   * charm e as atribuições. ABSOLUTA e ÚLTIMA-ESCRITA-VENCE, como `ammo`/`equipment` — NÃO
   * fundida pelo maior como o Bestiário: não há aqui um contador externo monotônico, é o
   * estado final da sessão dona.
   */
  readonly charms?: CharmsState;
  /**
   * As magias aprendidas (#624, ADR 0058 d.1, ADR 0052 d.1): os ids de `content.spells` que o
   * personagem comprou. Ao contrário de `charms`/`ammo`, NÃO é última-escrita-vence: o ledger
   * FUNDE pela UNIÃO dos ids (`LearnedSpells.merge`), como o Bestiário funde pelo maior. O
   * registro só CRESCE, e dois extratos pendentes se aplicam em ordem qualquer (o `SCAN` de
   * `pending()` não ordena) — o mais antigo chegando depois do mais novo não pode derrubar uma
   * magia já paga —, e um extrato de base desconhecida (sessão retomada sem registro) carrega só
   * as compras dela e não pode apagar a concessão da migração (ADR 0014). Extrato SEM o campo (nó
   * antigo em deploy) não toca na coluna.
   */
  readonly learnedSpells?: LearnedSpellsState;
  /**
   * O familiar de vocação (M38-02, #599, ADR 0057 d.3, ADR 0052 d.1): os carimbos de relógio de
   * PAREDE — até quando a invocação vale e até quando a magia volta. ABSOLUTO e ÚLTIMA-ESCRITA-
   * VENCE, como `charms` — e NUNCA fundido pelo maior: o `summonUntilMs` DESCE quando o familiar
   * morre (`FamiliarDeath` zera a recriação), e "ficar com o maior" ressuscitaria o familiar se um
   * extrato antigo, fora de ordem, chegasse depois de um mais novo já aplicado. Ausente é sessão
   * sem o registro (Cidade ou nó antigo em deploy): não toca na coluna.
   */
  readonly familiar?: FamiliarState;
  /**
   * O registro do Treino (#631, ADR 0059 d.3, ADR 0052 d.1): o banco de offline training e a skill
   * escolhida no livro. ABSOLUTO e ÚLTIMA-ESCRITA-VENCE, como `charms` — o banco SOBE por tempo de
   * hunt/treino e DESCE quando a `api` o gasta, então fundir por máximo ressuscitaria tempo já
   * gasto. Extrato SEM o campo (nó antigo em deploy) não toca na coluna.
   */
  readonly training?: OfflineTrainingState;
  /**
   * O Hazard (M44-14, #632, ADR 0052 d.1): o teto desbloqueado e o nível escolhido de cada zona.
   * ABSOLUTO e ÚLTIMA-ESCRITA-VENCE, como `charms` — a escolha desce e sobe por vontade do
   * jogador, e fundir pelo maior a desfaria. Ausente é quem nunca tocou no hazard.
   */
  readonly hazard?: HazardState;
  /**
   * A munição escolhida por família (#152): `{ arrow: 'sniper-arrow' }`. ABSOLUTA e
   * última-escrita-vence: é preferência do jogador, não progresso — um extrato antigo fora de
   * ordem escreveria a escolha antiga, e o jogador a refaria num clique.
   */
  readonly ammo?: Readonly<Record<string, string>>;
  /**
   * O estoque de SUPPLY do loot (#520): `{ supplyId: quantidade }`. ABSOLUTO e
   * última-escrita-vence, como `ammo` — mas NÃO é monotônico como o Bestiário: o estoque sobe
   * por loot e desce por uso na mesma sessão (`useSupply`, revisão do #536), então um valor
   * absoluto é o único que os dois lados podem concordar sobre.
   */
  readonly supplyStock?: Readonly<Record<string, number>>;
  /**
   * O estoque de MUNIÇÃO FÍSICA do loot (#520): `{ ammunitionId: quantidade }`, pela mesma
   * razão e a mesma forma do `supplyStock` — munição continua abstrata no tiro (ADR 0026 d.7),
   * mas o que caiu em loot precisa sobreviver à sessão para ser gasto antes do gold.
   */
  readonly ammunitionStock?: Readonly<Record<string, number>>;
  /**
   * Comida ativa no fim da sessão (#726, ADR 0049 decisão 5): `fedMs` restante, em
   * milissegundos. Valor ABSOLUTO, sem guarda de instante — ao contrário da stamina, não
   * recupera fora de hunt (a Cidade não anda), então não há "de agora" a calcular na leitura:
   * o número que a sessão tinha ao encerrar é o número que vale até a próxima.
   */
  readonly fedMs?: number;
  /**
   * As bênçãos no fim da sessão (#570, ADR 0052): o BITMASK de `CharacterRuntime.blessings`.
   * Valor ABSOLUTO, última escrita vence, como `fedMs` — mas ao contrário dele, este campo
   * PODE DESCER a zero dentro da MESMA sessão (a morte consome tudo), e é exatamente por isso
   * que o ledger (`jobs/ledger.ts`) nunca pode fundir por máximo aqui: um extrato antigo
   * processado fora de ordem depois de um mais novo já aplicado ressuscitaria uma bênção que
   * acabou de ser consumida.
   */
  readonly blessings?: number;
  /**
   * A postura de luta no fim da sessão (#550, M30-03, ADR 0040): o `fightMode` de
   * `CharacterRuntime`. Valor ABSOLUTO e última-escrita-vence, como `blessings` — o jogador troca a
   * postura para qualquer lado, então NÃO existe fusão por máximo (não há ordem entre os três
   * modos). Sai em todo extrato do dono, hunt ou Cidade; extrato SEM o campo (nó anterior a esta
   * issue) não toca na coluna.
   */
  readonly fightMode?: FightMode;
  /**
   * A vocação escolhida nesta sessão (#154, ADR 0026 decisão 1). Escrita UMA vez pelo `jobs`
   * (`coalesce`): um extrato fora de ordem com outra vocação não sobrescreve — e não pode
   * haver outra, porque `already-chosen` recusa a segunda na sessão e o ticket a traz de volta.
   */
  readonly vocation?: string;
  /**
   * Pontos de alma (#593). ABSOLUTO e última-escrita-vence, como `ammo`/`equipment` — NUNCA
   * fundido por máximo como `skills`/`bestiary`: alma PODE DESCER (gasta na conjuração), e um
   * extrato antigo fora de ordem não pode reviver um saldo já gasto. Ausente é sessão de
   * Cidade que não tocou alma, ou nó `game` anterior a esta issue.
   */
  readonly soul?: number;
  /**
   * Promovido (#566, ADR 0042 decisão 1). Só `true` viaja — o campo NUNCA carrega `false`
   * (ver `#requestPromoteVocation`/`#saveDurableReceipt`, `game/host.ts`). O `jobs` funde por
   * `OR` (`characters.promoted OR receipt.promoted`): um extrato fora de ordem nunca desce o
   * estado, a mesma garantia que `coalesce` dá à vocação, mas sem precisar de instante — um
   * boolean que só sobe não tem "ausente" a preencher uma vez só.
   */
  readonly promoted?: boolean;
  /**
   * O layout de equipamento no fim da sessão (§21.4, FUN-82): `slot → instanceId`.
   *
   * ABSOLUTO, como as skills: a sessão sabe o estado final, e mandar delta exigiria que os dois
   * lados concordassem sobre o inicial. O que não estiver aqui volta para a mochila.
   *
   * **Item não muda de dono pela sessão** — não há troca nem venda dentro da hunt. O que muda é
   * onde ele está, e é só isso que atravessa.
   */
  readonly equipment?: Readonly<Record<string, string>>;
  /**
   * Onde cada instância está DENTRO dos containers (#160): `instanceId → { container, index }`.
   * ABSOLUTO como `equipment`; instância equipada não aparece; o que não estiver aqui perde a
   * posição gravada e volta ao primeiro lugar livre na próxima entrada.
   */
  readonly layout?: Readonly<Record<string, ItemPlace>>;
  /**
   * O overlay de cada instância que a sessão carrega (#604, ADR 0046): `instanceId → overlay`,
   * `null` para a instância igual à definição. ABSOLUTO para as instâncias listadas, como o
   * layout: o `null` é o que apaga do banco o imbuement que venceu na sessão. Instância que NÃO
   * aparece aqui não é tocada — o extrato de um nó anterior (sem o campo) não apaga nada.
   */
  readonly overlays?: Readonly<Record<string, ItemInstanceOverlay | null>>;
  /**
   * Storages por personagem (#731, ADR 0050 d.6 T2): `storageKey → value`. ABSOLUTO e
   * última-escrita-vence, como `supplyStock` — NÃO gateado por vazio: um storage setado e
   * depois apagado NESTA sessão é um resultado real (voltou a "nunca setado"), e omitir a
   * chave faria o valor antigo ressuscitar no próximo login (a lição do #536). O mapa nunca
   * contém `-1` (a convenção de ausência): quem quer apagar simplesmente não lista a chave
   * aqui — o `jobs` (`applyStorages`, `jobs/ledger.ts`) trata este mapa como o ESTADO INTEIRO
   * do personagem e apaga do banco toda chave que não aparecer nele.
   */
  readonly storages?: CharacterStorageMap;
  /**
   * Os itens que ESTA sessão criou e que couberam na mochila (§22.2, FUN-88).
   *
   * Viram linha de `item_instance` na liquidação. O id vem do `sim` e é determinístico
   * (`sessionId:n`), então reprocessar o extrato insere a mesma chave primária e não faz nada
   * — a mesma idempotência que a `UNIQUE (session_id, seq)` dá ao ledger.
   */
  readonly acquired?: readonly BoxedItem[];
  /**
   * As instâncias que `sell-items`/`discard-item` destruíram nesta sessão (#724, ADR 0048 d.8):
   * o `jobs` apaga as linhas de `item_instance` correspondentes NA MESMA transação da linha de
   * ledger. Ausente/vazio é "nada vendido nem descartado" — a maioria dos extratos.
   */
  readonly removedInstances?: readonly string[];
}

/** Um lugar de container, como o extrato e o banco o guardam (#160). */
export interface ItemPlace {
  readonly container: 'backpack' | 'satchel';
  readonly index: number;
}

export interface ReceiptStoreOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
}

/** Generoso: um extrato perdido é progresso perdido, e ninguém percebe até o extrato faltar. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Quantos extratos de um personagem uma liquidação síncrona processa de uma vez.
 *
 * Cinquenta é inalcançável em operação normal: o extrato vive entre o fim da sessão e a
 * varredura seguinte, e ninguém encerra cinquenta sessões em dez segundos.
 */
const SETTLE_LIMIT = 50;

/**
 * Um extrato por (sessão, personagem, `seq`) (#823, OW-02): a party é uma sessão com N donos
 * (#194, ADR 0027), e o mesmo par grava vários extratos — Cidade → hunt → Cidade, checkpoint do
 * mundo. Sem o `seq` na chave o segundo SOBRESCREVIA o primeiro.
 */
const key = (sessionId: string, characterId: string, seq: number): string =>
  `receipt:${sessionId}:${characterId}:${seq}`;
/**
 * As duas chaves ANTIGAS, só para ler e apagar: `receipt:{sessionId}:{characterId}` (#194) e
 * `receipt:{sessionId}` (FUN-29). Extrato em voo gravado por um nó anterior não pode se perder.
 */
const keyV1 = (sessionId: string, characterId: string): string => `receipt:${sessionId}:${characterId}`;
const legacyKey = (sessionId: string): string => `receipt:${sessionId}`;
/** O SET ANTIGO do índice por personagem, só lido/limpo. Guardava a chave inteira (ou o `sessionId` cru). */
const characterKey = (characterId: string): string => `receipts:char:${characterId}`;
/**
 * O índice por personagem: um ZSET, score = `durableVersion`, membro = a chave do extrato.
 *
 * **Os prefixos são distintos de `receipt:` de propósito:** nomear o índice `receipt:...` o poria
 * dentro do `MATCH` do `SCAN` da varredura, e um ZSET no lugar de um extrato sai do `MGET` como
 * nada — a varredura pararia de ver um extrato por ciclo, sem erro em lugar nenhum.
 */
const versionIndex = (characterId: string): string => `receipts:char:v2:${characterId}`;
const RECEIPT_PATTERN = 'receipt:*';

/**
 * Apaga o extrato e as duas chaves antigas, ATOMICAMENTE e sem apagar o que não é dele: a chave
 * `receipt:{sessionId}:{characterId}` (#194) guardava UM extrato por par, e apagá-la às cegas
 * levaria junto um extrato de outro `seq` que ninguém liquidou. Só sai a que carrega o mesmo
 * `characterId` e o mesmo `seq`.
 *
 * KEYS: 1 = chave nova, 2 = ZSET, 3 = chave #194, 4 = chave FUN-29, 5 = SET antigo.
 * ARGV: 1 = seq, 2 = characterId, 3 = sessionId.
 */
const REMOVE_RECEIPT = `
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], KEYS[1])
for index = 3, 4 do
  local raw = redis.call('GET', KEYS[index])
  if raw then
    local decoded, receipt = pcall(cjson.decode, raw)
    if decoded and type(receipt) == 'table'
      and receipt.characterId == ARGV[2] and receipt.seq == tonumber(ARGV[1]) then
      redis.call('DEL', KEYS[index])
      if index == 3 then
        redis.call('SREM', KEYS[5], KEYS[3])
      else
        redis.call('SREM', KEYS[5], ARGV[3])
      end
    end
  end
end
return 1
`;

export class ReceiptStore {
  readonly #redis: Redis;
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(redis: Redis, options: ReceiptStoreOptions = {}) {
    this.#redis = redis;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#redis.defineCommand('removeSessionReceipt', { numberOfKeys: 5, lua: REMOVE_RECEIPT });
  }

  async save(receipt: Omit<SessionReceipt, 'endedAtMs'>): Promise<void> {
    await exec(this.#queueSave(this.#redis.multi(), { ...receipt, endedAtMs: this.#now() }));
  }

  /**
   * Grava VÁRIOS extratos num `MULTI` só (#837, OW-16, ADR 0060 d.10d): o lote do checkpoint do
   * mundo. É o que faz uma queda deixar o Redis com o último lote INTEIRO, e nunca com a metade
   * dele — o `MULTI` é enviado e executado de uma vez (ou o cliente cai antes do `EXEC` e nada
   * entra), então os duzentos personagens do mundo voltam ao mesmo instante.
   *
   * **Um `MULTI` só, sem fatiar, de propósito.** Fatiar em lotes de cinquenta devolveria a janela em
   * que metade do mundo voltou ao instante novo e a outra metade ao antigo, e a atomicidade é o que
   * a decisão 10d compra. O custo é o tamanho de um comando: o `bench:world` (OW-35) o mede, e é ele
   * quem decide se um dia isto precisa de outra forma.
   *
   * Todos os extratos levam o MESMO `endedAtMs` (o lote é um instante). Lote vazio não fala com o
   * Redis. Um comando que falhe DENTRO do `MULTI` não desfaz os outros — o Redis não tem rollback —,
   * mas é lançado como em `save` (`exec`), e repetir o lote é seguro: as chaves são as mesmas, o `SET`
   * e o `ZADD` regravam o mesmo valor, e o ledger recusa o `(session_id, seq)` que já entrou.
   */
  async saveBatch(receipts: readonly Omit<SessionReceipt, 'endedAtMs'>[]): Promise<void> {
    if (receipts.length === 0) return;
    const endedAtMs = this.#now();
    const pipeline = this.#redis.multi();
    for (const receipt of receipts) this.#queueSave(pipeline, { ...receipt, endedAtMs });
    await exec(pipeline);
  }

  /**
   * Enfileira no `MULTI` o que grava UM extrato.
   *
   * O extrato e a entrada de índice entram JUNTOS. O índice sozinho é um ponteiro para lugar
   * nenhum, que `pendingFor` limpa; o extrato sozinho seria pior — invisível para quem emite o
   * ticket, e o jogador voltaria a ver o personagem zerar (FUN-56).
   *
   * O membro é a CHAVE inteira, e o score é a versão durável (#823): é ele que ordena a
   * liquidação. Sem versão (extrato de fora do `game`) o score é 0 — o mais antigo. Gravar de novo
   * a mesma chave (retry de resposta perdida) troca o score e não duplica a entrada.
   */
  #queueSave(pipeline: ChainableCommander, receipt: SessionReceipt): ChainableCommander {
    const receiptKey = key(receipt.sessionId, receipt.characterId, receipt.seq);
    const index = versionIndex(receipt.characterId);
    return pipeline
      .set(receiptKey, JSON.stringify(receipt), 'PX', this.#ttlMs)
      .zadd(index, receipt.durableVersion ?? 0, receiptKey)
      .pexpire(index, this.#ttlMs);
  }

  /**
   * Os extratos deste personagem que ainda não viraram linha de ledger (FUN-56), do MAIS ANTIGO
   * para o mais novo (#823): o ZSET por versão, com o que um nó anterior deixou no formato
   * antigo à frente — é sempre mais velho, e não tem versão.
   *
   * Um personagem tem mais de um extrato pendente com facilidade: toda troca de atividade
   * encerra uma sessão, e toda sessão encerrada gera extrato — Cidade → hunt → Cidade já
   * são dois em poucos minutos.
   *
   * O teto existe porque isto roda no caminho de uma requisição HTTP, e cada extrato custa
   * uma transação no Postgres. Encostar nele significa que a varredura está parada há um
   * bom tempo — e nesse mundo a resposta certa é o login continuar rápido e o resto sair no
   * próximo, não a emissão de ticket virar o `jobs` de fato. Cortar pelos MAIS ANTIGOS é o que
   * deixa o resto sair no ciclo seguinte sem que um extrato novo passe na frente de um velho.
   *
   * Uma ida ao Redis, não duas: o ZSET e o SET antigo vão no mesmo pipeline.
   *
   * **Extrato gravado antes do #194 (chave `receipt:{sessionId}`, sem entrada de índice) não
   * aparece aqui**: a varredura do `jobs` o encontra, com o atraso de sempre.
   */
  async pendingFor(characterId: string, limit = SETTLE_LIMIT): Promise<SessionReceipt[]> {
    const [versionedKeys, legacyMembers] = await execResults(this.#redis
      .pipeline()
      .zrange(versionIndex(characterId), '0', String(limit - 1))
      .smembers(characterKey(characterId))) as [string[], string[]];

    // Entrada do SET antigo de antes do #194 é um `sessionId` cru; a de depois é a chave inteira.
    const legacyKeys = legacyMembers.map((member) => (member.startsWith('receipt:') ? member : legacyKey(member)));
    const keys = [...versionedKeys, ...legacyKeys];
    if (keys.length === 0) return [];

    const values = await this.#redis.mget(...keys);
    const versioned: SessionReceipt[] = [];
    const legacy: SessionReceipt[] = [];
    const staleVersioned: string[] = [];
    const staleLegacy: string[] = [];
    for (const [index, raw] of values.entries()) {
      const parsed = raw === null ? null : parseReceipt(raw);
      if (index < versionedKeys.length) {
        if (parsed === null) staleVersioned.push(versionedKeys[index] as string);
        else versioned.push(parsed);
      } else if (parsed === null) {
        staleLegacy.push(legacyMembers[index - versionedKeys.length] as string);
      } else {
        legacy.push(parsed);
      }
    }
    // Índice apontando para extrato que não existe mais: ou ele expirou, ou um `remove` morreu
    // entre apagar o extrato e limpar o índice. Limpar na leitura é o que impede o conjunto de
    // crescer para sempre num personagem que joga todo dia.
    if (staleVersioned.length > 0) await this.#redis.zrem(versionIndex(characterId), ...staleVersioned);
    if (staleLegacy.length > 0) await this.#redis.srem(characterKey(characterId), ...staleLegacy);
    legacy.sort((a, b) => a.endedAtMs - b.endedAtMs || a.seq - b.seq);
    return [...legacy, ...versioned].slice(0, limit);
  }

  /**
   * A MAIOR versão durável ainda pendente deste personagem, ou `0` (#823).
   *
   * É o que o ticket soma ao `characters.durable_version` para iniciar o contador do hospedeiro:
   * a sessão nova tem de gravar versões MAIORES que as de qualquer extrato que ainda espera
   * liquidação — uma liquidação que passou de `SETTLE_LIMIT`, por exemplo, deixa pendentes
   * que a coluna ainda não viu. Entrada de índice cujo extrato expirou (TTL) ainda conta: só
   * sobe o piso, sem custo.
   */
  async highestPendingVersion(characterId: string): Promise<number> {
    const [, score] = await this.#redis.zrange(versionIndex(characterId), '-1', '-1', 'WITHSCORES');
    const version = Number(score);
    return Number.isFinite(version) ? version : 0;
  }

  /**
   * Toda a fila, em ordem de `SCAN` e cortada em `limit` — o `jobs` só a usa para saber QUAIS
   * personagens têm pendência: cada um é completado e ordenado pelo índice (`pendingFor`, em
   * `completeGroups` do ledger), porque o corte pode entregar o extrato mais novo de um personagem
   * sem o mais velho (#823). Acha as três formas de chave, e é por isso que a varredura continua
   * sendo o que apanha o extrato de um nó anterior que não tinha índice.
   */
  async pending(limit = 200): Promise<SessionReceipt[]> {
    const receipts: SessionReceipt[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.#redis.scan(
        cursor, 'MATCH', RECEIPT_PATTERN, 'COUNT', 100,
      );
      cursor = next;
      if (keys.length === 0) continue;
      const values = await this.#redis.mget(...keys);
      for (const raw of values) {
        if (raw === null) continue;
        const parsed = parseReceipt(raw);
        if (parsed !== null) receipts.push(parsed);
        if (receipts.length >= limit) return receipts;
      }
    } while (cursor !== '0');
    return receipts;
  }

  /**
   * Apaga o extrato liquidado (#823): precisa do `seq` porque a chave o leva, e porque as duas
   * chaves ANTIGAS guardavam um extrato por par — só sai a que tiver o mesmo `seq`
   * (`REMOVE_RECEIPT`). `characterId` junto porque o índice é por personagem e o extrato já foi
   * lido por quem chama: derivá-lo aqui custaria um `GET` a mais para saber algo que o chamador
   * tem na mão.
   *
   * O extrato pode ter sido gravado por um nó anterior, e apagar só a chave nova o deixaria
   * para a varredura creditar de novo — a chave única do ledger recusaria, mas o Redis ficaria
   * com lixo até o TTL.
   */
  async remove(sessionId: string, characterId: string, seq: number): Promise<void> {
    const redis = this.#redis as unknown as {
      removeSessionReceipt(
        receiptKey: string, index: string, keyV1: string, legacyKey: string, legacyIndex: string,
        seq: string, characterId: string, sessionId: string,
      ): Promise<number>;
    };
    await redis.removeSessionReceipt(
      key(sessionId, characterId, seq), versionIndex(characterId), keyV1(sessionId, characterId),
      legacyKey(sessionId), characterKey(characterId), String(seq), characterId, sessionId,
    );
  }
}

/**
 * `exec()` do ioredis não lança quando um comando de dentro do MULTI falha — ele devolve o
 * erro na posição daquele comando. Sem esta conferência, um `SADD` recusado sairia daqui
 * como sucesso, e o extrato ficaria fora do índice sem ninguém saber.
 */
async function exec(pipeline: ChainableCommander): Promise<void> {
  await execResults(pipeline);
}

/** O mesmo, devolvendo o resultado de cada comando (um pipeline que LÊ). */
async function execResults(pipeline: ChainableCommander): Promise<unknown[]> {
  const results = await pipeline.exec();
  if (results === null) throw new Error('redis transaction was aborted');
  return results.map(([error, value]) => {
    if (error !== null) throw error;
    return value;
  });
}

function parseReceipt(raw: string): SessionReceipt | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  if (
    typeof value['sessionId'] !== 'string'
    || typeof value['characterId'] !== 'string'
    || typeof value['accountId'] !== 'string'
    || typeof value['reason'] !== 'string'
    || typeof value['seq'] !== 'number'
    || typeof value['aggregates'] !== 'object' || value['aggregates'] === null
  ) {
    return null;
  }
  const training = readOfflineTrainingState(value['training']);
  return {
    sessionId: value['sessionId'],
    characterId: value['characterId'],
    accountId: value['accountId'],
    reason: value['reason'] as ReceiptReason,
    seq: value['seq'],
    // A versão durável (#823): lista de PERMISSÃO, pela razão das skills — sem esta linha o campo
    // some no caminho de volta e o ledger trata todo extrato como sem versão, em silêncio.
    // Inteiro seguro não negativo, ou AUSENTE (o lado seguro: a regra de antes).
    ...(typeof value['durableVersion'] === 'number' && Number.isSafeInteger(value['durableVersion'])
      && value['durableVersion'] >= 0
      ? { durableVersion: value['durableVersion'] }
      : {}),
    aggregates: value['aggregates'] as Aggregates,
    notableEvents: Array.isArray(value['notableEvents'])
      ? (value['notableEvents'] as NotableEvent[])
      : [],
    endedAtMs: typeof value['endedAtMs'] === 'number' ? value['endedAtMs'] : 0,
    // Os dois andam juntos: valor sem instante não dá para ordenar, e instante sem valor não
    // diz nada. Meio par é dado corrompido, e a resposta é ignorar o par inteiro.
    ...(typeof value['staminaMs'] === 'number' && typeof value['staminaUpdatedAtMs'] === 'number'
      ? { staminaMs: value['staminaMs'], staminaUpdatedAtMs: value['staminaUpdatedAtMs'] }
      : {}),
    // Skills (FUN-75). Esta função é lista de PERMISSÃO — reconstrói campo a campo em vez de
    // espalhar o que veio —, e campo novo que não entra aqui some no caminho de volta sem
    // erro nenhum. Foi o que aconteceu na primeira vez que escrevi isto.
    ...(typeof value['skills'] === 'object' && value['skills'] !== null
      ? { skills: value['skills'] as SkillsState }
      : {}),
    // Bestiário (FUN-113). Lista de PERMISSÃO, como as skills logo acima — e a razão de esta
    // linha existir é a mesma que a do comentário delas.
    ...(typeof value['bestiary'] === 'object' && value['bestiary'] !== null
      ? { bestiary: value['bestiary'] as BestiaryState }
      : {}),
    // O Bosstiary (#629): lista de PERMISSÃO, pela razão das skills.
    ...(typeof value['bosstiary'] === 'object' && value['bosstiary'] !== null
      ? { bosstiary: value['bosstiary'] as BosstiaryState }
      : {}),
    // O Hazard (#632): lista de PERMISSÃO, pela razão das skills — e só a FORMA, como os Charms.
    ...(isHazardState(value['hazard']) ? { hazard: value['hazard'] } : {}),
    // A economia de Charms (M39-02, #602): lista de PERMISSÃO, pela razão das skills.
    ...(typeof value['charms'] === 'object' && value['charms'] !== null
      ? { charms: value['charms'] as CharmsState }
      : {}),
    // As magias aprendidas (#624): lista de PERMISSÃO, pela razão das skills.
    ...(typeof value['learnedSpells'] === 'object' && value['learnedSpells'] !== null
      ? { learnedSpells: value['learnedSpells'] as LearnedSpellsState }
      : {}),
    // O familiar (M38-02, #599): lista de PERMISSÃO, pela razão das skills — e validado por forma,
    // porque a coluna é `jsonb` sem CHECK e um registro torto nunca deve chegar ao banco.
    ...(isFamiliarState(value['familiar']) ? { familiar: value['familiar'] } : {}),
    // O registro do Treino (#631): lista de PERMISSÃO, pela razão das skills — e conferido pela
    // MESMA leitura defensiva do `sim` que o ticket usa: o ledger o grava direto na coluna `jsonb`,
    // e um banco negativo ou uma skill torta não pode chegar lá. Torto vira ausente.
    ...(training === undefined ? {} : { training }),
    // A munição (#152): lista de PERMISSÃO, pela razão das skills.
    ...(typeof value['ammo'] === 'object' && value['ammo'] !== null
      ? { ammo: value['ammo'] as Record<string, string> }
      : {}),
    // O estoque de supply e de munição física (#520): lista de PERMISSÃO, pela razão das skills.
    ...(typeof value['supplyStock'] === 'object' && value['supplyStock'] !== null
      ? { supplyStock: value['supplyStock'] as Record<string, number> }
      : {}),
    ...(typeof value['ammunitionStock'] === 'object' && value['ammunitionStock'] !== null
      ? { ammunitionStock: value['ammunitionStock'] as Record<string, number> }
      : {}),
    // Comida ativa (#726): lista de PERMISSÃO, pela razão das skills.
    ...(typeof value['fedMs'] === 'number' ? { fedMs: value['fedMs'] } : {}),
    // As bênçãos (#570): lista de PERMISSÃO, pela razão das skills.
    ...(typeof value['blessings'] === 'number' ? { blessings: value['blessings'] } : {}),
    // A postura de luta (#550): lista de PERMISSÃO, pela razão das skills — só um dos três nomes
    // sobrevive à volta; qualquer outra coisa vira ausente, e a coluna fica como estava.
    ...(isFightMode(value['fightMode']) ? { fightMode: value['fightMode'] } : {}),
    // A vocação (#154): lista de PERMISSÃO, pela razão das skills.
    ...(typeof value['vocation'] === 'string' && value['vocation'].length > 0
      ? { vocation: value['vocation'] }
      : {}),
    // Pontos de alma (#593): lista de PERMISSÃO, pela razão das skills.
    ...(typeof value['soul'] === 'number' ? { soul: value['soul'] } : {}),
    // A promoção (#566): lista de PERMISSÃO, pela razão das skills — só `true` sobrevive à
    // volta; `false`/ausente/torto vira ausente, o lado seguro (nunca desce o estado).
    ...(value['promoted'] === true ? { promoted: true } : {}),
    // Lista de PERMISSÃO, como o resto desta função: campo que não entra aqui some no caminho
    // de volta sem erro nenhum. Já aconteceu com as skills.
    ...(typeof value['equipment'] === 'object' && value['equipment'] !== null
      ? { equipment: value['equipment'] as Record<string, string> }
      : {}),
    // A posição dos itens (#160): lista de PERMISSÃO, pela razão das skills.
    ...(typeof value['layout'] === 'object' && value['layout'] !== null
      ? { layout: value['layout'] as Record<string, ItemPlace> }
      : {}),
    // O overlay por instância (#604): lista de PERMISSÃO, pela razão das skills. O conteúdo de
    // cada overlay é conferido na escrita (`ledger`), com a mesma leitura defensiva do ticket.
    ...(typeof value['overlays'] === 'object' && value['overlays'] !== null && !Array.isArray(value['overlays'])
      ? { overlays: value['overlays'] as Record<string, ItemInstanceOverlay | null> }
      : {}),
    // Storages (#731): lista de PERMISSÃO, pela razão das skills. O conteúdo é conferido na
    // escrita (`ledger`, `applyStorages`), com a mesma leitura defensiva do ticket.
    ...(typeof value['storages'] === 'object' && value['storages'] !== null && !Array.isArray(value['storages'])
      ? { storages: value['storages'] as CharacterStorageMap }
      : {}),
    ...(Array.isArray(value['acquired']) ? { acquired: value['acquired'] as BoxedItem[] } : {}),
    // As instâncias vendidas/descartadas (#724, ADR 0048 d.8): lista de PERMISSÃO, pela mesma
    // razão das skills — e é EXATAMENTE o defeito que este comentário já registrava: campo
    // novo em `SessionReceipt` que não entra aqui some no caminho de volta sem erro nenhum. O
    // `item_instance` correspondente nunca seria apagado, e ninguém veria por quê.
    ...(Array.isArray(value['removedInstances'])
      ? { removedInstances: value['removedInstances'] as string[] }
      : {}),
    // O mundo e os vitais (#836, OW-15): lista de PERMISSÃO, pela razão das skills — e conferidos
    // campo a campo pela MESMA leitura que o ticket usa, porque o ledger os grava direto nas colunas
    // e uma coordenada fora do mapa, uma vida negativa ou uma condição com prazo `NaN` não pode
    // chegar lá. Torto vira ausente, e a coluna fica como estava.
    ...readReceiptWorldState(value),
  };
}
