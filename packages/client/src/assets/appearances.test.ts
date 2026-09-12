import { describe, expect, it } from 'vitest';
import { NO_FLAGS, readAppearances } from './appearances.js';
import { Reader } from './protobuf.js';
import {
  appearance, appearances, concat, fixed32Field, flags, frameGroup, messageField, uint32Field,
  varint,
} from './testing.js';

describe('Reader (FUN-16)', () => {
  it('lê varint de um e de vários bytes', () => {
    expect(new Reader(varint(0)).varint()).toBe(0);
    expect(new Reader(varint(127)).varint()).toBe(127);
    expect(new Reader(varint(128)).varint()).toBe(128);
    // Um id de sprite real do pacote do Canary, que ocupa três bytes.
    expect(new Reader(varint(192_615)).varint()).toBe(192_615);
    // Acima de 2³¹: `<<` em JavaScript daria negativo aqui, e ids de sprite passam disso em
    // pacote grande. É o motivo de o leitor usar multiplicação em vez de deslocamento.
    expect(new Reader(varint(3_000_000_000)).varint()).toBe(3_000_000_000);
  });

  it('recusa varint que não termina, em vez de andar até o fim do arquivo', () => {
    // Todo byte com o bit de continuação ligado. Sem o corte em dez bytes, um `.dat` truncado
    // faria o laço varrer megabytes procurando um fim que não vem — a aba trava sem erro.
    expect(() => new Reader(Uint8Array.from([0x80, 0x80, 0x80])).varint())
      .toThrow(/passou do fim/);
    expect(() => new Reader(new Uint8Array(12).fill(0x80)).varint())
      .toThrow(/mais de dez bytes/);
  });

  it('pula cada wire type pelo tamanho certo', () => {
    // O pulo é o que mantém o cursor alinhado quando o pacote ganha campo novo. Errar o
    // tamanho não dá erro: dá lixo silencioso em TODO o resto do arquivo.
    const buffer = concat(
      uint32Field(1, 300),          // varint
      fixed32Field(2, 0xdead_beef), // fixed32
      messageField(3, varint(7)),   // length-delimited
      uint32Field(9, 42),           // o que queremos ler depois de pular os três
    );
    const reader = new Reader(buffer);
    for (let i = 0; i < 3; i++) reader.skip(reader.tag().wire);
    const { field } = reader.tag();
    expect(field).toBe(9);
    expect(reader.varint()).toBe(42);
    expect(reader.done).toBe(true);
  });

  it('recusa wire type desconhecido em vez de adivinhar um tamanho', () => {
    // Wire types 3 e 4 eram grupos, removidos. Adivinhar um pulo aqui transformaria um pacote
    // incompatível em aparências erradas, que é bem pior que recusar carregar.
    expect(() => new Reader(Uint8Array.from([0])).skip(3)).toThrow(/wire type desconhecido/);
  });

  it('recusa submensagem que passa do fim', () => {
    // Comprimento maior que o buffer: arquivo truncado no download.
    expect(() => new Reader(concat(varint(2 * 8 + 2), varint(999))).slice())
      .toThrow(/passa do fim/);
  });
});

