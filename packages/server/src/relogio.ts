import type { Relogio } from '@draconya/sim';

/** Relógio monotônico de produção, disponível apenas na borda do servidor. */
export function relogioDoSistema(): Relogio {
  return { agoraMs: () => performance.now() };
}
