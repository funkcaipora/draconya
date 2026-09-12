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
import type {
  Aggregates, BestiaryState, EndReason, NotableEvent, SkillsState,
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
   * A munição escolhida por família (#152): `{ arrow: 'sniper-arrow' }`. ABSOLUTA e
   * última-escrita-vence: é preferência do jogador, não progresso — um extrato antigo fora de
   * ordem escreveria a escolha antiga, e o jogador a refaria num clique.
   */
  readonly ammo?: Readonly<Record<string, string>>;
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
   * Os itens que ESTA sessão criou e que couberam na mochila (§22.2, FUN-88).
   *
   * Viram linha de `item_instance` na liquidação. O id vem do `sim` e é determinístico
   * (`sessionId:n`), então reprocessar o extrato insere a mesma chave primária e não faz nada
   * — a mesma idempotência que a `UNIQUE (session_id, seq)` dá ao ledger.
   */
  readonly acquired?: readonly BoxedItem[];
  /**
   * O que caiu e NÃO coube (§21.6). Vai para a Caixa de Loot da Sessão, não para o banco:
   * expirar precisa significar que o item nunca existiu.
   */
  readonly lootBox?: readonly BoxedItem[];
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

const key = (sessionId: string): string => `receipt:${sessionId}`;
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
    await exec(this.#redis
      .multi()
      .set(key(receipt.sessionId), JSON.stringify(stored), 'PX', this.#ttlMs)
      .sadd(index, receipt.sessionId)
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
    const sessionIds = (await this.#redis.smembers(characterKey(characterId))).slice(0, limit);
    if (sessionIds.length === 0) return [];

    const values = await this.#redis.mget(...sessionIds.map(key));
    const receipts: SessionReceipt[] = [];
    const stale: string[] = [];
    for (const [index, raw] of values.entries()) {
      const parsed = raw === null ? null : parseReceipt(raw);
      if (parsed === null) stale.push(sessionIds[index] as string);
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
    await exec(this.#redis.multi()
      .del(key(sessionId))
      .srem(characterKey(characterId), sessionId));
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
    // A munição (#152): lista de PERMISSÃO, pela razão das skills.
    ...(typeof value['ammo'] === 'object' && value['ammo'] !== null
      ? { ammo: value['ammo'] as Record<string, string> }
      : {}),
    // Lista de PERMISSÃO, como o resto desta função: campo que não entra aqui some no caminho
    // de volta sem erro nenhum. Já aconteceu com as skills.
    ...(typeof value['equipment'] === 'object' && value['equipment'] !== null
      ? { equipment: value['equipment'] as Record<string, string> }
      : {}),
    ...(Array.isArray(value['acquired']) ? { acquired: value['acquired'] as BoxedItem[] } : {}),
    ...(Array.isArray(value['lootBox']) ? { lootBox: value['lootBox'] as BoxedItem[] } : {}),
  };
}
