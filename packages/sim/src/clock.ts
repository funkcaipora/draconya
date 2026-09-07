// Tempo entra em `sim/` como parâmetro, nunca de um relógio global (invariante 1).
// `Date.now()` dentro deste pacote é bug, não estilo.
//
// Duas razões práticas, e as duas aparecem cedo:
//   1. O teste de equivalência 10 Hz / 1 Hz (FUN-25) precisa controlar o avanço do tempo.
//   2. A FUN-44 precisa "esperar" horas de hunt sem esperar de verdade — teste que dorme
//      dez minutos não roda no CI, e portanto não roda nunca.

export interface Clock {
  /** Milissegundos monotônicos. Não é hora do dia; não use para exibir data. */
  nowMs(): number;
}

/** Relógio controlado, para teste e para o cliente sintético de carga. */
export class TestClock implements Clock {
  #now: number;

  constructor(startMs = 0) {
    this.#now = startMs;
  }

  nowMs(): number {
    return this.#now;
  }

  advance(ms: number): void {
    if (ms < 0) throw new Error('the clock cannot move backwards');
    this.#now += ms;
  }
}
