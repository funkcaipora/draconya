// Interest management por célula (FUN-33, §13 do documento técnico).
//
// Sem isto, N jogadores na mesma sessão custam O(N²) em transmissão: cada passo de cada um vai
// para todos os outros. A conta que justifica está na issue — 2.000 jogadores dando 2 passos por
// segundo, cada passo para 2.000 pessoas, dá 8 milhões de mensagens por segundo.
//
// Com célula, cada passo vai só para quem tem aquele pedaço do mapa no campo de visão. O custo
// deixa de depender de quantos estão na sessão e passa a depender de quantos estão POR PERTO —
// um número que não cresce com a população, porque o mapa é o mesmo e tile é exclusivo.
//
// **Isto é apresentação, não simulação.** Mora no `server` de propósito: o `sim` produz o evento
// haja ou não alguém olhando (invariante 3), e quem decide se aquilo vira bytes é o hospedeiro
// (§12). AOI dentro do `sim` faria o resultado depender de quem está assistindo.
//
// ## A visibilidade é SIMÉTRICA
//
// Se eu te enxergo, você me enxerga. Não é simplificação: assimetria aqui seria um jogador
// aparecendo na tela de alguém que não aparece na dele, e a primeira consequência é combate
// contra quem não se vê. A simetria também é o que torna "quem recebe o passo deste personagem"
// uma leitura de conjunto, sem consulta de célula nenhuma no caminho quente.
//
// ## A histerese, e por que ela não é detalhe
//
// Entrar e sair do campo são MENSAGENS (`creature-appear` e `creature-disappear`). Dois jogadores
// oscilando em torno da distância limite gerariam um par delas por passo — e numa praça cheia
// isso é mais tráfego do que a AOI economizou.
//
// Por isso são DOIS limiares, como o lure e o ring swap do bot (FUN-87): o par passa a se
// enxergar ao chegar a `subscribe` células, e só deixa de se enxergar passando de `drop`. Entre
// os dois nada muda, por construção.

import type { GridPoint } from '@draconya/sim';

export interface AreaOfInterestOptions {
  /**
   * Lado da célula, em tiles.
   *
   * Dez, e o número vem da CÂMERA: `VIEW_WIDTH` é 18 e `visibleTiles` acrescenta uma tile de
   * margem de cada lado, então a tela alcança 9,5 tiles para os lados do personagem. Uma célula
   * de distância cobre pelo menos 10 tiles em qualquer direção, mesmo com os dois colados em
   * quinas opostas das suas células.
   *
   * O que o servidor manda e o que a tela mostra precisam ser a mesma coisa: menos, e aparece
   * buraco onde deveria haver criatura; muito mais, e paga-se banda por invisível.
   */
  readonly cellSize?: number;
  /** Distância, em células, em que o par PASSA a se enxergar. */
  readonly subscribe?: number;
  /** Distância a partir da qual ele deixa de se enxergar. Maior que `subscribe` — é a histerese. */
  readonly drop?: number;
}

/**
 * O que mudou de visibilidade. Ids, não mensagens: quem monta pacote é o hospedeiro, e este
 * módulo não conhece protocolo.
 *
 * Uma lista de cada, e não quatro, porque a relação é simétrica: quem apareceu para mim é
 * exatamente quem eu passei a enxergar.
 */
export interface VisibilityChange {
  /** Passaram a se enxergar com quem se moveu. */
  readonly appeared: readonly string[];
  /** Deixaram de se enxergar com quem se moveu. */
  readonly vanished: readonly string[];
}

const NOTHING: VisibilityChange = { appeared: [], vanished: [] };

/**
 * Chave numérica de célula. String alocaria por consulta, e isto roda por passo.
 *
 * O viés mantém a chave INJETIVA com índice negativo, e índice negativo acontece: o bloco de
 * candidatos de quem está na borda do mapa alcança células fora dele. Sem o viés,
 * `cellKey(3, -1)` é o mesmo número que `cellKey(2, 999_999)` — inalcançável num mapa de
 * verdade, que precisaria de dez milhões de tiles, mas "seguro por enquanto" não é seguro, e o
 * viés custa duas somas.
 */
const BIAS = 4_096;
const SPAN = 1_000_000;
const cellKey = (cx: number, cy: number): number => (cx + BIAS) * SPAN + (cy + BIAS);

interface Presence {
  cx: number;
  cy: number;
  /** Quem este enxerga AGORA. É o conjunto que a histerese preserva entre os dois limiares. */
  readonly visible: Set<string>;
}

export class AreaOfInterest {
  readonly #cellSize: number;
  readonly #subscribe: number;
  readonly #drop: number;
  readonly #presence = new Map<string, Presence>();
  /** Célula → quem está nela. É o índice que substitui varrer a sessão inteira por passo. */
  readonly #occupants = new Map<number, Set<string>>();

