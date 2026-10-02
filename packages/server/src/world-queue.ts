// A fila do mundo cheio (OW-21, #842, ADR 0060 d.2b).
//
//   world:{id}:queue         a fila         ZSET, personagem → ordem (premium antes de comum)
//   world:{id}:queue:until   os prazos      ZSET, personagem → instante em que desiste da vaga
//   world:{id}:queue:seq     o contador     número que dá a ordem de chegada
//
// É a `WaitingList` do Canary (`canary/src/creatures/players/management/waitlist.cpp`), em Redis e com
// a mesma regra de sempre: quem chega com o mundo cheio entra no fim da fila, recebe a posição e o tempo
// para tentar de novo, e só entra quando a posição dele cabe nas vagas que existem (`clientLogin`,
// `waitlist.cpp:69-93`; a resposta ao jogador, em `protocolgame.cpp:1005-1008`). O personagem que deixa
// de voltar sai da fila sozinho, passado o prazo — a fila não tem varredura, e quem a limpa é a próxima
// pessoa que bate nela (`cleanupList`, `waitlist.cpp:33-47`).
//
// **Por que Redis, se o mundo vive num processo só.** O mundo é uma sessão num processo (invariante 9),
// e a fila poderia ser um `Map` desse processo. Fica no Redis porque o processo cai e sobe — e uma fila
// que some junto manda todo mundo de volta para o fim — e porque, com a trava `world:{id}:owner` da
// OW-59, o dono do mundo troca de nó sem que a fila precise andar junto. É estado de apresentação, não
// quente: perdê-lo custa um lugar na fila, nunca um resultado (invariante 3).

import type { Redis } from 'ioredis';

/**
 * O que a fila responde a quem chega do repouso.
 *
 * `admitted: true` — entre; se estava na fila, já saiu dela. `admitted: false` — fique de fora:
 * `position` é o lugar na fila, de 1 em diante (`WaitingList::getClientSlot`), e `retryAfterMs` o tempo
 * até tentar de novo, uma DURAÇÃO medida no instante da resposta (`WaitingList::getTime`, `waitlist.cpp:53-67`; o Canary manda
 * segundos, o Draconya manda milissegundos como todo o resto).
 */
export type WorldQueueVerdict =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly position: number; readonly retryAfterMs: number };

export interface WorldQueueOptions {
  /** Relógio de PAREDE (epoch, ms): o prazo é gravado e lido por chamadas diferentes. Injetável para o teste. */
  readonly now?: () => number;
}

/** O que um personagem ganha por estar na fila depois de ter tentado: a chave só vive enquanto alguém bate nela. */
const KEY_TTL_MS = 150_000;
/** O contador dá a ordem de chegada e precisa viver mais que a fila — que expira em `KEY_TTL_MS` sem uso. */
const SEQUENCE_TTL_MS = 3_600_000;
/** Premium vem antes de comum (`priorityWaitList`, `waitlist.cpp:95-115`): a camada é a parte alta da nota. */
const TIER_WEIGHT = 2 ** 40;

/**
 * `WaitingList::clientLogin`, atômico. Limpar, entrar na fila (ou reencontrar o lugar) e decidir são UMA
 * operação: duas tentativas simultâneas lendo a mesma fila deixariam as duas acharem que são a primeira.
 *
 * `ARGV`: personagem, agora (ms), vagas, camada (0 premium, 1 comum).
 * Devolve `{ admitido (1/0), posição, espera (ms) }`.
 *
 * O tempo de espera e o prazo da vaga seguem `getTime`/`getTimeout` do Canary: 5 s até a posição 4, 10 s
 * até a 9, 20 s até a 19, 60 s até a 49 e 120 s dali em diante; o prazo é a espera mais 15 s de folga
 * (`TIMEOUT_EXTRA`). Esta tabela é a ÚNICA cópia — a do Canary está em `waitlist.cpp:20-24, 49-67`.
 */
