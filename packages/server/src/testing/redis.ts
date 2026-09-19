// Conexão de Redis para teste, com um banco por arquivo.
//
// O Vitest roda ARQUIVOS EM PARALELO, e `flushdb` é global. Dois arquivos apontando para o
// mesmo banco apagam o estado um do outro no meio do teste, e o resultado é intermitente e
// dependente da ordem: cada arquivo passa sozinho e falha junto com o outro. Foi exatamente
// o que aconteceu quando o teste de ticket chegou ao lado do teste de diretório.
//
// Um índice de banco por arquivo resolve sem serializar a suíte inteira. Índices em uso:
//
//   0  api/friends.postgres.test.ts
//   1  directory.test.ts
//   2  tickets.test.ts
//   3  auth/sessions.test.ts
//   4  api/integration.postgres.test.ts
//   5  jobs/ledger.postgres.test.ts
//   6  snapshots.test.ts
//   7  api/phase-one-exit.postgres.test.ts
//   8  receipts.test.ts
//   9  jobs/lock.test.ts
//  10  loot-box.test.ts
//  11  api/phase-two-exit.postgres.test.ts
//  12  party-store.test.ts
//  13  api/party.test.ts
//  14  api/party-exit.postgres.test.ts
//  15  api/matchmaking.test.ts
//
// A spec da #403 reservou o índice 18 (16 do #407, 17 do #402/#400), mas este Redis de teste
// — e o `redis:7-alpine` do CI — têm só os bancos 0 a 15: `SELECT 18` é `ERR DB index is out
// of range`, e o teste cairia no banco 0 em silêncio. Enquanto ninguém subir `--databases` na
// infraestrutura, o único índice livre é o 0, e é ele que `friends.postgres.test.ts` usa.
//
// Esta lista já foi violada uma vez, e por isso existe `testing/redis.test.ts`: ele lê os
// arquivos de teste e reprova se dois pedirem o mesmo índice. Comentário não impede colisão;
// teste impede.
//
// O mesmo arquivo guarda a outra metade da estabilidade da suíte: o PRAZO das chaves. Ver
// `testing/deadlines.ts` — prazo curto demais reprova sob carga, e sorteia qual teste cai.

import { Redis } from 'ioredis';

export interface TestRedis {
  readonly redis: Redis;
  /** `false` quando não há Redis à mão — o arquivo de teste então pula inteiro. */
  readonly available: boolean;
}

export async function connectTestRedis(db: number): Promise<TestRedis> {
  // Nunca assumir que o Redis de desenvolvimento pode sofrer FLUSHDB. O destino de
  // integração deve ser explicitamente dedicado aos testes.
  const url = process.env['TEST_REDIS_URL'];
  if (url === undefined) {
    throw new Error('TEST_REDIS_URL must point to a disposable Redis instance');
  }
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
