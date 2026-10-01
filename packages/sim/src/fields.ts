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
//
// **O campo tem DONO (OW-05, #826, ADR 0060 d.8).** Quem lançou o campo decide em quem ele
// pega: o campo de personagem — ou de invocação de personagem — não fere personagem nem
// invocação de personagem, e a parede dele (Magic Wall, Wild Growth) cede a quem é personagem.
// É o no-pvp do Canary aplicado ao campo (`canary/src/creatures/combat/combat.cpp:1207-1218`,
// `:2611-2640`; o portão final em `condition.cpp:2015-2020`). Campo sem dono é campo de MAPA e
// continua pegando todo mundo.

import type { ConditionSpec, FieldStage } from '@draconya/content';
import type { WorldPoint } from './movement.js';

/**
 * Quem lançou o campo (OW-05, #826). É um REGISTRO do lançamento, gravado por `applyField` e
 * nunca relido para achar a criatura: o que ele decide é só o `kind`, e por isso o campo
 * continua valendo depois de o dono sair da sessão, morrer ou ser desfeito (a invocação some
 * antes do campo — `Condition` do Canary guarda o mesmo id solto, `CONDITION_PARAM_OWNER`).
 *
 * - `character`: um personagem OU uma invocação de personagem (ADR 0057) — o Canary trata as
 *   duas como jogador (`caster->isSummon() ? master->getPlayer() : caster->getPlayer()`,
 *   `combat.cpp:1198-1204`). `id` é o id do personagem (o mestre, no caso da invocação).
 * - `monster`: qualquer outro monstro. `id` é o `subject` dele (`m:<id>`).
 */
export interface FieldOwner {
  readonly kind: 'character' | 'monster';
  readonly id: string;
}

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
  /**
   * Quem lançou (OW-05, #826). Ausente é campo de MAPA — o de todo snapshot gravado antes desta
   * issue, que restaura igual e sem subir `SNAPSHOT_FORMAT_VERSION`: nenhum campo de então tinha
   * dono, e o campo sem dono continua pegando todo mundo. Sobrevive à troca de estágio
   * (`HuntRuleset#onFieldStageAdvance` o repassa) e ao relançamento do MESMO id, que o troca
   * pelo de quem relançou.
   */
  readonly owner?: FieldOwner;
}

/**
 * O campo é de um personagem (ou de invocação de personagem)? É o que o no-pvp lê: o campo
 * assim não fere personagem (`HuntRuleset#fieldHarms`) e, sendo parede, cede a quem é
 * personagem (`isSafeWall`).
 */
export function isCharacterOwned(field: TileFieldState): boolean {
  return field.owner?.kind === 'character';
}

/**
 * A parede de personagem — a variante SEGURA do Canary (`ITEM_MAGICWALL_SAFE`/
 * `ITEM_WILDGROWTH_SAFE`, `combat.cpp:1207-1218`). Ela segue bloqueando monstro, invocação e
 * projétil, como a parede comum; quem a atravessa é o personagem: o passo dele a remove e ele
 * segue (`Tile::queryAdd`, `canary/src/items/tile.cpp:864-876`, "NO PVP magic wall or wild
 * growth field check"; `MagicField::onStepInField`, `combat.cpp:2594-2602`). Vale para QUALQUER
 * personagem, não só o lançador — o Canary confere `creature->getPlayer()`, nunca o dono.
 */
export function isSafeWall(field: TileFieldState): boolean {
  return field.blocksMovement === true && isCharacterOwned(field);
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
   *
   * `dissolvesSafeWalls` (OW-05, #826) é a pergunta de QUEM é personagem: a parede de
   * personagem (`isSafeWall`) não o bloqueia, porque o passo dele a desfaz. Ausente é `false` —
   * a pergunta de sempre, que monstro e invocação continuam fazendo.
   */
  blockedAt(point: WorldPoint, dissolvesSafeWalls = false): boolean {
    const field = this.at(point);
    if (field === null || field.blocksMovement !== true) return false;
    return !(dissolvesSafeWalls && isSafeWall(field));
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
