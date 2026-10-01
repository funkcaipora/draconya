// As magias utilitárias do Canary (#623, M44-05): Levitate, Magic Rope, Find Person/Fiend e Food.
//
// PURO: cada função responde uma pergunta sobre o mundo e devolve dado — nenhuma escreve posição,
// inventário ou fila. Quem aplica é o ruleset da hunt (`HuntRuleset#castSpell`), que já é dono
// dessas escritas (invariante 9); aqui mora só a REGRA, para ela ter teste por tabela sem
// levantar uma sessão. As fontes são `data/scripts/spells/support/{levitate,magic_rope,
// find_person,find_fiend,food}.lua` e `data/libs/functions/{position,tile}.lua` do Canary
// (47dfd51) — números e mecanismo descritos aqui, nunca o código (ADR 0019).
//
// **O que o mapa NÃO sabe.** O `Tilemap` guarda UM bit por tile e andar (`#` = parede OU tile
// inexistente, o resto é chão livre): não separa "sem chão" de "parede com chão", não guarda a
// flag de troca de andar de um tile que não seja escada listada, nem o `blockProjectile` além da
// camada `sight`. O Canary decide por essas flags (`Tile:getGround()`, `TILESTATE_BLOCKSOLID`,
// `TILESTATE_IMMOVABLEBLOCKSOLID`, `TILESTATE_FLOORCHANGE`) — o modelo abaixo as reproduz com o
// que o mapa TEM, e cada aproximação está marcada `[APROXIMAÇÃO]` no ponto onde ela acontece e em
// `docs/product/utility-spells.md`. Corrigir de verdade exige uma camada `ground` no importador
// (`scripts/import-map.ts`), que só pode ser regerada com o pacote de arte 1533 na máquina.

import { isBlocked } from '@draconya/content';
import { FORWARD } from './area.js';
import type { Direction } from './area.js';
import type { MovementWorld, WorldPoint } from './movement.js';
import type { Rng } from './rng.js';

// --- Find Person / Find Fiend --------------------------------------------------------------

/** A distância em faixas (`DISTANCE_*` do Canary): a métrica é o MAIOR eixo, não a euclidiana. */
export type FindDistance = 'beside' | 'close' | 'far' | 'very-far';

/** Onde o alvo está em relação ao andar de quem procura (`LEVEL_*` do Canary). */
export type FindLevel = 'lower' | 'same' | 'higher';

/** As oito direções do Find (`directions` de `find_person.lua`), em inglês como o id de conteúdo. */
export type CompassDirection =
  | 'north' | 'south' | 'east' | 'west'
  | 'north-east' | 'north-west' | 'south-east' | 'south-west';

/**
 * O resultado de um Find: DADO, sem texto. A frase em português é da apresentação (o host), como
 * toda mensagem do jogo — o `sim` só sabe distância, andar e direção.
 */
export interface FindRelation {
  readonly distance: FindDistance;
  readonly level: FindLevel;
  /** Ausente em `beside` — o Canary só acrescenta a direção depois da faixa "ao lado". */
  readonly direction?: CompassDirection;
}

/** `maxPositionDifference < 5`: "ao lado". */
export const FIND_BESIDE_BELOW = 5;
/** `< 101`: "perto"; `< 275`: "longe"; daí em diante, "muito longe". */
export const FIND_CLOSE_BELOW = 101;
export const FIND_FAR_BELOW = 275;

/**
 * As tangentes que separam os oito setores: `tan(22,5°) = 0,4142` e `tan(67,5°) = 2,4142` — a
 * bússola de 45° por setor do `find_person.lua`. Comparadas com `<` estrito, como no script.
 */
const TAN_EAST_WEST = 0.4142;
const TAN_DIAGONAL = 2.4142;

/**
 * Onde `to` está visto de `from` — a conta INTEIRA do `find_person.lua`/`find_fiend.lua`. A
 * diferença é `procurador − alvo` nos três eixos (o script subtrai nessa ordem), então `dx > 0`
 * quer dizer "o alvo está a OESTE". Tangente infinita (`dx = 0`) vira `10`, como no script — cai
 * no setor norte/sul. `y` cresce para o SUL, como no mapa do Tibia.
 */