describe('readAppearances (FUN-16)', () => {
  it('devolve um catálogo consultável por id', () => {
    const catalogue = readAppearances(appearances({
      object: [appearance({
        id: 3031,
        frameGroups: [frameGroup({ patternWidth: 1, patternHeight: 1, spriteIds: [100] })],
      })],
    }));

    const gold = catalogue.object.get(3031);
    expect(gold?.id).toBe(3031);
    expect(gold?.kind).toBe('object');
    expect(gold?.frameGroups[0]?.spriteIds).toEqual([100]);
  });

  it('mantém os quatro registros SEPARADOS, mesmo com o id repetido', () => {
    // O id é único dentro do registro, não entre eles. Num mapa achatado, o outfit 100
    // sobrescreveria o objeto 100 — e o sintoma seria um item desenhado como criatura.
    const catalogue = readAppearances(appearances({
      object: [appearance({ id: 100, frameGroups: [frameGroup({ spriteIds: [1] })] })],
      outfit: [appearance({ id: 100, frameGroups: [frameGroup({ spriteIds: [2] })] })],
      effect: [appearance({ id: 100, frameGroups: [frameGroup({ spriteIds: [3] })] })],
      missile: [appearance({ id: 100, frameGroups: [frameGroup({ spriteIds: [4] })] })],
    }));

    expect(catalogue.object.get(100)?.frameGroups[0]?.spriteIds).toEqual([1]);
    expect(catalogue.outfit.get(100)?.frameGroups[0]?.spriteIds).toEqual([2]);
    expect(catalogue.effect.get(100)?.frameGroups[0]?.spriteIds).toEqual([3]);
    expect(catalogue.missile.get(100)?.frameGroups[0]?.spriteIds).toEqual([4]);
  });

  it('lê os dois grupos de quadros, parado e andando', () => {
    // É a diferença entre uma criatura que anda e uma que desliza: o grupo 1 tem as fases, o
    // grupo 0 é o quadro parado.
    const catalogue = readAppearances(appearances({
      outfit: [appearance({
        id: 21,
        frameGroups: [
          frameGroup({ fixedFrameGroup: 0, patternWidth: 4, spriteIds: [10, 11, 12, 13] }),
          frameGroup({
            fixedFrameGroup: 1, patternWidth: 4, spriteIds: [20, 21, 22, 23],
            phases: [[100, 100], [120, 180]],
          }),
        ],
      })],
    }));

    const rat = catalogue.outfit.get(21);
    expect(rat?.frameGroups).toHaveLength(2);
    expect(rat?.frameGroups[0]?.fixedFrameGroup).toBe(0);
    expect(rat?.frameGroups[0]?.phases).toEqual([]);
    expect(rat?.frameGroups[1]?.fixedFrameGroup).toBe(1);
    expect(rat?.frameGroups[1]?.phases)
      .toEqual([{ durationMinMs: 100, durationMaxMs: 100 }, { durationMinMs: 120, durationMaxMs: 180 }]);
  });

  it('a direção vive nos pattern*, e um id por padrão', () => {
    // Quatro direções × duas fases = oito ids num vetor plano. Se `patternWidth` voltasse 1
    // aqui, o viewport desenharia sempre a mesma direção — e o defeito só apareceria na tela.
    const catalogue = readAppearances(appearances({
      outfit: [appearance({
        id: 7,
        frameGroups: [frameGroup({
          patternWidth: 4, patternHeight: 1, patternDepth: 1, layers: 1,
          spriteIds: [1, 2, 3, 4, 5, 6, 7, 8], phases: [[100, 100], [100, 100]],
        })],
      })],
    }));

    const group = catalogue.outfit.get(7)?.frameGroups[0];
    expect(group?.patternWidth).toBe(4);
    expect(group?.spriteIds).toHaveLength(
      (group?.patternWidth ?? 0) * (group?.phases.length ?? 0),
    );
  });

  it('aplica os defaults do proto2 quando o campo não vem', () => {
    // Campo ausente em proto2 é o default, e para os `pattern*` isso é 1 — não zero. Zero
    // faria o índice de sprite virar uma conta degenerada na hora de desenhar, longe da causa.
    const catalogue = readAppearances(appearances({
      object: [appearance({ id: 1, frameGroups: [frameGroup({ spriteIds: [9] })] })],
    }));

    const group = catalogue.object.get(1)?.frameGroups[0];
    expect(group).toMatchObject({
      patternWidth: 1, patternHeight: 1, patternDepth: 1, layers: 1, boundingSquare: 0,
    });
  });

  it('aceita sprite_id EMPACOTADO, além da forma por tag', () => {
    // O pacote real usa uma tag por id, mas proto2 permite as duas e o gerador pode trocar
    // entre versões. Aceitar só uma faria a versão seguinte carregar zero sprites — sem erro.
    const catalogue = readAppearances(appearances({
      object: [appearance({
        id: 2, frameGroups: [frameGroup({ spriteIds: [500, 501, 502], packed: true })],
      })],
    }));
    expect(catalogue.object.get(2)?.frameGroups[0]?.spriteIds).toEqual([500, 501, 502]);
  });

  it('PULA o que não conhece, e continua lendo direito depois', () => {
    // É a propriedade que sustenta subir de versão do pacote. `flags` (3), `name` (4) e
    // `description` (5) são reais e grandes; o campo 99 é o que ainda não existe.
    const catalogue = readAppearances(appearances({
      object: [appearance({
        id: 55,
        extra: [
          messageField(3, concat(uint32Field(1, 1), uint32Field(2, 2))), // flags
          messageField(4, Uint8Array.from([0x67, 0x6f, 0x6c, 0x64])),    // name: "gold"
          fixed32Field(99, 12345),                                        // o futuro
        ],
        frameGroups: [frameGroup({ spriteIds: [7], extra: [fixed32Field(98, 1)] })],
      })],
      // `special_meaning_appearance_ids` é o campo 5 do topo, e não é aparência nenhuma.
      extra: [messageField(5, uint32Field(1, 3031))],
    }));

    expect(catalogue.object.get(55)?.frameGroups[0]?.spriteIds).toEqual([7]);
    expect(catalogue.object.size).toBe(1);
  });

  it('descarta aparência sem id em vez de guardá-la sob zero', () => {
    // Uma entrada fantasma sob `0` sobrescreveria a próxima igual, e o catálogo passaria a
    // depender da ordem do arquivo.
    const catalogue = readAppearances(appearances({
      object: [appearance({ id: 0, frameGroups: [frameGroup({ spriteIds: [1] })] })],
    }));
    expect(catalogue.object.size).toBe(0);
  });

  it('lê o boundingSquare, que é o tamanho na tela', () => {
    const catalogue = readAppearances(appearances({
      object: [appearance({
        id: 3, frameGroups: [frameGroup({ spriteIds: [1], boundingSquare: 64 })],
      })],
    }));
    expect(catalogue.object.get(3)?.frameGroups[0]?.boundingSquare).toBe(64);
  });
});

