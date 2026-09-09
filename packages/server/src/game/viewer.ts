// Visualizador: um socket olhando uma sessão (FUN-13).
//
// A inversão que define a arquitetura: o socket NÃO é a sessão, é um item de uma lista dela.
// Cair não encerra nada, e é por isso que a hunt sobrevive ao navegador fechado (ADR 0001).
//
// Duas propriedades vivem aqui, e as duas são de banda:
//
//   1. Fila de saída com flush EM LOTE, um frame por ciclo — nunca um `send` por evento.
//      É o que sustenta a projeção de 0,5–1,5 KB/s por jogador.
//   2. Teto de backpressure. Cliente lento não pode fazer o nó crescer sem limite: passado o
//      teto o visualizador cai, e a sessão continua — que é justamente a graça.

import { randomUUID } from 'node:crypto';
import { encodeS2C, packBatch, type S2CMessage } from '@draconya/protocol';

/**
 * O pedaço do socket do uWS que o visualizador usa. Interface estrutural de propósito: o
 * teste exercita fila e backpressure sem subir servidor nenhum.
 */
export interface ViewerSocket {
  send(message: ArrayBuffer | Uint8Array, isBinary?: boolean, compress?: boolean): unknown;
  getBufferedAmount(): number;
  end(code?: number, shortMessage?: string): void;
}

export interface ViewerOptions {
  /** Teto de bytes represados no socket. Acima disso o cliente não está drenando. */
  readonly maxBufferedBytes?: number;
  /** Teto de mensagens acumuladas entre dois flushes. */
  readonly maxQueued?: number;
  /** Chamado a cada quadro escrito, com quantas mensagens ele levou e quantos bytes (FUN-47). */
  readonly onFrame?: (messages: number, bytes: number) => void;
}

const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;
const DEFAULT_MAX_QUEUED = 512;

export class Viewer {
  readonly id: string = randomUUID();
  readonly characterId: string;

  readonly #socket: ViewerSocket;
  readonly #maxBufferedBytes: number;
  readonly #maxQueued: number;
  readonly #options: ViewerOptions;
  readonly #queue: S2CMessage[] = [];

  #dead = false;
  #socketOpen = true;

  constructor(socket: ViewerSocket, characterId: string, options: ViewerOptions = {}) {
    this.#socket = socket;
    this.characterId = characterId;
    this.#maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.#maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED;
    this.#options = options;
  }

  /** `true` quando o visualizador precisa ser desanexado — a sessão nunca é afetada. */
  get dead(): boolean {
    return this.#dead;
  }

  get queued(): number {
    return this.#queue.length;
  }

  /** Enfileira. O envio acontece no flush, em lote. */
  send(message: S2CMessage): void {
    if (this.#dead) return;
    this.#queue.push(message);
    // Fila estourada significa que o flush não está dando conta deste cliente. Continuar
    // acumulando transforma um cliente lento em consumo de memória do nó inteiro.
    if (this.#queue.length > this.#maxQueued) this.#dead = true;
  }

  /**
   * Envio IMEDIATO, fora da fila. Só para o que mede tempo ou fecha o handshake: `pong` que
   * espera o próximo ciclo mede a fila, não a rede.
   */
  sendNow(message: S2CMessage): void {
    if (this.#dead || !this.#socketOpen) return;
    this.#write(encodeS2C(message));
  }

  /** Um frame por ciclo, com todas as mensagens acumuladas. */
  flush(): void {
    if (this.#queue.length === 0 || this.#dead || !this.#socketOpen) return;
    const messages = this.#queue.splice(0, this.#queue.length);
    // Uma mensagem só vai crua: o envelope de lote custaria 9 bytes para não agrupar nada,
    // e o decodificador aceita as duas formas.
    const frame = messages.length === 1
      ? encodeS2C(messages[0] as S2CMessage)
      : packBatch(messages.map((message) => encodeS2C(message)));
    this.#write(frame);
    // Contado DEPOIS do lote: o que importa para banda é o que saiu no fio, e contar antes
    // reportaria mensagens que o lote comprimiu como se fossem quadros separados.
    this.#options.onFrame?.(messages.length, frame.byteLength);
  }

  /** Fecha o socket. Chamar depois que o socket já caiu derruba o processo no uWS. */
  close(code = 1000, reason = ''): void {
    this.#dead = true;
    if (!this.#socketOpen) return;
    this.#socketOpen = false;
    this.#socket.end(code, reason);
  }

  /** O socket caiu por conta própria: marcar, sem tocar nele. */
  markClosed(): void {
    this.#dead = true;
    this.#socketOpen = false;
  }

  #write(frame: Uint8Array): void {
    if (this.#socket.getBufferedAmount() > this.#maxBufferedBytes) {
      this.#dead = true;
      return;
    }
    this.#socket.send(frame, true);
  }
}
