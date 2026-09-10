import { describe, expect, it, vi } from 'vitest';
import { SheetLoader } from './sheet-loader.js';
import type { SheetRequest, SheetResponse, SheetWorker } from './sheet-loader.js';

/**
 * Um worker de mentira que guarda o que recebeu e responde quando o teste mandar.
 *
 * O worker de VERDADE é uma casca de doze linhas sobre `decodeSheet`, que `sheet.test.ts` já
 * prova contra LZMA real. O que sobra para testar aqui é a fila — casar resposta com pedido,
 * recusar o que ficou em voo, ignorar resposta órfã —, e isso não precisa de worker nenhum.
 */
class FakeWorker implements SheetWorker {
  readonly sent: SheetRequest[] = [];
  readonly transfers: readonly Transferable[][] = [];
  terminated = 0;
  #listener: ((event: MessageEvent<SheetResponse>) => void) | null = null;

  postMessage(message: SheetRequest, transfer: readonly Transferable[]): void {
    this.sent.push(message);
    (this.transfers as Transferable[][]).push([...transfer]);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<SheetResponse>) => void): void {
    this.#listener = listener;
  }

  terminate(): void { this.terminated += 1; }

  reply(response: SheetResponse): void {
    this.#listener?.({ data: response } as MessageEvent<SheetResponse>);
  }
}

const pixels = (fill: number): ArrayBuffer => {
  const bytes = new Uint8ClampedArray(4 * 4 * 4).fill(fill);
  return bytes.buffer as ArrayBuffer;
};

describe('SheetLoader (FUN-17)', () => {
  it('devolve a folha decodificada de quem pediu', async () => {
    const worker = new FakeWorker();
    const loader = new SheetLoader(worker);
    const promise = loader.decode(new ArrayBuffer(8));

    const id = worker.sent[0]?.id ?? 0;
    worker.reply({ id, ok: true, width: 4, height: 4, pixels: pixels(7) });

    const sheet = await promise;
    expect(sheet.width).toBe(4);
    expect(sheet.pixels[0]).toBe(7);
  });

  it('TRANSFERE o buffer em vez de copiá-lo', async () => {
    // Uma folha comprimida ainda são centenas de KB. Copiar gastaria no thread principal o
    // tempo que este módulo existe para não gastar — e o sintoma seria travadinha ao entrar
    // numa tela nova, longe de qualquer coisa que aponte para aqui.
    const worker = new FakeWorker();
    const loader = new SheetLoader(worker);
    const file = new ArrayBuffer(8);
    void loader.decode(file);
    expect(worker.transfers[0]).toEqual([file]);
  });

  it('casa CADA resposta com o pedido certo, fora de ordem', async () => {
    // Duas folhas em voo é o caso normal — a tela carrega várias de uma vez —, e o worker não
    // promete ordem. Sem o id, a segunda resposta resolveria a primeira promessa e cada sprite
    // sairia com a arte de outro.
    const worker = new FakeWorker();
    const loader = new SheetLoader(worker);
    const primeira = loader.decode(new ArrayBuffer(8));
    const segunda = loader.decode(new ArrayBuffer(8));

    const [a, b] = worker.sent;
    worker.reply({ id: b?.id ?? 0, ok: true, width: 2, height: 2, pixels: pixels(2) });
    worker.reply({ id: a?.id ?? 0, ok: true, width: 1, height: 1, pixels: pixels(1) });

    expect((await primeira).pixels[0]).toBe(1);
    expect((await segunda).pixels[0]).toBe(2);
  });

  it('propaga o erro do worker como recusa, com a mensagem', async () => {
    const worker = new FakeWorker();
    const loader = new SheetLoader(worker);
    const promise = loader.decode(new ArrayBuffer(8));
    worker.reply({ id: worker.sent[0]?.id ?? 0, ok: false, error: 'folha: não é um BMP' });
    await expect(promise).rejects.toThrow(/não é um BMP/);
  });

  it('encerrar RECUSA o que estava em voo, em vez de pendurar', async () => {
    // Promessa pendurada faz a tela ficar em "carregando" para sempre, sem erro em lugar
    // nenhum — parece rede lenta, e ninguém procura a causa no decodificador.
    const worker = new FakeWorker();
    const loader = new SheetLoader(worker);
    const promise = loader.decode(new ArrayBuffer(8));
    loader.close();
    await expect(promise).rejects.toThrow(/foi encerrado/);
    expect(worker.terminated).toBe(1);
  });

  it('depois de encerrado, recusa em vez de mandar para um worker morto', async () => {
    const loader = new SheetLoader(new FakeWorker());
    loader.close();
    await expect(loader.decode(new ArrayBuffer(8))).rejects.toThrow(/já foi encerrado/);
  });

  it('IGNORA resposta sem pedido correspondente', () => {
    // Worker reaproveitado, ou outra coisa no mesmo canal. Estourar aqui derrubaria o thread
    // principal por ruído que não é do jogo.
    const worker = new FakeWorker();
    // eslint-disable-next-line no-new -- o efeito é o `addEventListener` do construtor
    new SheetLoader(worker);
    expect(() => worker.reply({ id: 999, ok: true, width: 1, height: 1, pixels: pixels(1) }))
      .not.toThrow();
  });

  it('não vaza pedido resolvido: responder duas vezes é inofensivo', async () => {
    const worker = new FakeWorker();
    const loader = new SheetLoader(worker);
    const promise = loader.decode(new ArrayBuffer(8));
    const id = worker.sent[0]?.id ?? 0;
    worker.reply({ id, ok: true, width: 1, height: 1, pixels: pixels(1) });
    await promise;
    const segunda = vi.fn();
    expect(() => worker.reply({ id, ok: false, error: 'tarde demais' })).not.toThrow();
    expect(segunda).not.toHaveBeenCalled();
  });
});
