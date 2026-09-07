// Cooldowns (FUN-36, ADR 0003). São dois mecanismos diferentes, e confundi-los é o erro.
//
// 1. AÇÃO DISPARADA POR EVENTO — `iniciar` / `pronto` / `restanteMs`.
//    Guarda TIMESTAMP ABSOLUTO. O jogador usou uma poção; ela volta em 1 s. Absoluto
//    sobrevive a snapshot e a retomada tardia; tempo restante, não (FUN-27).
//
// 2. AÇÃO PERIÓDICA — `vezesQueCoube`.
//    Guarda ACUMULADOR DE DURAÇÃO. É o que faz 1 Hz e 10 Hz renderem o mesmo.
//
// Sobre o segundo, vale registrar o erro que já foi cometido aqui: ancorar a fase no
// primeiro tick torna o resultado dependente da taxa. A 10 Hz o primeiro ataque cai em
// t=100 ms; a 1 Hz, em t=1000 — e a diferença de fase se propaga por toda a sessão. O
// acumulador não tem origem, então não tem esse problema.

/** Teto de aplicações num único tick. Ver `vezesQueCoube`. */
export const RECUPERACAO_MAXIMA = 32;

export interface EstadoDeCooldowns {
  /** chave → instante absoluto em que a ação por evento fica disponível. */
  readonly ate: Readonly<Record<string, number>>;
  /** chave → milissegundos já acumulados para a próxima aplicação periódica. */
  readonly acumulado: Readonly<Record<string, number>>;
}

export class Cooldowns {
  readonly #ate = new Map<string, number>();
  readonly #acumulado = new Map<string, number>();

  static deEstado(estado: Partial<EstadoDeCooldowns>): Cooldowns {
    const cd = new Cooldowns();
    for (const [k, v] of Object.entries(estado.ate ?? {})) cd.#ate.set(k, v);
    for (const [k, v] of Object.entries(estado.acumulado ?? {})) cd.#acumulado.set(k, v);
    return cd;
  }

  estado(): EstadoDeCooldowns {
    return {
      ate: Object.fromEntries(this.#ate),
      acumulado: Object.fromEntries(this.#acumulado),
    };
  }

  // --- 1. ação disparada por evento -------------------------------------------------------

  pronto(chave: string, agoraMs: number): boolean {
    return agoraMs >= (this.#ate.get(chave) ?? -Infinity);
  }

  restanteMs(chave: string, agoraMs: number): number {
    return Math.max(0, (this.#ate.get(chave) ?? -Infinity) - agoraMs);
  }

  iniciar(chave: string, agoraMs: number, duracaoMs: number): void {
    this.#ate.set(chave, agoraMs + duracaoMs);
  }

  // --- 2. ação periódica ------------------------------------------------------------------

  /**
   * Quantas vezes uma ação de período `intervaloMs` coube nos `dtMs` decorridos.
   *
   * Recebe o INTERVALO, não o instante: é o que torna o resultado independente da taxa de
   * tick. A ação começa pronta, então a primeira chamada devolve pelo menos 1.
   *
   * O teto existe por causa da retomada de sessão (FUN-28): um intervalo de horas entre
   * snapshot e retomada não pode virar centenas de ataques num tick só. Ao estourar, o
   * excedente é descartado em vez de virar dívida que explodiria no tick seguinte.
   */
  vezesQueCoube(chave: string, dtMs: number, intervaloMs: number): number {
    if (intervaloMs <= 0) throw new Error(`intervaloMs precisa ser positivo: ${intervaloMs}`);
    if (dtMs < 0) throw new Error(`dtMs não pode ser negativo: ${dtMs}`);

    // Sem entrada anterior a ação começa pronta — daí o acumulado inicial ser o intervalo.
    let acumulado = (this.#acumulado.get(chave) ?? intervaloMs) + dtMs;

    let vezes = 0;
    while (acumulado >= intervaloMs && vezes < RECUPERACAO_MAXIMA) {
      vezes++;
      acumulado -= intervaloMs;
    }
    if (vezes === RECUPERACAO_MAXIMA) acumulado = 0;

    this.#acumulado.set(chave, acumulado);
    return vezes;
  }

  limpar(chave: string): void {
    this.#ate.delete(chave);
    this.#acumulado.delete(chave);
  }
}
