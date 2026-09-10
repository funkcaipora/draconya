// Um cache LRU de bitmaps por ORÇAMENTO DE BYTES (FUN-18, FUN-20).
//
// Extraído porque duas coisas precisam exatamente da mesma regra — o fatiador de folhas e o
// compositor de outfit —, e duplicá-la é como uma das duas para de fechar os bitmaps e vaza
// sem ninguém notar. A regra tem duas metades e as duas são fáceis de errar sozinhas:
//
//   1. **Bytes, nunca contagem.** Um quadro 64×64 ocupa quatro vezes um 32×32; contar itens
//      faz o teto real de memória variar por um fator de quatro conforme o que está em cena.
//   2. **`close()` no despejado.** `ImageBitmap` segura memória de GPU que o coletor não
//      recolhe: um cache que respeita o teto e não fecha vaza igual a um que não tem teto.

/** O mínimo de `ImageBitmap` que isto usa. `ImageBitmap` satisfaz por estrutura. */
export interface Sprite {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/** Quantos bytes de GPU um quadro ocupa. RGBA, quatro bytes por pixel. */
export function spriteBytes(width: number, height: number): number {
  return width * height * 4;
}

interface Entry {
  readonly sprite: Sprite;
  readonly bytes: number;
  usedAtMs: number;
}

export class BitmapBudget<K> {
  readonly #maxBytes: number;
  readonly #now: () => number;
  readonly #entries = new Map<K, Entry>();
  #bytes = 0;

  constructor(maxBytes: number, now: () => number = () => Date.now()) {
    if (maxBytes <= 0) throw new Error('bitmaps: maxBytes precisa ser positivo');
    this.#maxBytes = maxBytes;
    this.#now = now;
  }

  /** Quanto está segurando. Existe para o teste poder afirmar o teto. */
  get bytes(): number { return this.#bytes; }

  /** O bitmap guardado, marcando o uso — é isso que faz o LRU ser LRU. */
  get(key: K): Sprite | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    entry.usedAtMs = this.#now();
    return entry.sprite;
  }

  /**
   * Guarda, despejando o menos recentemente usado.
   *
   * Bitmap maior que o orçamento inteiro NÃO entra: guardá-lo despejaria tudo para depois ser
   * despejado ele mesmo. Quem pediu já tem o bitmap na mão — o cache é atalho da próxima vez.
   */
  put(key: K, sprite: Sprite): void {
    const bytes = spriteBytes(sprite.width, sprite.height);
    if (bytes > this.#maxBytes) return;
    this.#evictFor(bytes);
    this.#entries.set(key, { sprite, bytes, usedAtMs: this.#now() });
    this.#bytes += bytes;
  }

  /** Fecha tudo. Trocar de mapa sem isto vaza a memória de GPU da tela anterior. */
  clear(): void {
    for (const entry of this.#entries.values()) entry.sprite.close();
    this.#entries.clear();
    this.#bytes = 0;
  }

  #evictFor(incoming: number): void {
    if (this.#bytes + incoming <= this.#maxBytes) return;
    const oldest = [...this.#entries.entries()].sort((a, b) => a[1].usedAtMs - b[1].usedAtMs);
    for (const [key, entry] of oldest) {
      if (this.#bytes + incoming <= this.#maxBytes) return;
      entry.sprite.close();
      this.#entries.delete(key);
      this.#bytes -= entry.bytes;
    }
  }
}
