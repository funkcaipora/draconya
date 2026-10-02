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
//
// E uma de CPU (OW-22, ADR 0060 d.11): a MESMA mensagem para N visualizadores é codificada uma vez
// por ciclo, e não uma por visualizador — ver `EncodeCache`.

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
/**
 * Teto de mensagens entre dois flushes. Exportado para o `bench:city` (OW-07) comparar a fila
 * medida com o teto de verdade, e não com uma cópia dele que um dia diverge.
 */
export const DEFAULT_MAX_QUEUED = 512;

/**
 * O que um `EncodeCache` já trabalhou, desde que nasceu. Contadores que só sobem: quem mede
 * (o `bench:city`) lê duas vezes e subtrai.
 */
export interface EncodeStats {
  /** Mensagens que o cache de fato codificou: a primeira entrega de cada objeto de mensagem. */
  readonly encoded: number;
  /** Entregas servidas do cache, sem codificar de novo. */
  readonly reused: number;
  /** Bytes dos frames codificados — o que a CPU serializou, não o que foi para o fio. */
  readonly encodedBytes: number;
}

/**
 * Cache de codificação de UM ciclo: o frame de cada OBJETO de mensagem, para que a mesma mensagem
 * entregue a N visualizadores seja codificada uma vez só (OW-22, ADR 0060 d.11).
 *
 * Até aqui `Viewer.flush` chamava `encodeS2C` por mensagem por visualizador, e o passo de um
 * jogador numa praça de trezentos vizinhos era `JSON.stringify` + `TextEncoder` + xorshift
 * trezentas vezes sobre os mesmos bytes. O hospedeiro já entrega a MESMA referência a todos os
 * destinatários (`for (const viewer of ...) viewer.send(message)`), então a identidade do objeto
 * é a chave — sem comparar conteúdo, sem hash.
 *
 * **O ciclo é o prazo de validade.** Quem usa chama `clear()` quando o ciclo fecha; uma mensagem
 * pode ser mutada entre ciclos (nenhuma é, hoje, mas nada impede), e um frame velho no cache
 * mandaria o conteúdo de ontem. Dentro do flush ninguém muta mensagem enfileirada.
 *
 * O que o fio vê não muda: o frame de cada mensagem é o MESMO conteúdo de antes, e o lote por
 * visualizador continua sendo montado por visualizador (`packBatch`), porque cada um recebe um
 * conjunto diferente de mensagens e o envelope de lote tem chave própria. O que muda é que o
 * pedaço de cada mensagem dentro do lote — com a chave de ofuscação dele, que não é segurança
 * (`protocol/AGENTS.md`) — passa a ser o mesmo para todos que a recebem.
 */
export class EncodeCache {
  readonly #memoize: boolean;
  readonly #frames = new Map<S2CMessage, Uint8Array>();
  #encoded = 0;
  #reused = 0;
  #encodedBytes = 0;

  /**
   * `memoize: false` é o cache que só CONTA: codifica toda vez, como o visualizador sozinho, mas
   * deixa os contadores comparáveis. É o grupo de controle da medição (`encodeOnce: false` no
   * hospedeiro) — sem ele, a coluna de bytes serializados do `bench:city` leria zero justamente na
   * linha que ela precisa comparar.
   */
  constructor(options: { readonly memoize?: boolean } = {}) {
    this.#memoize = options.memoize ?? true;
  }

  /** O frame da mensagem, codificando só na primeira vez que o objeto aparece neste ciclo. */
  encode(message: S2CMessage): Uint8Array {
    const known = this.#memoize ? this.#frames.get(message) : undefined;
    if (known !== undefined) {
      this.#reused += 1;
      return known;
    }
    const frame = encodeS2C(message);
    if (this.#memoize) this.#frames.set(message, frame);
    this.#encoded += 1;
    this.#encodedBytes += frame.byteLength;
    return frame;
  }

  /** Fecha o ciclo: nenhum frame sobrevive a ele. Os contadores continuam. */
  clear(): void {
    this.#frames.clear();
  }

  /** Quantos objetos de mensagem estão guardados agora. Só o teste olha. */
  get size(): number {
    return this.#frames.size;
  }

  get stats(): EncodeStats {
    return { encoded: this.#encoded, reused: this.#reused, encodedBytes: this.#encodedBytes };
  }
}

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

  /**
   * Um frame por ciclo, com todas as mensagens acumuladas.
   *
   * Com `cache`, cada mensagem é codificada pelo cache do ciclo — a mesma referência entregue a
   * outros visualizadores não é codificada de novo (OW-22). Sem ele, cada uma é codificada aqui,
   * como sempre foi: é o que o visualizador sozinho (o teste, a sessão de um dono só) faz.
   */
  flush(cache?: EncodeCache): void {
    if (this.#queue.length === 0 || this.#dead || !this.#socketOpen) return;
    const messages = this.#queue.splice(0, this.#queue.length);
    const encode = (message: S2CMessage): Uint8Array => (
      cache === undefined ? encodeS2C(message) : cache.encode(message)
    );
    // Uma mensagem só vai crua: o envelope de lote custaria 9 bytes para não agrupar nada,
    // e o decodificador aceita as duas formas.
    const frame = messages.length === 1
      ? encode(messages[0] as S2CMessage)
      : packBatch(messages.map((message) => encode(message)));
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
