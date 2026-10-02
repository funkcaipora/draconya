import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  encodeC2S, encodeS2C, decodeC2S, decodeS2C, packBatch,
} from './codec.js';
import type { C2SMessage, S2CMessage } from './types.js';
import { C2S_SCHEMAS, S2C_SCHEMAS } from './types.js';

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

  it('encodes and decodes player-count', () => {
    const msg: S2CMessage = { type: 'player-count', count: 1284 };
    const encoded = encodeS2C(msg);
    expect(decodeS2C(encoded)).toEqual([msg]);
  });

  it('encodes and decodes party-spending with and without estimatedShare', () => {
    const withEstimated: S2CMessage = {
      type: 'party-spending',
      shares: [
        { characterId: 'lead', goldSpent: 250, estimatedShare: 100 },
        { characterId: 'b', goldSpent: 12.5, estimatedShare: 100 },
      ],
    };
    expect(decodeS2C(encodeS2C(withEstimated))).toEqual([withEstimated]);

    const withoutEstimated: S2CMessage = {
      type: 'party-spending',
      shares: [
        { characterId: 'lead', goldSpent: 0 },
        { characterId: 'b', goldSpent: 50 },
      ],
    };
    expect(decodeS2C(encodeS2C(withoutEstimated))).toEqual([withoutEstimated]);
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

  describe('wire format (OW-22: one allocation, same bytes)', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    /**
     * O formato escrito à mão, independente do `packBatch`: `[chave uint32 LE][flags 2][ [tamanho
     * uint32 LE][frame] ... ]`, com tudo a partir do byte 4 passado pelo xorshift da chave. É o que o
     * `packBatch` produzia quando montava o corpo num buffer à parte e o copiava para o frame.
     */
    const reference = (frames: readonly Uint8Array[], key: number): Uint8Array => {
      const bytes: number[] = [key & 255, (key >>> 8) & 255, (key >>> 16) & 255, (key >>> 24) & 255, 2];
      for (const frame of frames) {
        bytes.push(frame.length & 255, (frame.length >>> 8) & 255, (frame.length >>> 16) & 255, (frame.length >>> 24) & 255);
        for (const byte of frame) bytes.push(byte);
      }
      let r = (key ^ 0x4853_5254) >>> 0;
      if (r === 0) r = 0x4853_5254;
      for (let i = 4; i < bytes.length; i++) {
        if (((i - 4) & 3) === 0) {
          r ^= r << 13; r >>>= 0;
          r ^= r >>> 17;
          r ^= r << 5; r >>>= 0;
        }
        bytes[i] = (bytes[i] as number) ^ ((r >>> (((i - 4) & 3) << 3)) & 255);
      }
      return Uint8Array.from(bytes);
    };

    it.each([
      ['no frames', 0],
      ['one frame', 1],
      ['fifty frames', 50],
    ])('is byte-identical to the documented format with %s', (_, count) => {
      const random = 0.6180339887;
      vi.spyOn(Math, 'random').mockReturnValue(random);
      const frames = Array.from({ length: count }, (_unused, i) => encodeS2C({
        type: 'creature-health', id: i, health: 100 - i, maxHealth: 100,
      }));

      const packed = packBatch(frames);

      expect(packed).toEqual(reference(frames, (random * 0x1_0000_0000) >>> 0));
    });

    it('is byte-identical for frames larger than 64 KiB, where the length prefix needs three bytes', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.25);
      const big = new Uint8Array(70_000).map((_unused, i) => (i * 31) & 255);
      expect(packBatch([big, new Uint8Array([1, 2, 3])]))
        .toEqual(reference([big, new Uint8Array([1, 2, 3])], (0.25 * 0x1_0000_0000) >>> 0));
    });

    it('does not modify the frames it joins', () => {
      // Os pedaços podem ser o MESMO `Uint8Array` para vários visualizadores (o cache de codificação
      // do hospedeiro): juntar um lote não pode embaralhá-los no lugar.
      const piece = encodeS2C(step);
      const before = piece.slice();
      packBatch([piece, piece]);
      packBatch([piece]);
      expect(piece).toEqual(before);
      expect(decodeS2C(packBatch([piece, piece]))).toEqual([step, step]);
    });
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
    // Recusa de verdade: `null` ou vazio. A versão anterior desta asserção também aceitava
    // "decodificou como outra coisa", e comparava contra um nome que o tipo C2S nem tem —
    // ou seja, era sempre verdadeira e não testava nada. Só apareceu quando os arquivos de
    // teste passaram a ser typechecados.
    const decoded = decodeC2S(serverFrame);
    expect(decoded === null || decoded.length === 0).toBe(true);
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

describe('message shape', () => {
  it('never lets a payload declare a field named `type`', () => {
    // O codec serializa com `const { type, ...props } = msg`: `type` é o discriminador da
    // MENSAGEM. Um campo de carga com o mesmo nome é apagado no caminho, e a mensagem
    // inteira passa a ser recusada na validação do outro lado — em SILÊNCIO, porque
    // `decodeS2C` devolve `null`. Aconteceu com o `session-state`, que nasceu com um `type`
    // de "tipo de sessão" e só falhou quando alguém finalmente mandou a mensagem.
    const offenders: string[] = [];
    for (const [table, schemas] of [['C2S', C2S_SCHEMAS], ['S2C', S2C_SCHEMAS]] as const) {
      for (const [name, schema] of Object.entries(schemas)) {
        const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
        if (shape !== undefined && 'type' in shape) offenders.push(`${table}.${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('positional inventory (#160)', () => {
  it('keeps null inside arrays through the frame: null is a place, not an absence', () => {
    // O codec é JSON e `null` sobrevive por natureza; o teste existe para prender isso — um
    // codec que apagasse `null` faria a mochila encolher no fio.
    const message = {
      type: 'inventory' as const,
      backpack: [{ instanceId: 'i1', itemId: 'sword', quantity: 1 }, null, null],
      satchel: [null, { instanceId: 'i2', itemId: 'cheese', quantity: 7 }],
      equipped: {},
      capacity: { used: 10, total: 400 },
      supplies: [] as { id: string; quantity: number }[],
      ammunition: [] as { id: string; quantity: number }[],
    };
    expect(decodeS2C(encodeS2C(message))).toEqual([message]);
    const move = { type: 'move-item' as const, from: { container: 'backpack' as const, index: 0 }, to: { slot: 'hand' } };
    expect(decodeC2S(encodeC2S(move))).toEqual([move]);
  });
});

describe('catalogue item stats (#337)', () => {
  it('round-trips catalogue items with value, attack, and armor', () => {
    // O codec preserva os novos atributos base de item enviados no catálogo.
    const message: S2CMessage = {
      type: 'catalogue',
      hunts: [],
      monsters: [],
      charms: [],
      vocations: [],
      vocationLevel: 0,
      bot: {
        vocabularyVersion: 2,
        setCount: 4,
        slotsPerSet: 24,
        setNames: ['Energia', 'Fogo', 'Gelo', 'Sagrado'],
        hotkeys: ['1'],
        groups: [],
        spells: [],
        automations: [],
        supplies: [],
      },
      ammunition: [],
      items: [
        {
          id: 'spike-sword',
          name: 'Spike Sword',
          appearanceId: 10,
          weight: 50,
          slot: 'hand',
          twoHanded: false,
          value: 240,
          attack: 24,
          armor: 0,
        },
        {
          id: 'leather-armor',
          name: 'Leather Armor',
          appearanceId: 20,
          weight: 60,
          slot: 'chest',
          twoHanded: false,
          value: 12,
          attack: 0,
          armor: 4,
        },
      ],
    };

    expect(decodeS2C(encodeS2C(message))).toEqual([message]);
  });

  it('decodes older catalogue items without value, attack, or armor leaving them absent', () => {
    // Deploy em rolagem: cliente novo recebendo catálogo de nó antigo decodifica sem
    // os campos opcionais (ficam ausentes / undefined, sem default injetado).
    const olderMessage = {
      type: 'catalogue',
      hunts: [],
      bot: {
        vocabularyVersion: 2,
        setCount: 4,
        slotsPerSet: 24,
        setNames: ['Energia', 'Fogo', 'Gelo', 'Sagrado'],
        hotkeys: ['1'],
        groups: [],
        spells: [],
        automations: [],
      },
      items: [
        {
          id: 'cheese',
          name: 'Cheese',
          appearanceId: 5,
          weight: 4,
          slot: null,
          twoHanded: false,
        },
      ],
    };

    const decoded = decodeS2C(encodeS2C(olderMessage as unknown as S2CMessage));
    expect(decoded).not.toBeNull();
    const item = (decoded as Array<{ items: Array<Record<string, unknown>> }>)[0]?.items[0];
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('value');
    expect(item).not.toHaveProperty('attack');
    expect(item).not.toHaveProperty('armor');
  });
});