const CLIENT_LOGIN = `
local now = tonumber(ARGV[2])
local vacancies = tonumber(ARGV[3])

local stale = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now)
for _, member in ipairs(stale) do
  redis.call('ZREM', KEYS[1], member)
  redis.call('ZREM', KEYS[2], member)
end

-- Sem fila e com vaga: entra sem passar por ela (o atalho de \`clientLogin\`).
if redis.call('ZCARD', KEYS[1]) == 0 and vacancies > 0 then return { 1, 0, 0 } end

local rank = redis.call('ZRANK', KEYS[1], ARGV[1])
if not rank then
  local sequence = redis.call('INCR', KEYS[3])
  redis.call('PEXPIRE', KEYS[3], ${String(SEQUENCE_TTL_MS)})
  redis.call('ZADD', KEYS[1], tonumber(ARGV[4]) * ${String(TIER_WEIGHT)} + sequence, ARGV[1])
  rank = redis.call('ZRANK', KEYS[1], ARGV[1])
end
local slot = rank + 1

local wait = 120
if slot < 5 then wait = 5
elseif slot < 10 then wait = 10
elseif slot < 20 then wait = 20
elseif slot < 50 then wait = 60 end

-- A posição cabe nas vagas: é a vez dele, e sai da fila.
if slot <= vacancies then
  redis.call('ZREM', KEYS[1], ARGV[1])
  redis.call('ZREM', KEYS[2], ARGV[1])
  return { 1, 0, 0 }
end

redis.call('ZADD', KEYS[2], now + (wait + 15) * 1000, ARGV[1])
redis.call('PEXPIRE', KEYS[1], ${String(KEY_TTL_MS)})
redis.call('PEXPIRE', KEYS[2], ${String(KEY_TTL_MS)})
return { 0, slot, wait * 1000 }
`;

const queueKey = (worldId: string): string => `world:${worldId}:queue`;
const untilKey = (worldId: string): string => `world:${worldId}:queue:until`;
const sequenceKey = (worldId: string): string => `world:${worldId}:queue:seq`;

export class WorldQueue {
  readonly #redis: Redis;
  readonly #now: () => number;

  constructor(redis: Redis, options: WorldQueueOptions = {}) {
    this.#redis = redis;
    this.#now = options.now ?? Date.now;
    this.#redis.defineCommand('worldQueueLogin', { numberOfKeys: 3, lua: CLIENT_LOGIN });
  }

  /**
   * O personagem do repouso bate no mundo `worldId`, que tem `vacancies` vagas agora (o `capacity` menos
   * quem está nele). `premium` o põe na frente dos comuns, como a lista de prioridade do Canary.
   *
   * Com o mundo vazio de fila e uma vaga, entra sem tocar em nada. Com fila — mesmo havendo vaga —, o
   * recém-chegado vai para o fim e só entra se a posição dele couber: é isso que impede furar a fila
   * quando uma vaga abre e o primeiro da fila ainda não voltou. Quem já está na fila e volta mantém o
   * lugar e renova o prazo.
   */
  async clientLogin(
    worldId: string,
    characterId: string,
    input: { readonly vacancies: number; readonly premium: boolean },
  ): Promise<WorldQueueVerdict> {
    const redis = this.#redis as Redis & {
      worldQueueLogin(
        queue: string, until: string, sequence: string,
        characterId: string, now: string, vacancies: string, tier: string,
      ): Promise<[number, number, number]>;
    };
    const [admitted, position, retryAfterMs] = await redis.worldQueueLogin(
      queueKey(worldId), untilKey(worldId), sequenceKey(worldId),
      characterId, String(this.#now()), String(Math.max(0, Math.trunc(input.vacancies))),
      input.premium ? '0' : '1',
    );
    return admitted === 1 ? { admitted: true } : { admitted: false, position, retryAfterMs };
  }

  /**
   * Tira o personagem da fila: ele entrou no jogo por outra porta (a hunt idle direta), e a vaga que
   * ele guardava não é mais dele. Sem isto o lugar dele ficaria ocupado até o prazo — até 20 s, com
   * gente atrás esperando uma vaga que ninguém vai usar.
   */
  async leave(worldId: string, characterId: string): Promise<void> {
    await this.#redis.multi()
      .zrem(queueKey(worldId), characterId)
      .zrem(untilKey(worldId), characterId)
      .exec();
  }

  /** Quantos esperam agora no mundo `worldId`, incluindo quem já passou do prazo e ninguém limpou. */
  async size(worldId: string): Promise<number> {
    return this.#redis.zcard(queueKey(worldId));
  }
}
