// Cache persistente das folhas já decodificadas (FUN-19).
//
// O Huntera rebaixa e redescomprime as folhas **a cada sessão** — não há IndexedDB nem Cache
// Storage no bundle deles. Guardar o resultado decodificado corta a maior parte do tempo de
// carregamento a partir do segundo acesso, e é uma das três melhorias deliberadas sobre eles
// (ADR 0008, §13.1).
//
// **A política mora aqui e o armazenamento mora em `indexeddb.ts`.** A divisão é o que torna
// despejo, teto de bytes e degradação testáveis sem um banco — e é a mesma razão de
// `sheet-loader.ts` não conhecer `Worker`.

/** Uma folha guardada: os pixels já em RGBA, prontos para virar `ImageBitmap`. */
export interface CachedSheet {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  /** Quando foi lida pela última vez. É o critério de despejo. */
  readonly usedAtMs: number;
}

/**
 * O armazenamento, no mínimo que o cache usa.
 *
 * **Nada aqui promete não falhar.** Aba anônima, cota estourada e navegador com armazenamento
 * bloqueado são normais, não excepcionais, e o cache trata falha como "não tem em cache".
 */
export interface SheetStore {
  get(key: string): Promise<CachedSheet | undefined>;
  put(key: string, sheet: CachedSheet): Promise<void>;
  delete(key: string): Promise<void>;
  /** Chave e tamanho em bytes de tudo que está guardado, para o despejo decidir. */
  entries(): Promise<readonly { key: string; bytes: number; usedAtMs: number }[]>;
}

export interface SheetCacheOptions {
  /**
   * Teto em bytes. O pacote de assets inteiro passa de 100 MB e não cabe em cota nenhuma —
   * sem teto, o cache cresce até o navegador recusar e o jogo passar a falhar ao carregar
   * folha nova, que é o oposto do que ele existe para fazer.
   */
  readonly maxBytes: number;
  readonly now?: () => number;
  /** Para onde vai o aviso quando o armazenamento falha. Silêncio esconderia cache morto. */
  readonly onDegraded?: (reason: string, error: unknown) => void;
}

/**
 * A chave de uma folha, tirada do nome do arquivo.
 *
 * **O hash já vem no nome** (`sprites-<hash>.bmp.lzma`) e é imutável por construção: nunca
 * existe entrada velha para o mesmo hash. Isso faz a invalidação por conteúdo SUMIR como
 * problema — não há o que invalidar, só o que despejar por espaço.
 *
 * A versão do pacote entra junto porque duas versões podem trazer folhas de mesmo nome com
 * conteúdo diferente, e aí o hash sozinho mentiria.
 */
export function sheetKey(packVersion: string, file: string): string {
  return `${packVersion}/${file}`;
}

/** Quantos bytes uma folha ocupa. Os pixels são o que importa; o resto é ruído. */
export function bytesOf(sheet: { readonly pixels: { readonly length: number } }): number {
  return sheet.pixels.length;
}

export class SheetCache {
  readonly #store: SheetStore;
  readonly #maxBytes: number;
  readonly #now: () => number;
  readonly #onDegraded: (reason: string, error: unknown) => void;

  constructor(store: SheetStore, options: SheetCacheOptions) {
    if (options.maxBytes <= 0) throw new Error('cache de folhas: maxBytes precisa ser positivo');
    this.#store = store;
    this.#maxBytes = options.maxBytes;
    this.#now = options.now ?? (() => Date.now());
    this.#onDegraded = options.onDegraded ?? (() => {});
  }

  /**
   * Lê uma folha do cache, ou `null`.
   *
   * **Falha do armazenamento vira `null`, nunca exceção.** Uma aba anônima não pode impedir o
   * jogo de abrir; ela só paga o LZMA de novo, que é exatamente o comportamento de antes deste
   * cache existir.
   */
  async get(key: string): Promise<CachedSheet | null> {
    try {
      const found = await this.#store.get(key);
      if (found === undefined) return null;
      // Marca o uso, para o despejo saber o que é antigo. Falhar aqui é inofensivo: perde-se a
      // precisão do LRU, não a folha — por isso a gravação vai sem `await` e sem propagar.
      void this.#touch(key, found);
      return found;
    } catch (error) {
      this.#onDegraded('leitura', error);
      return null;
    }
  }

  /**
   * Guarda uma folha, despejando o mais antigo se precisar.
   *
   * Devolve `false` quando não deu — e não deu é normal. Quem chamou já tem os pixels na mão;
   * o cache é atalho da PRÓXIMA vez, nunca do agora.
   */
  async put(key: string, sheet: Omit<CachedSheet, 'usedAtMs'>): Promise<boolean> {
    const bytes = bytesOf(sheet);
    // Folha maior que o teto inteiro nunca caberia, e tentar guardá-la despejaria TUDO para
    // depois falhar assim mesmo — o pior dos dois mundos.
    if (bytes > this.#maxBytes) {
      this.#onDegraded('folha maior que o teto do cache', null);
      return false;
    }
    try {
      await this.#evictFor(bytes, key);
      await this.#store.put(key, { ...sheet, usedAtMs: this.#now() });
      return true;
    } catch (error) {
      this.#onDegraded('gravação', error);
      return false;
    }
  }

  /**
   * Abre espaço para `incoming` bytes, despejando o menos recentemente usado.
   *
   * `exclude` é a chave que está entrando: reescrever uma folha que já existe não deve
   * despejá-la para depois gravá-la de novo, e sem isso o cache se comeria numa reconexão.
   */
  async #evictFor(incoming: number, exclude: string): Promise<void> {
    const entries = [...await this.#store.entries()]
      .filter((entry) => entry.key !== exclude)
      .sort((a, b) => a.usedAtMs - b.usedAtMs);

    let used = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of entries) {
      if (used + incoming <= this.#maxBytes) return;
      await this.#store.delete(entry.key);
      used -= entry.bytes;
    }
  }

  async #touch(key: string, sheet: CachedSheet): Promise<void> {
    try {
      await this.#store.put(key, { ...sheet, usedAtMs: this.#now() });
    } catch (error) {
      this.#onDegraded('marcação de uso', error);
    }
  }
}
