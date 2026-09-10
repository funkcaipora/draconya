// Leitor de `appearances-<hash>.dat` — o registro de aparências do pacote de assets (FUN-16).
//
// Os números de campo abaixo saem do schema REAL, `src/protobuf/appearances.proto` do
// `opentibiabr/otclient` (MIT), e não de engenharia reversa do binário. É a diferença entre
// "campo 5 parece ser a lista de sprites" e "campo 5 É `sprite_id`": um leitor que adivinha
// funciona até a primeira aparência atípica, e falha de um jeito que parece dado corrompido.
//
// O que se lê é o mínimo para DESENHAR: id, nome, grupos de quadro, sprites, padrões, animação
// e deslocamento. Todo o resto — as ~70 bandeiras de `AppearanceFlags`, categorias de mercado,
// dados de NPC — é pulado pelo wire type. Elas são regra de jogo, e regra de jogo vive em
// `content` (invariante 6): o pacote de arte entra aqui só para dizer como a coisa aparece.
//
// ATENÇÃO — nada disto foi conferido contra um `.dat` de verdade, porque o pacote não está
// nesta máquina (FUN-65). O que os testes provam é que o leitor obedece ao schema; que o
// arquivo real obedece ao schema é o que a FUN-21 vai medir. As suposições que não saem do
// `.proto` estão marcadas com `SUPOSIÇÃO` abaixo, e são duas.

import { ProtoReader, WIRE_BYTES, readRepeatedVarint } from './protobuf.js';

// --- campos, tal como o `.proto` os numera ------------------------------------------------

const APPEARANCES_OBJECT = 1;
const APPEARANCES_OUTFIT = 2;
const APPEARANCES_EFFECT = 3;
const APPEARANCES_MISSILE = 4;
const APPEARANCES_SPECIAL_IDS = 5;

const APPEARANCE_ID = 1;
const APPEARANCE_FRAME_GROUP = 2;
const APPEARANCE_FLAGS = 3;
const APPEARANCE_NAME = 4;

const FRAME_GROUP_FIXED = 1;
const FRAME_GROUP_ID = 2;
const FRAME_GROUP_SPRITE_INFO = 3;

const SPRITE_INFO_PATTERN_WIDTH = 1;
const SPRITE_INFO_PATTERN_HEIGHT = 2;
const SPRITE_INFO_PATTERN_DEPTH = 3;
const SPRITE_INFO_LAYERS = 4;
const SPRITE_INFO_SPRITE_ID = 5;
const SPRITE_INFO_ANIMATION = 6;
const SPRITE_INFO_BOUNDING_SQUARE = 7;

const ANIMATION_DEFAULT_START_PHASE = 1;
const ANIMATION_SYNCHRONIZED = 2;
const ANIMATION_RANDOM_START_PHASE = 3;
const ANIMATION_LOOP_TYPE = 4;
const ANIMATION_LOOP_COUNT = 5;
const ANIMATION_SPRITE_PHASE = 6;

const PHASE_DURATION_MIN = 1;
const PHASE_DURATION_MAX = 2;

const FLAGS_SHIFT = 26;
const SHIFT_X = 1;
const SHIFT_Y = 2;

const SPECIAL_GOLD_COIN = 1;
const SPECIAL_PLATINUM_COIN = 2;
const SPECIAL_CRYSTAL_COIN = 3;
const SPECIAL_TIBIA_COIN = 4;
const SPECIAL_STAMPED_LETTER = 5;
const SPECIAL_SUPPLY_STASH = 6;

/** `FIXED_FRAME_GROUP` do schema: qual papel este grupo de quadros cumpre. */
export const FRAME_GROUP_OUTFIT_IDLE = 0;
export const FRAME_GROUP_OUTFIT_MOVING = 1;
export const FRAME_GROUP_OBJECT_INITIAL = 2;

/** `ANIMATION_LOOP_TYPE`. O primeiro é NEGATIVO no schema, e por isso vem em dez bytes. */
export const LOOP_PINGPONG = -1;
export const LOOP_INFINITE = 0;
export const LOOP_COUNTED = 1;

