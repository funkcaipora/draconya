// Diretório de sessões e leases (FUN-14, FUN-15).
//
// Duas responsabilidades, ambas em Redis:
//
//   char:{id}:session     onde o personagem está       TTL, renovado pelo nó dono
//   node:{id}:heartbeat   quais nós estão vivos         TTL
//   account:{id}:active   quantos personagens ativos    teto de 2, script atômico
//
// O lease é o que permite detectar nó morto sem coordenação: TTL expirou, a sessão ficou
// órfã. O ajuste do TTL contra o intervalo de renovação é o ponto delicado — ver abaixo.

import type { Redis } from 'ioredis';

export interface SessionLocation {
  readonly sessionId: string;
  readonly nodeId: string;
  readonly type: string;
}

/** O que um nó de jogo publica sobre si mesmo a cada batimento. */
export interface NodeLoad {
  readonly sessions: number;
  /** URL pública do WebSocket deste nó — é dela que sai a `wsUrl` do ticket. */
  readonly url: string;
}

export interface NodeStatus extends NodeLoad {
  readonly nodeId: string;
}

export interface SessionDirectoryOptions {
  /**
   * Validade do lease. Precisa ser FOLGADAMENTE maior que o intervalo de renovação.
   *
   * Apertado demais, uma pausa de GC marca sessão viva como órfã — e aí duas cópias da mesma
   * sessão passam a rodar ao mesmo tempo, o que é pior que perder uma: dobra loot e XP, e o
   * jogador só percebe pelo extrato. Folgado demais, um nó morto segura sessões por mais
   * tempo antes de alguém recuperá-las. Errar para o lado folgado é o certo.
   */
  readonly leaseMs?: number;
  /** Teto de personagens ativos por conta (§7.1). */
  readonly activeLimit?: number;
}

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_ACTIVE_LIMIT = 2;

/**
 * Checar e inserir precisam ser UMA operação.
 *
 * Verificação otimista não serve: `SCARD` seguido de `SADD` em duas idas deixa duas
 * requisições simultâneas passarem pelo mesmo slot, e o §41 exige validação no servidor.
 *
 * Já ativo devolve sucesso — reconectar o mesmo personagem não pode ser recusado por ele
 * mesmo. O `EXPIRE` a cada reserva é o que faz o slot de um nó morto se libertar sozinho:
 * sem ele, um vazamento vira conta que nunca mais consegue logar.
 */
const RESERVE_SLOT = `
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
  return 1
end
if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`;

export class SessionDirectory {
  readonly #redis: Redis;
  readonly #leaseMs: number;
  readonly #activeLimit: number;

  constructor(redis: Redis, options: SessionDirectoryOptions = {}) {
    this.#redis = redis;
    this.#leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.#activeLimit = options.activeLimit ?? DEFAULT_ACTIVE_LIMIT;
    this.#redis.defineCommand('reserveSlot', { numberOfKeys: 1, lua: RESERVE_SLOT });
  }

  // --- onde o personagem está -------------------------------------------------------------

