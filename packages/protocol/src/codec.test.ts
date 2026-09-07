import { describe, expect, it } from 'vitest';
import {
  encodeC2S, encodeS2C, decodeC2S, decodeS2C, packBatch,
} from './codec.js';
import type { C2SMessage, S2CMessage } from './types.js';

const walk: C2SMessage = { type: 'walk', direction: 'north' };
const step: S2CMessage = {
  type: 'creature-move',
  id: 42,
  from: { x: 10, y: 10, z: 7 },
  to: { x: 10, y: 9, z: 7 },
  durationMs: 400,
};

describe('round trip', () => {
  it('simple client message', () => {
    expect(decodeC2S(encodeC2S(walk))).toEqual([walk]);
  });

  it('simple server message', () => {
    expect(decodeS2C(encodeS2C(step))).toEqual([step]);
  });

  it('accepts ArrayBuffer as well as Uint8Array', () => {
    const frame = encodeC2S(walk);
    const copy = frame.slice().buffer;
    expect(decodeC2S(copy)).toEqual([walk]);
  });

  it('compresses above the threshold and round trips unchanged', () => {
    const large: S2CMessage = {
      type: 'system-message', level: 'info', text: 'x'.repeat(20_000),
    };
    const frame = encodeS2C(large);
    // Comprimido: bem menor que os 20 KB do texto cru.
    expect(frame.length).toBeLessThan(5_000);
    expect(decodeS2C(frame)).toEqual([large]);
  });
});

describe('batch', () => {
  it('packs fifty small messages into one frame and preserves their order', () => {
    const messages: S2CMessage[] = Array.from({ length: 50 }, (_, i) => ({
      type: 'creature-health', id: i, health: 100 - i, maxHealth: 100,
    }));
    const frame = packBatch(messages.map(encodeS2C));
    expect(decodeS2C(frame)).toEqual(messages);
  });

  it('supports a batch with one item', () => {
    expect(decodeS2C(packBatch([encodeS2C(step)]))).toEqual([step]);
  });

  it('returns an empty list for an empty batch', () => {
    expect(decodeS2C(packBatch([]))).toEqual([]);
  });
});

describe('invalid input returns null without throwing', () => {
  it('rejects short frames', () => {
    expect(decodeC2S(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('rejects empty frames', () => {
    expect(decodeC2S(new Uint8Array(0))).toBeNull();
  });

  it('handles corruption at every byte', () => {
    const original = encodeC2S(walk);
    for (let i = 0; i < original.length; i++) {
      const altered = original.slice();
      altered[i] = ((altered[i] as number) ^ 0xff) & 255;
      expect(() => decodeC2S(altered)).not.toThrow();
    }
  });

  it('rejects unknown opcodes', () => {
    // Um frame do servidor lido como se fosse do cliente: opcodes não batem.
    const serverFrame = encodeS2C({ type: 'chat-message', channel: 'g', author: 'a', text: 't' });
    const decoded = decodeC2S(serverFrame);
    expect(decoded === null || decoded.length === 0 || decoded[0]?.type !== 'chat-message').toBe(true);
  });

  it('rejects properties that fail schema validation', () => {
    // O encoder permite representar o frame forjado; a validação acontece na recepção.
    expect(decodeS2C(encodeS2C({ ...step, durationMs: -1 }))).toBeNull();
  });
});

describe('obfuscation', () => {
  it('equal messages produce different frame bytes', () => {
    const a = encodeC2S(walk);
    const b = encodeC2S(walk);
    expect(a).not.toEqual(b); // chave aleatória por frame
    expect(decodeC2S(a)).toEqual(decodeC2S(b));
  });
});