// --- o que sai da leitura -----------------------------------------------------------------

export interface SpritePhase {
  readonly durationMinMs: number;
  readonly durationMaxMs: number;
}

export interface SpriteAnimation {
  readonly defaultStartPhase: number;
  readonly synchronized: boolean;
  readonly randomStartPhase: boolean;
  /** `LOOP_PINGPONG` | `LOOP_INFINITE` | `LOOP_COUNTED`. */
  readonly loopType: number;
  readonly loopCount: number;
  readonly phases: readonly SpritePhase[];
}

export interface FrameGroup {
  /** `FIXED_FRAME_GROUP`: parado ou andando, para outfit; inicial, para objeto. */
  readonly fixedGroup: number;
  readonly id: number;
  /**
   * Ids de sprite, na ordem em que o pacote os declara.
   *
   * O id é **global entre todas as folhas** — qual folha o contém se descobre pelas faixas do
   * `catalog-content.json`, com `sheetForSprite`.
   */
  readonly spriteIds: readonly number[];
  readonly patternWidth: number;
  readonly patternHeight: number;
  readonly patternDepth: number;
  readonly layers: number;
  readonly boundingSquare: number;
  readonly animation: SpriteAnimation | null;
}

export interface AppearanceOffset {
  readonly x: number;
  readonly y: number;
}

export interface Appearance {
  readonly id: number;
  readonly name: string | null;
  readonly frameGroups: readonly FrameGroup[];
  /** `flags.shift` — deslocamento em pixels ao desenhar. Ausente é sem deslocamento. */
  readonly offset: AppearanceOffset | null;
}

/**
 * Ids que o pacote marca como tendo significado próprio.
 *
 * Lidos porque são de graça, e **não** usados para regra de jogo: a moeda do Draconya é campo
 * no personagem, não item (FUN-63), e quem decide o que uma coisa faz é `content`.
 */
export interface SpecialAppearanceIds {
  readonly goldCoin: number | null;
  readonly platinumCoin: number | null;
  readonly crystalCoin: number | null;
  readonly tibiaCoin: number | null;
  readonly stampedLetter: number | null;
  readonly supplyStash: number | null;
}

export interface AppearanceIndex {
  readonly objects: ReadonlyMap<number, Appearance>;
  readonly outfits: ReadonlyMap<number, Appearance>;
  readonly effects: ReadonlyMap<number, Appearance>;
  readonly missiles: ReadonlyMap<number, Appearance>;
  readonly specialIds: SpecialAppearanceIds;
}

const NO_SPECIAL_IDS: SpecialAppearanceIds = {
  goldCoin: null, platinumCoin: null, crystalCoin: null,
  tibiaCoin: null, stampedLetter: null, supplyStash: null,
};

/**
 * Lê o registro inteiro e devolve os quatro catálogos indexados por id.
 *
 * **Não guarda o buffer.** Um `.dat` tem alguns MB, e o que interessa depois da leitura são os
 * mapas — segurar o `ArrayBuffer` seria deixar isso parado na memória do navegador para sempre.
 */
export function readAppearances(source: ArrayBuffer | Uint8Array): AppearanceIndex {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const reader = new ProtoReader(bytes);

  const objects = new Map<number, Appearance>();
  const outfits = new Map<number, Appearance>();
  const effects = new Map<number, Appearance>();
  const missiles = new Map<number, Appearance>();
  let specialIds = NO_SPECIAL_IDS;

  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (wire !== WIRE_BYTES) {
      // Todo campo de `Appearances` é submensagem. Qualquer outro wire type aqui é campo novo
      // de um pacote mais recente, e pular é o comportamento certo.
      reader.skip(wire);
      continue;
    }
    switch (field) {
      case APPEARANCES_OBJECT: collect(reader, objects); break;
      case APPEARANCES_OUTFIT: collect(reader, outfits); break;
      case APPEARANCES_EFFECT: collect(reader, effects); break;
      case APPEARANCES_MISSILE: collect(reader, missiles); break;
      case APPEARANCES_SPECIAL_IDS: specialIds = readSpecialIds(reader.fork()); break;
      default: reader.skip(wire); break;
    }
  }

  return { objects, outfits, effects, missiles, specialIds };
}

