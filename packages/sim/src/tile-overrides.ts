// Overlay de estado de tile por sessão (#728, ADR 0050 d.2, d.3, d.5, d.8).
//
// `Tilemap.interactables` (#727, ADR 0050 d.1) é CONTEÚDO: geometria e classificação fixadas na
// versão, nunca escritas. O que muda quando alguém abre uma porta, corta um capim ou puxa uma
// alavanca mora AQUI — um índice pequeno e volátil do RULESET, exatamente o desenho de
// `fields.ts` (CMB-07): chave NUMÉRICA por tile, porque `blockedAt`/`floorChangeAt` são
// consultados a cada passo de cada criatura (invariante 1: sem alocação por consulta).
//
// Ao contrário de `Fields` — onde vários campos podem cobrir o mesmo tile —, um tile tem NO
// MÁXIMO um interativo (ADR 0050 d.1, `scripts/scenery.ts`: "um índice só, para chão e item").
// Por isso o índice por tile aqui aponta um id só, nunca um `Set`.
//
// Nada aqui sabe o que abre a porta ou por que — `#useOnMap`/o walker (`rulesets/hunt.ts`) são
// quem decide QUANDO trocar de estado; este módulo só sabe COMO um estado se traduz em bloqueio,
// mudança de andar, e o par para onde ele alterna.

import type { TilemapInteractable } from '@draconya/content';
import type { WorldPoint } from './movement.js';

export type InteractableKind = TilemapInteractable['kind'];
export type InteractableTool = NonNullable<TilemapInteractable['requires']>['tool'];

/**
 * O estado de UM interativo, por sessão. `interactableId` é a chave estável — derivada da
 * posição (`interactableIdOf`), porque `Tilemap.interactables` não carrega um id próprio e um
 * tile nunca hospeda mais de um interativo (ADR 0050 d.1).
 */
export interface TileOverrideState {
  readonly interactableId: string;
  readonly kind: InteractableKind;
  /** O vocabulário de `initialState` do `kind` (`closed`/`open`, `uncut`/`cut`, `pile`/`hole`,
   * `down`/`up`) — nunca fechado aqui, como o schema de conteúdo já documenta. */
  readonly state: string;
  /** Impede movimento NESTE estado? Deriva de `kind` + `state` (T1, `BLOCKING_STATES`). */
  readonly blocked: boolean;
  /** Pisar aqui muda de andar? `null` fora do T1 (rope-spot/ladder, #728 fora do escopo). */
  readonly floorChange: WorldPoint | null;
  /**
   * Quando este estado reverte sozinho (capim cresce de volta, buraco enche), em instante
   * LÓGICO — o mesmo `expiresAtMs` de `ConditionState`. Ausente é "não decai": porta (fecha no
   * `vacate`, não por prazo) e alavanca (só troca por uso).
   */
  readonly revertAtMs?: number;
}

const tileKeyOf = (x: number, y: number, z: number): number => ((z + 16) * 100_000 + x) * 100_000 + y;

/**
 * O id estável de um interativo: a posição dele. `Tilemap.interactables` não carrega um id
 * próprio (#727 não precisava — só o importador escrevia), e a posição já é única por tile
 * (ADR 0050 d.1) — inventar um contador por ordem de importação quebraria no dia em que o
 * importador reordenar a lista sem mudar mapa nenhum.
 */
export function interactableIdOf(at: { readonly x: number; readonly y: number; readonly z: number }): string {
  return `${String(at.x)},${String(at.y)},${String(at.z)}`;
}

/**
 * Estados BLOQUEANTES por `kind`, no T1 (#728 — porta comum, capim, stone pile; ver
 * `docs/adr/0050-*.md` d.6 para os três grupos). `locked-door`/`level-door`/`quest-door` ficam
 * de fora de propósito: sem storage/level por personagem ainda (T2), o requisito nunca seria
 * satisfeito e a porta ficaria bloqueada para sempre — pior que a situação de hoje, em que ela
 * não bloqueia nada (ver `packages/content/CLAUDE.md`, "até a #728 pousar"). `rope-spot`/
 * `ladder`/`lever`/`chest`/`sign`/`teleport` nunca bloqueiam por si (usar não impede pisar).
 */
