// Lock de singleton do `jobs` (FUN-91, ADR 0005).
//
// O `AGENTS.md` raiz e o ADR 0005 descrevem o `jobs` como **"singleton com lock"** desde o
// primeiro dia. O lock nunca existiu: ficou um `TODO(FUN-28)` no `start`, a FUN-28 fechou, e a
// documentação continuou prometendo uma garantia que o código não dava.
//
// **O que dois `jobs` quebram hoje, e o que não quebram.** Escrever extrato é seguro — a
// `UNIQUE (session_id, seq)` do ledger torna o segundo uma operação nula (invariante 10). Varrer
// ticket é seguro — é script Lua atômico. O que NÃO é seguro é a varredura de órfã: ela devolve
// o slot de personagem, e dois processos podem devolver o mesmo slot em instantes diferentes —
// o segundo derrubando uma sessão que nasceu no intervalo.
//
// **Por que tentar a cada ciclo em vez de tomar no boot.** Tomar uma vez exigiria um temporizador
// de renovação em paralelo ao ciclo, e um processo que trava com o lock na mão nunca o solta. Com
// a tentativa por ciclo, quem está vivo renova naturalmente e quem morreu perde por TTL — a
// tomada é consequência de não renovar, não de alguém detectar a morte.

import type { Redis } from 'ioredis';

const KEY = 'jobs:singleton';

/**
 * Quanto o lock sobrevive sem renovação. Precisa ser MAIOR que o intervalo do ciclo, senão o
 * dono o perde entre uma renovação e a seguinte e os dois processos se revezam — que é pior
 * que não ter lock, porque metade dos ciclos não roda.
 *
 * Três ciclos de folga: um ciclo lento não custa a liderança, e um processo morto é substituído
 * em menos de meio minuto.
 */
export const LOCK_TTL_MS = 30_000;

/**
 * Toma o lock, ou o renova se já for meu.
 *
 * `GET` e `SET` num script só, e não `SET NX` seguido de `PEXPIRE`: entre os dois cabe uma queda
 * que deixa a chave sem prazo, e uma chave sem prazo é um `jobs` morto segurando a liderança
 * para sempre. Comparar o dono antes de escrever é o que torna a renovação segura — sem isso,
 * um processo que perdeu o lock por lentidão o roubaria de volta de quem já o tem.
 */
const ACQUIRE = `
local current = redis.call('GET', KEYS[1])
if current == false or current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', tonumber(ARGV[2]))
  return 1
end
return 0
`;

export interface SingletonLock {
  /** `true` se este processo é o `jobs` agora. Chamado uma vez por ciclo. */
  acquire(): Promise<boolean>;
  /** Solta o lock, se for meu. Chamado na drenagem, para o substituto não esperar o TTL. */
  release(): Promise<void>;
}

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

type LockRedis = Redis & {
  acquireJobsLock(key: string, owner: string, ttlMs: string): Promise<number>;
  releaseJobsLock(key: string, owner: string): Promise<number>;
};

/**
 * `owner` identifica o processo, e precisa ser único POR PROCESSO — não por máquina. Dois
 * containers `jobs` no mesmo host com o mesmo `NODE_ID` renovariam o lock um do outro e os
 * dois se achariam donos, que é exatamente o que este arquivo existe para impedir.
 */
export function createSingletonLock(redis: Redis, owner: string): SingletonLock {
  const client = redis as LockRedis;
  client.defineCommand('acquireJobsLock', { numberOfKeys: 1, lua: ACQUIRE });
  client.defineCommand('releaseJobsLock', { numberOfKeys: 1, lua: RELEASE });

  return {
    async acquire() {
      return (await client.acquireJobsLock(KEY, owner, String(LOCK_TTL_MS))) === 1;
    },
    async release() {
      await client.releaseJobsLock(KEY, owner);
    },
  };
}
