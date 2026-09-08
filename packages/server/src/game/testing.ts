// Duplos para os testes do nó de jogo. Não é código de produção.

import { decodeS2C, type S2CMessage } from '@draconya/protocol';
import type { ViewerSocket } from './viewer.js';

export class FakeSocket implements ViewerSocket {
  readonly frames: Uint8Array[] = [];
  buffered = 0;
  ended: { code: number; reason: string } | null = null;

  send(message: ArrayBuffer | Uint8Array): unknown {
    this.frames.push(new Uint8Array(message as Uint8Array));
    return 1;
  }

  getBufferedAmount(): number {
    return this.buffered;
  }

  end(code = 1000, reason = ''): void {
    this.ended = { code, reason };
  }

  /** Tudo que chegou, já decodificado e achatado — lote conta como várias mensagens. */
  received(): S2CMessage[] {
    return this.frames.flatMap((frame) => decodeS2C(frame) ?? []);
  }
}
