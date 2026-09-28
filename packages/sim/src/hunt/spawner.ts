// Spawn por ponto (#583, fim do pull por dificuldade — ADR 0039).
//
// Até o #583, um lugar de spawn era um "slot" espalhado pelos pontos da rota, na quantidade que
// a dificuldade escolhida mandasse (`monsterCount`). Isso acabou: toda hunt nasce dos pontos de
// spawn REAIS do Canary, um monstro por ponto, e todos os pontos nascem — não há mais tamanho de
// pull para decidir quantos. Um `SpawnSlot` agora é exatamente um `SpawnPoint` da rota: a
// contagem de lugares É a contagem de pontos, sem espalhamento nenhum para calcular.
//
// Posição continua determinística: o monstro aparece sempre no tile livre mais próximo do
// ponto. Uma hunt cujo spawn "anda" a cada respawn é uma hunt que o jogador não consegue
// planejar — e planejar é o que o §17.1 vende ao tornar o monstro previsível.

import type { Point } from '@draconya/content';
import type { Rng } from '../rng.js';
import type { Blocked } from '../monster/step.js';
import { tilesAround } from '../movement.js';

/**
 * Um lugar onde um monstro nasce. Vazio significa esperando o respawn.
 *
 * O `respawnAtMs` que morava aqui saiu na FUN-68: quem sabe a hora é o evento de spawn na fila
 * da sessão. Guardar o instante nos dois lugares seria duas verdades sobre a mesma coisa, e a
 * que estivesse errada só apareceria numa retomada.
 */
export interface SpawnSlot {
  readonly pointIndex: number;
  /** Id numérico da criatura que ocupa o lugar, ou `null`. */
  readonly occupantId: number | null;
}

export interface SpawnerState {
  readonly slots: readonly SpawnSlot[];
}

export interface SpawnRequest {
  readonly slot: number;
  readonly monsterId: string;
  readonly position: Point;
}

/** Um candidato a sorteio por peso: os `monsters` de um ponto que declara mais de um (#582). */
export interface WeightedMonster {
  readonly monsterId: string;
  readonly weight: number;
}

/**
 * Sorteia dentro dos pesos. É o ÚNICO sorteio do spawn — usado para os `monsters` de um ponto
 * que declara mais de um candidato na mesma posição (#582, o caso do Canary em que dois
 * `<monster>` do mesmo `<spawn>` caem exatamente ali).
 *
 * Peso zero é permitido e significa "não sai": deixar uma variante no arquivo com peso zero é
 * como se desliga um monstro sem apagar a linha, e apagar linha é como se perde o histórico
 * de balanceamento.
 */
export function pickByWeight(
  composition: readonly WeightedMonster[],
  rng: Rng,
): string | null {
  const total = composition.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return null;
  let roll = rng.fraction() * total;
  for (const entry of composition) {
    roll -= Math.max(0, entry.weight);
    if (roll < 0) return entry.monsterId;
  }
  return composition[composition.length - 1]?.monsterId ?? null;
}

export class Spawner {
  #slots: SpawnSlot[];

  /**
   * Um lugar por PONTO, nunca mais que isso (#583) — antes do #583 o total vinha de
   * `difficulty.monsterCount`, espalhado pelo laço; agora cada ponto É um lugar, porque o
   * conteúdo (#583, ADR 0039) exige que todo `spawnPoint` declare o próprio monstro
   * (`monsterId` ou `monsters`) e o próprio `respawnDelayMs` — não há mais para onde cair como
   * fallback. Rota sem ponto de spawn é hunt sem monstro.
   */
  constructor(pointCount: number, state?: SpawnerState) {
    if (state !== undefined) {
      this.#slots = [...state.slots];
      return;
    }
    this.#slots = [];
    for (let i = 0; i < pointCount; i++) {
      this.#slots.push({ pointIndex: i, occupantId: null });
    }
  }

  get slots(): readonly SpawnSlot[] {
    return this.#slots;
  }

