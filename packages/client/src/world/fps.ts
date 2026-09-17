// Média móvel de FPS a partir dos deltas do laço de quadro (RC-13, R1-12/R4-07).
//
// PURO: não conhece Pixi, requestAnimationFrame nem DOM. Quem desenha entrega os deltas em
// milissegundos; este módulo só os guarda e calcula a média, para que a regra seja testável sem
// montar um canvas.

export interface FpsMeter {
  /** Recebe uma vez por quadro o tempo desde o quadro anterior, em milissegundos. */
  record(deltaMs: number): void;
  /** Devolve o FPS médio arredondado, ou zero antes do primeiro quadro válido. */
  read(): number;
}

/** Cerca de meio segundo de amostras a 60 FPS: suaviza sem esconder uma queda sustentada. */
const DEFAULT_WINDOW = 30;

export function createFpsMeter(window = DEFAULT_WINDOW): FpsMeter {
  const deltas: number[] = [];

  return {
    record(deltaMs) {
      // Um relógio inválido ou parado não é um quadro: evitaria NaN, infinito ou FPS negativo.
      if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
      deltas.push(deltaMs);
      if (deltas.length > window) deltas.shift();
    },
    read() {
      if (deltas.length === 0) return 0;
      const averageMs = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
      return averageMs > 0 ? Math.round(1_000 / averageMs) : 0;
    },
  };
}