  async register(characterId: string, location: SessionLocation): Promise<void> {
    await this.#redis.set(
      sessionKey(characterId), JSON.stringify(location), 'PX', this.#leaseMs,
    );
  }

  async lookup(characterId: string): Promise<SessionLocation | null> {
    const raw = await this.#redis.get(sessionKey(characterId));
    return raw === null ? null : parseSessionLocation(raw);
  }

  /**
   * Renova em lote. Um `pipeline` por ciclo, não um comando por sessão: com milhares de
   * sessões num nó, a diferença entre os dois é a diferença entre caber e não caber no ciclo.
   */
  async renew(characterIds: readonly string[]): Promise<void> {
    if (characterIds.length === 0) return;
    const pipeline = this.#redis.pipeline();
    for (const id of characterIds) pipeline.pexpire(sessionKey(id), this.#leaseMs);
    await pipeline.exec();
  }

  async release(characterId: string): Promise<void> {
    await this.#redis.del(sessionKey(characterId));
  }

  // --- nós vivos --------------------------------------------------------------------------

  /**
   * O batimento carrega a URL pública do próprio nó porque quem precisa dela é OUTRO
   * processo: o `api` monta a `wsUrl` do ticket (FUN-12) e não tem como saber o endereço
   * externo de um nó de jogo que ele nunca viu. Deduzir de configuração local só funciona
   * enquanto existe um nó só.
   */
  async heartbeat(nodeId: string, load: NodeLoad): Promise<void> {
    await this.#redis.set(nodeKey(nodeId), JSON.stringify(load), 'PX', this.#leaseMs);
  }

  async isNodeAlive(nodeId: string): Promise<boolean> {
    return (await this.#redis.exists(nodeKey(nodeId))) === 1;
  }

  async node(nodeId: string): Promise<NodeStatus | null> {
    const raw = await this.#redis.get(nodeKey(nodeId));
    return raw === null ? null : parseNodeStatus(nodeId, raw);
  }

  /**
   * `SCAN`, nunca `KEYS`. Redis é de uma thread só e é o mesmo Redis do diretório de
   * sessões: um `KEYS` num conjunto grande trava todo mundo pelo tempo da varredura, e o
   * sintoma aparece como lag de jogo em sessões que não têm nada a ver com isto.
   */
  async aliveNodes(): Promise<NodeStatus[]> {
    const nodes: NodeStatus[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.#redis.scan(cursor, 'MATCH', nodeKey('*'), 'COUNT', 100);
      cursor = next;
      if (keys.length === 0) continue;
      const values = await this.#redis.mget(...keys);
      for (const [index, raw] of values.entries()) {
        // Expirou entre o SCAN e o MGET: o nó morreu no meio da varredura, e é justamente
        // por isso que ele não pode entrar na lista.
        if (raw === null) continue;
        const status = parseNodeStatus(nodeIdFromKey(keys[index] ?? ''), raw);
        if (status !== null) nodes.push(status);
      }
    } while (cursor !== '0');
    return nodes;
  }

  // --- limite de personagens ativos por conta ---------------------------------------------

  /** `true` se o slot foi reservado (ou já era dele). `false` se a conta está no teto. */
  async reserveSlot(accountId: string, characterId: string): Promise<boolean> {
    const redis = this.#redis as Redis & {
      reserveSlot(key: string, member: string, limit: string, ttl: string): Promise<number>;
    };
    const reserved = await redis.reserveSlot(
      activeCharactersKey(accountId),
      characterId,
      String(this.#activeLimit),
      String(this.#leaseMs),
    );
    return reserved === 1;
  }

  async releaseSlot(accountId: string, characterId: string): Promise<void> {
    await this.#redis.srem(activeCharactersKey(accountId), characterId);
  }

  async activeSlots(accountId: string): Promise<string[]> {
    return this.#redis.smembers(activeCharactersKey(accountId));
  }
}

const sessionKey = (characterId: string): string => `char:${characterId}:session`;
const activeCharactersKey = (accountId: string): string => `account:${accountId}:active`;
const nodeKey = (nodeId: string): string => `node:${nodeId}:heartbeat`;
const nodeIdFromKey = (key: string): string => key.slice('node:'.length, -':heartbeat'.length);

function parseNodeStatus(nodeId: string, raw: string): NodeStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  const url = value['url'];
  const sessions = value['sessions'];
  // Sem URL o nó existe mas é inalcançável para quem precisa roteá-lo. Descartar é mais
  // seguro que devolver endereço vazio: batimento antigo some sozinho em um lease.
  if (typeof url !== 'string' || url === '' || typeof sessions !== 'number') return null;
  return { nodeId, sessions, url };
}

function parseSessionLocation(raw: string): SessionLocation {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid session directory payload');
  }

  const value = parsed as Record<string, unknown>;
  // Compatibilidade pontual com leases escritos antes da migração. Novas escritas usam
  // `type`; aceitar `type` até os leases antigos expirarem evita perder sessões em deploy.
  const type = value['type'] ?? value['tipo'];
  if (
    typeof value['sessionId'] !== 'string'
    || typeof value['nodeId'] !== 'string'
    || typeof type !== 'string'
  ) {
    throw new Error('Invalid session directory payload');
  }

  const normalizedType = type === 'cidade' ? 'city' : type === 'treino' ? 'training' : type;
  return { sessionId: value['sessionId'], nodeId: value['nodeId'], type: normalizedType };
}
