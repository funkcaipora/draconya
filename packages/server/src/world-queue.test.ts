import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { WorldQueue } from './world-queue.js';
import type { WorldQueueVerdict } from './world-queue.js';
import { SHORT_MS } from './testing/deadlines.js';
import { connectTestRedis } from './testing/redis.js';

// O banco 29 é deste arquivo — ver `testing/redis.ts`. A checagem fica no topo do módulo: `describe.runIf` é
// avaliado na coleta (ver `directory.test.ts`).
const { redis, available } = await connectTestRedis(29);

afterAll(async () => {
  if (available) await redis.quit();
});

// Um mundo por teste, com id único, e a limpeza das chaves DELE em vez de `flushdb`: o Redis local de 16 bancos
// não tem o 29, e o arquivo cai no banco 0, que outros arquivos dividem — um `flushdb` aqui apagaria o estado
// deles no meio do teste. No CI (32 bancos) o banco é só deste arquivo, e o cuidado não custa nada.
const worlds: string[] = [];

afterEach(async () => {
  if (!available) return;
  for (const worldId of worlds.splice(0)) {
    await redis.del(`world:${worldId}:queue`, `world:${worldId}:queue:until`, `world:${worldId}:queue:seq`);
  }
});

/** O relógio do teste: a fila lê o prazo dele, e dormir 20 s de verdade não roda no CI. */
function build() {
  const clock = { nowMs: 1_700_000_000_000 };
  const queue = new WorldQueue(redis, { now: () => clock.nowMs });
  const worldId = `queue-test-${randomUUID()}`;
  worlds.push(worldId);
  const login = (characterId: string, vacancies: number, premium = false): Promise<WorldQueueVerdict> =>
    queue.clientLogin(worldId, characterId, { vacancies, premium });
  return { clock, queue, login, worldId };
}

const refused = (position: number, retryAfterMs = 5_000): WorldQueueVerdict => (
  { admitted: false, position, retryAfterMs }
);

