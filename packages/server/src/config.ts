// Configuração por ambiente, validada no boot. Falta de variável obrigatória derruba o
// processo aqui, com mensagem clara — nunca vira `undefined` numa query três camadas abaixo.

import { hostname } from 'node:os';
import { z } from 'zod';

const HttpUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'must use http or https');

const HttpOrigin = HttpUrl.refine((value) => {
  const url = new URL(value);
  return url.username === ''
    && url.password === ''
    && url.pathname === '/'
    && url.search === ''
    && url.hash === '';
}, 'must be an origin without credentials, path, query, or fragment')
  .transform((value) => new URL(value).origin);

const EnvironmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  API_PORT: z.coerce.number().int().positive().default(3000),
  API_ORIGIN: HttpOrigin.default('http://localhost:5173'),

  GAME_PORT: z.coerce.number().int().positive().default(7171),
  /**
   * Porta do `/metrics` do `jobs` (FUN-59). O `jobs` não tem outra superfície HTTP: a porta
   * existe só para o Prometheus, e é ela que faz o alvo SUMIR quando o processo morre — que é
   * o sinal que se quer, e o que um contador no Redis servido por outro papel não daria.
   */
  JOBS_PORT: z.coerce.number().int().positive().default(3001),
  GAME_PUBLIC_URL: z.string().default('ws://localhost:7171'),

  /**
   * Identidade do nó no diretório de sessões. O default cobre o caso de um nó só; com mais
   * de um por máquina ele PRECISA ser distinto, senão dois processos disputam o mesmo
   * batimento e o `api` roteia ticket para o nó errado.
   */
  NODE_ID: z.string().min(1).default(hostname()),

  WORKOS_API_KEY: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  WORKOS_CLIENT_ID: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(1).optional(),
  ),
  WORKOS_REDIRECT_URI: HttpUrl.default('http://localhost:3000/api/auth/callback'),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),
  AUTH_DEV_MODE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  /**
   * Diretório de `content`. O default é relativo ao diretório de execução, que é a raiz do
   * repositório em desenvolvimento e `/app` na imagem — os dois funcionam, mas o caminho
   * resolvido é registrado no boot de propósito: CWD errado produziria "conteúdo válido,
   * 0 monstros" em vez de erro.
   */
  CONTENT_DIR: z.string().default('./packages/content/data'),

  THINGS_VERSION: z.string().default('1332'),
  THINGS_DIR: z.string().default('./things'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Configuration = z.infer<typeof EnvironmentSchema>;

export function loadConfiguration(source: NodeJS.ProcessEnv = process.env): Configuration {
  const result = EnvironmentSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`invalid configuration — see .env.example\n${problems}`);
  }
  const configuration = result.data;

  // AUTH_DEV_MODE aceita qualquer e-mail sem verificar. Em produção isso é conta grátis
  // para qualquer um; falhar no boot é a única reação aceitável.
  if (configuration.NODE_ENV === 'production' && configuration.AUTH_DEV_MODE) {
    throw new Error('AUTH_DEV_MODE cannot be enabled in production');
  }
  if ((configuration.WORKOS_API_KEY === undefined) !== (configuration.WORKOS_CLIENT_ID === undefined)) {
    throw new Error('WORKOS_API_KEY and WORKOS_CLIENT_ID must be configured together');
  }
  if (configuration.NODE_ENV === 'production') {
    if (!configuration.WORKOS_API_KEY) {
      throw new Error('WORKOS_API_KEY is required in production');
    }
    if (!configuration.WORKOS_CLIENT_ID) {
      throw new Error('WORKOS_CLIENT_ID is required in production');
    }
    if (new URL(configuration.API_ORIGIN).protocol !== 'https:') {
      throw new Error('API_ORIGIN must use https in production');
    }
    if (new URL(configuration.WORKOS_REDIRECT_URI).protocol !== 'https:') {
      throw new Error('WORKOS_REDIRECT_URI must use https in production');
    }
  }
  return configuration;
}
