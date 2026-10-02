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
// ## O andar (OW-22, ADR 0060 d.11)
//
// Quem está em andares que o Canary não deixa ver um ao outro não se enxerga, por perto que esteja
// em x e y. A regra é a de `Spectators::getSpectators` (`canary/src/map/spectators.cpp:125-139`,
// constantes de `canary/src/map/map_const.hpp:17-19`), a mesma que decide quem recebe o passo de
// uma criatura no Tibia:
//
//   - da superfície se veem os andares 0 a 7, e o 6 e o 7 ainda alcançam o subsolo logo abaixo (o 6
//     vê até o 8, o 7 até o 9);
//   - do subsolo (8 a 15), dois andares para cada lado.
//
// Escrita assim ela é SIMÉTRICA (`floorsSee(a, b) === floorsSee(b, a)`, preso por teste), e a
// simetria é o que o resto deste módulo promete — o `canSee` de `creature.cpp:68-87` é assimétrico
// (de z 7 não se vê o 8, de z 8 vê-se o 7), mas ele decide o que UM cliente desenha, e aqui se
// decide quem avisa quem, nos dois sentidos.
//
// A chave de célula carrega a FAIXA de andar: os oito andares de superfície são uma faixa só
// (todos se veem), e cada andar de subsolo é a sua. Assim uma praça cheia no andar 7 não vira
// candidata na busca de quem está no porão, e quem sobe a escada troca de célula mesmo sem andar
// nenhum tile em x e y. O alcance em x e y continua o da célula: o `canSee` ainda desloca a caixa
// em um tile por andar (a perspectiva do cliente), e aqui isso se perde — a célula de 10 tiles
// com a histerese de três é folga de sobra para os dois ou três andares que a Thais e o subsolo
// próximo têm.
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

import type { FloorPoint } from '@draconya/sim';

/** `MAP_INIT_SURFACE_LAYER` (`canary/src/map/map_const.hpp:18`): o último andar de superfície. */
const SURFACE_LAYER = 7;
/** `MAP_MAX_LAYERS` (`map_const.hpp:17`). Os andares vão de 0 a 15. */
const FLOOR_COUNT = 16;
/** `MAP_LAYER_VIEW_LIMIT` (`map_const.hpp:19`): do subsolo, quantos andares para cada lado. */
const LAYER_VIEW_LIMIT = 2;

/**
 * O intervalo de andares que um espectador em `z` alcança — `Spectators::getSpectators`
 * (`canary/src/map/spectators.cpp:125-139`), com `multifloor` ligado. Inclusivo nas duas pontas.
 */
export function floorRange(z: number): readonly [number, number] {
  const floor = clampFloor(z);
  if (floor > SURFACE_LAYER) {
    return [Math.max(floor - LAYER_VIEW_LIMIT, 0), Math.min(floor + LAYER_VIEW_LIMIT, FLOOR_COUNT - 1)];
  }
  // O 6 vê até o 8 e o 7 até o 9: são os dois andares que o Canary deixa espiar o subsolo logo
  // abaixo da rua, e é por onde se vê quem desce a escada do porão. Do 5 para cima, só a superfície.
  if (floor === SURFACE_LAYER - 1) return [0, SURFACE_LAYER - 1 + LAYER_VIEW_LIMIT];
  if (floor === SURFACE_LAYER) return [0, SURFACE_LAYER + LAYER_VIEW_LIMIT];
  return [0, SURFACE_LAYER];
}

/** O andar de um ponto: sem `z` é o andar padrão do mapa, que o Canary chama de nível do mar. */
function floorOf(point: FloorPoint): number {
  return clampFloor(point.z ?? SURFACE_LAYER);
}

/** `z` fora de 0–15 não existe no Tibia; o teste e a `Session` de mentira não devem derrubar a AOI. */
function clampFloor(z: number): number {
  return Math.min(FLOOR_COUNT - 1, Math.max(0, Math.trunc(z)));
}

/** Estes dois andares se enxergam? Simétrico: `floorsSee(a, b) === floorsSee(b, a)`. */
export function floorsSee(a: number, b: number): boolean {
  const [min, max] = floorRange(a);
  const floor = clampFloor(b);
  return floor >= min && floor <= max;
}

/**
 * A faixa de andar da chave de célula: a superfície inteira numa só (todos os andares de 0 a 7 se
 * veem), e um andar de subsolo por faixa.
 */
function floorBand(z: number): number {
  return z <= SURFACE_LAYER ? 0 : z;
}

/**
 * Para cada andar, as faixas que ele alcança — o que a busca de candidatos percorre em vez de
 * andar por andar. Calculada uma vez: é função só do andar.
 */
