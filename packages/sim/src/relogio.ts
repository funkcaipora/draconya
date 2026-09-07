// Tempo entra em `sim/` como parâmetro, nunca de um relógio global (invariante 1).
// `Date.now()` dentro deste pacote é bug, não estilo.
//
// Duas razões práticas, e as duas aparecem cedo:
//   1. O teste de equivalência 10 Hz / 1 Hz (FUN-25) precisa controlar o avanço do tempo.
//   2. A FUN-44 precisa "esperar" horas de hunt sem esperar de verdade — teste que dorme
//      dez minutos não roda no CI, e portanto não roda nunca.

export interface Relogio {
  /** Milissegundos monotônicos. Não é hora do dia; não use para exibir data. */
  agoraMs(): number;
}

/** Relógio de produção. Vive fora de `sim/`, mas o tipo mora aqui. */
export function relogioDoSistema(): Relogio {
  const origem = Date.now();
  const partida = typeof performance !== 'undefined' ? performance.now() : 0;
  return {
    agoraMs: () =>
      typeof performance !== 'undefined' ? origem + (performance.now() - partida) : Date.now(),
  };
}

/** Relógio controlado, para teste e para o cliente sintético de carga. */
export class RelogioDeTeste implements Relogio {
  #agora: number;

  constructor(inicioMs = 0) {
    this.#agora = inicioMs;
  }

  agoraMs(): number {
    return this.#agora;
  }

  avancar(ms: number): void {
    if (ms < 0) throw new Error('o relógio não anda para trás');
    this.#agora += ms;
  }
}
