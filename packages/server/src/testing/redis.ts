// Conexão de Redis para teste, com um banco por arquivo.
//
// O Vitest roda ARQUIVOS EM PARALELO, e `flushdb` é global. Dois arquivos apontando para o
// mesmo banco apagam o estado um do outro no meio do teste, e o resultado é intermitente e
// dependente da ordem: cada arquivo passa sozinho e falha junto com o outro. Foi exatamente
// o que aconteceu quando o teste de ticket chegou ao lado do teste de diretório.
//
// Um índice de banco por arquivo resolve sem serializar a suíte inteira. Índices em uso:
//
//   0  livre (é o banco do desenvolvimento local)
//   1  directory.test.ts
//   2  tickets.test.ts

import { Redis } from 'ioredis';

export interface TestRedis {
  readonly redis: Redis;
  /** `false` quando não há Redis à mão — o arquivo de teste então pula inteiro. */
  readonly available: boolean;
}

export async function connectTestRedis(db: number): Promise<TestRedis> {
  const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(url, { db, lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.ping();
    return { redis, available: true };
  } catch {
    redis.disconnect();
    return { redis, available: false };
  }
}
