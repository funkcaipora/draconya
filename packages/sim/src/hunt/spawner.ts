// Spawn por ponto e composição por dificuldade (FUN-41, §14.5 e §14.6).
//
// A regra que decide o desenho inteiro: **densidade é DADO, nunca sorteio**. Quantos monstros
// há em cada ponto vem da dificuldade escolhida e não varia — o §14.5 é explícito. O único
// sorteio é QUAL monstro, dentro dos pesos da composição.
//
// Posição também é determinística, e isso é escolha: o monstro aparece sempre no mesmo tile
// livre mais próximo do ponto. Uma hunt cujo spawn "anda" a cada respawn é uma hunt que o
// jogador não consegue planejar — e planejar é o que o §17.1 vende ao tornar o monstro
// previsível.

import type { HuntDifficulty, Point } from '@draconya/content';
import type { Rng } from '../rng.js';
import type { Blocked } from '../monster/step.js';

/** Um lugar onde um monstro nasce. Vazio significa esperando o respawn. */
export interface SpawnSlot {
  readonly pointIndex: number;
  /** `null` enquanto vivo; instante em que volta, quando morto. */
  readonly respawnAtMs: number | null;
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

/**
 * Sorteia dentro dos pesos. É o ÚNICO sorteio do spawn.
 *
 * Peso zero é permitido e significa "não sai": deixar uma variante no arquivo com peso zero é
 * como se desliga um monstro sem apagar a linha, e apagar linha é como se perde o histórico
 * de balanceamento.
 */
export function pickByWeight(
  composition: HuntDifficulty['composition'],
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

/**
 * Tiles ao redor de um ponto, do mais próximo ao mais distante, em ordem fixa.
 *
 * Ordem fixa é o que torna a posição reproduzível: mesma hunt, mesmo respawn, mesmo tile. Sem
 * isso, dois servidores com o mesmo snapshot desenhariam mapas diferentes.
 */
export function* tilesAround(center: Point, radius: number): Generator<Point> {
  yield center;
  for (let ring = 1; ring <= radius; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        yield { x: center.x + dx, y: center.y + dy, z: center.z };
      }
    }
  }
}

export class Spawner {
  #slots: SpawnSlot[];

  /**
   * Um lugar por monstro previsto: `perSpawnPoint` da dificuldade, para cada ponto da rota.
   * A conta acontece UMA vez, na entrada — densidade não muda durante a hunt.
   */
  constructor(pointCount: number, difficulty: HuntDifficulty, state?: SpawnerState) {
    if (state !== undefined) {
      this.#slots = [...state.slots];
      return;
    }
    this.#slots = [];
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
      for (let i = 0; i < difficulty.perSpawnPoint; i++) {
        this.#slots.push({ pointIndex, respawnAtMs: null, occupantId: null });
      }
    }
  }

  get slots(): readonly SpawnSlot[] {
    return this.#slots;
  }

  getState(): SpawnerState {
    return { slots: [...this.#slots] };
  }

  /** Lugares que precisam de monstro agora: vazios e com o prazo cumprido. */
  due(
    nowMs: number,
    difficulty: HuntDifficulty,
    positionOf: (pointIndex: number) => Point,
    blocked: Blocked,
    rng: Rng,
  ): SpawnRequest[] {
    const requests: SpawnRequest[] = [];
    const taken = new Set<string>();
    for (const slot of this.#slots) {
      if (slot.occupantId !== null) continue;
      if (slot.respawnAtMs !== null && nowMs < slot.respawnAtMs) continue;

      const monsterId = pickByWeight(difficulty.composition, rng);
      if (monsterId === null) continue;

      const position = this.#freeTile(positionOf(slot.pointIndex), blocked, taken);
      // Sem lugar livre agora — outro monstro ocupou o ponto, ou o jogador está em cima.
      // Tentar de novo no próximo tick é melhor que empilhar dois monstros no mesmo tile.
      if (position === null) continue;

      taken.add(`${position.x},${position.y}`);
      requests.push({ slot: this.#slots.indexOf(slot), monsterId, position });
    }
    return requests;
  }

  /** Marca o lugar como ocupado pela criatura que acabou de nascer. */
  occupy(slot: number, occupantId: number): void {
    const current = this.#slots[slot];
    if (current === undefined) return;
    this.#slots[slot] = { ...current, occupantId, respawnAtMs: null };
  }

  /**
   * O ocupante morreu: o lugar volta a contar o tempo.
   *
   * Respawn instantâneo faria a rota deixar de importar — o personagem mataria tudo parado
   * num ponto só. Longo demais faz ele dar voltas em mapa vazio. O número é da hunt.
   */
  release(occupantId: number, nowMs: number, difficulty: HuntDifficulty): void {
    const index = this.#slots.findIndex((slot) => slot.occupantId === occupantId);
    if (index < 0) return;
    const slot = this.#slots[index] as SpawnSlot;
    this.#slots[index] = {
      ...slot,
      occupantId: null,
      respawnAtMs: nowMs + difficulty.respawnDelayMs,
    };
  }

  #freeTile(center: Point, blocked: Blocked, taken: ReadonlySet<string>): Point | null {
    for (const tile of tilesAround(center, SPAWN_RADIUS)) {
      if (blocked(tile.x, tile.y)) continue;
      if (taken.has(`${tile.x},${tile.y}`)) continue;
      return tile;
    }
    return null;
  }
}

/**
 * Até onde procurar um tile livre em volta do ponto.
 *
 * Não é o `radius` do ponto de spawn da rota, que descreve onde os monstros PODEM estar; este
 * é só o alcance da busca por um lugar desocupado, e ficar pequeno é o certo — monstro que
 * nasce longe do ponto deixa de guardar o trecho da rota que ele existe para guardar.
 */
const SPAWN_RADIUS = 3;
