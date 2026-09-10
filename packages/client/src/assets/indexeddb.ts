// O `SheetStore` de verdade, em IndexedDB (FUN-19).
//
// Só armazenamento: quem decide despejo, teto e degradação é `cache.ts`. Aqui só mora o que a
// API do navegador exige — e a API dela é por EVENTO, então metade deste arquivo é transformar
// evento em promessa.
//
// **Guardamos os pixels, nunca um `ImageBitmap`.** `ImageBitmap` não é serializável de forma
// portável entre sessões, e recriar o bitmap a partir dos pixels já pula a parte cara, que é o
// LZMA — que é justamente o que este cache existe para não repetir.

import type { CachedSheet, SheetStore } from './cache.js';

const DATABASE = 'draconya-sheets';
const STORE = 'sheets';
/**
 * A versão do SCHEMA do banco, não a do pacote de assets.
 *
 * A versão do pacote entra na CHAVE (ver `sheetKey`), e não aqui: subir esta versão apagaria
 * o cache inteiro a cada deploy que mexesse no formato, e a chave já resolve a coexistência.
 */
const SCHEMA_VERSION = 1;

/** O que vai para o disco. `Uint8ClampedArray` atravessa o clone estruturado sem ajuda. */
interface StoredSheet {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  readonly usedAtMs: number;
  /** Guardado em vez de derivado para `entries()` não precisar carregar os pixels de tudo. */
  readonly bytes: number;
}

/** Uma requisição do IndexedDB como promessa. A API é por evento; o resto do código não é. */
function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB: falha sem motivo')); };
  });
}

/**
 * Abre o banco. Rejeita quando o navegador não deixa — aba anônima, armazenamento bloqueado.
 *
 * Quem chama trata isso como "não há cache", nunca como falha do jogo.
 */
export function openSheetDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(request.error ?? new Error('IndexedDB: falha ao abrir')); };
    // Outra aba segurando uma versão antiga. Sem isto a promessa nunca resolve, e a tela fica
    // em "carregando" para sempre — que parece rede lenta e não aponta para o cache.
    request.onblocked = () => { reject(new Error('IndexedDB: outra aba está segurando o banco')); };
  });
}

export class IndexedDbSheetStore implements SheetStore {
  readonly #database: IDBDatabase;

  constructor(database: IDBDatabase) {
    this.#database = database;
  }

  async get(key: string): Promise<CachedSheet | undefined> {
    const transaction = this.#database.transaction(STORE, 'readonly');
    const stored = await promised<StoredSheet | undefined>(
      transaction.objectStore(STORE).get(key) as IDBRequest<StoredSheet | undefined>,
    );
    if (stored === undefined) return undefined;
    return {
      width: stored.width, height: stored.height,
      pixels: stored.pixels, usedAtMs: stored.usedAtMs,
    };
  }

  async put(key: string, sheet: CachedSheet): Promise<void> {
    const transaction = this.#database.transaction(STORE, 'readwrite');
    const record: StoredSheet = {
      key, width: sheet.width, height: sheet.height, pixels: sheet.pixels,
      usedAtMs: sheet.usedAtMs, bytes: sheet.pixels.length,
    };
    await promised(transaction.objectStore(STORE).put(record));
  }

  async delete(key: string): Promise<void> {
    const transaction = this.#database.transaction(STORE, 'readwrite');
    await promised(transaction.objectStore(STORE).delete(key));
  }

  async entries(): Promise<readonly { key: string; bytes: number; usedAtMs: number }[]> {
    // **Cursor, e não `getAll`.** `getAll` carregaria os PIXELS de todas as folhas para
    // responder "quanto ocupa cada uma" — dezenas de MB por consulta de despejo, no thread
    // principal, toda vez que uma folha nova chega.
    const transaction = this.#database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).openCursor();
    const found: { key: string; bytes: number; usedAtMs: number }[] = [];
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor === null) { resolve(found); return; }
        const stored = cursor.value as StoredSheet;
        found.push({ key: stored.key, bytes: stored.bytes, usedAtMs: stored.usedAtMs });
        cursor.continue();
      };
      request.onerror = () => { reject(request.error ?? new Error('IndexedDB: falha no cursor')); };
    });
  }
}