const BLOCKING_STATES: Partial<Record<InteractableKind, ReadonlySet<string>>> = {
  door: new Set(['closed']),
  grass: new Set(['uncut']),
  'stone-pile': new Set(['pile']),
};

/**
 * O par de estados que um `kind` alterna (T1 + T3, #734). `null` para quem não tem um "outro
 * lado" neste escopo (rope-spot/ladder são um passo, não uma troca de estado; baú/placa/livro
 * nem chegam a ter `state` mutável).
 *
 * `teleport` e `pressure-plate` entram aqui porque `toggle()`/`otherState()` são o mecanismo
 * COMPARTILHADO por clique (lever/door/grass/stone-pile, via `useOnMap`) E por passo
 * (pressure-plate, via step-in/step-out; teleport gated por alavanca, "abrir por N s") — mas
 * NENHUM dos dois é click-usável: `HuntRuleset.useOnMap` recusa os dois kinds explicitamente
 * (`NOT_CLICK_USABLE`, ADR 0050 d.6 T3), mesmo `isToggleable` valendo `true` para eles. Um
 * teleporte "sempre ligado" (o comum, `initialState: 'default'`) fica FORA deste par — `default`
 * não é `closed` nem `open`, `otherState` devolve `null`, e ninguém tenta alternar um teleporte
 * que nunca foi pensado para ser fechado; só quem é AUTORADO com `initialState: 'closed'` (uma
 * alavanca `links` para ele) entra no par.
 */
const TOGGLE_PAIR: Partial<Record<InteractableKind, readonly [string, string]>> = {
  door: ['closed', 'open'],
  grass: ['uncut', 'cut'],
  'stone-pile': ['pile', 'hole'],
  lever: ['down', 'up'],
  teleport: ['closed', 'open'],
  'pressure-plate': ['up', 'down'],
};

/** O outro estado do par, ou `null` quando este `kind` não alterna (T1). */
export function otherState(kind: InteractableKind, state: string): string | null {
  const pair = TOGGLE_PAIR[kind];
  if (pair === undefined) return null;
  const [a, b] = pair;
  if (state === a) return b;
  if (state === b) return a;
  return null;
}

/** `true` quando este `kind` tem um par de dois estados (e portanto pode ser usado/revertido). */
export function isToggleable(kind: InteractableKind): boolean {
  return TOGGLE_PAIR[kind] !== undefined;
}

/**
 * `floorChange` de um estado (T1: só a stone pile virada buraco). O Canary desce um andar no
 * MESMO tile ("floorchange down", ADR 0050 contexto) — rope/ladder (que trocam de andar pelo
 * outro sentido) ficam fora do escopo desta issue (#728, fora do escopo: "rope spot/ladder como
 * ITENS de verdade" continuam pendentes do T1 do plano, não desta entrega).
 */
function floorChangeFor(kind: InteractableKind, state: string, at: WorldPoint): WorldPoint | null {
  if (kind === 'stone-pile' && state === 'hole') return { x: at.x, y: at.y, z: at.z + 1 };
  return null;
}

/**
 * O estado inicial de um interativo do conteúdo — o que o OTBM tinha no instante da importação.
 * Nunca tem `revertAtMs`: nada decai antes de alguém usar (T1 só agenda a volta a partir do uso,
 * `TileOverrides.toggle`).
 */
export function overrideFromInteractable(interactable: TilemapInteractable): TileOverrideState {
  const { kind, initialState: state, at } = interactable;
  return {
    interactableId: interactableIdOf(at),
    kind,
    state,
    blocked: BLOCKING_STATES[kind]?.has(state) ?? false,
    floorChange: floorChangeFor(kind, state, at),
  };
}

