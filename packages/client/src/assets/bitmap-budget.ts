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

export interface BitmapBudgetOptions<K> {
  readonly now?: () => number;
  /**
   * Chamado ANTES de `close()`, com o bitmap ainda vivo.
   *
   * Existe por causa do Pixi: uma `Texture` construída sobre um `ImageBitmap` sobrevive ao
   * `close()` da fonte e vira textura inválida por baixo — desenha lixo, ou falha ao reenviar
   * para a GPU depois de uma perda de contexto. Quem guarda a textura precisa saber que o
   * bitmap vai morrer, e este é o único instante em que dá para avisar.
   *
   * **Não pode lançar.** O despejo varre as entradas no meio da conta de bytes; uma exceção
   * aqui deixaria `bytes` divergindo do que está guardado — vazamento silencioso, o defeito
   * que a classe inteira existe para não ter.
   */
  readonly onEvict?: (key: K, sprite: Sprite) => void;
}

export class BitmapBudget<K> {
  readonly #maxBytes: number;
  readonly #now: () => number;
  readonly #onEvict: (key: K, sprite: Sprite) => void;
  readonly #entries = new Map<K, Entry>();
  #bytes = 0;

  constructor(maxBytes: number, options: BitmapBudgetOptions<K> | (() => number) = {}) {
    if (maxBytes <= 0) throw new Error('bitmaps: maxBytes precisa ser positivo');
    // A forma antiga — só o relógio — continua valendo, para quem chamava assim.
    const resolved = typeof options === 'function' ? { now: options } : options;
    this.#maxBytes = maxBytes;
    this.#now = resolved.now ?? (() => Date.now());
    this.#onEvict = resolved.onEvict ?? (() => {});
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
    for (const [key, entry] of this.#entries) this.#release(key, entry);
    this.#entries.clear();
    this.#bytes = 0;
  }

  #evictFor(incoming: number): void {
    if (this.#bytes + incoming <= this.#maxBytes) return;
    const oldest = [...this.#entries.entries()].sort((a, b) => a[1].usedAtMs - b[1].usedAtMs);
    for (const [key, entry] of oldest) {
      if (this.#bytes + incoming <= this.#maxBytes) return;
      this.#release(key, entry);
      this.#entries.delete(key);
      this.#bytes -= entry.bytes;
    }
  }

  /** Avisa quem depende do bitmap e SÓ ENTÃO o fecha. A ordem é o contrato de `onEvict`. */
  #release(key: K, entry: Entry): void {
    try {
      this.#onEvict(key, entry.sprite);
    } catch {
      // Ver `onEvict`: a conta de bytes não pode ficar pela metade por causa de quem ouve.
    }
    entry.sprite.close();
  }
}
