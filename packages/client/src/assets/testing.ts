// Encoder de protobuf para FIXTURE (FUN-16). Não é código de produção: nada no jogo escreve
// `.dat`, e este arquivo existe porque a alternativa é pior.
//
// A alternativa seria versionar um `.dat` binário de amostra. Um blob binário no repositório é
// um teste que ninguém consegue LER: quando ele reprova, não há como saber o que a fixture
// dizia sem escrever um decoder para depurar o decoder. Aqui a fixture é a estrutura, escrita
// em TypeScript, e o encoder é a única coisa a conferir.

/** Um campo já codificado, pronto para concatenar. */
export type Field = Uint8Array;

export function varint(value: number): Uint8Array {
  const bytes: number[] = [];
  let rest = value;
  do {
    const byte = rest % 128;
    rest = Math.floor(rest / 128);
    bytes.push(rest > 0 ? byte | 0x80 : byte);
  } while (rest > 0);
  return Uint8Array.from(bytes);
}

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** Campo varint: `(field << 3) | 0`. */
export function uint32Field(field: number, value: number): Field {
  return concat(varint(field * 8), varint(value));
}

/** Campo length-delimited: `(field << 3) | 2`, tamanho, conteúdo. */
export function messageField(field: number, body: Uint8Array): Field {
  return concat(varint(field * 8 + 2), varint(body.length), body);
}

/** `repeated uint32` na forma EMPACOTADA, para o teste que exercita as duas. */
export function packedField(field: number, values: readonly number[]): Field {
  return messageField(field, concat(...values.map(varint)));
}

/** Campo fixed32, só para provar que o pulo por wire type acerta o tamanho. */
export function fixed32Field(field: number, value: number): Field {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return concat(varint(field * 8 + 5), out);
}

export interface FrameGroupFixture {
  readonly fixedFrameGroup?: number;
  readonly patternWidth?: number;
  readonly patternHeight?: number;
  readonly patternDepth?: number;
  readonly layers?: number;
  readonly boundingSquare?: number;
  readonly spriteIds?: readonly number[];
  /** `true` escreve `sprite_id` empacotado em vez de uma tag por id. */
  readonly packed?: boolean;
  readonly phases?: readonly (readonly [min: number, max: number])[];
  /** Campos que o leitor não conhece, para provar que ele os pula. */
  readonly extra?: readonly Field[];
}

export function frameGroup(fixture: FrameGroupFixture = {}): Uint8Array {
  const info: Field[] = [];
  if (fixture.patternWidth !== undefined) info.push(uint32Field(1, fixture.patternWidth));
  if (fixture.patternHeight !== undefined) info.push(uint32Field(2, fixture.patternHeight));
  if (fixture.patternDepth !== undefined) info.push(uint32Field(3, fixture.patternDepth));
  if (fixture.layers !== undefined) info.push(uint32Field(4, fixture.layers));
  const ids = fixture.spriteIds ?? [];
  if (fixture.packed === true) info.push(packedField(5, ids));
  else for (const id of ids) info.push(uint32Field(5, id));
  if (fixture.phases !== undefined) {
    info.push(messageField(6, concat(...fixture.phases.map(
      ([min, max]) => messageField(6, concat(uint32Field(1, min), uint32Field(2, max))),
    ))));
  }
  if (fixture.boundingSquare !== undefined) info.push(uint32Field(7, fixture.boundingSquare));
  info.push(...(fixture.extra ?? []));

  const group: Field[] = [];
  if (fixture.fixedFrameGroup !== undefined) group.push(uint32Field(1, fixture.fixedFrameGroup));
  group.push(messageField(3, concat(...info)));
  return concat(...group);
}

/**
 * As flags de uma aparência (campo 3), pelo número de campo do `appearances.proto` (FUN-117).
 * `bankWaypoints` emite `bank { waypoints }`; `bank: true` emite `bank {}` vazio, que é como
 * o pacote real marca chão sem velocidade; `hook`/`shift`/`height` são os submessages.
 */
