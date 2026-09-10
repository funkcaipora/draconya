// Leitor do registro de aparências do pacote de assets (FUN-16).
//
// O `.dat` é protobuf, e o schema é conhecido: `src/protobuf/appearances.proto` de
// `opentibiabr/otclient` (MIT). Os números de campo abaixo saem dele, não de tentativa e erro
// — o que a issue pedia ao dizer "gere o leitor a partir do .proto".
//
//   message Appearances { repeated Appearance object=1, outfit=2, effect=3, missile=4; }
//   message Appearance  { uint32 id=1; repeated FrameGroup frame_group=2; flags=3;
//                         string name=4; string description=5; }
//   message FrameGroup  { FIXED_FRAME_GROUP fixed_frame_group=1; uint32 id=2;
//                         SpriteInfo sprite_info=3; }
//   message SpriteInfo  { uint32 pattern_width=1, pattern_height=2, pattern_depth=3,
//                         layers=4; repeated uint32 sprite_id=5; SpriteAnimation animation=6;
//                         uint32 bounding_square=7; bool is_opaque=8;
//                         repeated Box bounding_box_per_direction=9; }
//   message SpriteAnimation { ... repeated SpritePhase sprite_phase=6; }
//   message SpritePhase { uint32 duration_min=1; uint32 duration_max=2; }
//
// **Lemos um subconjunto, de propósito.** `flags` (campo 3) é a maior parte do arquivo e nada
// nele desenha um sprite; `name` e `description` são texto do cliente oficial. Materializá-los
// custaria memória para dezenas de milhares de aparências que o jogo nunca desenha ao mesmo
// tempo. O que não é lido é PULADO por wire type, e é isso que mantém o leitor válido quando o
// pacote sobe de versão e ganha campo novo.

import { Reader, WIRE_LENGTH, WIRE_VARINT } from './protobuf.js';

/**
 * Os quatro registros do pacote. São catálogos SEPARADOS: o id 100 de `object` e o id 100 de
 * `outfit` são coisas diferentes, e achatá-los num mapa só faria um sobrescrever o outro.
 */
export const APPEARANCE_KINDS = ['object', 'outfit', 'effect', 'missile'] as const;
export type AppearanceKind = (typeof APPEARANCE_KINDS)[number];

/** Campo do `Appearances` de topo por tipo de registro. */
const KIND_BY_FIELD: Readonly<Record<number, AppearanceKind>> = {
  1: 'object', 2: 'outfit', 3: 'effect', 4: 'missile',
};

/**
 * Uma fase de animação, em milissegundos.
 *
 * Mínimo e máximo são distintos porque o pacote descreve animação com duração VARIÁVEL — a
 * tocha não pisca no mesmo compasso que a do lado. Colapsar os dois num só faria toda tocha do
 * mapa piscar junta, que é o tipo de coisa que ninguém nota descrita e todo mundo nota na tela.
 */
export interface SpritePhase {
  readonly durationMinMs: number;
  readonly durationMaxMs: number;
}

/**
 * Um grupo de quadros. Uma aparência tem um (parado) ou dois (parado e andando).
 *
 * **A direção vive nos `pattern*`, não numa lista de direções.** `sprite_id` é um array plano
 * indexado por `((((phase * patternDepth + z) * patternHeight + y) * patternWidth + x) * layers)
 * + layer` — é assim que quatro direções e três fases cabem num vetor só.
 */
export interface FrameGroup {
  /** `0` parado, `1` andando. O pacote chama de `FIXED_FRAME_GROUP`. */
  readonly fixedFrameGroup: number;
  readonly patternWidth: number;
  readonly patternHeight: number;
  readonly patternDepth: number;
  readonly layers: number;
  /**
   * Ids de sprite, GLOBAIS entre todas as folhas. Qual folha contém cada um sai das faixas do
   * `catalog-content.json` — ver `catalog.ts`.
   */
  readonly spriteIds: readonly number[];
  /** Lado do quadrado que a aparência ocupa, em pixels. `0` quando o pacote não declara. */
  readonly boundingSquare: number;
  /** Vazio é aparência PARADA: um quadro só, sem animação. */
  readonly phases: readonly SpritePhase[];
}

export interface Appearance {
  readonly id: number;
  readonly kind: AppearanceKind;
  readonly frameGroups: readonly FrameGroup[];
}

/** Um catálogo por tipo, pela razão explicada em `APPEARANCE_KINDS`. */
export type AppearanceCatalogue = Readonly<
  Record<AppearanceKind, ReadonlyMap<number, Appearance>>
>;

/**
 * Lê o `appearances-<hash>.dat` inteiro.
 *
 * **Não guarde o buffer depois disto.** São alguns MB parados, e nada aqui aponta de volta
 * para ele: `spriteIds` é um array de números, não uma view.
 */
