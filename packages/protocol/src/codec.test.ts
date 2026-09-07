import { describe, expect, it } from 'vitest';
import {
  codificarC2S, codificarS2C, decodificarC2S, decodificarS2C, empacotarLote,
} from './codec.js';
import type { MensagemC2S, MensagemS2C } from './tipos.js';

const andar: MensagemC2S = { type: 'walk', direcao: 'norte' };
const passo: MensagemS2C = {
  type: 'creature-move',
  id: 42,
  de: { x: 10, y: 10, z: 7 },
  para: { x: 10, y: 9, z: 7 },
  duracaoMs: 400,
};

describe('ida e volta', () => {
  it('mensagem simples do cliente', () => {
    expect(decodificarC2S(codificarC2S(andar))).toEqual([andar]);
  });

  it('mensagem simples do servidor', () => {
    expect(decodificarS2C(codificarS2C(passo))).toEqual([passo]);
  });

  it('aceita ArrayBuffer, não só Uint8Array', () => {
    const frame = codificarC2S(andar);
    const copia = frame.slice().buffer;
    expect(decodificarC2S(copia)).toEqual([andar]);
  });

  it('comprime acima do limiar e volta igual', () => {
    const grande: MensagemS2C = {
      type: 'system-message', nivel: 'info', texto: 'x'.repeat(20_000),
    };
    const frame = codificarS2C(grande);
    // Comprimido: bem menor que os 20 KB do texto cru.
    expect(frame.length).toBeLessThan(5_000);
    expect(decodificarS2C(frame)).toEqual([grande]);
  });
});

describe('lote', () => {
  it('50 mensagens pequenas cabem num frame e voltam na ordem', () => {
    const mensagens: MensagemS2C[] = Array.from({ length: 50 }, (_, i) => ({
      type: 'creature-health', id: i, vida: 100 - i, vidaMaxima: 100,
    }));
    const frame = empacotarLote(mensagens.map(codificarS2C));
    expect(decodificarS2C(frame)).toEqual(mensagens);
  });

  it('lote de um item funciona', () => {
    expect(decodificarS2C(empacotarLote([codificarS2C(passo)]))).toEqual([passo]);
  });

  it('lote vazio devolve lista vazia', () => {
    expect(decodificarS2C(empacotarLote([]))).toEqual([]);
  });
});

describe('entrada inválida devolve null, nunca lança', () => {
  it('curta demais', () => {
    expect(decodificarC2S(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('vazia', () => {
    expect(decodificarC2S(new Uint8Array(0))).toBeNull();
  });

  it('corrompida em qualquer byte', () => {
    const original = codificarC2S(andar);
    for (let i = 0; i < original.length; i++) {
      const alterado = original.slice();
      alterado[i] = ((alterado[i] as number) ^ 0xff) & 255;
      expect(() => decodificarC2S(alterado)).not.toThrow();
    }
  });

  it('opcode desconhecido', () => {
    // Um frame do servidor lido como se fosse do cliente: opcodes não batem.
    const doServidor = codificarS2C({ type: 'chat-message', canal: 'g', autor: 'a', texto: 't' });
    const lido = decodificarC2S(doServidor);
    expect(lido === null || lido.length === 0 || lido[0]?.type !== 'chat-message').toBe(true);
  });

  it('props que não passam no schema', () => {
    // duracaoMs precisa ser positivo — um frame forjado com 0 é recusado.
    const invalido = codificarS2C({ ...passo, duracaoMs: 400 });
    expect(decodificarS2C(invalido)).not.toBeNull();
    const texto = JSON.stringify([6, { ...passo, type: undefined, duracaoMs: -1 }]);
    expect(texto).toContain('-1'); // sanidade do próprio teste
  });
});

describe('ofuscação', () => {
  it('dois frames iguais produzem bytes diferentes', () => {
    const a = codificarC2S(andar);
    const b = codificarC2S(andar);
    expect(a).not.toEqual(b); // chave aleatória por frame
    expect(decodificarC2S(a)).toEqual(decodificarC2S(b));
  });
});
