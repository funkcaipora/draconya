import { pino } from 'pino';

export function criarLog(nivel: string, papel: string) {
  return pino({
    level: nivel,
    base: { papel },
    // Sem transport bonito nem em desenvolvimento: log estruturado é o que a
    // observabilidade consome, e formatar no processo custa CPU no caminho quente.
    // Para ler à mão: `pnpm dev | npx pino-pretty`.
  });
}

export type Log = ReturnType<typeof criarLog>;