export function findRelation(from: WorldPoint, to: WorldPoint): FindRelation {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const dz = from.z - to.z;
  const span = Math.max(Math.abs(dx), Math.abs(dy));

  const level: FindLevel = dz > 0 ? 'higher' : dz < 0 ? 'lower' : 'same';
  const distance: FindDistance = span < FIND_BESIDE_BELOW
    ? 'beside'
    : span < FIND_CLOSE_BELOW ? 'close' : span < FIND_FAR_BELOW ? 'far' : 'very-far';
  if (span < FIND_BESIDE_BELOW) return { distance, level };

  const tangent = dx !== 0 ? dy / dx : 10;
  let direction: CompassDirection;
  if (Math.abs(tangent) < TAN_EAST_WEST) {
    direction = dx > 0 ? 'west' : 'east';
  } else if (Math.abs(tangent) < TAN_DIAGONAL) {
    direction = tangent > 0
      ? (dy > 0 ? 'north-west' : 'south-east')
      : (dx > 0 ? 'south-west' : 'north-east');
  } else {
    direction = dy > 0 ? 'north' : 'south';
  }
  return { distance, level, direction };
}

// --- Levitate ------------------------------------------------------------------------------

/**
 * O andar-fronteira do Tibia: 7 é a superfície, 8 o primeiro subsolo. O Levitate não atravessa a
 * fronteira — `up` recusa em 8 e `down` recusa em 7 (o `z ~= 8`/`z ~= 7` do script).
 */
export const FIRST_UNDERGROUND_FLOOR = 8;
export const SURFACE_FLOOR = 7;

/**
 * Para onde o Levitate leva, ou `null` ("Sorry, not possible"). Reproduz `levitate.lua`:
 *
 * 1. a fronteira de andar (acima);
 * 2. o tile SONDA precisa estar vazio — `up` olha o tile em CIMA do lançador (`z − 1`), `down`
 *    olha o tile da FRENTE no mesmo andar (a direção que o personagem encara, `FORWARD`);
 * 3. o destino é o tile da frente, um andar acima/abaixo (`z ∓ 1`), com chão, sem bloqueio sólido
 *    e SEM troca de andar (`TILESTATE_FLOORCHANGE` — escada e buraco recusam).
 *
 * `[APROXIMAÇÃO]` do passo 2: o Canary aceita o tile inexistente OU o que não tem chão nem bloqueio
 * sólido; o mapa não separa "inexistente" de "parede", então tile bloqueado/fora do mapa conta
 * como vazio — uma parede COM chão na sonda deixaria passar o que o Canary recusa. Do passo 3, o
 * "tem chão e não bloqueia" é `!blockedAt` (geometria, porta fechada, campo bloqueante) e a troca
 * de andar é `floorChangeAt` (escada listada do mapa e buraco do overlay).
 *
 * **Tile é exclusivo neste motor** (invariante da ocupação): o `FLAG_IGNOREBLOCKCREATURE` do Canary
 * deixaria o jogador pousar em cima de outra criatura, e aqui o destino ocupado recusa como
 * qualquer outro destino inválido. Não é regra de caça — é a estrutura de `TileOccupancy`.
 */
export function levitateDestination(
  world: MovementWorld, from: WorldPoint, facing: Direction, direction: 'up' | 'down',
): WorldPoint | null {
  if (direction === 'up' ? from.z === FIRST_UNDERGROUND_FLOOR : from.z === SURFACE_FLOOR) return null;
  const step = FORWARD[facing];
  const ahead = { x: from.x + step.x, y: from.y + step.y };
  const dz = direction === 'up' ? -1 : 1;

  // A sonda: em cima de quem levita (`up`) ou à frente dele (`down`).
  const probe = direction === 'up'
    ? { x: from.x, y: from.y, z: from.z + dz }
    : { x: ahead.x, y: ahead.y, z: from.z };
  if (!isOpenSpace(world, probe)) return null;

  const to = { x: ahead.x, y: ahead.y, z: from.z + dz };
  if (to.x < 0 || to.y < 0 || to.x >= world.map.width || to.y >= world.map.height) return null;
  if (!world.map.floors.has(to.z)) return null;
  if (world.blockedAt(to.x, to.y, to.z)) return null;
  if (world.floorChangeAt(to.x, to.y, to.z) !== null) return null;
  if (world.occupied(to.x, to.y, to.z)) return null;
  return to;
}

/**
 * O tile é "espaço vazio" para o Levitate — sem chão e sem bloqueio sólido? `[APROXIMAÇÃO]`:
 * a grade estática (`isBlocked`: parede, tile inexistente, fora do mapa ou andar que o mapa não
 * tem). Estática de propósito: uma porta fechada, ou um campo bloqueante do overlay, TEM chão por
 * baixo — quem consulta `blockedAt` aqui tomaria a porta por vazio.
 */
function isOpenSpace(world: MovementWorld, at: WorldPoint): boolean {
  return isBlocked(world.map, at.x, at.y, at.z);
}

// --- Magic Rope ----------------------------------------------------------------------------

