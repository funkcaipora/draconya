// O estado do personagem em REPOUSO no mundo: onde está, de que cidade é, com quanta vida e mana, e
// com que condições (#836, OW-15, ADR 0060 decisões 3.b, 6 e 10.f).
//
// Mora num arquivo só porque o mesmo dado atravessa cinco fronteiras — a linha de `characters`, o
// ticket, o extrato do Redis, o `jobs` e o `sim` — e cada uma delas LÊ dado que outra escreveu: uma
// forma conferida num lugar só é o que impede a linha `jsonb`, o JSON do Redis e o ticket de
// concordarem em coisas diferentes. A regra é a de todo campo do ticket: torto vira AUSENTE, nunca
// recusa (o personagem entra cheio, no templo, sem condição — a degradação segura).
//
// **Nada aqui lê relógio.** As condições viajam como PRAZO RESTANTE (`CharacterRuntime.
// conditionsAsRemaining`): instante de relógio de sessão nenhuma, porque o repouso não conta tempo.

import type { ConditionState, Conditions, Point } from '@draconya/sim';

/** A coordenada ABSOLUTA do Tibia (a do `otservbr.otbm`), como a linha, o ticket e o extrato a guardam. */
export interface AbsolutePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * O mundo e a posição que o TICKET leva de um personagem — o conjunto que a OW-15 acrescenta. Todos
 * opcionais: AUSENTE é "nasce como antes" (cheio, no templo, sem condição), e é o que o ticket é com
 * a flag `OPEN_WORLD` desligada. A linha nula é o campo ausente — por isso aqui a posição nunca é `null`.
 */
export interface TicketWorldState {
  /** A posição absoluta onde o personagem saiu. */
  readonly worldPosition?: AbsolutePoint;
  /** A cidade do personagem: o `id` de `content.worlds[].towns[]`. */
  readonly townId?: string;
  /** A vida com que saiu: inteiro maior que zero (zero seria um morto, e o morto entra cheio). */
  readonly health?: number;
  /** A mana com que saiu: inteiro não negativo. */
  readonly mana?: number;
  /**
   * As condições ativas, como PRAZO RESTANTE (`expiresAtMs`/`nextTickAtMs` em milissegundos que
   * faltavam, não instante de relógio de sessão nenhuma).
   */
  readonly conditions?: readonly ConditionState[];
}

/**
 * O mesmo, como o EXTRATO o leva de volta: AUSENTE é "não toque" (o ledger não escreve a coluna), e
 * dois valores ganham um sentido que o ticket não precisa. `worldPosition: null` quer dizer "volta ao
 * templo" — o `0,0,0` do Canary (`iologindata_load_player.cpp:207-210`): quem morreu, ou nunca esteve
 * no mundo —, e o ledger zera as três colunas. `conditions: []` quer dizer "nenhuma", e o ledger grava
 * nulo. Vida e mana aceitam zero porque o extrato é só um número; quem o escreve nunca grava a vida de
 * um morto.
 */
export interface WorldState extends Omit<TicketWorldState, 'worldPosition'> {
  readonly worldPosition?: AbsolutePoint | null;
}

/** O maior `z` do Tibia: 16 andares, de 0 a 15. */
const MAX_FLOOR = 15;
/** A coordenada máxima do mapa do Tibia (`uint16_t`). */
const MAX_COORDINATE = 65_535;
/**
 * Quantas condições uma linha pode carregar. Há uma dúzia de tipos e uma chave por tipo de dano ao
 * longo do tempo; mais que isto é lixo, e uma lista de milhares de condições entraria numa sessão
 * que agenda dois eventos por uma.
 */
const MAX_CONDITIONS = 64;

const MERGES: ReadonlySet<unknown> = new Set(['replace', 'refresh', 'strongest', 'longest']);
const TICK_KINDS: ReadonlySet<unknown> = new Set(['heal', 'damage', 'soul']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Uma coordenada absoluta válida, ou `undefined`. Inteiros, dentro do mapa do Tibia: `x` e `y` em
 * `uint16_t` e `z` de 0 a 15. A `0,0,0` do Canary É válida aqui e quer dizer "sem posição" — quem
 * grava a normaliza para `null` (`absolutePointOfAnchor`), e quem lê a trata como a âncora ausente.
 */
export function readAbsolutePoint(value: unknown): AbsolutePoint | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y, z } = value;
  if (
    typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > MAX_COORDINATE
    || typeof y !== 'number' || !Number.isInteger(y) || y < 0 || y > MAX_COORDINATE
    || typeof z !== 'number' || !Number.isInteger(z) || z < 0 || z > MAX_FLOOR
  ) return undefined;
  return { x, y, z };
}

/**
 * A âncora de um personagem do `sim` como o extrato a guarda: a coordenada absoluta, ou `null` para
 * "volta ao templo" — nunca a âncora ausente (`null` no `sim`) nem a `0,0,0` do Canary
 * (`iologindata_load_player.cpp:207-210`) com cara de lugar.
 */
