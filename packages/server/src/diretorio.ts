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

export interface Localizacao {
  readonly sessionId: string;
  readonly nodeId: string;
  readonly tipo: string;
}

export interface OpcoesDoDiretorio {
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
  readonly tetoDeAtivos?: number;
}

const LEASE_PADRAO_MS = 30_000;
const TETO_PADRAO = 2;

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
const RESERVAR_SLOT = `
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
  return 1
end
if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`;

export class DiretorioDeSessoes {
  readonly #redis: Redis;
  readonly #leaseMs: number;
  readonly #teto: number;

  constructor(redis: Redis, opcoes: OpcoesDoDiretorio = {}) {
    this.#redis = redis;
    this.#leaseMs = opcoes.leaseMs ?? LEASE_PADRAO_MS;
    this.#teto = opcoes.tetoDeAtivos ?? TETO_PADRAO;
    this.#redis.defineCommand('reservarSlot', { numberOfKeys: 1, lua: RESERVAR_SLOT });
  }

  // --- onde o personagem está -------------------------------------------------------------

  async registrar(characterId: string, onde: Localizacao): Promise<void> {
    await this.#redis.set(chaveDeSessao(characterId), JSON.stringify(onde), 'PX', this.#leaseMs);
  }

  async ondeEsta(characterId: string): Promise<Localizacao | null> {
    const cru = await this.#redis.get(chaveDeSessao(characterId));
    return cru === null ? null : (JSON.parse(cru) as Localizacao);
  }

  /**
   * Renova em lote. Um `pipeline` por ciclo, não um comando por sessão: com milhares de
   * sessões num nó, a diferença entre os dois é a diferença entre caber e não caber no ciclo.
   */
  async renovar(characterIds: readonly string[]): Promise<void> {
    if (characterIds.length === 0) return;
    const pipeline = this.#redis.pipeline();
    for (const id of characterIds) pipeline.pexpire(chaveDeSessao(id), this.#leaseMs);
    await pipeline.exec();
  }

  async liberar(characterId: string): Promise<void> {
    await this.#redis.del(chaveDeSessao(characterId));
  }

  // --- nós vivos ---------------------------------------------------------------------------

  async pulsar(nodeId: string, carga: { sessoes: number }): Promise<void> {
    await this.#redis.set(
      `node:${nodeId}:heartbeat`, JSON.stringify(carga), 'PX', this.#leaseMs,
    );
  }

  async noEstaVivo(nodeId: string): Promise<boolean> {
    return (await this.#redis.exists(`node:${nodeId}:heartbeat`)) === 1;
  }

  // --- limite de personagens ativos por conta ----------------------------------------------

  /** `true` se o slot foi reservado (ou já era dele). `false` se a conta está no teto. */
  async reservarSlot(accountId: string, characterId: string): Promise<boolean> {
    const r = this.#redis as Redis & {
      reservarSlot(k: string, a: string, b: string, c: string): Promise<number>;
    };
    const ok = await r.reservarSlot(
      chaveDeAtivos(accountId), characterId, String(this.#teto), String(this.#leaseMs),
    );
    return ok === 1;
  }

  async liberarSlot(accountId: string, characterId: string): Promise<void> {
    await this.#redis.srem(chaveDeAtivos(accountId), characterId);
  }

  async slotsAtivos(accountId: string): Promise<string[]> {
    return this.#redis.smembers(chaveDeAtivos(accountId));
  }
}

const chaveDeSessao = (characterId: string): string => `char:${characterId}:session`;
const chaveDeAtivos = (accountId: string): string => `account:${accountId}:active`;
