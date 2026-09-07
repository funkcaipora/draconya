// Gerador determinístico e semeado, com estado serializável.
//
// `Math.random()` é proibido em `sim/`: uma sessão precisa ser reproduzível para que
// "por que morri?" e "por que não caiu o item?" sejam investigáveis, e para que a sessão
// retomada de um snapshot continue a MESMA sequência (FUN-27, FUN-28).
//
// xorshift128+: rápido, estado de 128 bits em quatro uint32, qualidade suficiente para loot
// e combate. Não serve para criptografia — e não é para isso que está aqui.

export interface RngState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export class Rng {
  #a: number; #b: number; #c: number; #d: number;

  constructor(state: RngState) {
    this.#a = state.a >>> 0;
    this.#b = state.b >>> 0;
    this.#c = state.c >>> 0;
    this.#d = state.d >>> 0;
    if ((this.#a | this.#b | this.#c | this.#d) === 0) this.#a = 1; // estado zero trava o gerador
  }

  /** Deriva um estado inicial de uma string — o id da sessão, por exemplo. */
  static fromSeed(seed: string): Rng {
    let h = 0x811c_9dc5;
    const words = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      for (const ch of `${seed}#${i}`) {
        h ^= ch.codePointAt(0) as number;
        h = Math.imul(h, 0x0100_0193) >>> 0;
      }
      words[i] = h;
    }
    return new Rng({
      a: words[0] as number, b: words[1] as number,
      c: words[2] as number, d: words[3] as number,
    });
  }

  /** Estado atual, para entrar no snapshot da sessão. */
  getState(): RngState {
    return { a: this.#a, b: this.#b, c: this.#c, d: this.#d };
  }

  /** uint32 uniforme. */
  next(): number {
    let t = this.#d;
    const s = this.#a;
    this.#d = this.#c;
    this.#c = this.#b;
    this.#b = s;
    t ^= t << 11; t >>>= 0;
    t ^= t >>> 8;
    this.#a = (t ^ s ^ (s >>> 19)) >>> 0;
    return this.#a;
  }

  /** [0, 1) */
  fraction(): number {
    return this.next() / 0x1_0000_0000;
  }

  /** Inteiro em [min, max], inclusive nos dois extremos. */
  integer(min: number, max: number): number {
    if (max < min) throw new Error(`invalid range: [${min}, ${max}]`);
    return min + Math.floor(this.fraction() * (max - min + 1));
  }

  /** true com a probabilidade dada, em [0, 1]. */
  chance(probability: number): boolean {
    return this.fraction() < probability;
  }
}