/**
 * A ORDEM em que `Position:moveUpstairs` procura onde pousar no andar de cima, depois do tile ao
 * sul do rope spot (o `defaultPosition`): `for direction = NORTH, NORTHEAST` com o `SOUTH`
 * trocado por `WEST` — e como o `for` numérico do Lua não relê a variável, o `WEST` é tentado
 * DUAS vezes (a segunda é inócua). Norte, leste, oeste, sudoeste, sudeste, noroeste, nordeste.
 */
const ROPE_FALLBACK_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, 0], [-1, 0], [-1, 1], [1, 1], [-1, -1], [1, -1],
];

/** O tile "sul" do rope spot: o pouso preferido do `moveUpstairs`. */
const ROPE_DEFAULT_OFFSET: readonly [number, number] = [0, 1];

/**
 * O tile pode ser pisado por `Tile:isWalkable(false, false, false, false, true)`? Ground, sem
 * bloqueio sólido e — o `proj` do último argumento — sem item fixo que bloqueie projétil. Troca de
 * andar e criatura NÃO contam (os flags `floorchange`/`creature` são `false`). No mapa: não
 * bloqueado e sem `blocksSight` (a camada de vista é o `blockProjectile`).
 */
function isWalkableForRope(world: MovementWorld, at: WorldPoint): boolean {
  if (world.blockedAt(at.x, at.y, at.z)) return false;
  const floor = world.map.floors.get(at.z);
  return floor?.blocksSight?.[at.y * world.map.width + at.x] !== 1;
}

/**
 * Para onde o Magic Rope leva quem está num rope spot em `from`, ou `null` ("There is not enough
 * room"). É `Position:moveUpstairs`: o andar de cima (`z − 1`), o tile ao SUL se ele for andável,
 * senão o primeiro andável da ordem de `ROPE_FALLBACK_OFFSETS` em volta do ponto. `hasRopeSpot`
 * é a pergunta `Tile:isRopeSpot()`, que o CHAMADOR responde (o overlay de cenário é dele) — sem
 * rope spot a magia recusa antes, com outro motivo (`not-possible`).
 *
 * `[APROXIMAÇÃO]`: o Canary, sem nenhum vizinho andável, ainda teleporta ao tile sul se ELE existir
 * (o `teleportTo` então falha calado e a mana é gasta); o mapa não separa "existe mas é parede" de
 * "inexistente", então sem tile andável a resposta é sempre `null` — nenhuma mana perdida num pouso
 * que não acontece.
 *
 * **Tile é exclusivo neste motor** (a estrutura de `TileOccupancy` que o Levitate também respeita).
 * O `moveUpstairs` ignora criatura (`isWalkable(false, false, false, false, true)`) e o
 * `internalTeleport` do Canary pousa com `FLAG_NOLIMIT` — EMPILHARIA o lançador sobre quem estiver
 * no tile. Aqui o tile ocupado é pulado e a busca segue a ordem do `moveUpstairs`; sem nenhum
 * livre, `null`, e a recusa "not enough room" sai ANTES de pagar. Assim o destino que a
 * pré-conferência aprova é sempre aplicável (`relocate` confere a mesma ocupação). Não é regra de
 * caça: é a estrutura de ocupação, a mesma divergência já documentada no Levitate.
 */
export function ropeDestination(world: MovementWorld, from: WorldPoint): WorldPoint | null {
  const z = from.z - 1;
  if (!world.map.floors.has(z)) return null;
  const candidates: ReadonlyArray<readonly [number, number]> = [ROPE_DEFAULT_OFFSET, ...ROPE_FALLBACK_OFFSETS];
  for (const [dx, dy] of candidates) {
    const at = { x: from.x + dx, y: from.y + dy, z };
    if (at.x < 0 || at.y < 0 || at.x >= world.map.width || at.y >= world.map.height) continue;
    if (isWalkableForRope(world, at) && !world.occupied(at.x, at.y, at.z)) return at;
  }
  return null;
}

// --- Food ----------------------------------------------------------------------------------

/**
 * O que a Food cria (`food.lua`): a rolagem `math.random(0, 1) == 1` decide se há um SEGUNDO item;
 * depois, sempre, um item sorteado uniforme da lista — e o segundo, quando existe, sai ANTES do
 * garantido (a ordem do script: o `if` vem primeiro). A ordem de consumo do `Rng` é contrato,
 * como a do loot: bônus, [índice do bônus], índice do garantido. `items` já vem na ordem do
 * conteúdo, e o índice do sorteio é a posição nela.
 */
export function rollFoods(rng: Rng, items: readonly string[]): readonly string[] {
  const created: string[] = [];
  if (rng.integer(0, 1) === 1) created.push(items[rng.integer(0, items.length - 1)] as string);
  created.push(items[rng.integer(0, items.length - 1)] as string);
  return created;
}