export class TileOverrides {
  readonly #byId = new Map<string, TileOverrideState>();
  /** tile → o ÚNICO interativo que o cobre (ADR 0050 d.1: nunca sobreposição, ao contrário de `Fields`). */
  readonly #byTile = new Map<number, string>();
  /** Posição de cada interativo, do conteúdo — fixa na sessão (o `Tilemap` não muda). */
  readonly #atOf = new Map<string, WorldPoint>();
  /** O conteúdo de cada interativo (`revertMs`, `requires`, `links`) — para `useInteractable`. */
  readonly #contentOf = new Map<string, TilemapInteractable>();

  static fromInteractables(interactables: readonly TilemapInteractable[]): TileOverrides {
    const overrides = new TileOverrides();
    for (const interactable of interactables) {
      const id = interactableIdOf(interactable.at);
      overrides.#atOf.set(id, interactable.at);
      overrides.#contentOf.set(id, interactable);
      overrides.#index(overrideFromInteractable(interactable));
    }
    return overrides;
  }

  /**
   * Reconstrói do conteúdo (posições e classificação fixas) e aplica por cima o que o snapshot
   * diverge do estado inicial — a mesma forma de `Fields.fromState`. `undefined` é "nenhuma
   * sessão anterior mexeu em nada": snapshot anterior a esta issue, sem bump.
   */
  static fromState(
    interactables: readonly TilemapInteractable[], state: readonly TileOverrideState[] | undefined,
  ): TileOverrides {
    const overrides = TileOverrides.fromInteractables(interactables);
    overrides.restoreState(state);
    return overrides;
  }

