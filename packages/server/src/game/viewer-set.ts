// Os visualizadores de uma sessão, indexados por personagem (OW-22, ADR 0060 d.11).
//
// Até aqui `HostedSession.viewers` era um `Set<Viewer>` e toda pergunta "quem olha ESTE
// personagem?" — `#sendToViewersOf`, `#watchers` — varria o conjunto inteiro filtrando por
// `characterId`. Numa sessão de um dono só isso é um item; numa praça de trezentas pessoas, cada
// passo de cada um virava `vizinhos × visualizadores` comparações, e `#presentStats` (um
// `#watchers` por participante) virava o quadrado da população por ciclo. O ADR 0060 aposta que é
// o leque de saída, e não o `sim`, que cede primeiro quando o mundo enche.
//
// O índice é um `Map<characterId, Set<Viewer>>` ao lado do conjunto, mantido pelos únicos dois
// pontos de entrada e saída (`add` e `delete`). Por ser a MESMA classe que o hospedeiro itera, não
// existe caminho que mexa num e esqueça o outro: é por isso que isto é uma classe e não um
// `Map` solto ao lado do `Set`.
//
// A ordem de iteração é a de anexação, no conjunto inteiro e dentro de cada personagem — a mesma
// de filtrar o conjunto por personagem, que é o que o hospedeiro fazia —, então a ordem em que as
// mensagens entram na fila de cada visualizador não muda.

import type { Viewer } from './viewer.js';

const NONE: ReadonlySet<Viewer> = new Set();

export class ViewerSet implements Iterable<Viewer> {
  readonly #all = new Set<Viewer>();
  readonly #byCharacter = new Map<string, Set<Viewer>>();

  /** Quantos visualizadores, de todos os personagens. Abas contam separado. */
  get size(): number {
    return this.#all.size;
  }

  /** Quantos PERSONAGENS distintos têm ao menos um visualizador. Duas abas contam uma vez. */
  get characterCount(): number {
    return this.#byCharacter.size;
  }

  /** Adicionar duas vezes o mesmo visualizador não duplica nada, como num `Set`. */
  add(viewer: Viewer): this {
    if (this.#all.has(viewer)) return this;
    this.#all.add(viewer);
    const own = this.#byCharacter.get(viewer.characterId);
    if (own === undefined) this.#byCharacter.set(viewer.characterId, new Set([viewer]));
    else own.add(viewer);
    return this;
  }

  /** `true` se ele estava aqui. O índice do personagem some junto com a última aba dele. */
  delete(viewer: Viewer): boolean {
    if (!this.#all.delete(viewer)) return false;
    const own = this.#byCharacter.get(viewer.characterId);
    if (own !== undefined) {
      own.delete(viewer);
      if (own.size === 0) this.#byCharacter.delete(viewer.characterId);
    }
    return true;
  }

  has(viewer: Viewer): boolean {
    return this.#all.has(viewer);
  }

  /**
   * Os visualizadores DESTE personagem, na ordem de anexação — sem varrer a sessão.
   *
   * É o conjunto vivo, não uma cópia: quem for soltar visualizadores enquanto percorre (`delete`
   * ou `close`) copia antes (`[...viewers.of(id)]`), como já se fazia com a sessão inteira.
   */
  of(characterId: string): ReadonlySet<Viewer> {
    return this.#byCharacter.get(characterId) ?? NONE;
  }

  /** Quantos visualizadores olham ESTE personagem. Abas contam separado. */
  countOf(characterId: string): number {
    return this.#byCharacter.get(characterId)?.size ?? 0;
  }

  /** Os personagens que têm ao menos um visualizador. */
  characterIds(): IterableIterator<string> {
    return this.#byCharacter.keys();
  }

  [Symbol.iterator](): IterableIterator<Viewer> {
    return this.#all[Symbol.iterator]();
  }
}