const BANDS_SEEN: readonly (readonly number[])[] = Array.from({ length: FLOOR_COUNT }, (_, z) => {
  const [min, max] = floorRange(z);
  const bands = new Set<number>();
  for (let floor = min; floor <= max; floor++) bands.add(floorBand(floor));
  return [...bands];
});

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
 * viés custa duas somas. A faixa de andar é o dígito de menor ordem (OW-22), e a chave segue
 * injetiva por ela caber em 0–15.
 */
const BIAS = 4_096;
const SPAN = 1_000_000;
const cellKey = (cx: number, cy: number, band: number): number => (
  ((cx + BIAS) * SPAN + (cy + BIAS)) * FLOOR_COUNT + band
);

interface Presence {
  cx: number;
  cy: number;
  /** O andar de verdade, de 0 a 15: a faixa da chave sai dele, mas a regra de visão é por andar. */
  z: number;
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

  /** Entrou no mundo. Sem `z`, no andar padrão do mapa (o 7). */
  enter(id: string, at: FloorPoint): VisibilityChange {
    if (this.#presence.has(id)) return this.move(id, at);
    const z = floorOf(at);
    const presence: Presence = {
      cx: Math.floor(at.x / this.#cellSize),
      cy: Math.floor(at.y / this.#cellSize),
      z,
      visible: new Set(),
    };
    this.#presence.set(id, presence);
    this.#addOccupant(cellKey(presence.cx, presence.cy, floorBand(z)), id);
    return this.#reconcile(id, presence);
  }

  /** Saiu do mundo. Devolve de quem ele some. */
  leave(id: string): VisibilityChange {
    const presence = this.#presence.get(id);
    if (presence === undefined) return NOTHING;

    const vanished = [...presence.visible];
    for (const other of vanished) this.#presence.get(other)?.visible.delete(id);
    this.#removeOccupant(cellKey(presence.cx, presence.cy, floorBand(presence.z)), id);
    this.#presence.delete(id);
    return { appeared: [], vanished };
  }

  /**
   * Andou. **Passo dentro da mesma célula e do mesmo andar não muda visibilidade de ninguém**, e é
   * o caso comum: para ele a AOI não faz trabalho nenhum além de duas divisões.
   *
   * Trocar de andar SEMPRE reavalia, ainda que x e y fiquem na mesma célula: a escada do porão
   * leva um tile adiante, e a regra de andares do Canary é por andar, não por faixa — do 5 para o 7
   * a faixa é a mesma, e quem está no 9 passa a ver o personagem.
   */
  move(id: string, to: FloorPoint): VisibilityChange {
    const presence = this.#presence.get(id);
    if (presence === undefined) return this.enter(id, to);

    const cx = Math.floor(to.x / this.#cellSize);
    const cy = Math.floor(to.y / this.#cellSize);
    const z = floorOf(to);
    if (cx === presence.cx && cy === presence.cy && z === presence.z) return NOTHING;

    const before = cellKey(presence.cx, presence.cy, floorBand(presence.z));
    const after = cellKey(cx, cy, floorBand(z));
    presence.cx = cx;
    presence.cy = cy;
    presence.z = z;
    if (before !== after) {
      this.#removeOccupant(before, id);
      this.#addOccupant(after, id);
    }
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
   * pode passar a enxergá-lo —, em cada faixa de andar que o andar dele alcança (`BANDS_SEEN`),
   * mais quem ele já enxergava, que precisa ser reavaliado mesmo tendo ficado para trás. O bloco é
   * constante (`(2·(drop−1)+1)²` células por faixa, uma faixa na superfície abaixo do 6), então o
   * custo de um passo não cresce com a população da sessão.
   */
  #reconcile(id: string, presence: Presence): VisibilityChange {
    const appeared: string[] = [];
    const vanished: string[] = [];
    const candidates = new Set<string>(presence.visible);
    const reach = this.#drop - 1;
    for (const band of BANDS_SEEN[presence.z] ?? []) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const occupants = this.#occupants.get(cellKey(presence.cx + dx, presence.cy + dy, band));
          if (occupants === undefined) continue;
          for (const other of occupants) if (other !== id) candidates.add(other);
        }
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
      // bastante deixa de ver; no meio, fica como estava. O andar vem ANTES e não tem faixa morta:
      // dois andares que o Canary não deixa se ver não se veem a distância nenhuma, e voltam a se
      // ver no instante em que a regra permite — é a tela que muda, não a distância.
      const shouldSee = floorsSee(presence.z, theirs.z)
        && (distance <= this.#subscribe || (seen && distance <= reach));
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
