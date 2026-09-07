// Cooldowns (FUN-36, ADR 0003). São dois mecanismos diferentes, e confundi-los é o erro.
//
// 1. AÇÃO DISPARADA POR EVENTO — `start` / `isReady` / `remainingMs`.
//    Guarda TIMESTAMP ABSOLUTO. O jogador usou uma poção; ela volta em 1 s. Absoluto
//    sobrevive a snapshot e a retomada tardia; tempo restante, não (FUN-27).
//
// 2. AÇÃO PERIÓDICA — `timesThatFit`.
//    Guarda ACUMULADOR DE DURAÇÃO. É o que faz 1 Hz e 10 Hz renderem o mesmo.
//
// Sobre o segundo, vale registrar o erro que já foi cometido aqui: ancorar a fase no
// primeiro tick torna o resultado dependente da taxa. A 10 Hz o primeiro ataque cai em
// t=100 ms; a 1 Hz, em t=1000 — e a diferença de fase se propaga por toda a sessão. O
// acumulador não tem origem, então não tem esse problema.

/** Teto de aplicações num único tick. Ver `timesThatFit`. */
export const MAX_CATCH_UP = 32;

export interface CooldownState {
  /** chave → instante absoluto em que a ação por evento fica disponível. */
  readonly until: Readonly<Record<string, number>>;
  /** chave → milissegundos já acumulados para a próxima aplicação periódica. */
  readonly accumulated: Readonly<Record<string, number>>;
}

export class Cooldowns {
  readonly #until = new Map<string, number>();
  readonly #accumulated = new Map<string, number>();

  static fromState(state: Partial<CooldownState>): Cooldowns {
    const cd = new Cooldowns();
    for (const [key, value] of Object.entries(state.until ?? {})) cd.#until.set(key, value);
    for (const [key, value] of Object.entries(state.accumulated ?? {})) {
      cd.#accumulated.set(key, value);
    }
    return cd;
  }

  getState(): CooldownState {
    return {
      until: Object.fromEntries(this.#until),
      accumulated: Object.fromEntries(this.#accumulated),
    };
  }

  // --- 1. ação disparada por evento -------------------------------------------------------

  isReady(key: string, nowMs: number): boolean {
    return nowMs >= (this.#until.get(key) ?? -Infinity);
  }

  remainingMs(key: string, nowMs: number): number {
    return Math.max(0, (this.#until.get(key) ?? -Infinity) - nowMs);
  }

  start(key: string, nowMs: number, durationMs: number): void {
    this.#until.set(key, nowMs + durationMs);
  }

  // --- 2. ação periódica ------------------------------------------------------------------

  /**
 * Quantas vezes uma ação de período `intervalMs` coube nos `dtMs` decorridos.
   *
 * Recebe o INTERVALO, não o instante: é o que torna o resultado independente da taxa de
   * tick. A ação começa pronta, então a primeira chamada devolve pelo menos 1.
   *
   * O teto existe por causa da retomada de sessão (FUN-28): um intervalo de horas entre
   * snapshot e retomada não pode virar centenas de ataques num tick só. Ao estourar, o
   * excedente é descartado em vez de virar dívida que explodiria no tick seguinte.
   */
  timesThatFit(key: string, dtMs: number, intervalMs: number): number {
    if (intervalMs <= 0) throw new Error(`intervalMs must be positive: ${intervalMs}`);
    if (dtMs < 0) throw new Error(`dtMs cannot be negative: ${dtMs}`);

    // Sem entrada anterior a ação começa pronta — daí o acumulado inicial ser o intervalo.
    let accumulated = (this.#accumulated.get(key) ?? intervalMs) + dtMs;

    let times = 0;
    while (accumulated >= intervalMs && times < MAX_CATCH_UP) {
      times++;
      accumulated -= intervalMs;
    }
    if (times === MAX_CATCH_UP) accumulated = 0;

    this.#accumulated.set(key, accumulated);
    return times;
  }

  clear(key: string): void {
    this.#until.delete(key);
    this.#accumulated.delete(key);
  }
}