// A fila é a `WaitingList` do Canary (`canary/src/creatures/players/management/waitlist.cpp`), e o que se prende
// aqui é o que ela faz: o atalho sem fila, a posição, a vez que só chega quando a posição CABE nas vagas, o
// prazo de quem não volta, e a tabela de espera.
describe.runIf(available)('a fila do mundo cheio (#842, OW-21)', () => {
  it('sem fila e com vaga, entra sem tocar em nada: nenhuma chave nasce no Redis', async () => {
    const { login, worldId } = build();
    expect(await login('a', 5)).toEqual({ admitted: true });
    // Só as chaves DESTE mundo: o Redis local de 16 bancos junta os arquivos no banco 0, e `world:*` pegaria as do
    // `rest-entry.test.ts` rodando ao lado.
    expect(await redis.keys(`world:${worldId}:*`)).toEqual([]);
  });

  it('sem vaga, o primeiro fica na posição 1 e espera 5 s; o segundo, na 2', async () => {
    const { login, worldId } = build();
    expect(await login('a', 0)).toEqual(refused(1));
    expect(await login('b', 0)).toEqual(refused(2));
  });

  it('quem volta mantém o lugar: a posição não muda e o prazo é renovado', async () => {
    const { clock, queue, login, worldId } = build();
    await login('a', 0);
    await login('b', 0);

    clock.nowMs += 4_000;
    expect(await login('b', 0)).toEqual(refused(2));
    expect(await queue.size(worldId)).toBe(2);
    // O prazo de `b` foi renovado a partir de AGORA: 5 s de espera + 15 s de folga.
    expect(Number(await redis.zscore(`world:${worldId}:queue:until`, 'b'))).toBe(clock.nowMs + 20_000);
  });

  it('quando uma vaga abre, entra o primeiro da fila — e o segundo continua esperando, agora na posição 1', async () => {
    const { login, queue, worldId } = build();
    await login('a', 0);
    await login('b', 0);

    expect(await login('a', 1)).toEqual({ admitted: true });
    // `a` saiu da fila ao entrar.
    expect(await queue.size(worldId)).toBe(1);
    expect(await login('b', 0)).toEqual(refused(1));
  });

  it('NÃO fura a fila: quem chega com a vaga aberta e gente esperando vai para o fim, e o primeiro entra', async () => {
    // O caso que a fila existe para impedir: uma vaga abre, o primeiro da fila ainda não voltou, e um
    // recém-chegado a levaria. No Canary a posição do recém-chegado (2) não cabe em UMA vaga.
    const { login, worldId } = build();
    await login('a', 0);

    expect(await login('novato', 1)).toEqual(refused(2));
    expect(await login('a', 1)).toEqual({ admitted: true });
    // Com `a` dentro e a vaga já ocupada, `novato` é o primeiro.
    expect(await login('novato', 0)).toEqual(refused(1));
  });

  it('com duas vagas, os dois primeiros entram e o terceiro continua esperando', async () => {
    const { login, worldId } = build();
    await login('a', 0);
    await login('b', 0);
    await login('c', 0);

    // O mundo tem 2 vagas livres. `c` (posição 3) chega primeiro, e não cabe.
    expect(await login('c', 2)).toEqual(refused(3));
    expect(await login('b', 2)).toEqual({ admitted: true });
    // Na checagem de `a`, `b` já saiu da fila: `a` é a posição 1.
    expect(await login('a', 2)).toEqual({ admitted: true });
    expect(await login('c', 0)).toEqual(refused(1));
  });

  it('o premium vai para a frente dos comuns, como a lista de prioridade do Canary', async () => {
    const { login, worldId } = build();
    await login('a', 0);
    await login('b', 0);

    expect(await login('p', 0, true)).toEqual(refused(1));
    // E os comuns ganham uma posição.
    expect(await login('a', 0)).toEqual(refused(2));
    expect(await login('b', 0)).toEqual(refused(3));
    // Entre premiums vale a ordem de chegada.
    expect(await login('q', 0, true)).toEqual(refused(2));
    expect(await login('p', 0, true)).toEqual(refused(1));
    expect(await login('a', 0)).toEqual(refused(3));
  });

  it('quem não volta no prazo — a espera mais 15 s — sai da fila, e quem estava atrás sobe', async () => {
    const { clock, login, queue, worldId } = build();
    await login('a', 0);
    await login('b', 0);

    // `b` volta a cada 10 s e `a` some. O prazo de `a` é 5 s + 15 s = 20 s.
    clock.nowMs += 10_000;
    expect(await login('b', 0)).toEqual(refused(2));
    clock.nowMs += 10_000;
    // Agora são 20 s desde a última vez de `a`: o prazo vence (`timeout - time <= 0`) e ele sai.
    expect(await login('b', 0)).toEqual(refused(1));
    expect(await queue.size(worldId)).toBe(1);
  });

  it('a fila só tem vagas contra o que o mundo tem: vaga negativa ou fracionária conta como zero ou o chão', async () => {
    const { queue, worldId } = build();
    expect(await queue.clientLogin(worldId, 'a', { vacancies: -3, premium: false })).toEqual(refused(1));
    expect(await queue.clientLogin(worldId, 'b', { vacancies: 0.9, premium: false })).toEqual(refused(2));
  });

  it('a espera segue a tabela do Canary: 5 s até a posição 4, 10 s até a 9, 20 s até a 19, 60 s até a 49, 120 s dali', async () => {
    const { login, worldId } = build();
    const waits = new Map<number, number>();
    for (let position = 1; position <= 51; position += 1) {
      const verdict = await login(`c${String(position)}`, 0);
      if (verdict.admitted) throw new Error('o mundo não tem vaga');
      expect(verdict.position).toBe(position);
      waits.set(position, verdict.retryAfterMs);
    }
    // `getTime(slot)` do Canary (`waitlist.cpp:53-67`): `slot < 5`, `< 10`, `< 20`, `< 50`, e o resto.
    for (const [position, expected] of [
      [1, 5_000], [4, 5_000], [5, 10_000], [9, 10_000], [10, 20_000], [19, 20_000],
      [20, 60_000], [49, 60_000], [50, 120_000], [51, 120_000],
    ] as const) {
      expect(waits.get(position), `posição ${String(position)}`).toBe(expected);
    }
  });

  it('o prazo de cada um acompanha a espera da posição dele: 15 s de folga sobre ela', async () => {
    const { clock, login, worldId } = build();
    for (let position = 1; position <= 12; position += 1) await login(`c${String(position)}`, 0);
    const deadline = async (characterId: string): Promise<number> =>
      Number(await redis.zscore(`world:${worldId}:queue:until`, characterId)) - clock.nowMs;
    expect(await deadline('c1')).toBe(20_000); // 5 s + 15 s
    expect(await deadline('c6')).toBe(25_000); // 10 s + 15 s
    expect(await deadline('c12')).toBe(35_000); // 20 s + 15 s
  });

  it('`leave` tira o personagem da fila e dos prazos, e quem estava atrás sobe', async () => {
    const { login, queue, worldId } = build();
    await login('a', 0);
    await login('b', 0);

    await queue.leave(worldId, 'a');
    expect(await queue.size(worldId)).toBe(1);
    expect(await redis.zscore(`world:${worldId}:queue:until`, 'a')).toBeNull();
    expect(await login('b', 0)).toEqual(refused(1));
    // Largar quem não está lá não é erro.
    await queue.leave(worldId, 'nunca-esteve');
  });

  it('a fila é POR MUNDO: um mundo não vê a fila do outro', async () => {
    const { queue, login, worldId } = build();
    const other = `${worldId}-other`;
    worlds.push(other);
    await login('a', 0);
    expect(await queue.clientLogin(other, 'b', { vacancies: 0, premium: false })).toEqual(refused(1));
    expect(await queue.size(worldId)).toBe(1);
    expect(await queue.size(other)).toBe(1);
  });

  it('as chaves da fila têm TTL curto: sem uso, a fila some sozinha; o contador de ordem vive mais que ela', async () => {
    const { login, worldId } = build();
    await login('a', 0);
    const queueTtl = await redis.pttl(`world:${worldId}:queue`);
    const untilTtl = await redis.pttl(`world:${worldId}:queue:until`);
    const sequenceTtl = await redis.pttl(`world:${worldId}:queue:seq`);
    expect(queueTtl).toBeGreaterThan(0);
    expect(queueTtl).toBeLessThanOrEqual(150_000);
    expect(untilTtl).toBeGreaterThan(0);
    expect(untilTtl).toBeLessThanOrEqual(150_000);
    // O contador dá a ordem de chegada: se expirasse antes da fila, o próximo da fila ganharia uma ordem
    // MENOR que a de quem já espera, e furaria.
    expect(sequenceTtl).toBeGreaterThan(queueTtl);
  });

  it('a fila viva mantém o contador de ordem vivo: quem espera volta, o contador renova, e o próximo a chegar fica ATRÁS', async () => {
    // O contador só era renovado na chegada de alguém novo. Uma fila de gente que volta a cada poucos segundos
    // mas sem ninguém chegando durante uma hora o deixava expirar, e o recém-chegado nascia com a ordem 1 —
    // empatava com o primeiro e passava na frente do segundo. Ninguém espera um prazo vencer aqui (ver
    // `testing/deadlines.ts`): o contador é encurtado à mão para `SHORT_MS`, e o que se afirma é o prazo
    // GRAVADO depois da volta de `b`. Mutação que mata: renovar só na chegada.
    const { login, worldId } = build();
    const sequence = `world:${worldId}:queue:seq`;
    await login('a', 0);
    await login('b', 0);
    await redis.pexpire(sequence, SHORT_MS);

    expect(await login('b', 0)).toEqual(refused(2));
    expect(await redis.pttl(sequence)).toBeGreaterThan(3_000_000);

    expect(await login('c', 0)).toEqual(refused(3));
    expect(await login('b', 0)).toEqual(refused(2));
  });

  it('a vez de quem entra também renova o contador, se ainda sobrou gente esperando', async () => {
    const { login, worldId } = build();
    const sequence = `world:${worldId}:queue:seq`;
    await login('a', 0);
    await login('b', 0);
    await login('c', 0);
    await redis.pexpire(sequence, SHORT_MS);

    // `a` entra (a posição dele cabe na vaga) e `b` e `c` seguem na fila.
    expect(await login('a', 1)).toEqual({ admitted: true });
    expect(await redis.pttl(sequence)).toBeGreaterThan(3_000_000);

    expect(await login('d', 0)).toEqual(refused(3));
    expect(await login('b', 0)).toEqual(refused(1));
  });

  it('chegadas simultâneas não se atropelam: cada uma recebe uma posição distinta, na ordem em que o Redis as viu', async () => {
    const { login, worldId } = build();
    const verdicts = await Promise.all(Array.from({ length: 30 }, (_, index) => login(`c${String(index)}`, 0)));
    const positions = verdicts.map((verdict) => (verdict.admitted ? -1 : verdict.position)).sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
  });
});
