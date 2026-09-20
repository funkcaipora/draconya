// Argumentos do cliente de carga (FUN-45).
//
// Separado do `main` para ser testável sem subir processo nenhum: a análise de argumento é
// exatamente o tipo de código que ninguém testa e que erra em silêncio — `--sessoes 1000`
// virando `NaN` sobe zero sessões e o relatório diz que tudo passou.

export interface LoadOptions {
  readonly apiUrl: string;
  readonly metricsUrl: string | null;
  readonly sessions: number;
  readonly mode: 'attached' | 'detached';
  readonly durationMs: number;
  readonly workers: number;
  readonly huntId: string;
  readonly difficulty: string;
  readonly pingIntervalMs: number;
  readonly rampMs: number;
  readonly json: string | null;
  /** Tamanho da party (#198): 1 é solo, o de sempre; N agrupa as sessões de N em N. */
  readonly party: number;
  /** "Ativar rateio" (§4, ADR 0033 D1) — o antigo `shared` de `--party-mode`. Padrão `true`. */
  readonly shareCosts: boolean;
  /** "Dividir lucro" (§5, ADR 0033 D1) — o outro eixo. Padrão `true`. */
  readonly splitLoot: boolean;
}

export class ArgumentError extends Error {}

/** `10m`, `90s`, `1500ms` ou um número puro em milissegundos. */
export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value.trim());
  if (match === null) throw new ArgumentError(`duração inválida: "${value}"`);
  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  const factor = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[unit] ?? 1;
  return Math.round(amount * factor);
}

const DEFAULTS = {
  apiUrl: 'http://127.0.0.1:8080',
  sessions: 1_000,
  mode: 'detached' as const,
  durationMs: 60_000,
  huntId: 'rat-cellars',
  difficulty: 'cautious',
  pingIntervalMs: 1_000,
  rampMs: 2,
  party: 1,
  shareCosts: true,
  splitLoot: true,
};

export function parseArguments(argv: readonly string[], cpuCount: number): LoadOptions {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === undefined || !key.startsWith('--') || value === undefined) {
      throw new ArgumentError(`argumento solto: "${key ?? ''}"`);
    }
    flags.set(key.slice(2), value);
  }

  const number = (name: string, fallback: number): number => {
    const raw = flags.get(name);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    // `Number('mil')` é `NaN`, e `NaN` sessões abre zero em silêncio: o relatório diria que
    // tudo passou porque nada falhou.
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ArgumentError(`--${name} precisa ser um número: "${raw}"`);
    }
    return parsed;
  };

  const mode = flags.get('mode') ?? DEFAULTS.mode;
  if (mode !== 'attached' && mode !== 'detached') {
    throw new ArgumentError(`--mode é "attached" ou "detached", não "${mode}"`);
  }

  // Os dois eixos do ADR 0033 D1 substituem o `--party-mode` (#407, DT-04): o `/propose`
  // deixou de aceitar `mode`, e o cliente de carga não depende de um campo que está saindo do
  // fio. Só `"true"`/`"false"` são booleanos válidos — qualquer outra coisa seria `undefined`
  // silencioso, o mesmo defeito que `--sessions mil` tinha.
  const boolean = (name: string, fallback: boolean): boolean => {
    const raw = flags.get(name);
    if (raw === undefined) return fallback;
    if (raw !== 'true' && raw !== 'false') {
      throw new ArgumentError(`--${name} é "true" ou "false", não "${raw}"`);
    }
    return raw === 'true';
  };
  const shareCosts = boolean('party-share-costs', DEFAULTS.shareCosts);
  const splitLoot = boolean('party-share-loot', DEFAULTS.splitLoot);
  const party = Math.max(1, Math.floor(number('party', DEFAULTS.party)));

  const sessions = Math.floor(number('sessions', DEFAULTS.sessions));
  // Um worker por core, no máximo, e nunca mais workers que sessões: processo que abre zero
  // sessão só custa memória e polui o relatório com uma fatia vazia.
  const workers = Math.max(1, Math.min(
    Math.floor(number('workers', Math.min(cpuCount, 8))),
    Math.max(1, sessions),
  ));

  return {
    apiUrl: (flags.get('api') ?? DEFAULTS.apiUrl).replace(/\/$/, ''),
    metricsUrl: flags.get('metrics')?.replace(/\/$/, '') ?? null,
    sessions,
    mode,
    durationMs: parseDuration(flags.get('duration') ?? String(DEFAULTS.durationMs)),
    workers,
    huntId: flags.get('hunt') ?? DEFAULTS.huntId,
    difficulty: flags.get('difficulty') ?? DEFAULTS.difficulty,
    pingIntervalMs: number('ping', DEFAULTS.pingIntervalMs),
    rampMs: number('ramp', DEFAULTS.rampMs),
    json: flags.get('json') ?? null,
    party,
    shareCosts,
    splitLoot,
  };
}

export const USAGE = `
  pnpm load --sessions 1000 --mode detached --duration 10m
  pnpm load --sessions 2000 --mode attached  --duration 10m --metrics http://127.0.0.1:7171

  --sessions N     quantas sessões abrir (padrão 1000)
  --mode M         attached | detached (padrão detached)
  --party N        agrupa as sessões em parties de N (padrão 1, solo); a sobra vai solo
  --party-share-costs B  ativa o rateio de supply (padrão true) — só com --party > 1
  --party-share-loot B   divide o lucro na bolsa (padrão true) — só com --party > 1
  --duration D     10m, 90s, 1500ms (padrão 60s)
  --workers N      processos worker (padrão: núcleos, no máximo 8)
  --api URL        base do api (padrão http://127.0.0.1:8080)
  --metrics URL    base do /metrics do nó de jogo, para memória e custo de tick
  --hunt ID        hunt a entrar (padrão rat-cellars)
  --difficulty D   dificuldade (padrão cautious)
  --ping MS        intervalo de ping no modo anexado (padrão 1000)
  --ramp MS        espaçamento entre aberturas (padrão 2)
  --json FILE      grava o relatório em JSON
`.trim();
