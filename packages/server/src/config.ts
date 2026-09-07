// Configuração por ambiente, validada no boot. Falta de variável obrigatória derruba o
// processo aqui, com mensagem clara — nunca vira `undefined` numa query três camadas abaixo.

import { z } from 'zod';

const Ambiente = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  API_PORT: z.coerce.number().int().positive().default(3000),
  API_ORIGIN: z.string().url().default('http://localhost:5173'),

  GAME_PORT: z.coerce.number().int().positive().default(7171),
  GAME_PUBLIC_URL: z.string().default('ws://localhost:7171'),

  WORKOS_API_KEY: z.string().optional(),
  WORKOS_CLIENT_ID: z.string().optional(),
  AUTH_DEV_MODE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  THINGS_VERSAO: z.string().default('1332'),
  THINGS_DIR: z.string().default('./things'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Configuracao = z.infer<typeof Ambiente>;

export function carregarConfiguracao(fonte: NodeJS.ProcessEnv = process.env): Configuracao {
  const resultado = Ambiente.safeParse(fonte);
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`configuração inválida — veja .env.example\n${problemas}`);
  }
  const cfg = resultado.data;

  // AUTH_DEV_MODE aceita qualquer e-mail sem verificar. Em produção isso é conta grátis
  // para qualquer um; falhar no boot é a única reação aceitável.
  if (cfg.NODE_ENV === 'production' && cfg.AUTH_DEV_MODE) {
    throw new Error('AUTH_DEV_MODE não pode estar ligado em produção');
  }
  if (cfg.NODE_ENV === 'production' && !cfg.WORKOS_API_KEY) {
    throw new Error('WORKOS_API_KEY é obrigatório em produção');
  }
  return cfg;
}
