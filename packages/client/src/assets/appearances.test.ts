import { describe, expect, it } from 'vitest';
import {
  FRAME_GROUP_OUTFIT_IDLE, FRAME_GROUP_OUTFIT_MOVING, LOOP_PINGPONG, readAppearances,
} from './appearances.js';

// --- codificador de teste -------------------------------------------------------------------
//
// Existe para montar fixture rica sem depender de um `.dat` real, que não está nesta máquina
// (FUN-65). Ele NÃO é a prova de que o leitor está certo — codificador e leitor escritos pela
// mesma mão concordam entre si com facilidade. A prova é o teste "bytes derivados à mão" logo
// abaixo, que não passa por aqui.

const varint = (value: number): number[] => {
  const out: number[] = [];
  let rest = value >>> 0;
  for (;;) {
    const byte = rest & 0x7f;
    rest >>>= 7;
    if (rest === 0) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
};
const tag = (field: number, wire: number): number[] => varint((field << 3) | wire);
const uint = (field: number, value: number): number[] => [...tag(field, 0), ...varint(value)];
const flag = (field: number, value: boolean): number[] => uint(field, value ? 1 : 0);
const block = (field: number, payload: readonly number[]): number[] =>
  [...tag(field, 2), ...varint(payload.length), ...payload];
const text = (field: number, value: string): number[] =>
  block(field, [...new TextEncoder().encode(value)]);
/** `repeated` empacotado: um único campo length-delimited com os varints em sequência. */
const packed = (field: number, values: readonly number[]): number[] =>
  block(field, values.flatMap((value) => varint(value)));
/** `repeated` solto: um campo por valor, que é o padrão de proto2. */
const loose = (field: number, values: readonly number[]): number[] =>
  values.flatMap((value) => uint(field, value));
/** -1 em complemento de dois, dez bytes. É o único valor negativo do schema. */
const PINGPONG = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01];

const read = (bytes: readonly number[]) => readAppearances(Uint8Array.from(bytes));

describe('bytes derivados à mão, sem passar pelo codificador de teste', () => {
  it('lê a aparência mínima', () => {
    // Derivação, campo a campo, direto do `appearances.proto`:
    //
    //   Appearance.id = 1, varint      → tag (1<<3)|0 = 0x08, valor 100 = 0x64
    //   Appearance.name = 4, bytes     → tag (4<<3)|2 = 0x22, tamanho 3, "rat" = 72 61 74
    //   Appearances.object = 1, bytes  → tag (1<<3)|2 = 0x0a, tamanho 7, e os 7 acima
    //
    // Se o leitor e o codificador deste arquivo estiverem os dois errados do mesmo jeito, é
    // este teste que reprova — ele não usa o codificador.
    const index = read([0x0a, 0x07, 0x08, 0x64, 0x22, 0x03, 0x72, 0x61, 0x74]);

    expect(index.objects.size).toBe(1);
    expect(index.objects.get(100)).toMatchObject({ id: 100, name: 'rat' });
  });
});