describe('as flags de aparência (FUN-117)', () => {
  it('lê chão, bloqueio, pilha, elevação, deslocamento e gancho pelo número de campo', () => {
    const catalogue = readAppearances(appearances({
      object: [
        appearance({
          id: 429, frameGroups: [frameGroup({ spriteIds: [1] })],
          flags: flags({ bankWaypoints: 100, unmove: true, fullbank: true }),
        }),
        appearance({
          id: 1294, frameGroups: [frameGroup({ spriteIds: [2] })],
          flags: flags({ bottom: true, unpass: true, unmove: true, unsight: true, hookSouth: 2 }),
        }),
        appearance({
          id: 7, frameGroups: [frameGroup({ spriteIds: [3] })],
          flags: flags({
            clip: true, top: true, avoid: true, take: true, hang: true, hookEast: 1,
            shift: { x: 8, y: 4 }, elevation: 8, lyingObject: true, animateAlways: true,
          }),
        }),
      ],
    }));
    const floor = catalogue.object.get(429)?.flags;
    expect(floor).toMatchObject({ bankWaypoints: 100, unmove: true, fullbank: true, unpass: false });
    const wall = catalogue.object.get(1294)?.flags;
    expect(wall).toMatchObject({ bottom: true, unpass: true, unsight: true, hookSouth: 2 });
    expect(wall?.bankWaypoints).toBeUndefined();
    const odd = catalogue.object.get(7)?.flags;
    expect(odd).toMatchObject({
      clip: true, top: true, avoid: true, take: true, hang: true, hookEast: 1,
      shiftX: 8, shiftY: 4, elevation: 8, lyingObject: true, animateAlways: true,
    });
  });

  it('chão sem waypoints continua sendo chão: bank vazio dá zero, não undefined', () => {
    // O pacote real grava `bank {}` em chão sem velocidade declarada. A pergunta que o
    // importador faz é "é chão?", e a resposta tem que ser sim.
    const catalogue = readAppearances(appearances({
      object: [appearance({ id: 5, frameGroups: [frameGroup({ spriteIds: [1] })], flags: flags({ bank: true }) })],
    }));
    expect(catalogue.object.get(5)?.flags?.bankWaypoints).toBe(0);
  });

  it('sem o campo 3 a aparência não tem flags, e um campo de flag desconhecido é pulado', () => {
    const catalogue = readAppearances(appearances({
      object: [
        appearance({ id: 1, frameGroups: [frameGroup({ spriteIds: [1] })] }),
        appearance({
          id: 2, frameGroups: [frameGroup({ spriteIds: [1] })],
          // `light` (23) é submessage, `market` (36) também, e um bool que não lemos (9).
          flags: flags({
            unpass: true,
            extra: [messageField(23, concat(uint32Field(1, 7), uint32Field(2, 215))), uint32Field(9, 1),
              messageField(36, uint32Field(1, 3))],
          }),
        }),
      ],
    }));
    expect(catalogue.object.get(1)?.flags).toBeUndefined();
    expect(catalogue.object.get(2)?.flags).toEqual({ ...NO_FLAGS, unpass: true });
  });
});
