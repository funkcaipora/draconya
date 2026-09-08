// Configuração por ambiente, validada no boot. Falta de variável obrigatória derruba o
// processo aqui, com mensagem clara — nunca vira `undefined` numa query três camadas abaixo.

import { hostname } from 'node:os';
import { z } from 'zod';

const EnvironmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  API_PORT: z.coerce.number().int().positive().default(3000),
  API_ORIGIN: z.string().url().default('http://localhost:5173'),

  GAME_PORT: z.coerce.number().int().positive().default(7171),
  GAME_PUBLIC_URL: z.string().default('ws://localhost:7171'),

  /**
   * Identidade do nó no diretório de sessões. O default cobre o caso de um nó só; com mais
   * de um por máquina ele PRECISA ser distinto, senão dois processos disputam o mesmo
   * batimento e o `api` roteia ticket para o nó errado.
   */
  NODE_ID: z.string().min(1).default(hostname()),

  WORKOS_API_KEY: z.string().optional(),
  WORKOS_CLIENT_ID: z.string().optional(),
  AUTH_DEV_MODE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

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
  if (configuration.NODE_ENV === 'production' && !configuration.WORKOS_API_KEY) {
    throw new Error('WORKOS_API_KEY is required in production');
  }
  return configuration;
}
