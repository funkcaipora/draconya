// O pacote de arte como o NAVEGADOR o monta (FUN-23).
//
// `AssetPack.load` não conhece `Worker`, `indexedDB` nem `createImageBitmap` — recebe os três
// injetados, e é o que torna o resto testável em Node. Este arquivo é onde os três de verdade
// entram, e só ele sabe que existe um navegador. Nenhum teste passa por aqui.

import { openSheetDatabase, IndexedDbSheetStore } from './indexeddb.js';
import { AssetPack } from './pack.js';
import type { PackOptions } from './pack.js';
import { createSheetLoader } from './sheet-loader.js';
import type { SheetLoader } from './sheet-loader.js';
import type { SheetStore } from './cache.js';

export interface BrowserPack {
  readonly pack: AssetPack;
  /** Encerra o worker. Sem isto o StrictMode deixa um por montagem, decodificando para ninguém. */
  close(): void;
}

/**
 * Monta o pacote para o navegador.
 *
 * `baseUrl` ausente é ERRO com mensagem, não um `fetch('undefined/catalog-content.json')` que
 * dá 404 sem apontar para a variável que falta. O cache persistente é opcional por contrato
 * (`PackOptions.store`): aba anônima recusa o IndexedDB, e tratar isso como falha derrubaria a
 * tela de quem só está numa janela privada.
 */
export async function loadBrowserPack(
  baseUrl: string | undefined,
  onEvict: PackOptions['onEvict'],
): Promise<BrowserPack> {
  if (baseUrl === undefined || baseUrl === '') {
    throw new Error('VITE_THINGS_URL não está definido — o cliente não sabe de onde buscar a arte');
  }
  const loader: SheetLoader = createSheetLoader();
  let store: SheetStore | undefined;
  try {
    store = new IndexedDbSheetStore(await openSheetDatabase(indexedDB));
  } catch {
    store = undefined;
  }
  const pack = await AssetPack.load({
    baseUrl,
    loader,
    // `ImageData` exige `Uint8ClampedArray<ArrayBuffer>`, e o que sai do recorte é tipado como
    // `ArrayBufferLike`. Nunca é `SharedArrayBuffer` — `cutOut` aloca o array — então a
    // asserção fica no menor lugar possível, e não na assinatura de `createBitmap`.
    createBitmap: async (pixels, width, height) => createImageBitmap(
      new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height),
    ),
    ...(store === undefined ? {} : { store }),
    ...(onEvict === undefined ? {} : { onEvict }),
  });
  // Fechar é fechar os DOIS orçamentos de bitmap (quadros e composições) e o worker. Sem o
  // `clear()`, cada desmonte do viewport deixava até 80 MB de `ImageBitmap` vivos — e o
  // `onEvict` que ele dispara é o que avisa o `TextureBook` para destruir as texturas junto.
  return { pack, close: () => { pack.clear(); loader.close(); } };
}
