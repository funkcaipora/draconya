// O worker que decodifica folhas (FUN-17). Casca fina de propósito.
//
// Tudo que decide alguma coisa está em `sheet.ts` e é testado sem worker nenhum; aqui só mora
// a cola que o ambiente exige — e cola que ninguém testa precisa ser pequena o bastante para
// caber numa olhada. Ver `sheet-loader.ts` para o outro lado.

import { decodeSheet } from './sheet.js';
import type { SheetRequest, SheetResponse } from './sheet-loader.js';

/**
 * O escopo de worker, tipado À MÃO e no mínimo.
 *
 * A alternativa seria trocar a `lib` do pacote para `WebWorker`, e ela CONFLITA com `DOM` —
 * o cliente precisa das duas, em arquivos diferentes. Declarar as duas funções que este
 * arquivo usa custa menos que partir o projeto de TypeScript em dois.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<SheetRequest>) => void) | null;
  postMessage(message: SheetResponse, transfer?: readonly Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<SheetRequest>): void => {
  const { id, file } = event.data;
  try {
    const sheet = decodeSheet(new Uint8Array(file));
    // `decodeSheet` aloca o array aqui dentro, então o buffer é sempre um `ArrayBuffer` comum
    // — nunca compartilhado. É o que torna esta asserção segura, e não uma esperança.
    const pixels = sheet.pixels.buffer as ArrayBuffer;
    const response: SheetResponse = {
      id, ok: true, width: sheet.width, height: sheet.height, pixels,
    };
    // O buffer é TRANSFERIDO, não copiado: uma folha de 384×384 são 590 KB, e copiar isso a
    // cada uma desfaz metade do motivo de o decoder estar num worker.
    scope.postMessage(response, [pixels]);
  } catch (error) {
    scope.postMessage({ id, ok: false, error: (error as Error).message });
  }
};
