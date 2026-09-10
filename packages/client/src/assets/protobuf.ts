// Leitura de protobuf, só o que o pacote de aparências exige (FUN-16).
//
// **Por que não `protobufjs`**, que a issue sugeria gerar a partir do `.proto`: a preocupação
// dela é não ADIVINHAR número de campo, e não adivinhamos — `appearances.ts` cita o schema
// real (`opentibiabr/otclient`, MIT) campo a campo. O que um decoder genérico custaria é o
// resto: ele materializa TODO campo de TODA mensagem, e `Appearance.flags` — que é a maior
// parte dos 4,8 MB e da qual não usamos nada — viraria objeto para cada uma das dezenas de
// milhares de aparências. Um leitor dirigido pula a submensagem inteira lendo um varint.
// (`pbjs --target static-module` ainda emitiria `.js`, que o `source-policy` recusa.)
//
// Nada aqui conhece aparência: é o mecanismo, e `appearances.ts` é quem tem o schema.

/**
 * Wire types do protobuf. Só estes quatro existem hoje; 3 e 4 são grupos, removidos no proto3.
 *
 * `FIXED64` e `FIXED32` existem aqui para `skip` saber o TAMANHO deles, não porque algum campo
 * do pacote de aparências seja fixo — nenhum é. Sem os dois, um campo fixo novo numa versão
 * futura desalinharia o cursor.
 */
export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_LENGTH = 2;
export const WIRE_FIXED32 = 5;

/**
 * Cursor sobre o buffer. Mutável de propósito — parsear 4,8 MB devolvendo `{ valor, novaPos }`
 * a cada varint alocaria um objeto por campo, e são milhões.
 */
export class Reader {
  readonly #bytes: Uint8Array;
  #at: number;
  readonly #end: number;

  constructor(buffer: ArrayBuffer | Uint8Array, from = 0, to?: number) {
    // Uint8Array entra sem cópia: `slice()` devolve sub-leitores sobre o MESMO buffer, e
    // copiar ali faria a leitura de 4,8 MB alocar de novo a cada submensagem.
    this.#bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.#at = from;
    this.#end = to ?? this.#bytes.length;
  }

  get position(): number { return this.#at; }
  get done(): boolean { return this.#at >= this.#end; }

  /**
   * Varint de até 32 bits úteis.
   *
   * O corte em dez bytes não é arbitrário: 64 bits em varint ocupam no máximo dez, e um buffer
   * corrompido sem esse corte faz o laço andar até o fim do arquivo procurando um bit de
   * continuação que não vem. Sem ele, um `.dat` truncado trava a aba em vez de dar erro.
   */
  varint(): number {
    let result = 0;
    let shift = 0;
    for (let read = 0; read < 10; read++) {
      if (this.#at >= this.#end) throw new Error('protobuf: varint passou do fim do buffer');
      const byte = this.#bytes[this.#at++] ?? 0;
      // Os bits acima de 32 são descartados: nenhum campo que lemos passa de uint32, e
      // `<<` em JavaScript já opera em 32 bits com sinal — `* 2 ** shift` evita o negativo.
      if (shift < 32) result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
    throw new Error('protobuf: varint com mais de dez bytes');
  }

  /** A tag de um campo: `(número << 3) | wireType`. */
  tag(): { field: number; wire: number } {
    const tag = this.varint();
    return { field: Math.floor(tag / 8), wire: tag & 0x7 };
  }

  /** Um sub-`Reader` sobre os próximos `length` bytes, e avança por cima deles. */
  slice(): Reader {
    const length = this.varint();
    const from = this.#at;
    const to = from + length;
    if (to > this.#end) throw new Error('protobuf: submensagem passa do fim do buffer');
    this.#at = to;
    return new Reader(this.#bytes, from, to);
  }

  /** Bytes crus de um campo length-delimited. */
  bytes(): Uint8Array {
    const length = this.varint();
    const from = this.#at;
    if (from + length > this.#end) throw new Error('protobuf: bytes passam do fim do buffer');
    this.#at = from + length;
    return this.#bytes.subarray(from, from + length);
  }

  /**
   * Pula um campo pelo wire type, sem tentar interpretá-lo.
   *
   * É isto que torna o leitor resistente a subir de versão do pacote: campo novo que ninguém
   * aqui conhece some corretamente, em vez de desalinhar o cursor e produzir lixo silencioso
   * de todo o resto do arquivo. Wire type desconhecido é ERRO, e não um pulo adivinhado —
   * adivinhar aqui é o que transformaria um pacote incompatível em aparências erradas.
   */
  skip(wire: number): void {
    switch (wire) {
      case WIRE_VARINT: this.varint(); return;
      case WIRE_FIXED64: this.#advance(8); return;
      case WIRE_LENGTH: this.#advance(this.varint()); return;
      case WIRE_FIXED32: this.#advance(4); return;
      default: throw new Error(`protobuf: wire type desconhecido ${wire}`);
    }
  }

  #advance(by: number): void {
    if (this.#at + by > this.#end) throw new Error('protobuf: campo passa do fim do buffer');
    this.#at += by;
  }
}
