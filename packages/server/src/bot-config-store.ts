// Preferências aceitas pelo dono da sessão, aguardando Postgres (ADR 0028).
// Uma entrada por personagem, sem TTL: indisponibilidade do banco não pode apagar uma edição.
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { BotConfig } from '@draconya/content';

const KEY = 'bot-config:pending';
/**
 * Para onde vai uma entrada que não é um envelope (#265). Fica para diagnóstico, sem TTL: quem
 * investiga apaga com `HDEL` depois de olhar. Nunca é lida por ninguém no caminho de admissão.
 */
const CORRUPT_KEY = 'bot-config:corrupt';
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

/**
 * Uma entrada que não é `{ id, config }` — JSON inválido incluído. Não há o que gravar, e
 * deixá-la na fila só bloquearia a admissão daquele personagem (#265): quem a encontra a põe
 * em quarentena e segue com a linha do Postgres, pela regra que vale para as cores do outfit e
 * o Bestiário — valor corrompido vira AUSENTE, nunca login recusado.
 */
export interface CorruptBotConfig {
  readonly serialized: string;
  readonly corrupt: true;
}

function envelopeConfig(serialized: string): { readonly config: unknown } | null {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null
    || !('id' in value) || typeof value.id !== 'string' || !('config' in value)) {
    return null;
  }
  return { config: value.config };
}

export class BotConfigStore {
  constructor(private readonly redis: Redis) {}

  async save(characterId: string, config: BotConfig): Promise<void> {
    // O nonce distingue inclusive duas edições com conteúdo idêntico (ABA).
    await this.redis.hset(KEY, characterId, JSON.stringify({ id: randomUUID(), config }));
  }

  /**
   * Há pendência? Um `HEXISTS`, para a admissão não abrir transação nem travar a linha do
   * personagem no caso comum — nada pendente —, que é o de toda listagem e de quase todo ticket.
   */
  async hasPending(characterId: string): Promise<boolean> {
    return (await this.redis.hexists(KEY, characterId)) === 1;
  }

  /** `null` sem pendência; corrompida vem marcada, não lançada — Redis fora do ar é que lança. */
  async load(characterId: string): Promise<PendingBotConfig | CorruptBotConfig | null> {
    const serialized = await this.redis.hget(KEY, characterId);
    if (serialized === null) return null;
    const envelope = envelopeConfig(serialized);
    return envelope === null ? { serialized, corrupt: true } : { serialized, config: envelope.config };
  }

  async acknowledge(characterId: string, pending: PendingBotConfig | CorruptBotConfig): Promise<void> {
    // Nunca apagar a edição que chegou enquanto a anterior estava sendo gravada no banco.
    await this.redis.eval(ACKNOWLEDGE, 1, KEY, characterId, pending.serialized);
  }

  /**
   * Tira a entrada corrompida da fila e a guarda em `bot-config:corrupt`. A remoção é a mesma
   * comparação do ACK: uma edição válida que chegou por cima da corrompida fica onde está.
   */
  async quarantine(characterId: string, pending: CorruptBotConfig): Promise<void> {
    await this.redis.hset(CORRUPT_KEY, characterId, pending.serialized);
    await this.acknowledge(characterId, pending);
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
