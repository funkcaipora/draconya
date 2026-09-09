// Cooldown de ação disparada por evento (FUN-36, ADR 0003, FUN-68).
//
// Guarda TIMESTAMP ABSOLUTO, no relógio LÓGICO da sessão: o jogador usou uma poção, ela volta
// em mil milissegundos. Absoluto sobrevive a snapshot e a retomada tardia; tempo restante,
// não (FUN-27).
//
// **O mecanismo periódico saiu daqui na FUN-68.** Ele era um acumulador de duração —
// `timesThatFit(chave, dtMs, intervalo)` — e existia para responder "quantas aplicações
// couberam neste tick". Quem responde isso agora é a fila de eventos da sessão, que não
// precisa perguntar: cada ação acorda no instante em que vence.
//
// Vale dizer por que ele foi embora em vez de ficar sem uso. Duas razões, e a segunda é a que
// importa:
//
//   1. não sobrou chamador — passo de rota, passo e ataque de monstro, ataque do jogador e
//      regeneração viraram eventos;
//   2. ele é a forma exata do defeito que a FUN-68 corrige. Um acumulador devolve N aplicações
//      de uma vez e deixa quem chama decidir o que fazer com o N — foi assim que a FUN-67
//      nasceu, com dois dos quatro chamadores aplicando uma só. Deixá-lo disponível é deixar
//      carregada a arma que já disparou.
//
// O mecanismo absoluto abaixo, ao contrário, só passou a ser SEGURO agora: o `nowMs` que ele
// recebe é o tempo lógico da sessão, e não mais o monotônico do processo. Antes, um cooldown
// gravado num nó e lido noutro voltava eternamente pronto ou eternamente travado — inofensivo
// enquanto ninguém usava, e poção e magia são exatamente o que vem usá-lo.

export interface CooldownState {
  /**
   * chave → instante LÓGICO da sessão em que a ação fica disponível.
   *
   * Lógico, nunca de processo: é o que faz o valor continuar significando a mesma coisa do
   * outro lado de um snapshot.
   */
  readonly until: Readonly<Record<string, number>>;
}

export class Cooldowns {
  readonly #until = new Map<string, number>();

  static fromState(state: Partial<CooldownState>): Cooldowns {
    const cd = new Cooldowns();
    for (const [key, value] of Object.entries(state.until ?? {})) cd.#until.set(key, value);
    return cd;
  }

  getState(): CooldownState {
    return { until: Object.fromEntries(this.#until) };
  }

  /** `nowMs` é o tempo LÓGICO da sessão (`session.nowMs`), nunca relógio de processo. */
  isReady(key: string, nowMs: number): boolean {
    return nowMs >= (this.#until.get(key) ?? -Infinity);
  }

  remainingMs(key: string, nowMs: number): number {
    return Math.max(0, (this.#until.get(key) ?? -Infinity) - nowMs);
  }

  start(key: string, nowMs: number, durationMs: number): void {
    this.#until.set(key, nowMs + durationMs);
  }

  clear(key: string): void {
    this.#until.delete(key);
  }
}