  constructor(options: AreaOfInterestOptions = {}) {
    this.#cellSize = options.cellSize ?? 10;
    this.#subscribe = options.subscribe ?? 1;
    this.#drop = options.drop ?? 3;
    if (this.#drop <= this.#subscribe) {
      // Sem faixa morta não há histerese: quem oscila em torno do limite gera um par
      // appear/disappear por passo, que é mais tráfego do que a AOI economizou.
      throw new Error('drop must be greater than subscribe: equal thresholds have no dead band');
    }
  }

  /** Entrou no mundo. */
  enter(id: string, at: GridPoint): VisibilityChange {
    if (this.#presence.has(id)) return this.move(id, at);
    const presence: Presence = {
      cx: Math.floor(at.x / this.#cellSize),
      cy: Math.floor(at.y / this.#cellSize),
      visible: new Set(),
    };
    this.#presence.set(id, presence);
    this.#addOccupant(cellKey(presence.cx, presence.cy), id);
    return this.#reconcile(id, presence);
  }

  /** Saiu do mundo. Devolve de quem ele some. */
  leave(id: string): VisibilityChange {
    const presence = this.#presence.get(id);
    if (presence === undefined) return NOTHING;

    const vanished = [...presence.visible];
    for (const other of vanished) this.#presence.get(other)?.visible.delete(id);
    this.#removeOccupant(cellKey(presence.cx, presence.cy), id);
    this.#presence.delete(id);
    return { appeared: [], vanished };
  }

  /**
   * Andou. **Passo dentro da mesma célula não muda visibilidade de ninguém**, e é o caso comum:
   * para ele a AOI não faz trabalho nenhum além de duas divisões.
   */
  move(id: string, to: GridPoint): VisibilityChange {
    const presence = this.#presence.get(id);
    if (presence === undefined) return this.enter(id, to);

    const cx = Math.floor(to.x / this.#cellSize);
    const cy = Math.floor(to.y / this.#cellSize);
    if (cx === presence.cx && cy === presence.cy) return NOTHING;

    this.#removeOccupant(cellKey(presence.cx, presence.cy), id);
    presence.cx = cx;
    presence.cy = cy;
    this.#addOccupant(cellKey(cx, cy), id);
    return this.#reconcile(id, presence);
  }

  /**
   * Quem enxerga este personagem — e, pela simetria, quem ele enxerga.
   *
   * É a lista que substitui "todos os visualizadores da sessão" no caminho quente, e ela já
   * está pronta: nenhuma consulta de célula acontece aqui.
   */
  visibleTo(id: string): readonly string[] {
    const presence = this.#presence.get(id);
    return presence === undefined ? [] : [...presence.visible];
  }

  /** Quantas células têm alguém dentro. Existe para a medição, não para a decisão. */
  get occupiedCells(): number {
    return this.#occupants.size;
  }

  /**
   * Recalcula o que ESTE personagem enxerga, e devolve a diferença.
   *
   * Os candidatos saem do bloco de células que alcança `drop - 1` — mais longe que isso ninguém
   * pode passar a enxergá-lo —, mais quem ele já enxergava, que precisa ser reavaliado mesmo
   * tendo ficado para trás. O bloco é constante (`(2·(drop−1)+1)²` células), então o custo de um
   * passo não cresce com a população da sessão.
   */
  #reconcile(id: string, presence: Presence): VisibilityChange {
    const appeared: string[] = [];
    const vanished: string[] = [];
    const candidates = new Set<string>(presence.visible);
    const reach = this.#drop - 1;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const occupants = this.#occupants.get(cellKey(presence.cx + dx, presence.cy + dy));
        if (occupants === undefined) continue;
        for (const other of occupants) if (other !== id) candidates.add(other);
      }
    }

    for (const other of candidates) {
      const theirs = this.#presence.get(other);
      if (theirs === undefined) continue;
      const distance = Math.max(
        Math.abs(theirs.cx - presence.cx), Math.abs(theirs.cy - presence.cy),
      );
      const seen = presence.visible.has(other);
      // Os dois limiares, e a faixa morta entre eles: perto o bastante passa a ver; longe o
      // bastante deixa de ver; no meio, fica como estava.
      const shouldSee = distance <= this.#subscribe || (seen && distance <= reach);
      if (shouldSee === seen) continue;

      if (shouldSee) {
        presence.visible.add(other);
        theirs.visible.add(id);
        appeared.push(other);
      } else {
        presence.visible.delete(other);
        theirs.visible.delete(id);
        vanished.push(other);
      }
    }
    return { appeared, vanished };
  }

  #addOccupant(cell: number, id: string): void {
    const set = this.#occupants.get(cell);
    if (set === undefined) this.#occupants.set(cell, new Set([id]));
    else set.add(id);
  }

  #removeOccupant(cell: number, id: string): void {
    const set = this.#occupants.get(cell);
    if (set === undefined) return;
    set.delete(id);
    if (set.size === 0) this.#occupants.delete(cell);
  }
}
