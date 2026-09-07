import { pino } from 'pino';

export function createLogger(level: string, role: string) {
  return pino({
    level,
    base: { role },
    // Sem transport bonito nem em desenvolvimento: log estruturado é o que a
    // observabilidade consome, e formatar no processo custa CPU no caminho quente.
    // Para ler à mão: `pnpm dev | npx pino-pretty`.
  });
}

export type Logger = ReturnType<typeof createLogger>;
