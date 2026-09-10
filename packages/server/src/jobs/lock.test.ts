import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LOCK_TTL_MS, createSingletonLock } from './lock.js';
import { connectTestRedis } from '../testing/redis.js';

const { redis, available } = await connectTestRedis(9);

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

const KEY = 'jobs:singleton';

describe.runIf(available)('lock de singleton do jobs (FUN-91)', () => {
  it('o primeiro toma e o segundo não', async () => {
    // A garantia que o `AGENTS.md` e o ADR 0005 prometiam desde o primeiro dia e que o código
    // não dava. Sem ela, dois `jobs` varrem órfã ao mesmo tempo — e essa varredura DEVOLVE
    // slot, então o segundo derruba uma sessão que nasceu no intervalo.
    const primeiro = createSingletonLock(redis, 'a');
    const segundo = createSingletonLock(redis, 'b');

    expect(await primeiro.acquire()).toBe(true);
    expect(await segundo.acquire()).toBe(false);
  });

  it('o dono renova sem perder, e continua sendo ele', async () => {
    // A renovação é o mesmo `acquire`: quem está vivo mantém a liderança sem um temporizador
    // paralelo, e sem que o par consiga tomá-la no meio.
    const dono = createSingletonLock(redis, 'a');
    const outro = createSingletonLock(redis, 'b');

    expect(await dono.acquire()).toBe(true);
    expect(await dono.acquire()).toBe(true);
    expect(await outro.acquire()).toBe(false);
    expect(await redis.get(KEY)).toBe('a');
  });

  it('grava PRAZO junto, e não uma chave eterna', async () => {
    // `SET` com `PX` num comando só, e não `SET` seguido de `PEXPIRE`: entre os dois cabe uma
    // queda que deixa a chave sem prazo — e chave sem prazo é um `jobs` morto segurando a
    // liderança para sempre.
    //
    // Afirmar o prazo, e não esperar por ele: testar que o Redis expira é testar o Redis
    // (FUN-62). A tomada depois da morte é provada apagando na mão, que é o que a expiração faz.
    await createSingletonLock(redis, 'a').acquire();

    const ttl = await redis.pttl(KEY);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(LOCK_TTL_MS);
  });

  it('quando o dono some, o substituto assume', async () => {
    const morto = createSingletonLock(redis, 'a');
    const vivo = createSingletonLock(redis, 'b');
    await morto.acquire();
    expect(await vivo.acquire()).toBe(false);

    // É o que a expiração por TTL faz quando o dono para de renovar, sem esperar por ela.
    await redis.del(KEY);

    expect(await vivo.acquire()).toBe(true);
    expect(await redis.get(KEY)).toBe('b');
  });

  it('release só solta o que é meu', async () => {
    // Na drenagem o líder solta para o substituto assumir no ciclo seguinte, em vez de esperar
    // meio minuto de TTL com ninguém varrendo. Soltar o lock ALHEIO seria pior que não soltar.
    const dono = createSingletonLock(redis, 'a');
    const intruso = createSingletonLock(redis, 'b');
    await dono.acquire();

    await intruso.release();
    expect(await redis.get(KEY)).toBe('a');

    await dono.release();
    expect(await redis.get(KEY)).toBeNull();
  });

  it('o TTL cobre mais de um ciclo, senão os dois se revezam', async () => {
    // Se o prazo fosse menor que o intervalo do ciclo, o dono o perderia ENTRE uma renovação e
    // a seguinte, e os dois processos alternariam a liderança — pior que não ter lock, porque
    // metade dos ciclos não roda.
    const SCHEDULE_INTERVAL_MS = 10_000;
    expect(LOCK_TTL_MS).toBeGreaterThan(SCHEDULE_INTERVAL_MS);
  });
});
