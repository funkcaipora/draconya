// Campos de tile (CMB-07, #334). O estado transiente que NÃO pertence ao conteúdo: o `Tilemap`
// é imutável e fixado na sessão (invariante 7), e mutá-lo para guardar fogo no chão seria
// reescrever a geometria a cada magia. Aqui é um índice pequeno e volátil, do RULESET.
//
// **Chave NUMÉRICA por tile**, como `movement.ts` faz com a ocupação: a entrada de campo é
// consultada a cada passo de cada criatura, e uma string (`"x,y,z"`) alocaria por consulta. A
// indexação é O(1) e nenhum passo varre a lista de campos.
//
// Vários campos podem cobrir o mesmo tile (sobreposição). O mais RECENTE vence na leitura; ao
// remover um, os tiles voltam a apontar para os que restam sem varredura — cada tile guarda o
// conjunto de ids que o cobrem, em ordem de aplicação.
//
// Nada aqui sabe o que o campo FAZ: a condição é conteúdo (`ConditionSpec`), e quem a aplica e
// agenda os tiques é o `HuntRuleset`.

import type { ConditionSpec } from '@draconya/content';
import type { WorldPoint } from './movement.js';

/** O estado de um campo no chão. O `id` é o do conteúdo; relançar o mesmo id REINICIA. */
export interface TileFieldState {
  readonly id: string;
  readonly tiles: readonly WorldPoint[];
  readonly expiresAtMs: number;
  readonly condition: ConditionSpec;
}

/**
 * A mesma conta de `movement.ts`: andar deslocado em 16, x e y em 100 000. Só é chamada com
 * coordenada de tile — o campo é resolvido a partir de posições de criatura, que já são do mapa.
 */
export function fieldTileKey(x: number, y: number, z: number): number {
  return ((z + 16) * 100_000 + x) * 100_000 + y;
}

export class Fields {
  readonly #byId = new Map<string, TileFieldState>();
  /** tile → ids que o cobrem, em ordem de aplicação. O último é o que `at` devolve. */
  readonly #byTile = new Map<number, Set<string>>();

  static fromState(state: readonly TileFieldState[] | undefined): Fields {
    const fields = new Fields();
    if (state === undefined) return fields;
    for (const field of state) fields.apply(field);
    return fields;
  }

  getState(): readonly TileFieldState[] {
    return [...this.#byId.values()];
  }

  /**
   * Aplica (ou reinicia) um campo. Devolve o anterior de mesmo id — quem chama cancela os
   * eventos dele antes de reagendar, sem deixar órfão.
   */
  apply(field: TileFieldState): TileFieldState | null {
    const previous = this.#byId.get(field.id) ?? null;
    if (previous !== null) this.#unindex(previous);
    this.#byId.set(field.id, field);
    for (const tile of field.tiles) {
      const key = fieldTileKey(tile.x, tile.y, tile.z);
      const ids = this.#byTile.get(key);
      if (ids === undefined) this.#byTile.set(key, new Set([field.id]));
      else ids.add(field.id);
    }
    return previous;
  }

  remove(id: string): TileFieldState | null {
    const field = this.#byId.get(id) ?? null;
    if (field === null) return null;
    this.#unindex(field);
    this.#byId.delete(id);
    return field;
  }

  get(id: string): TileFieldState | null {
    return this.#byId.get(id) ?? null;
  }

  /** O campo que cobre um tile AGORA — o mais recente, quando há sobreposição. O(1). */
  at(point: WorldPoint): TileFieldState | null {
    const ids = this.#byTile.get(fieldTileKey(point.x, point.y, point.z));
    if (ids === undefined || ids.size === 0) return null;
    let last: string | undefined;
    for (const id of ids) last = id;
    return last === undefined ? null : this.#byId.get(last) ?? null;
  }

  get size(): number {
    return this.#byId.size;
  }

  #unindex(field: TileFieldState): void {
    for (const tile of field.tiles) {
      const key = fieldTileKey(tile.x, tile.y, tile.z);
      const ids = this.#byTile.get(key);
      if (ids === undefined) continue;
      ids.delete(field.id);
      if (ids.size === 0) this.#byTile.delete(key);
    }
  }
}
