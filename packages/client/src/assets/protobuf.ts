// Leitor de fio protobuf (proto2), mínimo e sem dependência (FUN-16).
//
// Por que escrever em vez de gerar: o único consumidor é `appearances.ts`, e os números de
// campo dele saem do schema REAL (`appearances.proto` do `opentibiabr/otclient`, MIT) — não há
// adivinhação, que era o risco que a issue apontava no leitor "na mão". Um gerador traria
// runtime de protobuf inteiro para o bundle do cliente por causa de um arquivo, e a lista de
// bibliotecas fixas do ADR 0011 vale por ser curta.
//
// O que este leitor precisa saber fazer, e nada além:
//
//   varint, length-delimited, e PULAR o resto pelo wire type.
//
// Pular corretamente é o que torna o parser resistente a subir de versão do pacote de assets:
// um campo que a CIP adicionar amanhã é ignorado sem quebrar a leitura dos que vêm depois dele.

/** Wire types do protobuf. Grupos (3 e 4) são obsoletos e não aparecem neste schema. */
export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_BYTES = 2;
export const WIRE_FIXED32 = 5;

export interface Tag {
  readonly field: number;
  readonly wire: number;
}

const textDecoder = new TextDecoder();

export class ProtoReader {
  readonly #bytes: Uint8Array;
  #pos: number;
  readonly #end: number;

  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    this.#bytes = bytes;
    this.#pos = start;
    this.#end = end;
  }

  get done(): boolean {
    return this.#pos >= this.#end;
  }

  /** O próximo cabeçalho de campo: número e wire type, num varint só. */
  tag(): Tag {
    const key = this.varint32();
    const field = key >>> 3;
    if (field === 0) throw new Error('protobuf: field number 0 is invalid');
    return { field, wire: key & 7 };
  }

  /**
   * Um varint, devolvendo os **32 bits baixos** sem sinal.
   *
   * Todo campo deste schema é `uint32`, `bool` ou enum, e cabe em 32 bits. Um enum negativo
   * (`ANIMATION_LOOP_TYPE_PINGPONG = -1`) vem em dez bytes, porque proto2 o codifica como
   * `int64` em complemento de dois: os bytes são consumidos até o fim, e quem quer o sinal
   * chama `int32`. Assim não existe caminho em que a leitura perde precisão em silêncio.
   */
  varint32(): number {
    let result = 0;
    for (let i = 0; i < 10; i++) {
      if (this.#pos >= this.#end) throw new Error('protobuf: truncated varint');
      const byte = this.#bytes[this.#pos++] as number;
      // Só os 32 bits baixos importam; os shifts acima de 28 caem fora deles de propósito.
      if (i < 5) result |= (byte & 0x7f) << (7 * i);
      if ((byte & 0x80) === 0) return result >>> 0;
    }
    throw new Error('protobuf: varint longer than 10 bytes');
  }

  /** O mesmo varint, reinterpretado com sinal. É o que lê enum negativo. */
  int32(): number {
    return this.varint32() | 0;
  }

  bool(): boolean {
    return this.varint32() !== 0;
  }

  /**
   * O conteúdo de um campo length-delimited, como VISTA sobre o buffer original.
   *
   * Vista e não cópia: o `.dat` tem alguns MB e é percorrido inteiro uma vez. Quem precisar
   * guardar o conteúdo depois da leitura que copie — e `readAppearances` não guarda nenhum.
   */
  bytes(): Uint8Array {
    const length = this.varint32();
    const start = this.#pos;
    const end = start + length;
    if (end > this.#end) throw new Error('protobuf: length-delimited field runs past the end');
    this.#pos = end;
    return this.#bytes.subarray(start, end);
  }

  string(): string {
    return textDecoder.decode(this.bytes());
  }

  /** Um leitor para o conteúdo de uma submensagem, delimitado ao tamanho dela. */
  fork(): ProtoReader {
    const nested = this.bytes();
    return new ProtoReader(nested);
  }

  /**
   * Descarta o campo atual pelo wire type. É o que faz o leitor sobreviver a um schema que
   * cresceu — sem isto, o primeiro campo desconhecido desalinha tudo o que vem depois.
   */
  skip(wire: number): void {
    switch (wire) {
      case WIRE_VARINT:
        this.varint32();
        return;
      case WIRE_FIXED64:
        this.#advance(8);
        return;
      case WIRE_BYTES:
        this.#advance(this.varint32());
        return;
      case WIRE_FIXED32:
        this.#advance(4);
        return;
      default:
        // Grupos (3 e 4). Obsoletos desde proto2 e ausentes deste schema; encontrar um
        // significa que o buffer não é o que se pensa, e adivinhar dali para a frente
        // produziria aparências plausíveis e erradas.
        throw new Error(`protobuf: unsupported wire type ${wire}`);
    }
  }

  #advance(count: number): void {
    const end = this.#pos + count;
    if (end > this.#end) throw new Error('protobuf: field runs past the end');
    this.#pos = end;
  }
}

/**
 * Lê um `repeated` numérico aceitando as DUAS codificações.
 *
 * proto2 não empacota por padrão, mas nada impede o gerador do pacote de assets de empacotar —
 * e um leitor que só entende uma das formas devolve zero sprite para metade das aparências, ou
 * lança. Aqui as duas caem no mesmo vetor: `WIRE_BYTES` é a lista empacotada, qualquer outro
 * wire type é um valor solto.
 */
export function readRepeatedVarint(reader: ProtoReader, wire: number, into: number[]): void {
  if (wire !== WIRE_BYTES) {
    into.push(reader.varint32());
    return;
  }
  const packed = reader.fork();
  while (!packed.done) into.push(packed.varint32());
}
