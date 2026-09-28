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

import type { ConditionSpec, FieldStage } from '@draconya/content';
import type { WorldPoint } from './movement.js';

/**
 * O estado de um campo no chão. O `id` é o do conteúdo; relançar o mesmo id REINICIA.
 *
 * `expiresAtMs` é o vencimento do ESTÁGIO ATUAL (#560), não mais do campo inteiro — para um
 * campo de um estágio só (todo campo declarado antes do #560) as duas coisas são a mesma
 * data, e nada muda. `condition` também é a do estágio atual; um estágio sem condição
 * (Magic Wall, Wild Growth, ou o último estágio mudo do fire field) é campo que ocupa e talvez
 * bloqueie o tile, sem aplicar nada a quem pisa nele.
 */
export interface TileFieldState {
  readonly id: string;
  readonly tiles: readonly WorldPoint[];
  readonly expiresAtMs: number;
  readonly condition?: ConditionSpec;
  /**
   * Próximo tique, para auditoria e para o relançamento decidir se reaproveita a cadência
   * (`HuntRuleset#applyField`, #334) — o mesmo papel de `ConditionState.nextTickAtMs`. Ausente
   * é "nenhum tique agendado" (campo sem tique, ou o último já rodou); nunca um valor fantasma
   * sem evento correspondente na fila. Opcional: um snapshot anterior ao #334 não tinha este
   * campo, e ausência já significava "sem tique pendente conhecido" — compatível sem bump de
   * `SNAPSHOT_FORMAT_VERSION`.
   */
  readonly nextTickAtMs?: number;
  /**
   * Em qual estágio da cadeia o campo está agora (#560, `decayTo` do Canary). Ausente é `0` —
   * o primeiro/único estágio, o que preserva bit a bit todo snapshot gravado antes desta
   * issue (nenhum campo de então tinha mais de um estágio, então nunca havia o que contar).
   */
  readonly stageIndex?: number;
  /**
   * A cadeia INTEIRA de estágios (#560) — só quando o campo tem mais de um (`FieldSpec.stages`
   * declarado). Precisa viajar no estado porque `HuntRuleset#onFieldStageAdvance` roda bem
   * depois de `applyField`, sem mais acesso ao `FieldSpec` que criou o campo — o ruleset não
   * indexa spec por id. Ausente é campo de UM estágio só (todo campo de antes desta issue).
   */
  readonly stages?: readonly FieldStage[];
  /**
   * Bloqueia movimento como parede (#560, Magic Wall/Wild Growth)? Copiado do `FieldSpec` na
   * aplicação — `Fields`/`TileOccupancy` consultam isto sem precisar do catálogo de conteúdo
   * (o mesmo desenho de `TileOverrideState.blocked`). Ausente é `false`: nenhum campo antes
   * desta issue bloqueia, e é o que preserva o v1.
   */
  readonly blocksMovement?: boolean;
  /** Bloqueia projétil/LOS (#560)? Ver `blocksMovement`. Ausente é `false`. */
  readonly blocksProjectile?: boolean;
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
    fields.restoreState(state);
    return fields;
  }

  /**
   * Substitui o conteúdo desta instância pelo do snapshot — MUTAÇÃO, não construção de outra
   * (#560). `TileOccupancy.fields` referencia esta MESMA instância desde o construtor do
   * `HuntRuleset` (o mesmo motivo de `TileOverrides.restoreState`): trocar `this.#fields` no
   * `restore()` do ruleset deixaria o mundo lendo um objeto velho, sempre vazio. `undefined` é
   * "nenhum campo" — snapshot de antes desta issue, ou instância nova.
   */
  restoreState(state: readonly TileFieldState[] | undefined): void {
    this.#byId.clear();
    this.#byTile.clear();
    if (state === undefined) return;
    for (const field of state) this.apply(field);
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

  /**
   * Substitui sem reindexar tiles — usado para atualizar `nextTickAtMs` (o mesmo papel de
   * `Conditions.replace`). Reaplicar via `apply` moveria o id para o topo da ordem de
   * sobreposição de cada tile mesmo sem o campo ter se movido, mudando qual campo "vence" numa
   * leitura de `at()` com sobreposição — `replace` não mexe no índice.
   */
  replace(field: TileFieldState): void {
    this.#byId.set(field.id, field);
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

  /**
   * O tile tem um campo bloqueante AGORA (#560)? Vale para QUALQUER criatura — é
   * `TileOccupancy.blockedAt` quem combina isto com a geometria do mapa e com `TileOverrides`,
   * a mesma composição de três fontes que já existe para porta/capim/stone-pile.
   */
  blockedAt(point: WorldPoint): boolean {
    return this.at(point)?.blocksMovement ?? false;
  }

  /** O tile tem um campo que bloqueia projétil/LOS AGORA (#560)? Ver `blockedAt`. */
  blocksProjectileAt(point: WorldPoint): boolean {
    return this.at(point)?.blocksProjectile ?? false;
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