  getState(): readonly TileOverrideState[] {
    return [...this.#byId.values()];
  }

  get(interactableId: string): TileOverrideState | null {
    return this.#byId.get(interactableId) ?? null;
  }

  /** O interativo (se houver) que cobre este tile — o(1), como `Fields.at`. */
  at(point: { readonly x: number; readonly y: number; readonly z: number }): TileOverrideState | null {
    const id = this.#byTile.get(tileKeyOf(point.x, point.y, point.z));
    return id === undefined ? null : this.#byId.get(id) ?? null;
  }

  blockedAt(x: number, y: number, z: number): boolean {
    return this.at({ x, y, z })?.blocked ?? false;
  }

  floorChangeAt(x: number, y: number, z: number): WorldPoint | null {
    return this.at({ x, y, z })?.floorChange ?? null;
  }

  /**
   * O destino de um teleporte AQUI, se houver um ativo (#734, ADR 0050 d.6 T3). `null` sempre
   * que: não há interativo neste tile; o interativo não é `teleport`; o estado é `closed` (o
   * único jeito de um teleporte estar INATIVO — uma alavanca que ainda não o abriu, T3 "abrir
   * teleporte por N s"); ou o conteúdo não carrega `target` (nunca deveria acontecer — todo
   * `kind: 'teleport'` do importador carrega `target`, mas um snapshot de conteúdo em versão
   * divergente não pode gerar exceção, invariante 7).
   *
   * O `target` que sai daqui é a coordenada LOCAL do conteúdo (`scripts/import-map.ts` já
   * converte na importação) — pode estar FORA de `[0, width)`×`[0, height)` quando o OTBM
   * apontava para fora do recorte importado, e é `movement.ts#move()` quem faz essa checagem
   * (a mesma que já faz para o destino de uma escada): esta função não sabe o tamanho do mapa.
   */
  teleportTargetAt(x: number, y: number, z: number): WorldPoint | null {
    const current = this.at({ x, y, z });
    if (current === null || current.kind !== 'teleport' || current.state === 'closed') return null;
    return this.#contentOf.get(current.interactableId)?.target ?? null;
  }

  /** O conteúdo fixo de um interativo — `revertMs`, `requires`, `links`, `kind`. */
  contentOf(interactableId: string): TilemapInteractable | null {
    return this.#contentOf.get(interactableId) ?? null;
  }

  links(interactableId: string): readonly string[] {
    const links = this.#contentOf.get(interactableId)?.links;
    if (links === undefined) return [];
    // `links` do conteúdo é `aid` como string (ADR 0050 d.1); resolve para o interactableId de
    // quem carrega aquele `aid`, dentro deste mapa — um link para `aid` inexistente é ignorado.
    const resolved: string[] = [];
    for (const [id, content] of this.#contentOf) {
      if (content.aid !== undefined && links.includes(String(content.aid))) resolved.push(id);
    }
    return resolved;
  }

  /**
   * Troca o estado de UM interativo para o outro lado do par (T1). Devolve o novo estado, ou
   * `null` quando este `kind` não alterna — chamar aqui num `kind` sem par é erro de quem chama,
   * nunca acontece com o conteúdo real (`isToggleable` confere antes).
   */
  toggle(interactableId: string, nowMs: number): TileOverrideState | null {
    const current = this.#byId.get(interactableId);
    const at = this.#atOf.get(interactableId);
    if (current === undefined || at === undefined) return null;
    const next = otherState(current.kind, current.state);
    if (next === null) return null;
    const revertMs = this.#contentOf.get(interactableId)?.revertMs;
    const blocking = BLOCKING_STATES[current.kind]?.has(next) ?? false;
    const state: TileOverrideState = {
      interactableId,
      kind: current.kind,
      state: next,
      blocked: blocking,
      floorChange: floorChangeFor(current.kind, next, at),
      // Só o lado NÃO-bloqueante decai (capim cortado volta a crescer, buraco enche de volta);
      // o lado bloqueante — o "de repouso" — não tem prazo (T1: nunca é o lado que decai).
      ...(revertMs !== undefined && !blocking ? { revertAtMs: nowMs + revertMs } : {}),
    };
    this.#index(state);
    return state;
  }

  /**
   * A porta fecha quando o tile esvazia e ninguém está nele (ADR 0050 d.3,
   * `Creature.checkCreatureInsideDoor` do Canary) — chamado pelo MESMO `vacate` que libera a
   * ocupação (`TileOccupancy.vacate`), nunca por um evento próprio: é o estado da ocupação, não
   * um prazo, que decide. `stillOccupied` é depois do vacate — `false` é "ninguém mais aqui".
   */
  closeDoorIfVacant(x: number, y: number, z: number, stillOccupied: boolean): void {
    if (stillOccupied) return;
    const current = this.at({ x, y, z });
    if (current === null || current.kind !== 'door' || current.state !== 'open') return;
    const at = this.#atOf.get(current.interactableId);
    if (at === undefined) return;
    this.#index({
      interactableId: current.interactableId, kind: 'door', state: 'closed', blocked: true, floorChange: null,
    });
  }

  /**
   * Aplica o que um snapshot diverge do estado inicial, NA MESMA instância — usado por
   * `restore()` do ruleset, que não pode trocar a instância que `TileOccupancy.overrides` já
   * referencia (o mesmo motivo de `Fields.replace` não reindexar: aqui é identidade de objeto,
   * não ordem). Entrada para um `interactableId` que este mapa não tem é ignorada — conteúdo
   * mudou de versão entre uma sessão e outra não é o caso comum (invariante 7 fixa a versão),
   * mas não deveria derrubar a retomada.
   */
  restoreState(state: readonly TileOverrideState[] | undefined): void {
    if (state === undefined) return;
    for (const entry of state) {
      if (!this.#atOf.has(entry.interactableId)) continue;
      this.#index(entry);
    }
  }

  /** Aplica um estado já resolvido (usado por `toggle`/`closeDoorIfVacant`, e por `TILE_REVERT`). */
  #index(state: TileOverrideState): void {
    this.#byId.set(state.interactableId, state);
    const at = this.#atOf.get(state.interactableId);
    if (at !== undefined) this.#byTile.set(tileKeyOf(at.x, at.y, at.z), state.interactableId);
  }
}
