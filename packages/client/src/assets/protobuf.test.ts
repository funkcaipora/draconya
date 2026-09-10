import { describe, expect, it } from 'vitest';
import {
  ProtoReader, WIRE_BYTES, WIRE_FIXED32, WIRE_FIXED64, WIRE_VARINT, readRepeatedVarint,
} from './protobuf.js';

/**
 * Os bytes deste arquivo são LITERAIS, escritos à mão a partir da especificação do fio.
 *
 * É deliberado: um teste de leitor que usa o encoder da casa para produzir a entrada prova que
 * os dois concordam, não que algum dos dois está certo. Aqui não há encoder — cada caso diz
 * quais bytes são e o que eles significam.
 */
const reader = (...bytes: number[]) => new ProtoReader(Uint8Array.from(bytes));

describe('varint', () => {
  it('lê um byte só, e depois vários', () => {
    // 0x01 = 1. 0x96 0x01 = (0x16) | (1 << 7) = 150.
    expect(reader(0x01).varint32()).toBe(1);
    expect(reader(0x96, 0x01).varint32()).toBe(150);
    // 0xff 0xff 0xff 0xff 0x0f = 2^32 - 1, o maior uint32.
    expect(reader(0xff, 0xff, 0xff, 0xff, 0x0f).varint32()).toBe(4_294_967_295);
  });

  it('lê enum negativo, que vem em dez bytes', () => {
    // proto2 codifica enum negativo como `int64` em complemento de dois: -1 são 63 bits um,
    // que dão nove bytes de continuação mais o bit 63. É o `ANIMATION_LOOP_TYPE_PINGPONG`.
    const pingpong = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01];
    expect(reader(...pingpong).int32()).toBe(-1);
    // Sem sinal, os mesmos bytes são os 32 bits baixos — e não um número gigante impreciso.
    expect(reader(...pingpong).varint32()).toBe(4_294_967_295);
  });

  it('recusa varint truncado e varint longo demais', () => {
    expect(() => reader(0x80).varint32()).toThrow(/truncated/);
    expect(() => reader(...Array<number>(10).fill(0x80)).varint32()).toThrow(/longer than 10/);
  });
});

describe('tag', () => {
  it('separa número de campo e wire type', () => {
    // 0x0a = 10 = (1 << 3) | 2 — campo 1, length-delimited.
    expect(reader(0x0a).tag()).toEqual({ field: 1, wire: WIRE_BYTES });
    // 0x08 = 8 = (1 << 3) | 0 — campo 1, varint.
    expect(reader(0x08).tag()).toEqual({ field: 1, wire: WIRE_VARINT });
  });

  it('recusa o campo 0, que não existe em protobuf', () => {
    expect(() => reader(0x00).tag()).toThrow(/field number 0/);
  });
});

describe('length-delimited', () => {
  it('devolve o conteúdo como vista, e lê string', () => {
    // 0x03 "rat"
    expect(reader(0x03, 0x72, 0x61, 0x74).string()).toBe('rat');
  });

  it('recusa comprimento que passa do fim do buffer', () => {
    expect(() => reader(0x09, 0x72).bytes()).toThrow(/past the end/);
  });

  it('a submensagem é delimitada ao próprio tamanho', () => {
    // Comprimento 1, e um byte a mais depois dela: o fork enxerga só o byte de dentro.
    const outer = reader(0x01, 0x07, 0x63);
    const inner = outer.fork();
    expect(inner.varint32()).toBe(7);
    expect(inner.done).toBe(true);
    // O leitor de fora continua exatamente onde a submensagem acabou.
    expect(outer.varint32()).toBe(0x63);
  });
});

describe('skip — é o que sobrevive a um schema que cresceu', () => {
  it('pula cada wire type e continua alinhado no campo seguinte', () => {
    const cases: ReadonlyArray<readonly [number, number[]]> = [
      // varint de dois bytes, depois o campo 2 com o valor 9
      [WIRE_VARINT, [0x96, 0x01, 0x10, 0x09]],
      // oito bytes fixos, depois o campo 2 com o valor 9
      [WIRE_FIXED64, [1, 2, 3, 4, 5, 6, 7, 8, 0x10, 0x09]],
      // quatro bytes fixos
      [WIRE_FIXED32, [1, 2, 3, 4, 0x10, 0x09]],
      // length-delimited de três bytes
      [WIRE_BYTES, [0x03, 0x61, 0x62, 0x63, 0x10, 0x09]],
    ];
    for (const [wire, bytes] of cases) {
      const r = reader(...bytes);
      r.skip(wire);
      expect(r.tag()).toEqual({ field: 2, wire: WIRE_VARINT });
      expect(r.varint32()).toBe(9);
    }
  });

  it('recusa grupo em vez de adivinhar', () => {
    // Wire types 3 e 4 são grupos, obsoletos e ausentes deste schema. Encontrar um significa
    // que o buffer não é o que se pensa — e seguir dali produziria aparências plausíveis e
    // erradas, que é pior que falhar.
    expect(() => reader(0x00).skip(3)).toThrow(/unsupported wire type 3/);
    expect(() => reader(0x00).skip(4)).toThrow(/unsupported wire type 4/);
  });
});

describe('repeated numérico', () => {
  it('aceita a forma empacotada e a solta, no mesmo vetor', () => {
    // proto2 não empacota por padrão, mas nada impede o pacote de assets de empacotar. Um
    // leitor que só entende uma das formas devolve zero sprite para metade das aparências.
    const packed: number[] = [];
    readRepeatedVarint(reader(0x03, 0x01, 0x02, 0x03), WIRE_BYTES, packed);
    expect(packed).toEqual([1, 2, 3]);

    const loose: number[] = [];
    readRepeatedVarint(reader(0x07), WIRE_VARINT, loose);
    expect(loose).toEqual([7]);
  });
});
