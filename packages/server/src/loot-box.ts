// A Caixa de Loot da Sessão (§21.6, FUN-88).
//
//   lootbox:{sessionId}   o que caiu e não coube na mochila     TTL de 30 min
//
// **Redis, e não Postgres**, por uma razão que decide sozinha: a caixa EXPIRA, e expirar aqui
// precisa significar que o item nunca existiu. Uma linha em `item_instance` que ninguém
// consegue mais ver é pior que nenhuma — ela aparece em consulta de proveniência, em soma de
// patrimônio, e em toda auditoria que alguém escrever depois. Com TTL, o que expira some.
//
// O relógio começa quando a SESSÃO encerra, não quando o item cai: é o §21.6, e é por isso que
// a chave é por `sessionId`. Enquanto a hunt roda, o que não coube vive no personagem — o
// `sim` não faz I/O (invariante 1), e a caixa só é escrita no encerramento.
//
// **Nada aqui é `item_instance` ainda.** O item vira linha no banco quando o jogador o resgata,
// e resgatar é issue própria. Criar a linha antes tornaria a expiração um `DELETE`, e um
// `DELETE` que some com item de jogador é o tipo de operação que ninguém quer ter escrito.

import type { Redis } from 'ioredis';

/** §21.6: trinta minutos depois do encerramento. */
export const LOOT_BOX_TTL_MS = 30 * 60 * 1000;

/** Um item na caixa. Mesma forma do `CarriedItem` do `sim`, sem depender dele. */
export interface BoxedItem {
  readonly instanceId: string;
  readonly itemId: string;
  readonly quantity: number;
}

const key = (sessionId: string): string => `lootbox:${sessionId}`;
const PATTERN = 'lootbox:*';

export class LootBoxStore {
  readonly #redis: Redis;
  readonly #ttlMs: number;

  constructor(redis: Redis, ttlMs: number = LOOT_BOX_TTL_MS) {
    this.#redis = redis;
    this.#ttlMs = ttlMs;
  }

  /**
   * Guarda o que sobrou, com o prazo correndo a partir de AGORA.
   *
   * Lista vazia não cria chave: uma caixa vazia é indistinguível de não haver caixa, e criar
   * uma para cada sessão encerrada encheria o Redis com nada — 5.000 chaves por rodada de
   * hunts, todas dizendo "não sobrou item".
   */
  async save(sessionId: string, items: readonly BoxedItem[]): Promise<void> {
    if (items.length === 0) return;
    await this.#redis.set(key(sessionId), JSON.stringify(items), 'PX', this.#ttlMs);
  }

  /** O que ainda está na caixa, ou lista vazia — que é o que "expirou" também devolve. */
  async load(sessionId: string): Promise<readonly BoxedItem[]> {
    const raw = await this.#redis.get(key(sessionId));
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as BoxedItem[]) : [];
    } catch {
      // Caixa ilegível é caixa perdida, e perder o conteúdo é melhor que derrubar quem a leu.
      return [];
    }
  }

  /**
   * Quantas caixas ainda existem. É o número que o `jobs` publica (FUN-59).
   *
   * `SCAN`, não `KEYS`: com milhares de chaves, `KEYS` bloqueia o Redis inteiro, e ele é o
   * caminho de toda sessão do nó.
   */
  async pending(): Promise<number> {
    let cursor = '0';
    let total = 0;
    do {
      const [next, keys] = await this.#redis.scan(cursor, 'MATCH', PATTERN, 'COUNT', 100);
      cursor = next;
      total += keys.length;
    } while (cursor !== '0');
    return total;
  }

  /** Quanto falta para esta caixa expirar, em ms. Negativo quando ela não existe. */
  async remainingMs(sessionId: string): Promise<number> {
    return this.#redis.pttl(key(sessionId));
  }
}
