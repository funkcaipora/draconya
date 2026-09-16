// Preferências aceitas pelo dono da sessão, aguardando Postgres (ADR 0028).
// Uma entrada por personagem, sem TTL: indisponibilidade do banco não pode apagar uma edição.
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { BotConfig } from '@draconya/content';

const KEY = 'bot-config:pending';
const ACKNOWLEDGE = `
if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then
  return redis.call('HDEL', KEYS[1], ARGV[1])
end
return 0
`;

export interface PendingBotConfig {
  readonly serialized: string;
  readonly config: unknown;
}

export class BotConfigStore {
  constructor(private readonly redis: Redis) {}

  async save(characterId: string, config: BotConfig): Promise<void> {
    // O nonce distingue inclusive duas edições com conteúdo idêntico (ABA).
    await this.redis.hset(KEY, characterId, JSON.stringify({ id: randomUUID(), config }));
  }

  async load(characterId: string): Promise<PendingBotConfig | null> {
    const serialized = await this.redis.hget(KEY, characterId);
    if (serialized === null) return null;
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== 'object' || value === null
      || !('id' in value) || typeof value.id !== 'string' || !('config' in value)) {
      throw new Error('Invalid pending bot configuration');
    }
    return { serialized, config: value.config };
  }

  async acknowledge(characterId: string, pending: PendingBotConfig): Promise<void> {
    // Nunca apagar a edição que chegou enquanto a anterior estava sendo gravada no banco.
    await this.redis.eval(ACKNOWLEDGE, 1, KEY, characterId, pending.serialized);
  }

  async pendingCharacters(): Promise<readonly string[]> {
    const ids = new Set<string>();
    let cursor = '0';
    do {
      const [next, entries] = await this.redis.hscan(KEY, cursor, 'COUNT', 100);
      cursor = next;
      for (let i = 0; i < entries.length; i += 2) ids.add(entries[i]!);
    } while (cursor !== '0');
    return [...ids];
  }
}
