import { pino } from 'pino';

/**
 * `processes` é a lista de papéis que este processo hospeda (`api+game+jobs` no modo solo),
 * não o papel que emitiu a linha. O nome é distinto de propósito: cada papel loga por um filho
 * com `role`, e uma base chamada `role` produziria a chave duas vezes na mesma linha — JSON
 * com chave repetida resolve conforme o parser, e `role` é justamente o campo pelo qual se
 * filtra log por papel.
 */
export function createLogger(level: string, processes: string) {
  return pino({
    level,
    base: { processes },
    // Sem transport bonito nem em desenvolvimento: log estruturado é o que a
    // observabilidade consome, e formatar no processo custa CPU no caminho quente.
    // Para ler à mão: `pnpm dev | npx pino-pretty`.
  });
}

export type Logger = ReturnType<typeof createLogger>;