export function absolutePointOfAnchor(anchor: Point | null): AbsolutePoint | null {
  if (anchor === null) return null;
  const point = readAbsolutePoint(anchor);
  if (point === undefined || (point.x === 0 && point.y === 0 && point.z === 0)) return null;
  return point;
}

/** Vida ou mana como número de linha: inteiro seguro não negativo, ou `undefined`. */
export function readVital(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Uma condição que o `sim` aceita sem engasgar, conferida nos campos que viram `NaN` ou laço. */
function isPersistedCondition(value: unknown): value is ConditionState {
  if (!isRecord(value)) return false;
  if (typeof value['key'] !== 'string' || value['key'].length === 0) return false;
  // Prazo restante: estritamente positivo — a que já venceu nem entra na linha.
  if (!isFiniteNumber(value['expiresAtMs']) || value['expiresAtMs'] <= 0) return false;
  // O próximo tique pode ter caído NO instante da saída (restante zero ou negativo) — o
  // `#armConditions` o trata com `Math.max(0, …)`, e ele roda assim que a sessão entra.
  if (value['nextTickAtMs'] !== undefined && !isFiniteNumber(value['nextTickAtMs'])) return false;
  if (value['merge'] !== undefined && !MERGES.has(value['merge'])) return false;
  for (const field of ['speedPercent', 'damageTakenPercent'] as const) {
    if (value[field] !== undefined && !isFiniteNumber(value[field])) return false;
  }
  for (const field of ['damageDealtPercent', 'skillDeltas'] as const) {
    const record = value[field];
    if (record === undefined) continue;
    if (!isRecord(record) || !Object.values(record).every((entry) => entry === undefined || isFiniteNumber(entry))) {
      return false;
    }
  }
  for (const field of ['look', 'light', 'flee'] as const) {
    if (value[field] !== undefined && !isRecord(value[field])) return false;
  }
  for (const field of ['targetId', 'spellId', 'sourceId'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return false;
  }
  const tick = value['tick'];
  if (tick === undefined) return true;
  if (!isRecord(tick) || !isFiniteNumber(tick['amount']) || !isFiniteNumber(tick['intervalMs']) || tick['intervalMs'] <= 0) return false;
  if (tick['kind'] !== undefined && !TICK_KINDS.has(tick['kind'])) return false;
  const queue = tick['queue'];
  if (queue === undefined) return true;
  return Array.isArray(queue) && queue.every((entry) =>
    isRecord(entry) && isFiniteNumber(entry['amount']) && isFiniteNumber(entry['intervalMs']) && entry['intervalMs'] > 0);
}

/**
 * As condições de uma coluna `jsonb`, de um ticket ou de um extrato, ou `undefined` quando o valor
 * não é uma lista válida — a lista TODA é recusada se uma só condição vem torta, porque uma lista
 * pela metade é um personagem com a haste e sem o veneno, e a ausência é o lado seguro. Lista vazia
 * É válida (`[]` é "nenhuma"). Passa os campos que não conhece: o formato do `sim` cresce, e um
 * campo novo que esta leitura descartasse sumiria no caminho de volta sem erro nenhum.
 */
export function readPersistedConditions(value: unknown): readonly ConditionState[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_CONDITIONS) return undefined;
  return value.every(isPersistedCondition) ? (value as readonly ConditionState[]) : undefined;
}

/** Os campos comuns ao ticket e ao extrato, cada um conferido sozinho: o que não passa some. */
function readCommonWorldState(value: Record<string, unknown>): Omit<TicketWorldState, 'worldPosition'> {
  const health = readVital(value['health']);
  const mana = readVital(value['mana']);
  const conditions = readPersistedConditions(value['conditions']);
  return {
    ...(typeof value['townId'] === 'string' && value['townId'].length > 0 ? { townId: value['townId'] } : {}),
    ...(health === undefined ? {} : { health }),
    ...(mana === undefined ? {} : { mana }),
    ...(conditions === undefined ? {} : { conditions }),
  };
}

/**
 * O mundo e a posição de um TICKET, campo a campo: cada um que não passa na conferência some, e os
 * outros seguem — torto vira ausente, nunca ticket recusado. Mais estrito que o extrato: a posição
 * `null` não existe e uma vida zero é um morto, que entra cheio.
 */
export function readTicketWorldState(value: Record<string, unknown>): TicketWorldState {
  const { health, ...rest } = readCommonWorldState(value);
  const point = readAbsolutePoint(value['worldPosition']);
  return {
    ...rest,
    ...(health === undefined || health < 1 ? {} : { health }),
    ...(point === undefined ? {} : { worldPosition: point }),
  };
}

/** O mundo e a posição de um EXTRATO do Redis, campo a campo, pela mesma régua do ticket. */
export function readReceiptWorldState(value: Record<string, unknown>): WorldState {
  const position = value['worldPosition'];
  const point = position === null ? null : readAbsolutePoint(position);
  return {
    ...readCommonWorldState(value),
    ...(point === undefined ? {} : { worldPosition: point }),
  };
}

/** A linha de `characters` como o ticket a leva: só o que EXISTE, e só o que passa na conferência. */
export function worldStateOfRow(row: {
  readonly worldPosition: AbsolutePoint | null;
  readonly townId: string;
  readonly health: number | null;
  readonly mana: number | null;
  readonly conditions: unknown;
}): TicketWorldState {
  const conditions = readPersistedConditions(row.conditions);
  return {
    ...(row.worldPosition === null ? {} : { worldPosition: row.worldPosition }),
    townId: row.townId,
    // Zero é um morto — e o ticket só aplica vida maior que zero; a linha nunca o guarda (o dono
    // da sessão grava a vida cheia de quem morreu), mas o banco é `jsonb` e `integer` sem dono.
    ...(row.health === null || row.health < 1 ? {} : { health: row.health }),
    ...(row.mana === null ? {} : { mana: row.mana }),
    ...(conditions === undefined || conditions.length === 0 ? {} : { conditions }),
  };
}

/**
 * Leva as condições de um personagem que acaba de nascer do TICKET para o relógio da sessão em que
 * ele vai entrar. Elas vêm da linha como PRAZO RESTANTE — relógio ZERO (`readPersistedConditions`,
 * `CharacterRuntime.conditionsAsRemaining`) —, e a sessão que o recebe tem o relógio dela: `Session.
 * enter` NÃO traduz o personagem do ticket (sem sessão anterior não há de onde vir), então sem isto
 * uma sessão que já andou — o recém-chegado de uma party em curso, a Cidade, o mundo — veria toda
 * condição trazida como vencida no instante da entrada, e o `armConditions` do ruleset a apagaria.
 *
 * Chame ANTES de `session.enter`: o ruleset agenda o vencimento e o próximo tique no `onEnter`, a
 * partir do instante em que a condição vale na sessão. Numa sessão que nasce agora (relógio zero: a
 * hunt nova, a party recém-formada) é nada. NÃO chame para um personagem que já andou por outra
 * sessão — esse o `moveToClock` já traduziu, e traduzir de novo o deslocaria duas vezes.
 */
export function carryRestoredConditions(
  character: { readonly conditions: Pick<Conditions, 'size' | 'rebase'> },
  session: { readonly nowMs: number },
): void {
  if (character.conditions.size === 0 || session.nowMs === 0) return;
  character.conditions.rebase(0, session.nowMs);
}

/**
 * O que o extrato precisa saber de um personagem para levar o mundo e os vitais dele: o que o
 * `CharacterRuntime` vivo e o `CharacterState` de um snapshot têm em comum. A âncora e a cidade são
 * opcionais nos dois — o personagem que não veio de um ticket com o mundo não tem nenhuma.
 */
export interface WorldStateSource {
  readonly alive: boolean;
  readonly health: number;
  readonly maxHealth: number;
  readonly mana: number;
  readonly maxMana: number;
  readonly townId?: string | null;
  readonly worldPosition?: Point | null;
}

/**
 * O mundo e os vitais que o EXTRATO leva de um personagem (#836, OW-15, ADR 0060 d.10.f) — o dono
 * da sessão chama quando a flag `OPEN_WORLD` está ligada. `conditions` já vem como PRAZO RESTANTE
 * (`CharacterRuntime.conditionsAsRemaining`, ou o `rebase` do snapshot para o relógio zero).
 *
 * **`townId` é a marca de que o `api` leu o mundo deste personagem:** o ticket o leva SEMPRE que a
 * flag estava ligada na emissão (`worldStateOfRow`). Sem ela o personagem nasceu de um ticket sem o
 * mundo — a flag desligada no `api`, ou um `api` anterior numa implantação em rolagem — e o extrato
 * NÃO leva nada: gravar `worldPosition: null` ali apagaria a posição que a linha guarda, e a vida
 * cheia desfaria a que a linha guarda. Ausente é "não toque", e é o lado seguro.
 *
 * **Quem morreu volta ao templo, de vida e mana cheias, sem condição** (`player.cpp:4226-4252`): a
 * posição vai `null` (o `0,0,0` do Canary), a vida e a mana são as do máximo, e o extrato leva
 * `conditions: []`. O morto tem vida zero, e zero nunca é um valor que a linha guarda.
 */
export function receiptWorldStateOf(
  source: WorldStateSource, conditions: readonly ConditionState[],
): WorldState {
  const townId = source.townId;
  if (townId === undefined || townId === null) return {};
  if (!source.alive) {
    return { worldPosition: null, townId, health: source.maxHealth, mana: source.maxMana, conditions: [] };
  }
  return {
    worldPosition: absolutePointOfAnchor(source.worldPosition ?? null),
    townId,
    health: source.health,
    mana: source.mana,
    conditions,
  };
}