  getState(): SpawnerState {
    return { slots: [...this.#slots] };
  }

  /**
   * O que nasce NESTE lugar, agora. `null` quando ele está ocupado ou não há tile livre.
   *
   * Um lugar por chamada desde a FUN-68, e não uma varredura de todos: quem chama é o evento
   * de spawn daquele lugar, que já sabe qual é. Quem chama ocupa o tile devolvido antes de
   * pedir o próximo; é isso que dispensa o conjunto de tiles já tomados que uma varredura
   * precisaria carregar.
   */
  fill(
    slotIndex: number,
    spawnPointOf: (pointIndex: number) => SpawnArea,
    blocked: Blocked,
    rng: Rng,
  ): SpawnRequest | null {
    const slot = this.#slots[slotIndex];
    if (slot === undefined || slot.occupantId !== null) return null;

    const area = spawnPointOf(slot.pointIndex);
    // O ponto SEMPRE declara o monstro (#583): direto (`monsterId`) ou por sorteio entre os
    // candidatos DELE (`monsters`, #582) — nunca mais uma composição de dificuldade como
    // fallback, porque não há mais dificuldade nenhuma.
    const monsterId = area.monsterId
      ?? (area.monsters !== undefined ? pickByWeight(area.monsters, rng) : null);
    if (monsterId === null) return null;

    const position = this.#freeTile(area.at, area.radius, blocked, monsterId);
    // Sem lugar livre agora — outro monstro ocupou o ponto, ou o jogador está em cima.
    // Quem chama tenta de novo mais tarde; empilhar dois monstros no mesmo tile é pior.
    if (position === null) return null;

    return { slot: slotIndex, monsterId, position };
  }

  /** Marca o lugar como ocupado pela criatura que acabou de nascer. */
  occupy(slot: number, occupantId: number): void {
    const current = this.#slots[slot];
    if (current === undefined) return;
    this.#slots[slot] = { ...current, occupantId };
  }

  /**
   * O ocupante morreu: devolve o lugar, e diz QUAL para quem chama agendar o respawn.
   *
   * Respawn instantâneo faria a rota deixar de importar — o personagem mataria tudo parado
   * num ponto só. Longo demais faz ele dar voltas em mapa vazio. O número é da hunt, e quem
   * o aplica agora é o evento.
   */
  release(occupantId: number): number | null {
    const index = this.#slots.findIndex((slot) => slot.occupantId === occupantId);
    if (index < 0) return null;
    const slot = this.#slots[index] as SpawnSlot;
    this.#slots[index] = { ...slot, occupantId: null };
    return index;
  }

  /**
   * O tile livre mais próximo do ponto, até o `radius` DO PONTO (FUN-123) — o que a rota
   * autora, e que até então era dado morto: a busca usava uma constante e o número do arquivo
   * não mudava nada. Ficar pequeno é o certo — monstro que nasce longe do ponto deixa de
   * guardar o trecho da rota que ele existe para guardar —, e é por isso que o raio é de quem
   * escreve a rota, tile a tile, e não de uma constante daqui.
   */
  #freeTile(center: Point, radius: number, blocked: Blocked, monsterId: string): Point | null {
    for (const tile of tilesAround(center, radius)) {
      // O `z` do PONTO, nunca o do mapa (#519): num recorte multiandar, `tilesAround` preserva o
      // andar de `center` em cada tile gerado, e é ele que precisa ser conferido — sem passar
      // adiante, todo ponto seria checado no andar padrão do mapa, e um Dragon Lord de z11
      // nasceria "livre" num tile de z10 que por acaso está vazio. O `monsterId` já resolvido é
      // o que deixa `#spawnBlockedFor` saber se ESTE monstro é `blockable` antes de aplicar a
      // janela de visão (#583, o `isBlockable` do TFS/Canary).
      if (blocked(tile.x, tile.y, tile.z, monsterId)) continue;
      return tile;
    }
    return null;
  }
}

/** Um ponto de spawn como o `Spawner` o vê: o tile, até onde procurar lugar em volta dele, e o
 * monstro do ponto — declarado (`monsterId`) ou sorteado entre candidatos (`monsters`, #582). */
export interface SpawnArea {
  readonly at: Point;
  readonly radius: number;
  readonly monsterId?: string;
  /** Vários candidatos SÓ deste ponto, com peso (#582). Exclusivo com `monsterId`. */
  readonly monsters?: readonly WeightedMonster[];
}
