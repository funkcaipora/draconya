// Passo guloso (FUN-40, ADR 0009).
//
// O ALGORITMO INTEIRO:
//
//   1. tenta o tile que mais aproxima do alvo
//   2. bloqueado? tenta os dois vizinhos daquela direção
//   3. nada? espera este tick
//
// Sem caminho guardado. Sem A*. O(1) por monstro por tick.
//
// A consequência que vale entender agora: como o monstro NÃO GUARDA CAMINHO, não existe
// invalidação de rota. Um campo bloqueante posto no meio do mapa custa ZERO — ele só reavalia
// o próximo tile, como já faria. É isso que torna magic wall barato na F5, e é por isso que
// trocar por busca de caminho real "para melhorar a IA" sairia caro em mais de um sentido.

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Um `GridPoint` que também sabe o andar (#519, hunt multiandar). Ausente é "andar padrão do
 * mapa": snapshot de monstro anterior a esta issue, ou hunt de andar único — onde comparar
 * andar nunca muda nada, porque todo mundo está no mesmo. Quem SEMPRE carrega `z` de verdade é
 * o personagem (`WorldPoint`); o monstro passou a carregar também, só que opcional, para o
 * snapshot antigo continuar restaurando sem bump de formato.
 */
export interface FloorPoint extends GridPoint {
  readonly z?: number;
}

/**
 * Dois andares são "iguais" para fins de mira e perseguição. Ausente em qualquer lado é
 * "qualquer um" — compatibilidade com quem nunca carrega `z` (monstro de snapshot antigo, Cidade
 * de andar único) —, e é isso que faz este comparador ser um NO-OP em toda hunt de andar único.
 */
export function sameFloor(a: number | undefined, b: number | undefined): boolean {
  return a === undefined || b === undefined || a === b;
}

/** `MAP_INIT_SURFACE_LAYER` do Canary (`src/map/map_const.hpp`): o último andar de superfície. */
const SURFACE_LAYER = 7;
/** `MAP_LAYER_VIEW_LIMIT`: de baixo da terra, quantos andares acima/abaixo a criatura enxerga. */
const LAYER_VIEW_LIMIT = 2;

/**
 * `to` está na área de visão de quem está em `from` (#655, Canary `Creature::canSee(myPos, pos,
 * viewRangeX, viewRangeY)`, `src/creatures/creature.cpp:68-87` — mecanismo, não código, ADR
 * 0019)? É a pergunta que enche e esvazia a `targetList` do monstro (`Monster::updateTargetList`)
 * e, com ela, decide se ele está ocioso, volta ao spawn ou anda ao acaso.
 *
 * `range` é o `aggroRadius` do monstro (11 = `MAP_MAX_VIEW_PORT_X`/`_Y` do Canary, que herda o
 * quadrado de `Creature::canSee` sem sobrescrevê-lo): o Canary usa o MESMO raio nos dois eixos,
 * então um único número basta. No MESMO andar é exatamente a distância de Chebyshev ≤ `range`;
 * em andares diferentes valem as regras do Canary — de superfície (z ≤ 7) não se enxerga o
 * subsolo, de subsolo só se enxerga até dois andares de diferença, e a caixa se desloca em
 * `from.z − to.z` tiles por andar (a perspectiva do cliente). Sem `z` de um dos lados (snapshot
 * anterior ao #519, hunt de andar único) é o `sameFloor` de sempre: só a distância.
 */
export function canSeePoint(from: FloorPoint, to: FloorPoint, range: number): boolean {
  const fromZ = from.z;
  const toZ = to.z;
  if (fromZ === undefined || toZ === undefined) return distance(from, to) <= range;
  if (fromZ <= SURFACE_LAYER) {
    if (toZ > SURFACE_LAYER) return false;
  } else if (Math.abs(fromZ - toZ) > LAYER_VIEW_LIMIT) {
    return false;
  }
  const offsetZ = fromZ - toZ;
  return to.x >= from.x - range + offsetZ && to.x <= from.x + range + offsetZ
    && to.y >= from.y - range + offsetZ && to.y <= from.y + range + offsetZ;
}

/**
 * `true` quando o tile não pode ser ocupado — parede, borda, ou outra criatura. O `z` é opcional
 * porque a maioria dos chamadores (o passo guloso de personagem e monstro) já sabe o andar pelo
 * mover capturado na closure; só o spawner multiandar (#519) o usa, para conferir o andar CERTO
 * de cada ponto — sem ele, todo ponto de spawn seria conferido no andar padrão do mapa.
 *
 * `monsterId` é o mesmo tipo de exceção, só para o spawner (#519): é como `#spawnBlockedFor`
 * sabe SE o monstro deste ponto espera o jogador sair da vista (`blockable`) antes de aplicar
 * `spawnClearRadius` — sem ele, a checagem valeria para todo monstro, e o Tibia faz o oposto
 * (`isBlockable` é `false`, "não espera", para 1.640 dos 1.656 do bestiário).
 */
export type Blocked = (x: number, y: number, z?: number, monsterId?: string) => boolean;

/**
 * As oito direções, em ordem angular. A ordem importa: "os dois vizinhos da direção geral"
 * são os índices ±1 nesta lista, e é ela que transforma a regra em duas linhas de código.
 */
const DIRECTIONS: readonly GridPoint[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

/**
 * As quatro direções CARDINAIS, na ordem que o Canary embaralha para escolher onde empurrar
 * uma criatura fora do caminho (M29-08, `Monster::pushCreature`, `monster.cpp:2387-2403`:
 * dirList `{NORTH, WEST, EAST, SOUTH}` antes do `std::ranges::shuffle`). Nunca diagonal — o
 * Tibia empurra só para os quatro lados retos.
 */
export const PUSH_DIRECTIONS: readonly GridPoint[] = [
  { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 },
];

const sign = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);

/**
 * Próximo tile, ou `null` para esperar.
 *
 * Espera acontece em dois casos que valem distinguir na leitura: já estar no alvo, e estar
 * cercado. O segundo é o monstro EMPACADO numa concavidade — comportamento esperado, igual
 * ao do Tibia, e que os jogadores reconhecem como certo. Não conserte.
 */
export function greedyStep(from: GridPoint, target: GridPoint, blocked: Blocked): GridPoint | null {
  const dx = sign(target.x - from.x);
  const dy = sign(target.y - from.y);
  if (dx === 0 && dy === 0) return null;

  const primary = DIRECTIONS.findIndex((d) => d.x === dx && d.y === dy);
  if (primary < 0) return null;

  // Primeiro o que mais aproxima; depois os dois vizinhos. A ordem entre os dois vizinhos é
  // fixa (horário antes de anti-horário) de propósito: alternar exigiria guardar estado por
  // monstro, e um viés estável é preferível a um viés que depende de quantas vezes o monstro
  // já tentou — este último é o que produz movimento errático que ninguém consegue reproduzir.
  for (const offset of [0, 1, -1]) {
    const direction = DIRECTIONS[(primary + offset + DIRECTIONS.length) % DIRECTIONS.length];
    if (direction === undefined) continue;
    const x = from.x + direction.x;
    const y = from.y + direction.y;
    if (!blocked(x, y)) return { x, y };
  }
  return null;
}

/**
 * Um passo AFASTANDO da ameaça (FUN-85), para a postura "manter distância".
 *
 * É o passo guloso com o alvo ESPELHADO: refletir a ameaça para o outro lado do personagem dá
 * exatamente a direção oposta, e daí em diante valem as mesmas três tentativas — a direção que
 * mais afasta, depois as duas vizinhas. Escrever um segundo algoritmo de fuga seria a mesma
 * regra de desvio em dois lugares, divergindo na terceira mudança.
 *
 * Empacado devolve `null`, como o guloso: recuar até a parede e ficar lá é o comportamento
 * certo, não um caso a consertar.
 */
export function fleeStep(from: GridPoint, threat: GridPoint, blocked: Blocked): GridPoint | null {
  return greedyStep(from, { x: 2 * from.x - threat.x, y: 2 * from.y - threat.y }, blocked);
}

/** Distância de Chebyshev: um passo diagonal custa o mesmo que um reto, como na grade. */
export function distance(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Adjacente inclui diagonal — mesma regra que a validação de rota usa (FUN-9). */
export function isAdjacent(a: GridPoint, b: GridPoint): boolean {
  const d = distance(a, b);
  return d === 1;
}

/**
 * O passo LATERAL de quem já não tem passo a dar rumo ao alvo (#543, TFS/Canary
 * `Monster::getDanceStep`, `monster.cpp:2570-2624` — mecanismo, não código, ADR 0019). Chamado
 * só quando o monstro está "colado" (o guloso já devolveria `null` para aproximar mais), este é
 * o passo cosmético que evita o monstro parecer uma estátua.
 *
 * Só as quatro direções CARDINAIS entram — nunca diagonal, diferente do guloso/fuga. Uma
 * candidata só é válida se a distância Chebyshev dela ATÉ O ALVO for EXATAMENTE igual à
 * distância atual (nunca aproxima, nunca afasta) e o tile for andável. O filtro de sinal
 * (`offsetX`/`offsetY`, a posição do monstro MENOS a do alvo) é o `keepDistance` do Canary: só
 * tenta o lado que não empurra o monstro para mais perto do eixo já mais próximo.
 *
 * Esta função só replica o ramo `keepAttack=true, keepDistance=true` (o não-fugindo) — a dança
 * durante a fuga é fora do escopo do #543. Por isso não há parâmetro de alcance nem de "ainda
 * consegue atacar": com a distância EXATAMENTE preservada, quem já podia atacar da posição atual
 * continua podendo da candidata — o `keepAttack` do Canary vira identidade sob essa restrição.
 *
 * Sorteia uniformemente entre as candidatas — mesmo com uma só, para o sorteio não depender de
 * quantas sobraram (o mesmo `uniform_random` do Canary, chamado sempre que a lista não é vazia).
 * Lista vazia devolve `null` sem consumir `rng`.
 */
export function danceStep(
  from: GridPoint, target: GridPoint, blocked: Blocked, rng: { integer(min: number, max: number): number },
): GridPoint | null {
  const centerToDist = distance(from, target);
  const offsetX = from.x - target.x;
  const offsetY = from.y - target.y;
  const candidates: GridPoint[] = [];
  const tryAdd = (x: number, y: number): void => {
    if (Math.max(Math.abs(x - target.x), Math.abs(y - target.y)) !== centerToDist) return;
    if (blocked(x, y)) return;
    candidates.push({ x, y });
  };
  if (offsetY >= 0) tryAdd(from.x, from.y - 1); // norte
  if (offsetY <= 0) tryAdd(from.x, from.y + 1); // sul
  if (offsetX <= 0) tryAdd(from.x + 1, from.y); // leste
  if (offsetX >= 0) tryAdd(from.x - 1, from.y); // oeste
  if (candidates.length === 0) return null;
  return candidates[rng.integer(0, candidates.length - 1)] ?? null;
}

/**
 * A ordem embaralhada das quatro direções CARDINAIS (#655, `Monster::getRandomStep`,
 * `monster.cpp:2552-2570`: `dirList {NORTH, WEST, EAST, SOUTH}` e `std::ranges::shuffle` a cada
 * chamada). Um Fisher-Yates completo — sempre três sorteios, mesmo que só uma direção sirva, e
 * é isso que faz a primeira direção livre da lista embaralhada ser uniforme entre as livres.
 * Compartilhado com o empurrão de criatura (`HuntRuleset#pushAside`, M29-08): as duas fontes
 * embaralham a MESMA lista, e uma cópia do laço divergiria na primeira correção.
 */
export function shuffledCardinals(rng: { integer(min: number, max: number): number }): GridPoint[] {
  const order = PUSH_DIRECTIONS.slice();
  for (let i = order.length - 1; i > 0; i -= 1) {
    const pick = rng.integer(0, i);
    const chosen = order[pick] as GridPoint;
    order[pick] = order[i] as GridPoint;
    order[i] = chosen;
  }
  return order;
}

/**
 * O passo ao acaso do monstro que não persegue nem volta ao spawn (#655, TFS/Canary
 * `Monster::getRandomStep`): as quatro direções cardinais embaralhadas, e a PRIMEIRA cujo tile
 * de destino está livre. Nunca diagonal — o Canary só sorteia entre norte, oeste, leste e sul.
 * Sem nenhuma livre devolve `null` (o monstro fica onde está), depois de já ter consumido os três
 * sorteios do embaralhamento, como o Canary consome o dele antes de olhar qualquer tile.
 */
export function randomStep(
  from: GridPoint, blocked: Blocked, rng: { integer(min: number, max: number): number },
): GridPoint | null {
  for (const direction of shuffledCardinals(rng)) {
    const x = from.x + direction.x;
    const y = from.y + direction.y;
    if (!blocked(x, y)) return { x, y };
  }
  return null;
}

/**
 * O passo da volta ao spawn (#655, `Monster::doWalkBack`, `monster.cpp:2501-2526`): o passo
 * guloso rumo ao `home` — o mesmo movimento que o monstro já usa para perseguir (ADR 0009; o
 * Canary usa A* aqui, e o `home` desta hunt não muda essa escolha) —, com uma exceção que o
 * guloso puro erraria: A UM tile do `home` só vale pisar NELE. O guloso tentaria também os dois
 * vizinhos da direção, que a essa distância NÃO aproximam — só rodeiam —, e um `home` ocupado
 * por outro monstro faria quem volta girar em volta dele para sempre. O Canary nem chega a
 * andar quando o destino exato está ocupado (não há caminho até ele); aqui o monstro chega ao
 * lado e espera, sem oscilar. Já no `home` devolve `null`, como o guloso.
 */
export function walkBackStep(from: GridPoint, home: GridPoint, blocked: Blocked): GridPoint | null {
  if (distance(from, home) === 1) return blocked(home.x, home.y) ? null : { x: home.x, y: home.y };
  return greedyStep(from, home, blocked);
}
