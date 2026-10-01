// Extratos de sessão à espera de virar linha de ledger (FUN-29).
//
//   receipt:{sessionId}          extrato de uma sessão encerrada       TTL longo
//   receipts:char:{characterId}  os extratos pendentes de um personagem TTL longo
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
// índice troca isso por um `SMEMBERS` que quase sempre volta vazio.

import type { ChainableCommander, Redis } from 'ioredis';
import { isFamiliarState, isFightMode, isHazardState, readOfflineTrainingState } from '@draconya/sim';
import type {
  Aggregates, BestiaryState, BosstiaryState, CharacterStorageMap, CharmsState, EndReason, FamiliarState,
  FightMode, HazardState, ItemInstanceOverlay, LearnedSpellsState, NotableEvent, OfflineTrainingState, SkillsState,
} from '@draconya/sim';
import type { BoxedItem } from './loot-box.js';

export interface SessionReceipt {
  readonly sessionId: string;
  readonly characterId: string;
  readonly accountId: string;
  readonly reason: EndReason;
  /** Sequência dentro da sessão. É metade da chave de idempotência do ledger. */
  readonly seq: number;
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
 * Um extrato por MEMBRO (#194, ADR 0027): a party é uma sessão com N donos, e quatro extratos
 * da mesma sessão não podem se sobrescrever. A chave antiga (`receipt:{sessionId}`) continua
 * LIDA por um deploy: extrato em voo gravado por um nó anterior não pode se perder.
 */
const key = (sessionId: string, characterId: string): string => `receipt:${sessionId}:${characterId}`;
const legacyKey = (sessionId: string): string => `receipt:${sessionId}`;
/** Prefixo distinto de `receipt:`, de propósito: o `SCAN` de `pending` não pode pegá-lo. */
const characterKey = (characterId: string): string => `receipts:char:${characterId}`;
const RECEIPT_PATTERN = 'receipt:*';

export class ReceiptStore {
  readonly #redis: Redis;
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(redis: Redis, options: ReceiptStoreOptions = {}) {
    this.#redis = redis;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  async save(receipt: Omit<SessionReceipt, 'endedAtMs'>): Promise<void> {
    const stored: SessionReceipt = { ...receipt, endedAtMs: this.#now() };
    const index = characterKey(receipt.characterId);
    // O extrato e a entrada de índice entram JUNTOS. O índice sozinho é um ponteiro para
    // lugar nenhum, que `pendingFor` limpa; o extrato sozinho seria pior — invisível para
    // quem emite o ticket, e o jogador voltaria a ver o personagem zerar (FUN-56).
    // O índice guarda a CHAVE inteira (#194): `pendingFor` tem o `characterId`, mas guardar
    // só o `sessionId` obrigaria a adivinhar entre a chave nova e a antiga.
    await exec(this.#redis
      .multi()
      .set(key(receipt.sessionId, receipt.characterId), JSON.stringify(stored), 'PX', this.#ttlMs)
      .sadd(index, key(receipt.sessionId, receipt.characterId))
      .pexpire(index, this.#ttlMs));
  }

  /**
   * Os extratos deste personagem que ainda não viraram linha de ledger (FUN-56).
   *
   * Um personagem tem mais de um extrato pendente com facilidade: toda troca de atividade
   * encerra uma sessão, e toda sessão encerrada gera extrato — Cidade → hunt → Cidade já
   * são dois em poucos minutos.
   *
   * O teto existe porque isto roda no caminho de uma requisição HTTP, e cada extrato custa
   * uma transação no Postgres. Encostar nele significa que a varredura está parada há um
   * bom tempo — e nesse mundo a resposta certa é o login continuar rápido e o resto sair no
   * próximo, não a emissão de ticket virar o `jobs` de fato.
   *
   * **Extrato gravado antes desta issue não tem entrada de índice** e não aparece aqui. É
   * degradação aceitável e temporária: durante um deploy em rolagem, o que um nó antigo
   * gravou continua sendo creditado pela varredura do `jobs`, com o atraso de sempre.
   */
  async pendingFor(characterId: string, limit = SETTLE_LIMIT): Promise<SessionReceipt[]> {
    const members = (await this.#redis.smembers(characterKey(characterId))).slice(0, limit);
    if (members.length === 0) return [];

    // Entrada de índice de antes do #194 é um `sessionId` cru; a de agora é a chave inteira.
    const keys = members.map((member) => (member.startsWith('receipt:') ? member : legacyKey(member)));
    const values = await this.#redis.mget(...keys);
    const receipts: SessionReceipt[] = [];
    const stale: string[] = [];
    for (const [index, raw] of values.entries()) {
      const parsed = raw === null ? null : parseReceipt(raw);
      if (parsed === null) stale.push(members[index] as string);
      else receipts.push(parsed);
    }
    // Índice apontando para extrato que não existe mais: ou ele expirou, ou um `remove`
    // morreu entre apagar o extrato e limpar o índice. Limpar na leitura é o que impede o
    // conjunto de crescer para sempre num personagem que joga todo dia.
    if (stale.length > 0) await this.#redis.srem(characterKey(characterId), ...stale);
    return receipts;
  }

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
   * `characterId` junto porque o índice é por personagem e o extrato já foi lido por quem
   * chama: derivá-lo aqui custaria um `GET` a mais para saber algo que o chamador tem na mão.
   */
  async remove(sessionId: string, characterId: string): Promise<void> {
    // As duas chaves e as duas formas de índice: o extrato pode ter sido gravado por um nó
    // anterior ao #194, e apagar só a nova o deixaria para a varredura creditar de novo —
    // a chave única do ledger recusaria, mas o Redis ficaria com lixo até o TTL.
    await exec(this.#redis.multi()
      .del(key(sessionId, characterId))
      .del(legacyKey(sessionId))
      .srem(characterKey(characterId), key(sessionId, characterId), sessionId));
  }
}

/**
 * `exec()` do ioredis não lança quando um comando de dentro do MULTI falha — ele devolve o
 * erro na posição daquele comando. Sem esta conferência, um `SADD` recusado sairia daqui
 * como sucesso, e o extrato ficaria fora do índice sem ninguém saber.
 */
async function exec(pipeline: ChainableCommander): Promise<void> {
  const results = await pipeline.exec();
  if (results === null) throw new Error('redis transaction was aborted');
  for (const [error] of results) if (error !== null) throw error;
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
    reason: value['reason'] as EndReason,
    seq: value['seq'],
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
  };
}
