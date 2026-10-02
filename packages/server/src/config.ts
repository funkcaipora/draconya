// Configuração por ambiente, validada no boot. Falta de variável obrigatória derruba o
// processo aqui, com mensagem clara — nunca vira `undefined` numa query três camadas abaixo.

import { hostname } from 'node:os';
import { z } from 'zod';

const HttpUrl = z.string().url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'must use http or https');

const HttpOrigin = HttpUrl.refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.username === ''
    && url.password === ''
    && url.pathname === '/'
    && url.search === ''
    && url.hash === '';
}, 'must be an origin without credentials, path, query, or fragment')
  .transform((value) => new URL(value).origin);

const WebSocketUrl = z.string().url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === 'ws:' || url.protocol === 'wss:')
    && url.username === '' && url.password === '' && url.search === '' && url.hash === '';
}, 'must use ws or wss without credentials, query, or fragment');

const VALID_ROLES = ['api', 'game', 'jobs'] as const;
export type RoleName = (typeof VALID_ROLES)[number];

/** Resolve a seleção ANTES dos requisitos de cada papel; nunca consulta outro ambiente. */
export function requestedRoles(source: NodeJS.ProcessEnv): RoleName[] {
  if (source['PROCESSOS'] !== undefined) {
    throw new Error('PROCESSOS was renamed to PROCESSES (ADR 0014). Rename it before starting.');
  }
  const requested = (source['PROCESSES'] ?? 'api,game,jobs')
    .split(',').map((role) => role.trim()).filter(Boolean);
  const invalid = requested.filter((role) => !VALID_ROLES.includes(role as RoleName));
  if (invalid.length > 0) throw new Error(`Invalid PROCESSES value: ${invalid.join(', ')}`);
  if (requested.length === 0) throw new Error('PROCESSES cannot be empty');
  if (new Set(requested).size !== requested.length) throw new Error('PROCESSES cannot contain duplicate roles');
  return requested as RoleName[];
}

const EnvironmentSchema = z.object({
  DATABASE_URL: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
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
  GAME_PUBLIC_URL: WebSocketUrl.default('ws://localhost:7171'),

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

  /**
   * A versão do pacote de arte que o deploy SERVE (`/things/<versão>`, o mesmo número de
   * `VITE_THINGS_URL`). O boot a compara com o inventário contra o qual o conteúdo foi
   * conferido (FUN-21, `served-pack.ts`): divergência é recusa, não aviso.
   */
  THINGS_VERSION: z.string().default('1533'),

  /**
   * O mundo aberto do Tibia sem PvP (ADR 0060). DESLIGADO por default: com a flag desligada tudo
   * funciona exatamente como antes — a Cidade é o espaço compartilhado, o ticket nasce cheio, o
   * repouso é `'city'`, e nenhuma coluna de mundo é lida nem escrita. Ligada, o personagem passa a
   * existir no mundo em repouso (posição, cidade, vida, mana e condições, #836 OW-15), e as peças
   * seguintes do plano (`docs/open-world-plan.md`) se apoiam nela.
   *
   * Aceita `1`/`true` e `0`/`false`: o plano chama de `OPEN_WORLD=1`. Quem a lê são o `api` (o ticket
   * leva os vitais, a lista de personagens reporta o repouso como `'offline'`) e o `game` (todo
   * extrato leva a posição, a cidade, a vida, a mana e as condições); o `jobs` escreve as colunas que
   * o extrato trouxer e a lê só para uma coisa (#838, OW-17): ligada, o CHECKPOINT versionado sem valor
   * movido é aplicado como estado absoluto, sem linha de ledger — e a liquidação do ticket, no `api`,
   * faz o mesmo. O extrato de fim de sessão e de saída segue com a linha. Tem de ser a MESMA no `api` e no `game`: um `game` ligado com o `api` desligado
   * emite extratos sobre personagens que nasceram cheios, e é por isso que o extrato só leva o mundo de
   * quem o ticket trouxe (`receiptWorldStateOf`).
   */
  OPEN_WORLD: z.enum(['1', '0', 'true', 'false']).default('false').transform((v) => v === '1' || v === 'true'),

  /**
   * A cadência do checkpoint do mundo, em milissegundos (#837, OW-16, ADR 0060 d.10d): de quanto em
   * quanto tempo o `game` grava num `MULTI` só o extrato de todo personagem sujo do mundo. O default é
   * 60 000 (60 s) — o que a decisão compra, 3,3 transações por segundo com 200 personagens caçando — e
   * é também o que o mundo PERDE numa queda do nó. O Canary salva de hora em hora
   * (`canary/config.lua.dist:356-362`), e é por isso que o teto é uma hora. Só o `game` a lê, e só tem
   * efeito com `OPEN_WORLD` ligado: sem ele nenhuma sessão é `checkpointed`.
   */
  WORLD_CHECKPOINT_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Configuration = z.infer<typeof EnvironmentSchema> & { readonly PROCESSES: readonly RoleName[] };

export function loadConfiguration(source: NodeJS.ProcessEnv = process.env): Configuration {
  const roles = requestedRoles(source);
  const result = EnvironmentSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`invalid configuration — see .env.example\n${problems}`);
  }
  const configuration: Configuration = { ...result.data, PROCESSES: roles };
  const hasApi = roles.includes('api');
  if ((hasApi || roles.includes('jobs')) && configuration.DATABASE_URL === undefined) {
    throw new Error('DATABASE_URL is required for api and jobs');
  }

  // AUTH_DEV_MODE aceita qualquer e-mail sem verificar. Em produção isso é conta grátis
  // para qualquer um; falhar no boot é a única reação aceitável.
  if (configuration.NODE_ENV === 'production' && configuration.AUTH_DEV_MODE) {
    throw new Error('AUTH_DEV_MODE cannot be enabled in production');
  }
  if (hasApi && ((configuration.WORKOS_API_KEY === undefined) !== (configuration.WORKOS_CLIENT_ID === undefined))) {
    throw new Error('WORKOS_API_KEY and WORKOS_CLIENT_ID must be configured together');
  }
  if (hasApi && configuration.NODE_ENV === 'production') {
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
  if (roles.includes('game') && configuration.NODE_ENV === 'production'
    && new URL(configuration.GAME_PUBLIC_URL).protocol !== 'wss:') {
    throw new Error('GAME_PUBLIC_URL must use wss in production');
  }
  return configuration;
}