export function readAppearances(buffer: ArrayBuffer | Uint8Array): AppearanceCatalogue {
  const catalogue: Record<AppearanceKind, Map<number, Appearance>> = {
    object: new Map(), outfit: new Map(), effect: new Map(), missile: new Map(),
  };

  const reader = new Reader(buffer);
  while (!reader.done) {
    const { field, wire } = reader.tag();
    const kind = KIND_BY_FIELD[field];
    // Campo desconhecido no topo — `special_meaning_appearance_ids` (5) hoje, e o que vier
    // depois. Pular é o comportamento certo: é conteúdo que este cliente não desenha.
    if (kind === undefined || wire !== WIRE_LENGTH) {
      reader.skip(wire);
      continue;
    }
    const appearance = readAppearance(reader.slice(), kind);
    // Sem id não há como consultar, e o pacote real não produz isso. Guardar sob `0` daria um
    // catálogo com uma entrada fantasma que sobrescreve a próxima igual.
    if (appearance.id === 0) continue;
    catalogue[kind].set(appearance.id, appearance);
  }

  return catalogue;
}

function readAppearance(reader: Reader, kind: AppearanceKind): Appearance {
  let id = 0;
  const frameGroups: FrameGroup[] = [];

  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1 && wire === WIRE_VARINT) { id = reader.varint(); continue; }
    if (field === 2 && wire === WIRE_LENGTH) { frameGroups.push(readFrameGroup(reader.slice())); continue; }
    // `flags` (3), `name` (4), `description` (5) e o que vier: pulados. Ver o topo do arquivo.
    reader.skip(wire);
  }

  return { id, kind, frameGroups };
}

function readFrameGroup(reader: Reader): FrameGroup {
  let fixedFrameGroup = 0;
  let patternWidth = 1;
  let patternHeight = 1;
  let patternDepth = 1;
  let layers = 1;
  let boundingSquare = 0;
  let spriteIds: number[] = [];
  let phases: SpritePhase[] = [];

  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1 && wire === WIRE_VARINT) { fixedFrameGroup = reader.varint(); continue; }
    if (field === 3 && wire === WIRE_LENGTH) {
      const info = readSpriteInfo(reader.slice());
      ({ patternWidth, patternHeight, patternDepth, layers, boundingSquare } = info);
      spriteIds = info.spriteIds;
      phases = info.phases;
      continue;
    }
    // `id` (2) é o índice do grupo dentro da aparência, e a ORDEM já o dá. Pulado.
    reader.skip(wire);
  }

  return {
    fixedFrameGroup, patternWidth, patternHeight, patternDepth, layers,
    spriteIds, boundingSquare, phases,
  };
}

interface SpriteInfo {
  patternWidth: number;
  patternHeight: number;
  patternDepth: number;
  layers: number;
  boundingSquare: number;
  spriteIds: number[];
  phases: SpritePhase[];
}

function readSpriteInfo(reader: Reader): SpriteInfo {
  // Defaults do proto2 para campo ausente: uma aparência sem `pattern_width` é um quadro só,
  // não zero quadros. Zero aqui faria o índice de sprite virar divisão por zero na hora de
  // desenhar, longe da causa.
  const info: SpriteInfo = {
    patternWidth: 1, patternHeight: 1, patternDepth: 1, layers: 1,
    boundingSquare: 0, spriteIds: [], phases: [],
  };

  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (wire === WIRE_VARINT) {
      const value = reader.varint();
      if (field === 1) info.patternWidth = value;
      else if (field === 2) info.patternHeight = value;
      else if (field === 3) info.patternDepth = value;
      else if (field === 4) info.layers = value;
      else if (field === 5) info.spriteIds.push(value);
      else if (field === 7) info.boundingSquare = value;
      continue;
    }
    if (field === 5 && wire === WIRE_LENGTH) {
      // `repeated uint32` PACKED. O pacote real usa a forma não empacotada (uma tag por id),
      // mas proto2 permite as duas e o gerador pode trocar entre versões — aceitar só uma
      // faria uma versão futura carregar zero sprites, sem erro em lugar nenhum.
      const packed = reader.slice();
      while (!packed.done) info.spriteIds.push(packed.varint());
      continue;
    }
    if (field === 6 && wire === WIRE_LENGTH) { info.phases = readAnimation(reader.slice()); continue; }
    reader.skip(wire);
  }

  return info;
}

function readAnimation(reader: Reader): SpritePhase[] {
  const phases: SpritePhase[] = [];
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 6 && wire === WIRE_LENGTH) { phases.push(readPhase(reader.slice())); continue; }
    // `default_start_phase`, `synchronized`, `random_start_phase`, `loop_type`, `loop_count`:
    // são política de reprodução, e quem decide isso é o viewport (FUN-23). Aqui só a duração.
    reader.skip(wire);
  }
  return phases;
}

function readPhase(reader: Reader): SpritePhase {
  let durationMinMs = 0;
  let durationMaxMs = 0;
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field === 1 && wire === WIRE_VARINT) { durationMinMs = reader.varint(); continue; }
    if (field === 2 && wire === WIRE_VARINT) { durationMaxMs = reader.varint(); continue; }
    reader.skip(wire);
  }
  return { durationMinMs, durationMaxMs };
}