function collect(reader: ProtoReader, into: Map<number, Appearance>): void {
  const appearance = readAppearance(reader.fork());
  // Aparência sem id não é endereçável, e entrar no mapa com a chave `0` faria uma sobrescrever
  // a outra em silêncio. Descartar é o menor dano — e o teste diz que isso acontece.
  if (appearance.id === 0) return;
  into.set(appearance.id, appearance);
}

function readAppearance(reader: ProtoReader): Appearance {
  let id = 0;
  let name: string | null = null;
  let offset: AppearanceOffset | null = null;
  const frameGroups: FrameGroup[] = [];

  while (!reader.done) {
    const { field, wire } = reader.tag();
    switch (field) {
      case APPEARANCE_ID: id = reader.varint32(); break;
      case APPEARANCE_NAME: name = reader.string(); break;
      case APPEARANCE_FRAME_GROUP: frameGroups.push(readFrameGroup(reader.fork())); break;
      case APPEARANCE_FLAGS: offset = readShift(reader.fork()); break;
      default: reader.skip(wire); break;
    }
  }

  return { id, name, frameGroups, offset };
}

function readFrameGroup(reader: ProtoReader): FrameGroup {
  let fixedGroup = FRAME_GROUP_OBJECT_INITIAL;
  let id = 0;
  let info: SpriteInfo = EMPTY_SPRITE_INFO;

  while (!reader.done) {
    const { field, wire } = reader.tag();
    switch (field) {
      case FRAME_GROUP_FIXED: fixedGroup = reader.int32(); break;
      case FRAME_GROUP_ID: id = reader.varint32(); break;
      case FRAME_GROUP_SPRITE_INFO: info = readSpriteInfo(reader.fork()); break;
      default: reader.skip(wire); break;
    }
  }

  return { fixedGroup, id, ...info };
}

interface SpriteInfo {
  readonly spriteIds: readonly number[];
  readonly patternWidth: number;
  readonly patternHeight: number;
  readonly patternDepth: number;
  readonly layers: number;
  readonly boundingSquare: number;
  readonly animation: SpriteAnimation | null;
}

/**
 * SUPOSIÇÃO 1 — padrão e camada ausentes valem **1**, não 0.
 *
 * O `.proto` não declara `default`, então protobuf devolveria 0 para um campo ausente. Mas a
 * contagem de sprites de um grupo é o produto das dimensões, e um zero ali zera o produto: uma
 * aparência de um sprite só, que não declara padrão nenhum, ficaria sem nenhum. `1` é o
 * elemento neutro, e é o que faz "sem padrão" significar "um padrão".
 *
 * Não conferido contra arquivo real — ver o aviso no topo.
 */
const EMPTY_SPRITE_INFO: SpriteInfo = {
  spriteIds: [], patternWidth: 1, patternHeight: 1, patternDepth: 1,
  layers: 1, boundingSquare: 0, animation: null,
};

function readSpriteInfo(reader: ProtoReader): SpriteInfo {
  let patternWidth = 1;
  let patternHeight = 1;
  let patternDepth = 1;
  let layers = 1;
  let boundingSquare = 0;
  let animation: SpriteAnimation | null = null;
  const spriteIds: number[] = [];

  while (!reader.done) {
    const { field, wire } = reader.tag();
    switch (field) {
      case SPRITE_INFO_PATTERN_WIDTH: patternWidth = reader.varint32(); break;
      case SPRITE_INFO_PATTERN_HEIGHT: patternHeight = reader.varint32(); break;
      case SPRITE_INFO_PATTERN_DEPTH: patternDepth = reader.varint32(); break;
      case SPRITE_INFO_LAYERS: layers = reader.varint32(); break;
      case SPRITE_INFO_SPRITE_ID: readRepeatedVarint(reader, wire, spriteIds); break;
      case SPRITE_INFO_ANIMATION: animation = readAnimation(reader.fork()); break;
      case SPRITE_INFO_BOUNDING_SQUARE: boundingSquare = reader.varint32(); break;
      default: reader.skip(wire); break;
    }
  }

  return { spriteIds, patternWidth, patternHeight, patternDepth, layers, boundingSquare, animation };
}

