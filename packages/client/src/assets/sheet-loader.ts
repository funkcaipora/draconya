// O lado do thread principal do decodificador de folhas (FUN-17).
//
// **O decoder LZMA em JS puro é pesado e NUNCA roda aqui** (§13.1). Este módulo só empacota
// pedido, casa resposta com pedido e devolve promessa; quem descomprime é `sheet-worker.ts`.
//
// Ele não conhece `Worker` do navegador de propósito — recebe qualquer coisa que poste e
// escute mensagens. É o que torna a fila testável sem um worker de verdade, e é a mesma razão
// de `net/connection.ts` não construir o próprio socket.

export interface SheetRequest {
  readonly id: number;
  /** Transferido, não copiado. Depois de mandar, o buffer daqui fica vazio. */
  readonly file: ArrayBuffer;
}

export type SheetResponse =
  | { readonly id: number; readonly ok: true; readonly width: number; readonly height: number;
      readonly pixels: ArrayBuffer }
  | { readonly id: number; readonly ok: false; readonly error: string };

export interface DecodedSheet {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

/** O mínimo de `Worker` que este módulo usa. Ver o comentário do topo. */
export interface SheetWorker {
  postMessage(message: SheetRequest, transfer: readonly Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SheetResponse>) => void): void;
  terminate(): void;
}

interface Pending {
  readonly resolve: (sheet: DecodedSheet) => void;
  readonly reject: (error: Error) => void;
}

export class SheetLoader {
  readonly #worker: SheetWorker;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #closed = false;

  constructor(worker: SheetWorker) {
    this.#worker = worker;
    this.#worker.addEventListener('message', (event) => { this.#settle(event.data); });
  }

  /**
   * Manda uma folha para decodificar.
   *
   * `file` é TRANSFERIDO: depois desta chamada o buffer de quem chamou fica com zero bytes.
   * É de propósito — uma folha comprimida ainda são centenas de KB, e copiá-la para o worker
   * gastaria no thread principal justamente o tempo que este módulo existe para não gastar.
   */
  decode(file: ArrayBuffer): Promise<DecodedSheet> {
    if (this.#closed) return Promise.reject(new Error('folha: o decodificador já foi encerrado'));
    const id = this.#nextId++;
    return new Promise<DecodedSheet>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ id, file }, [file]);
    });
  }

  /**
   * Encerra o worker e RECUSA o que estava em voo.
   *
   * Deixar as promessas penduradas faria uma troca de tela travar em "carregando" para sempre,
   * sem erro em lugar nenhum — o pior formato, porque parece rede lenta.
   */
  close(): void {
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      pending.reject(new Error('folha: o decodificador foi encerrado'));
    }
    this.#pending.clear();
    this.#worker.terminate();
  }

  #settle(response: SheetResponse): void {
    const pending = this.#pending.get(response.id);
    // Resposta sem pedido correspondente: worker reaproveitado, ou mensagem de outra coisa no
    // mesmo canal. Ignorar é o certo — estourar aqui derrubaria o thread por ruído.
    if (pending === undefined) return;
    this.#pending.delete(response.id);
    if (!response.ok) { pending.reject(new Error(response.error)); return; }
    pending.resolve({
      width: response.width,
      height: response.height,
      pixels: new Uint8ClampedArray(response.pixels),
    });
  }
}

/**
 * O `SheetLoader` de produção, com o worker de verdade.
 *
 * Separado do construtor porque `new Worker(new URL(...))` é uma forma que o Vite reconhece
 * ESTATICAMENTE para empacotar o worker — passar a URL por variável faz o bundle sair sem ele,
 * e o erro só aparece em produção.
 */
export function createSheetLoader(): SheetLoader {
  const worker = new Worker(new URL('./sheet-worker.js', import.meta.url), { type: 'module' });
  return new SheetLoader(worker as unknown as SheetWorker);
}
