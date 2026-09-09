// Armazenamento de snapshot de sessão (FUN-28).
//
//   session:{characterId}:snapshot   estado serializado    TTL longo, sobrevive ao nó
//
// A chave existir É o índice de "esta sessão deveria estar rodando". Não há lista separada
// de propósito: uma lista precisa ser mantida em sincronia com a realidade, e o dia em que
// ela diverge é o dia em que ou se perde uma sessão ou se ressuscita uma que já acabou.
//
// A regra que define órfã: **o snapshot existe e o lease do diretório não**. O lease morre com
// o nó, o snapshot não — então a diferença entre os dois é exatamente "alguém estava rodando
// isto e parou de renovar".

import type { Redis } from 'ioredis';
import type { SessionSnapshot } from '@draconya/sim';

/**
 * Quanto tempo um snapshot órfão fica disponível para retomada.
 *
 * Generoso de propósito: o jogador de um jogo idle pode voltar no dia seguinte, e o §38.4 diz
 * que uma hunt AFK não pode sumir em silêncio. Apagar cedo é perder progresso de alguém que
 * ainda ia voltar.
 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredSnapshot {
  readonly characterId: string;
  readonly accountId: string;
  readonly nodeId: string;
  readonly savedAtMs: number;
  readonly snapshot: SessionSnapshot;
}

export interface SnapshotStoreOptions {
  readonly ttlMs?: number;
  /** Relógio de parede: o instante é gravado por um processo e lido por outro. */
  readonly now?: () => number;
}

const key = (characterId: string): string => `session:${characterId}:snapshot`;
const SNAPSHOT_PATTERN = 'session:*:snapshot';

export class SnapshotStore {
  readonly #redis: Redis;
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(redis: Redis, options: SnapshotStoreOptions = {}) {
    this.#redis = redis;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  async save(
    characterId: string,
    accountId: string,
    nodeId: string,
    snapshot: SessionSnapshot,
  ): Promise<void> {
    const stored: StoredSnapshot = {
      characterId, accountId, nodeId, savedAtMs: this.#now(), snapshot,
    };
    await this.#redis.set(key(characterId), JSON.stringify(stored), 'PX', this.#ttlMs);
  }

  async load(characterId: string): Promise<StoredSnapshot | null> {
    const raw = await this.#redis.get(key(characterId));
    return raw === null ? null : parseStored(raw);
  }

  async remove(characterId: string): Promise<void> {
    await this.#redis.del(key(characterId));
  }

  /**
   * Ids de personagem com snapshot guardado. `SCAN`, nunca `KEYS` — o Redis é de uma thread
   * só e é o mesmo do diretório de sessões.
   */
  async storedCharacterIds(): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.#redis.scan(
        cursor, 'MATCH', SNAPSHOT_PATTERN, 'COUNT', 100,
      );
      cursor = next;
      for (const found_key of keys) {
        found.push(found_key.slice('session:'.length, -':snapshot'.length));
      }
    } while (cursor !== '0');
    return found;
  }
}

function parseStored(raw: string): StoredSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  if (
    typeof value['characterId'] !== 'string'
    || typeof value['accountId'] !== 'string'
    || typeof value['nodeId'] !== 'string'
    || typeof value['savedAtMs'] !== 'number'
    || typeof value['snapshot'] !== 'object' || value['snapshot'] === null
  ) {
    return null;
  }
  return {
    characterId: value['characterId'],
    accountId: value['accountId'],
    nodeId: value['nodeId'],
    savedAtMs: value['savedAtMs'],
    snapshot: value['snapshot'] as SessionSnapshot,
  };
}