function readAnimation(reader: ProtoReader): SpriteAnimation {
  let defaultStartPhase = 0;
  let synchronized = false;
  let randomStartPhase = false;
  let loopType = LOOP_INFINITE;
  let loopCount = 0;
  const phases: SpritePhase[] = [];

  while (!reader.done) {
    const { field, wire } = reader.tag();
    switch (field) {
      case ANIMATION_DEFAULT_START_PHASE: defaultStartPhase = reader.varint32(); break;
      case ANIMATION_SYNCHRONIZED: synchronized = reader.bool(); break;
      case ANIMATION_RANDOM_START_PHASE: randomStartPhase = reader.bool(); break;
      // Com sinal: `ANIMATION_LOOP_TYPE_PINGPONG` é -1, e proto2 o codifica como `int64` em
      // complemento de dois — dez bytes que um leitor sem sinal traria como número enorme.
      case ANIMATION_LOOP_TYPE: loopType = reader.int32(); break;
      case ANIMATION_LOOP_COUNT: loopCount = reader.varint32(); break;
      case ANIMATION_SPRITE_PHASE: phases.push(readPhase(reader.fork())); break;
      default: reader.skip(wire); break;
    }
  }

  return { defaultStartPhase, synchronized, randomStartPhase, loopType, loopCount, phases };
}

function readPhase(reader: ProtoReader): SpritePhase {
  let durationMinMs = 0;
  let durationMaxMs = 0;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    switch (field) {
      case PHASE_DURATION_MIN: durationMinMs = reader.varint32(); break;
      case PHASE_DURATION_MAX: durationMaxMs = reader.varint32(); break;
      default: reader.skip(wire); break;
    }
  }
  return { durationMinMs, durationMaxMs };
}

/**
 * De `AppearanceFlags`, só o deslocamento.
 *
 * As outras ~70 bandeiras são regra de jogo — empilhável, container, bloqueia passagem,
 * categoria de mercado — e não entram: quem decide isso é `content` (invariante 6). Lê-las aqui
 * criaria uma segunda fonte de verdade sobre o que um item faz, dentro do pacote de arte.
 */
function readShift(reader: ProtoReader): AppearanceOffset | null {
  let offset: AppearanceOffset | null = null;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field !== FLAGS_SHIFT) {
      reader.skip(wire);
      continue;
    }
    const shift = reader.fork();
    let x = 0;
    let y = 0;
    while (!shift.done) {
      const inner = shift.tag();
      switch (inner.field) {
        case SHIFT_X: x = shift.varint32(); break;
        case SHIFT_Y: y = shift.varint32(); break;
        default: shift.skip(inner.wire); break;
      }
    }
    offset = { x, y };
  }
  return offset;
}

function readSpecialIds(reader: ProtoReader): SpecialAppearanceIds {
  let goldCoin: number | null = null;
  let platinumCoin: number | null = null;
  let crystalCoin: number | null = null;
  let tibiaCoin: number | null = null;
  let stampedLetter: number | null = null;
  let supplyStash: number | null = null;

  while (!reader.done) {
    const { field, wire } = reader.tag();
    switch (field) {
      case SPECIAL_GOLD_COIN: goldCoin = reader.varint32(); break;
      case SPECIAL_PLATINUM_COIN: platinumCoin = reader.varint32(); break;
      case SPECIAL_CRYSTAL_COIN: crystalCoin = reader.varint32(); break;
      case SPECIAL_TIBIA_COIN: tibiaCoin = reader.varint32(); break;
      case SPECIAL_STAMPED_LETTER: stampedLetter = reader.varint32(); break;
      case SPECIAL_SUPPLY_STASH: supplyStash = reader.varint32(); break;
      default: reader.skip(wire); break;
    }
  }

  return { goldCoin, platinumCoin, crystalCoin, tibiaCoin, stampedLetter, supplyStash };
}
