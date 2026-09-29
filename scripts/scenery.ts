// Classifica cenário usável a partir das tabelas do Canary transcritas como DADO (#727, ADR 0050
// d.1): `doors.lua` (KeyDoorTable/CustomDoorTable/QuestDoorTable/LevelDoorTable),
// `register_actions.lua` (jungleGrass, holes/stone pile) e `global.lua` (ropeSpots,
// specialRopeSpots) — só os pares de id que eles publicam, nunca o script em si (ADR 0019). O
// `duration`/`decayTo` de cada estágio vem de `items.xml`. As tabelas moram em
// `packages/content/data/scenery/canary-tables.json`, e este módulo só as INTERPRETA.
//
// PURO: entra um id (de chão ou de item, com `aid`/`uid`/`text` já lidos do OTBM), sai a
// classificação. Quem lê o JSON do disco e escreve os produtos (`interactables[]`,
// `appearances/generated/scenery.json`) é `import-map.ts`.

import type { OtbmItem } from './otbm.js';

export interface DoorTriple {
  readonly closed: number;
  readonly open: number;
  readonly locked?: number;
}

export interface GrassPair {
  readonly uncut: number;
  readonly cut: number;
  readonly durationSec: number;
}

export interface StonePilePair {
  readonly pile: number;
  readonly hole: number;
  readonly durationSec: number;
}

export interface CanaryTables {
  readonly id: string;
  readonly source: string;
  readonly doors: {
    readonly locked: readonly DoorTriple[];
    readonly common: readonly DoorTriple[];
    readonly quest: readonly DoorTriple[];
    readonly level: readonly DoorTriple[];
  };
  readonly grass: readonly GrassPair[];
  readonly stonePiles: readonly StonePilePair[];
  readonly ropeSpots: { readonly ground: readonly number[]; readonly special: readonly number[] };
  readonly ladders: readonly number[];
  readonly levers: readonly number[];
}

/**
 * `pressure-plate` (#734, ADR 0050 d.6 T3) não tem tabela do Canary aqui: nenhum dos quatro
 * recortes carrega uma, e o Draconya não teve evidência de `aid` genérico o bastante para
 * classificar por atributo (ao contrário de baú/placa/teleporte, que têm `uid`/`text`/
 * `ATTR_TELE_DEST` como sinal único). É `kind` de AUTORIA À MÃO no JSON do mapa — a mesma
 * decisão de `floorChanges`/`entryPoint`.
 */
export type InteractableKind =
  | 'door' | 'locked-door' | 'level-door' | 'quest-door' | 'grass' | 'stone-pile'
  | 'rope-spot' | 'ladder' | 'lever' | 'chest' | 'sign' | 'teleport' | 'pressure-plate';

export type InteractableTool = 'machete' | 'rope' | 'shovel' | 'pick' | 'key';

export interface ClassifiedFeature {
  readonly kind: InteractableKind;
  readonly initialState: string;
  readonly appearanceKey: string;
  readonly requiresTool?: InteractableTool;
  readonly revertMs?: number;
}

const DOOR_KIND: Record<'locked' | 'common' | 'quest' | 'level', InteractableKind> = {
  locked: 'locked-door', common: 'door', quest: 'quest-door', level: 'level-door',
};

/**
 * Um índice id → classificação, montado uma vez por importação a partir de `CanaryTables`.
 *
 * `interactiveIds` é todo id que uma tabela do Canary classifica — útil para inspeção e teste;
 * o importador NÃO o usa para excluir do cálculo de bloqueio (`import-map.ts:blockedOf`), porque
 * baú/placa/teleporte são classificados por `aid`/`uid`/`text` do ITEM, não por id estático, e
 * `blockedOf` chama `classifyGround`/`classifyItem` (mais `classifyByAttributes`) direto, por
 * item, para cobrir os dois casos com a MESMA regra (ADR 0050 d.1: o tile de um interativo nunca
 * é `#` — quem sabe se dá para pisar é o interativo, no `TileOverrides` da #728, não a grade).
 */