export interface FlagsFixture {
  readonly bank?: boolean;
  readonly bankWaypoints?: number;
  readonly clip?: boolean;
  readonly bottom?: boolean;
  readonly top?: boolean;
  readonly unpass?: boolean;
  readonly unmove?: boolean;
  readonly unsight?: boolean;
  readonly avoid?: boolean;
  readonly noMovementAnimation?: boolean;
  readonly take?: boolean;
  readonly hang?: boolean;
  readonly hookSouth?: number;
  readonly hookEast?: number;
  readonly shift?: { readonly x: number; readonly y: number };
  readonly elevation?: number;
  readonly lyingObject?: boolean;
  readonly animateAlways?: boolean;
  readonly fullbank?: boolean;
  /** Campos que o leitor NÃO conhece, para provar o pulo. */
  readonly extra?: readonly Field[];
}

export function flags(fixture: FlagsFixture): Field {
  const parts: Field[] = [];
  if (fixture.bankWaypoints !== undefined) {
    parts.push(messageField(1, uint32Field(1, fixture.bankWaypoints)));
  } else if (fixture.bank) {
    parts.push(messageField(1, new Uint8Array(0)));
  }
  const bools: ReadonlyArray<readonly [number, boolean | undefined]> = [
    [2, fixture.clip], [3, fixture.bottom], [4, fixture.top], [13, fixture.unpass],
    [14, fixture.unmove], [15, fixture.unsight], [16, fixture.avoid],
    [17, fixture.noMovementAnimation], [18, fixture.take],
    [20, fixture.hang], [28, fixture.lyingObject], [29, fixture.animateAlways],
    [32, fixture.fullbank],
  ];
  for (const [field, on] of bools) if (on !== undefined) parts.push(uint32Field(field, on ? 1 : 0));
  if (fixture.hookSouth !== undefined || fixture.hookEast !== undefined) {
    const hook: Field[] = [];
    if (fixture.hookSouth !== undefined) hook.push(uint32Field(1, fixture.hookSouth));
    if (fixture.hookEast !== undefined) hook.push(uint32Field(2, fixture.hookEast));
    parts.push(messageField(21, concat(...hook)));
  }
  if (fixture.shift !== undefined) {
    parts.push(messageField(26, concat(uint32Field(1, fixture.shift.x), uint32Field(2, fixture.shift.y))));
  }
  if (fixture.elevation !== undefined) parts.push(messageField(27, uint32Field(1, fixture.elevation)));
  parts.push(...(fixture.extra ?? []));
  return messageField(3, concat(...parts));
}

export interface AppearanceFixture {
  readonly id: number;
  readonly frameGroups?: readonly Uint8Array[];
  /** Já codificado por `flags()`. */
  readonly flags?: Field;
  readonly extra?: readonly Field[];
}

export function appearance(fixture: AppearanceFixture): Uint8Array {
  return concat(
    uint32Field(1, fixture.id),
    ...(fixture.frameGroups ?? []).map((group) => messageField(2, group)),
    ...(fixture.flags === undefined ? [] : [fixture.flags]),
    ...(fixture.extra ?? []),
  );
}

/** O `Appearances` de topo: um campo por tipo de registro. */
export function appearances(registries: {
  readonly object?: readonly Uint8Array[];
  readonly outfit?: readonly Uint8Array[];
  readonly effect?: readonly Uint8Array[];
  readonly missile?: readonly Uint8Array[];
  readonly extra?: readonly Field[];
}): Uint8Array {
  return concat(
    ...(registries.object ?? []).map((one) => messageField(1, one)),
    ...(registries.outfit ?? []).map((one) => messageField(2, one)),
    ...(registries.effect ?? []).map((one) => messageField(3, one)),
    ...(registries.missile ?? []).map((one) => messageField(4, one)),
    ...(registries.extra ?? []),
  );
}