describe('readAppearances', () => {
  it('indexa os quatro catálogos por id, cada um no seu', () => {
    const index = read([
      ...block(1, uint(1, 10)),
      ...block(2, uint(1, 20)),
      ...block(3, uint(1, 30)),
      ...block(4, uint(1, 40)),
    ]);

    expect([...index.objects.keys()]).toEqual([10]);
    expect([...index.outfits.keys()]).toEqual([20]);
    expect([...index.effects.keys()]).toEqual([30]);
    expect([...index.missiles.keys()]).toEqual([40]);
  });

  it('lê grupos de quadro com sprites, padrões e caixa', () => {
    const spriteInfo = [
      ...uint(1, 4), // pattern_width — as quatro direções vivem aqui
      ...uint(2, 1), // pattern_height
      ...uint(3, 1), // pattern_depth
      ...uint(4, 2), // layers
      ...packed(5, [900, 901, 902, 903]),
      ...uint(7, 32), // bounding_square
    ];
    const index = read([...block(2, [
      ...uint(1, 128),
      ...block(2, [...uint(1, FRAME_GROUP_OUTFIT_IDLE), ...uint(2, 0), ...block(3, spriteInfo)]),
      ...block(2, [...uint(1, FRAME_GROUP_OUTFIT_MOVING), ...uint(2, 1), ...block(3, spriteInfo)]),
    ])]);

    const outfit = index.outfits.get(128);
    expect(outfit?.frameGroups).toHaveLength(2);
    expect(outfit?.frameGroups[0]).toMatchObject({
      fixedGroup: FRAME_GROUP_OUTFIT_IDLE,
      spriteIds: [900, 901, 902, 903],
      patternWidth: 4,
      layers: 2,
      boundingSquare: 32,
    });
    expect(outfit?.frameGroups[1]?.fixedGroup).toBe(FRAME_GROUP_OUTFIT_MOVING);
  });

  it('lê a lista de sprites empacotada e solta com o mesmo resultado', () => {
    const withInfo = (info: readonly number[]) =>
      read([...block(1, [...uint(1, 7), ...block(2, block(3, info))])])
        .objects.get(7)?.frameGroups[0]?.spriteIds;

    expect(withInfo(packed(5, [1, 2, 3]))).toEqual([1, 2, 3]);
    expect(withInfo(loose(5, [1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it('padrão e camada ausentes valem 1, não 0', () => {
    // É SUPOSIÇÃO documentada em `appearances.ts`: a contagem de sprites de um grupo é o
    // produto das dimensões, e um zero ali zeraria o produto — uma aparência de um sprite só,
    // que não declara padrão nenhum, ficaria sem nenhum.
    const index = read([...block(1, [...uint(1, 7), ...block(2, block(3, packed(5, [42])))])]);

    expect(index.objects.get(7)?.frameGroups[0]).toMatchObject({
      patternWidth: 1, patternHeight: 1, patternDepth: 1, layers: 1,
    });
  });

  it('lê animação, inclusive o laço ping-pong, que é negativo', () => {
    const animation = [
      ...uint(1, 2), // default_start_phase
      ...flag(2, true), // synchronized
      ...flag(3, false), // random_start_phase
      ...tag(4, 0), ...PINGPONG, // loop_type = -1
      ...uint(5, 3), // loop_count
      ...block(6, [...uint(1, 100), ...uint(2, 200)]),
      ...block(6, [...uint(1, 300), ...uint(2, 400)]),
    ];
    const index = read([...block(1, [...uint(1, 7), ...block(2, block(3, block(6, animation)))])]);

    const group = index.objects.get(7)?.frameGroups[0];
    expect(group?.animation).toMatchObject({
      defaultStartPhase: 2, synchronized: true, randomStartPhase: false,
      loopType: LOOP_PINGPONG, loopCount: 3,
    });
    expect(group?.animation?.phases).toEqual([
      { durationMinMs: 100, durationMaxMs: 200 },
      { durationMinMs: 300, durationMaxMs: 400 },
    ]);
  });

  it('lê o deslocamento das bandeiras, e ignora o resto delas', () => {
    // As ~70 bandeiras de `AppearanceFlags` são regra de jogo — empilhável, container, bloqueia
    // passagem — e quem decide isso é `content` (invariante 6). Só o deslocamento é desenho.
    const flags = [
      ...flag(5, true), // container: lido e descartado de propósito
      ...block(26, [...uint(1, 8), ...uint(2, 16)]), // shift
      ...flag(42, true), // corpse: idem
    ];
    const index = read([...block(1, [...uint(1, 7), ...block(3, flags)])]);

    expect(index.objects.get(7)?.offset).toEqual({ x: 8, y: 16 });
  });

  it('sem deslocamento, o campo é nulo em vez de zero', () => {
    // Zero é um deslocamento válido. Confundir "não tem" com "tem, e é zero" faria o dia em
    // que o padrão mudasse virar bug invisível.
    const index = read([...block(1, uint(1, 7))]);
    expect(index.objects.get(7)?.offset).toBeNull();
  });

  it('lê os ids de significado especial, sem lhes dar significado', () => {
    const index = read([...block(5, [...uint(1, 3031), ...uint(4, 22118)])]);

    expect(index.specialIds.goldCoin).toBe(3031);
    expect(index.specialIds.tibiaCoin).toBe(22118);
    expect(index.specialIds.crystalCoin).toBeNull();
  });

  it('descarta aparência sem id, em vez de deixá-las se sobrescreverem na chave 0', () => {
    const index = read([...block(1, text(4, 'sem id')), ...block(1, uint(1, 7))]);

    expect([...index.objects.keys()]).toEqual([7]);
  });
});

describe('resistência a um pacote de versão mais nova', () => {
  it('pula campo desconhecido de qualquer wire type e segue alinhado', () => {
    // É o teste que decide se este leitor sobrevive a uma versão nova do pacote. Sem o pulo
    // correto, o primeiro campo que a CIP adicionar desalinha tudo o que vem depois dele — e
    // o sintoma é sprite trocado, não erro de leitura.
    const unknownVarint = uint(99, 123_456);
    const unknownBytes = text(100, 'campo que ainda não existe');
    const unknownFixed64 = [...tag(101, 1), 1, 2, 3, 4, 5, 6, 7, 8];
    const unknownFixed32 = [...tag(102, 5), 1, 2, 3, 4];

    const index = read([
      ...unknownVarint,
      ...block(1, [
        ...unknownFixed64,
        ...uint(1, 7),
        ...unknownBytes,
        ...text(4, 'rat'),
        ...unknownFixed32,
      ]),
      ...unknownBytes,
    ]);

    expect(index.objects.get(7)).toMatchObject({ id: 7, name: 'rat' });
  });

  it('recusa buffer que não é um registro de aparências', () => {
    // Grupo (wire type 3) não existe neste schema: o buffer não é o que se pensa.
    expect(() => read([...tag(1, 3)])).toThrow(/unsupported wire type/);
  });
});