export interface SceneryIndex {
  readonly interactiveIds: ReadonlySet<number>;
  classifyGround(groundId: number): ClassifiedFeature | null;
  classifyItem(item: OtbmItem): ClassifiedFeature | null;
  /**
   * As entradas de `appearances.scenery` que as tabelas do Canary já fecham dos dois lados —
   * porta, capim, stone pile, rope spot, ladder, alavanca — independente de qual mapa foi
   * importado. Baú, placa e teleporte entram por OBSERVAÇÃO (o id só existe quando o OTBM
   * carrega um), e o importador os acrescenta por cima.
   */
  readonly staticAppearances: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export function buildSceneryIndex(tables: CanaryTables): SceneryIndex {
  const interactiveIds = new Set<number>();
  // UM índice só, para chão e item: uma porta, um capim ou uma stone pile é o MESMO id esteja
  // ele como chão do tile ou como item empilhado — o OTBM real grava a pile de Thais como
  // `ground`, não como item (o degrau de escada já fazia o mesmo: item sem chão embaixo). Só
  // `ropeSpots` distingue os dois grupos (`ground`/`special`) porque a TABELA do Canary já os
  // separa dessa forma (`Tile:isRopeSpot()` olha primeiro o chão, depois o topo da pilha).
  const itemIndex = new Map<number, ClassifiedFeature>();
  const staticAppearances: Record<string, Record<string, number>> = {};

  const addDoorTable = (category: keyof CanaryTables['doors']): void => {
    const kind = DOOR_KIND[category];
    for (const triple of tables.doors[category]) {
      const key = `${kind}-${triple.closed}`;
      const states: Record<string, number> = { closed: triple.closed, open: triple.open };
      if (triple.locked !== undefined) states.locked = triple.locked;
      staticAppearances[key] = states;
      interactiveIds.add(triple.closed);
      interactiveIds.add(triple.open);
      itemIndex.set(triple.closed, { kind, initialState: 'closed', appearanceKey: key });
      itemIndex.set(triple.open, { kind, initialState: 'open', appearanceKey: key });
      if (triple.locked !== undefined) {
        interactiveIds.add(triple.locked);
        itemIndex.set(triple.locked, { kind, initialState: 'locked', appearanceKey: key });
      }
    }
  };
  addDoorTable('locked');
  addDoorTable('common');
  addDoorTable('quest');
  addDoorTable('level');

  for (const grass of tables.grass) {
    const key = `grass-${grass.uncut}`;
    staticAppearances[key] = { uncut: grass.uncut, cut: grass.cut };
    interactiveIds.add(grass.uncut);
    interactiveIds.add(grass.cut);
    itemIndex.set(grass.uncut, { kind: 'grass', initialState: 'uncut', appearanceKey: key, requiresTool: 'machete' });
    itemIndex.set(grass.cut, {
      kind: 'grass', initialState: 'cut', appearanceKey: key, requiresTool: 'machete',
      revertMs: grass.durationSec * 1000,
    });
  }

  for (const pile of tables.stonePiles) {
    const key = `stone-pile-${pile.pile}`;
    staticAppearances[key] = { pile: pile.pile, hole: pile.hole };
    interactiveIds.add(pile.pile);
    interactiveIds.add(pile.hole);
    itemIndex.set(pile.pile, { kind: 'stone-pile', initialState: 'pile', appearanceKey: key, requiresTool: 'shovel' });
    itemIndex.set(pile.hole, {
      kind: 'stone-pile', initialState: 'hole', appearanceKey: key, requiresTool: 'shovel',
      revertMs: pile.durationSec * 1000,
    });
  }

  for (const id of [...tables.ropeSpots.ground, ...tables.ropeSpots.special]) {
    const key = `rope-spot-${id}`;
    staticAppearances[key] = { default: id };
    interactiveIds.add(id);
    itemIndex.set(id, { kind: 'rope-spot', initialState: 'default', appearanceKey: key, requiresTool: 'rope' });
  }

  for (const id of tables.ladders) {
    const key = `ladder-${id}`;
    staticAppearances[key] = { default: id };
    interactiveIds.add(id);
    itemIndex.set(id, { kind: 'ladder', initialState: 'default', appearanceKey: key });
  }

  // A alavanca é UM par global (ADR 0050 d.1: "alterna 2772 ↔ 2773") — toda alavanca do mapa
  // aponta a mesma entrada de `appearances.scenery`, ao contrário de porta/capim/pile, que têm
  // um par POR MODELO. O `aid` (ligação a outro interativo, #728) é o que distingue uma alavanca
  // da outra, não o par de aparência.
  if (tables.levers.length > 0) {
    const [down, up] = tables.levers;
    if (down !== undefined) {
      staticAppearances.lever = up === undefined ? { down } : { down, up };
      interactiveIds.add(down);
      itemIndex.set(down, { kind: 'lever', initialState: 'down', appearanceKey: 'lever' });
    }
    if (up !== undefined) {
      interactiveIds.add(up);
      itemIndex.set(up, { kind: 'lever', initialState: 'up', appearanceKey: 'lever' });
    }
  }

  return {
    interactiveIds,
    staticAppearances,
    classifyGround: (groundId) => itemIndex.get(groundId) ?? null,
    classifyItem: (item) => itemIndex.get(item.id) ?? null,
  };
}

/**
 * Classifica um item que NENHUMA tabela do Canary cobre, pela presença de `aid`/`uid`/`text`
 * (ADR 0050 d.1) — baú (`uid`) e placa (`text`). `aid` sozinho, sem casar com `levers`, não
 * classifica nada: um item com action id pode ser gatilho de quest sem ser cenário nenhum, e
 * chutar "alavanca" para todo `aid` desconhecido produziria falso positivo — melhor deixar de
 * fora do que classificar errado o que ninguém revisou.
 */
export function classifyByAttributes(item: OtbmItem): ClassifiedFeature | null {
  if (item.uniqueId !== undefined) {
    return { kind: 'chest', initialState: 'default', appearanceKey: `chest-${item.id}` };
  }
  if (item.text !== undefined) {
    return { kind: 'sign', initialState: 'default', appearanceKey: `sign-${item.id}` };
  }
  if (item.teleportTo !== undefined) {
    return { kind: 'teleport', initialState: 'default', appearanceKey: `teleport-${item.id}` };
  }
  return null;
}
