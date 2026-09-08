// Espera entre tentativas de reconexão (FUN-24).

/** Primeira espera. Curta: a queda mais comum é um blip, e voltar rápido é o certo. */
const BASE_MS = 500;
/** Teto. Sem ele, uma queda longa leva a espera a horas e o jogador acha que morreu. */
const MAX_MS = 30_000;

/**
 * Espera exponencial COM JITTER.
 *
 * O jitter não é refinamento. Sem ele, a queda de um nó faz todos os clientes daquele nó
 * voltarem no mesmo instante — e derrubarem o nó de novo, agora com a carga concentrada num
 * milissegundo. O sintoma é um servidor que não consegue mais subir depois da primeira queda.
 *
 * Jitter COMPLETO (um ponto qualquer entre zero e o teto da tentativa), e não metade fixa
 * mais metade aleatória: espalha melhor, e o pior caso individual continua limitado.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_MS, BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(random() * ceiling);
}

export const BACKOFF_BASE_MS = BASE_MS;
export const BACKOFF_MAX_MS = MAX_MS;
