// O ÚNICO lugar que escreve posição de criatura (FUN-69, ADR 0009).
//
// Antes desta task a regra vivia em três cópias dentro do `HuntRuleset`, cada uma com a
// contabilidade de ocupação escrita à mão em volta — e uma delas (`onEnter`) não tinha a
// contabilidade nenhuma. Três cópias divergem; é questão de quando. A falta aparecia em três
// issues ao mesmo tempo: `walk` sem dono, personagem nascendo em parede, e `creature-move` sem
// emissor porque não havia um ponto por onde todo passo passasse.
//
// O padrão é o do §8 do documento de referência OpenTibia, e é conceitual — não a hierarquia
// OO do TFS:
//
//   VALIDAR → COMMIT ATÔMICO → EVENTO
//
// Nunca validar aqui e commitar lá fora, porque aí a validação vira sugestão. O evento é
// DEVOLVIDO no resultado, não emitido daqui: quem sabe para onde ele vai é o ruleset (§12).

import type { Tilemap } from '@draconya/content';
import { floorChangeAt, groundSpeed, isBlocked } from '@draconya/content';
import type { GridPoint } from './monster/step.js';
import type { Fields } from './fields.js';
import type { TileOverrides } from './tile-overrides.js';

/**
 * Por que um passo foi recusado. A MESMA razão para bot, jogador e monstro (§17 da referência):
 * um jogador recusado precisa ouvir o mesmo motivo que o bot ouviria, senão são duas regras que
 * divergem na terceira mudança.
 */
export type MoveRejection =
  | 'out-of-bounds'
  | 'tile-blocked'
  | 'tile-occupied'
  | 'not-adjacent'
  | 'same-tile'
  /**
   * Só de `HuntRuleset.requestMove` (#763): um `walk-to` para um destino DISTANTE cujo BFS
   * limitado (`boundedPath`, o mesmo do follow) não achou caminho dentro do raio — parede
   * genuína, fora do raio, ou um interativo bloqueante que não é porta. NUNCA de `canOccupy`:
   * ele só compara tile ADJACENTE, e não sabe o que é "inalcançável" — só "não é vizinho".
   */
  | 'unreachable'
  /**
   * Só de `HuntRuleset#step` (M44-04, #622): quem anda está sob `rooted` — nenhum passo sai, de
   * nenhuma origem (`Game::internalMoveCreature`, `game.cpp:1965`). Nunca de `canOccupy`: a
   * condição é do criatura, não do tile.
   */
  | 'rooted'
  /**
   * Só de `HuntRuleset#step` (M44-04, #622): quem anda está sob `feared` e o passo NÃO é o da
   * fuga forçada (`Creature::startAutoWalk` recusa o caminhar do próprio jogador, do bot e do
   * `walk` do socket), OU a própria fuga pisaria num campo que causa dano
   * (`Game::internalMoveCreature`, `game.cpp:1975-1980`).
   */
  | 'feared';

/** Ponto de mundo, com o andar. O `z` vem do MAPA — é a única fonte de verdade sobre ele. */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type MoveResult =
  | {
    readonly ok: true;
    readonly from: WorldPoint;
    readonly to: WorldPoint;
    readonly durationMs: number;
  }
  | { readonly ok: false; readonly reason: MoveRejection };

/**
 * O que o sistema de movimento precisa saber do mundo. Estreito de propósito: ele não pode
 * arrastar `Session` nem `HuntRuleset` junto, senão a Cidade não consegue usá-lo — e a Guild
 * War muito menos.
 */
export interface MovementWorld {
  readonly map: Tilemap;
  /**
   * Passo de duração FIXA, em milissegundos — o regime da Cidade (FUN-119, ADR 0025): ela é
   * navegação, não simulação, e anda a `city.stepDurationMs` para todo mundo. Ausente é o
   * regime da hunt: a fórmula do Tibia, por chão e velocidade.
   */
  readonly fixedStepMs?: number;
  /** `true` se ALGUÉM ocupa o tile. Quem chama já excluiu quem está se movendo. */
  occupied(x: number, y: number, z?: number): boolean;
  vacate(x: number, y: number, z?: number): void;
  occupy(x: number, y: number, z?: number): void;
  /**
   * Bloqueado por geometria, por overlay de sessão (#728, ADR 0050 d.2) OU por campo bloqueante
   * (#560, Magic Wall/Wild Growth)? Combina o `Tilemap` (parede, fora do mapa) com
   * `TileOverrides` (porta fechada, capim, stone pile) e `Fields` (parede temporária) — UMA
   * pergunta para `canOccupy`/`move`, o passo guloso e o BFS do follow, em vez de cada um saber
   * que existem três lugares para conferir. Vale IGUAL para jogador e monstro — ao contrário do
   * desvio de dano (`canMonsterEnterField`), que só o monstro respeita.
   */
  blockedAt(x: number, y: number, z: number): boolean;
  /** Pisar aqui muda de andar — escada do mapa OU overlay (stone pile virada buraco, #728)? */
  floorChangeAt(x: number, y: number, z: number): WorldPoint | null;
  /**
   * Pisar aqui teleporta (#734, ADR 0050 d.6 T3)? `null` sem teleporte ativo aqui — inclusive um
   * `closed` (gated por alavanca que ainda não abriu) ou cujo `target` cai fora do mapa (o
   * `move()` que confere isso, não aqui: esta pergunta só resolve o CONTEÚDO, nunca geometria).
   */
  teleportAt(x: number, y: number, z: number): WorldPoint | null;
}

/**
 * Genérico no tipo do ponto, e é decisão: o personagem carrega `z` porque atravessa protocolo
 * e banco; o monstro vive numa instância de um andar só e não tem por que carregar. Forçar um
 * dos dois formatos apagaria `z` de um ou inventaria para o outro — e transição de andar é
 * não-objetivo declarado desta task.
 */
export interface Movable<P extends GridPoint = GridPoint> {
  position: P;
  /**
   * Velocidade na escala do Tibia (FUN-119). Vem do conteúdo — `progression` para o
   * personagem, a definição para o monstro —, nunca de constante em código.
   */
  readonly speed: number;
  /**
   * Haste (#155): multiplica a velocidade por um tempo. À parte de `speed` porque `retarget` e
   * a entrada na hunt REESCREVEM `speed` pela tabela, e apagariam o haste com ele. Ausente é 1.
   */
  readonly speedScale?: number;
  /**
   * Usa escada (#519, hunt multiandar)? Ausente é o padrão de sempre: quem carrega `z` na
   * posição sobe e desce; quem não carrega vê o degrau como parede (o monstro, e o Tibia
   * concorda). O monstro multiandar PASSOU a carregar `z` — é o que faz `zOf` achar o andar
   * certo dele para bloqueio e ocupação —, então `false` aqui é o que continua impedindo o
   * monstro de subir escada só porque a posição dele agora tem `z`: as duas coisas eram a MESMA
   * checagem antes desta issue, e não podem continuar sendo.
   */
  readonly crossesFloors?: boolean;
}

/**
 * Produzido SEMPRE que uma criatura se move, haja viewer ou não (§12 da referência). Quem
 * decide virar pacote é o hospedeiro — se a matemática dependesse de haver alguém olhando,
 * o invariante 3 estaria quebrado.
 */
export interface CreatureMoved {
  readonly kind: 'creature-moved';
  readonly creatureId: string | number;
  readonly from: WorldPoint;
  readonly to: WorldPoint;
  /** O cliente INTERPOLA este intervalo inteiro; não existe snapshot por tick (ADR 0001). */
  readonly durationMs: number;
}

/** O `z` de um ponto que pode não ter `z` (monstro): o andar padrão do mapa. */
export function zOf(point: GridPoint, map: Tilemap): number {
  return 'z' in point && typeof point.z === 'number' ? point.z : map.z;
}

/**
 * Quanto tempo um passo leva. **Uma função, usada por humano, bot, monstro e auto-walk**
 * (§10.1 da referência).
 *
 * É a fórmula do Tibia (FUN-119, ADR 0025): `chão × 1000 / speed`, com o chão do tile de
 * DESTINO, arredondado para cima em múltiplos de 50 ms — o "beat" do servidor —, e a diagonal
 * custa **3×** antes do arredondamento (é o que faz 1.163 × 3 dar 3.500, e não 3.600). Os
 * números do Huntera na Parte II da observação são a fixture: speed 292 em chão 130/160/200
 * dá 450/550/700 ms, e a diagonal do 200 dá 2.100.
 *
 * `from === to` é "quanto custa um passo daqui": é a cadência com que quem parou volta a
 * olhar em volta, e é reta.
 *
 * `landing` é onde o passo TERMINA quando `to` é uma escada — o chão que conta é o dele, mas
 * a diagonal é a do passo pedido (`from` → `to`): uma escada que leva dois tiles adiante não
 * transforma um passo reto em diagonal. Ausente, o passo termina em `to`.
 *
 * Na Cidade (`fixedStepMs`) nada disto vale: o passo é o que o conteúdo diz, para todo mundo.
 */
export function movementDuration(
  world: MovementWorld, mover: Movable<GridPoint>, from: GridPoint, to: WorldPoint,
  landing: WorldPoint = to,
): number {
  if (world.fixedStepMs !== undefined) return world.fixedStepMs;
  const ground = groundSpeed(world.map, landing.x, landing.y, landing.z);
  const diagonal = from.x !== to.x && from.y !== to.y;
  const raw = (ground * 1000) / Math.max(1, mover.speed * (mover.speedScale ?? 1)) * (diagonal ? 3 : 1);
  return Math.max(BEAT_MS, Math.ceil(raw / BEAT_MS) * BEAT_MS);
}

/** O compasso do servidor, em ms: toda duração de passo é múltiplo dele. */
const BEAT_MS = 50;

/**
 * Legalidade sem aplicar — para o `greedyStep` e para o `walk-to` do cliente.
 *
 * `null` é "pode". A ordem das checagens é a do §10, e ela importa para a RAZÃO devolvida:
 * "fora do mapa" é mais útil que "ocupado" quando as duas valem, porque a segunda sugere
 * esperar e a primeira sugere que quem pediu está errado sobre a geometria.
 */
export function canOccupy(
  world: MovementWorld, mover: Movable<GridPoint>, to: GridPoint,
): MoveRejection | null {
  const from = mover.position;
  if (to.x === from.x && to.y === from.y) return 'same-tile';
  // Um tile por passo, diagonal inclusive. Sem isto, `walk-to` do cliente vira teleporte —
  // e o cliente manda INTENÇÃO, então quem recusa é aqui (invariante 4).
  if (Math.abs(to.x - from.x) > 1 || Math.abs(to.y - from.y) > 1) return 'not-adjacent';
  // O andar é o de ONDE se está: trocar de andar é pisar numa escada, nunca pedir um `z`.
  const z = zOf(from, world.map);
  const change = world.floorChangeAt(to.x, to.y, z);
  if (change !== null) {
    // Quem não carrega `z` continua vendo o degrau como parede (o monstro de andar único de
    // sempre, como no Tibia); quem carrega mas foi marcado `crossesFloors: false` também — é o
    // monstro multiandar (#519), que carrega `z` para achar o PRÓPRIO andar mas nunca troca de
    // andar sozinho. Para quem sobra, a legalidade é a do DESTINO da escada.
    if (!('z' in from) || mover.crossesFloors === false) return 'tile-blocked';
    return tileAdmits(world, change);
  }
  return tileAdmits(world, { x: to.x, y: to.y, z });
}

/**
 * O tile aceita alguém? É a metade da legalidade que NÃO depende de onde se vem, e por isso
 * vale igual para um passo e para uma colocação.
 *
 * `isBlocked` já cobre fora do mapa: `packages/content/src/map.ts` devolve `true` para
 * coordenada fora dos limites. As duas razões ficam separadas mesmo assim — "andei para fora
 * do mapa" e "bati numa parede" são bugs diferentes de quem chamou.
 */
function tileAdmits(world: MovementWorld, to: WorldPoint): MoveRejection | null {
  const { map } = world;
  if (to.x < 0 || to.y < 0 || to.x >= map.width || to.y >= map.height) return 'out-of-bounds';
  if (world.blockedAt(to.x, to.y, to.z)) return 'tile-blocked';
  if (world.occupied(to.x, to.y, to.z)) return 'tile-occupied';
  return null;
}

/**
 * Valida e, se legal, aplica. Nunca aplica pela metade.
 *
 * Commit atômico: os três passos ou acontecem juntos, ou nenhum acontece. `vacate` antes de
 * `occupy` porque um passo para o próprio tile já foi recusado acima como `same-tile` — e é
 * o que garante que não existe instante em que a criatura esteja em dois tiles ou em nenhum,
 * que é o estado que produz monstro atravessando parede e dois corpos no mesmo lugar.
 */
export function move<P extends GridPoint>(
  world: MovementWorld, mover: Movable<P>, to: P,
): MoveResult {
  const rejection = canOccupy(world, mover, to);
  if (rejection !== null) return { ok: false, reason: rejection };

  const from = mover.position;
  const fromZ = zOf(from, world.map);
  // Pisar na escada leva ao destino dela (FUN-119): é o passo com `z` diferente que o
  // cliente já sabe interpolar — e o tile de chegada pode não ser adjacente, como no Tibia.
  const change = world.floorChangeAt(to.x, to.y, fromZ);
  let dest: WorldPoint = change ?? { x: to.x, y: to.y, z: fromZ };

  // Teleporte (#734, ADR 0050 d.6 T3): DIFERENTE de escada — o passo para `to` já é legal por
  // si só (o tile do teleporte nunca bloqueia), então um destino inválido não pode recusar o
  // passo inteiro (como faria com uma escada). Sem destino alcançável — fora do mapa, parede,
  // ocupado —, a criatura simplesmente FICA no tile do teleporte, sem redirecionar: a mesma
  // degradação de `Teleport::addThing` do Canary para `destPos` inválido ou `destTile` ausente
  // (não teleporta; nunca um erro). Escada continua tendo prioridade — os dois nunca coexistem
  // no mesmo tile de conteúdo real, mas a ordem é a mais segura das duas.
  if (change === null) {
    const teleportTarget = world.teleportAt(to.x, to.y, fromZ);
    if (teleportTarget !== null && tileAdmits(world, teleportTarget) === null) dest = teleportTarget;
  }

  world.vacate(from.x, from.y, fromZ);
  mover.position = ('z' in from ? { ...to, x: dest.x, y: dest.y, z: dest.z } : { ...to, x: dest.x, y: dest.y }) as P;
  world.occupy(dest.x, dest.y, dest.z);

  return {
    ok: true,
    from: { x: from.x, y: from.y, z: fromZ },
    to: dest,
    durationMs: movementDuration(world, mover, from, { x: to.x, y: to.y, z: fromZ }, dest),
  };
}

/**
 * Os dois lados de uma troca de lugar: o que cada criatura percorreu, com a duração do PRÓPRIO passo
 * dela (velocidade e chão dela — o cliente interpola cada uma pelo seu intervalo).
 */
export interface SwapResult {
  readonly ok: true;
  readonly mover: Extract<MoveResult, { ok: true }>;
  readonly other: Extract<MoveResult, { ok: true }>;
}

/**
 * O `mover` ATRAVESSA `other`, que está no tile vizinho (#600): o Canary deixa o jogador pisar no
 * tile de uma invocação de jogador no mundo no-pvp (`Player::canWalkthrough`) e as duas criaturas
 * passam a dividir o tile. A ocupação deste motor é EXCLUSIVA (invariante 8, `TileOccupancy`: um
 * `Set` por tile), então o atravessar vira TROCA de lugar — quem atravessa ocupa o tile do outro, e o
 * outro ocupa o dele. É o equivalente exato para quem joga: o passo acontece, e ninguém fica preso
 * atrás de um aliado parado.
 *
 * Quem decide SE a travessia é permitida (quem é `other`, de quem é a invocação) é do chamador — esta
 * função só cuida da geometria. Recusa com a MESMA razão de `move` o que `move` recusaria por outro
 * motivo que não a ocupação (não adjacente, parede, fora do mapa), e com `tile-occupied` o que não é
 * troca simples: o tile de `other` é uma escada ou um teleporte (o passo redirecionaria quem pisa, e
 * `other` nunca fica num deles) ou `other` não está de fato no tile vizinho do `mover`.
 *
 * **A ocupação NÃO muda**: os dois tiles estavam ocupados e continuam — por isso não há `vacate`
 * (que fecharia porta e soltaria placa de pressão debaixo de quem acabou de entrar) nem `occupy`.
 */
export function swapPlaces<A extends GridPoint, B extends GridPoint>(
  world: MovementWorld, mover: Movable<A>, other: Movable<B>,
): SwapResult | { readonly ok: false; readonly reason: MoveRejection } {
  const rejection = canOccupy(world, mover, other.position);
  // Só o `tile-occupied` interessa: qualquer outra recusa é a de um passo comum, e vale igual.
  if (rejection !== null && rejection !== 'tile-occupied') return { ok: false, reason: rejection };
  const fromZ = zOf(mover.position, world.map);
  const toZ = zOf(other.position, world.map);
  const target = { x: other.position.x, y: other.position.y, z: toZ };
  const origin = { x: mover.position.x, y: mover.position.y, z: fromZ };
  if (rejection === null // o tile de `other` não está ocupado: nada a trocar, quem chama deveria ter pisado.
    || fromZ !== toZ
    || world.floorChangeAt(target.x, target.y, toZ) !== null
    || world.teleportAt(target.x, target.y, toZ) !== null) {
    return { ok: false, reason: 'tile-occupied' };
  }
  mover.position = { ...mover.position, x: target.x, y: target.y } as A;
  other.position = { ...other.position, x: origin.x, y: origin.y } as B;
  return {
    ok: true,
    mover: { ok: true, from: origin, to: target, durationMs: movementDuration(world, mover, origin, target) },
    other: { ok: true, from: target, to: origin, durationMs: movementDuration(world, other, target, origin) },
  };
}

/**
 * Colocação inicial: o mesmo teste de legalidade, sem origem. Fecha a FUN-60.
 *
 * Nascer, entrar numa hunt, reentrar na rota. A distância não importa; o tile importa. Um
 * personagem colocado em `(0,0)` — que é a borda de qualquer tilemap, bloqueada por
 * construção — é recusado aqui em vez de descoberto quando alguém tentar andar.
 *
 * **NÃO libera o tile da posição anterior** (FUN-72), e a diferença é a razão de `place` e
 * `move` serem funções separadas. `place` é ENTRADA no mundo: a posição que o mover traz vem
 * de outra sessão, de outro mapa, ou de um valor que nunca foi ocupado aqui. Liberá-la é
 * liberar um tile que pertence a **outra** criatura desta instância — e aí duas acabam no
 * mesmo lugar, que é exatamente o estado que o commit atômico do `move` existe para impedir,
 * entrando pela porta dos fundos.
 *
 * Quem já está NESTE mundo e precisa saltar — teleporte, reentrada na rota, respawn de Guild
 * War — precisa liberar a origem, e isso é outra função. Ela não existe porque ainda não há
 * chamador; escrevê-la agora seria adivinhar a assinatura sem o caso de uso. **Não faça `place`
 * virar as duas coisas com um parâmetro booleano:** foi o que este comentário custou.
 */
export function place<P extends GridPoint>(
  world: MovementWorld, mover: Movable<P>, at: P,
): MoveRejection | null {
  const z = zOf(at, world.map);
  const rejection = tileAdmits(world, { x: at.x, y: at.y, z });
  if (rejection !== null) return rejection;
  mover.position = at;
  world.occupy(at.x, at.y, z);
  return null;
}

/**
 * Tiles ao redor de um ponto, do mais próximo ao mais distante, em ordem fixa.
 *
 * Ordem fixa é o que torna a posição reproduzível: mesma hunt, mesmo respawn, mesmo tile. Sem
 * isso, dois servidores com o mesmo snapshot desenhariam mapas diferentes.
 *
 * Mora aqui, e não no spawner, porque tem dois donos desde a FUN-71: o respawn da hunt e a
 * chegada na praça compartilhada. Geometria de tile não é assunto de hunt.
 */
export function* tilesAround<P extends GridPoint>(center: P, radius: number): Generator<P> {
  yield center;
  for (let ring = 1; ring <= radius; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        yield { ...center, x: center.x + dx, y: center.y + dy };
      }
    }
  }
}

/**
 * Coloca no tile pedido, ou no LIVRE mais próximo dele.
 *
 * Existe porque o ponto de entrada da Cidade é um tile só e a praça passou a ser compartilhada
 * (FUN-71): o segundo jogador a chegar encontra o primeiro parado exatamente ali, `place`
 * recusa, e o personagem fica fora do mapa — invisível, sem andar, sem nada explicando.
 *
 * Devolve a última recusa quando nem o anel inteiro serve. Isso é a praça cheia, e quem chama
 * decide o que fazer — que é assunto do teto de população, na FUN-33.
 */
export function placeNear<P extends GridPoint>(
  world: MovementWorld, mover: Movable<P>, at: P, radius: number,
): MoveRejection | null {
  let last: MoveRejection = 'out-of-bounds';
  for (const tile of tilesAround(at, radius)) {
    const rejection = place(world, mover, tile);
    if (rejection === null) return null;
    last = rejection;
  }
  return last;
}

/** Os quatro vizinhos cardeais, em ordem fixa: norte, leste, sul, oeste. */
const CARDINALS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Coloca no tile pedido, ou no LIVRE mais próximo A PÉ dele (FUN-120).
 *
 * `placeNear` procura em anéis geométricos, e num lugar com paredes o anel atravessa a parede:
 * com o templo de Thais lotado, ele colocaria quem chega do lado de fora do prédio — ou numa
 * sala dos fundos sem porta. Aqui a busca é em largura pelos tiles andáveis, quatro vizinhos,
 * no andar do ponto pedido, e para no primeiro livre; `limit` é quantos tiles ela visita antes
 * de desistir, que é a praça cheia — e o tile pedido é sempre tentado, mesmo com `limit`
 * zero, como `placeNear` sempre tenta o centro. Escada não entra na fila: ela leva a outro
 * andar.
 *
 * A hunt não precisa disto: o spawn é um `place` seco num ponto aberto (`hunt.ts`), e
 * `placeNear` fica como a busca em anel para quem tiver um lugar sem paredes.
 */
export function placeReachable<P extends GridPoint>(
  world: MovementWorld, mover: Movable<P>, at: P, limit: number,
): MoveRejection | null {
  const z = zOf(at, world.map);
  const queue: P[] = [at];
  const seen = new Set<number>([tileKey(at.x, at.y, z)]);
  let last: MoveRejection = 'out-of-bounds';
  const visits = Math.max(1, limit);
  for (let head = 0; head < queue.length && head < visits; head++) {
    const tile = queue[head] as P;
    const rejection = place(world, mover, tile);
    if (rejection === null) return null;
    last = rejection;
    // Só o OCUPADO tem vizinho a explorar: parede e fora do mapa são o fim do caminho.
    if (rejection !== 'tile-occupied') continue;
    for (const [dx, dy] of CARDINALS) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      const k = tileKey(x, y, z);
      if (seen.has(k)) continue;
      seen.add(k);
      if (world.blockedAt(x, y, z) || world.floorChangeAt(x, y, z) !== null) continue;
      queue.push({ ...tile, x, y });
    }
  }
  return last;
}

/**
 * Chave numérica de tile, com o andar. String (`\`${x},${y}\``) alocaria por consulta, e a
 * ocupação é consultada até três vezes por passo de cada criatura. Só é chamada com
 * coordenada dentro do mapa — `tileAdmits` pergunta ao tilemap antes.
 */
const tileKey = (x: number, y: number, z: number): number =>
  ((z + 16) * 100_000 + x) * 100_000 + y;

/**
 * A implementação padrão de `MovementWorld`: um tilemap imutável mais um `Set` de tiles
 * ocupados.
 *
 * É o §9.2 da referência em duas linhas — geometria compartilhada e imutável, ocupação
 * pequena e mutável. Existe como classe para hunt e Cidade não manterem cada uma o próprio
 * `Set` com a mesma contabilidade; o contrato continua sendo a interface, e quem precisar de
 * outra estrutura (AOI por célula, na FUN-33) implementa a interface, não herda daqui.
 */
export class TileOccupancy implements MovementWorld {
  readonly map: Tilemap;
  readonly fixedStepMs?: number;
  /** O overlay de cenário usável desta sessão (#728). Ausente é "mapa sem interativo". */
  readonly overrides?: TileOverrides;
  /** Os campos de tile desta sessão (#560). Ausente é "nenhum campo pode bloquear aqui". */
  readonly fields?: Fields;
  readonly #occupied = new Set<number>();

  constructor(
    map: Tilemap,
    options: {
      readonly fixedStepMs?: number; readonly overrides?: TileOverrides; readonly fields?: Fields;
    } = {},
  ) {
    this.map = map;
    if (options.fixedStepMs !== undefined) this.fixedStepMs = options.fixedStepMs;
    if (options.overrides !== undefined) this.overrides = options.overrides;
    if (options.fields !== undefined) this.fields = options.fields;
  }

  occupied(x: number, y: number, z: number = this.map.z): boolean {
    return this.#occupied.has(tileKey(x, y, z));
  }

  occupy(x: number, y: number, z: number = this.map.z): void {
    this.#occupied.add(tileKey(x, y, z));
  }

  vacate(x: number, y: number, z: number = this.map.z): void {
    this.#occupied.delete(tileKey(x, y, z));
    // A porta comum fecha quando o tile esvazia e ninguém está nele (ADR 0050 d.3) — no MESMO
    // `vacate` que a libera, nunca por um evento próprio.
    this.overrides?.closeDoorIfVacant(x, y, z, this.occupied(x, y, z));
  }

  blockedAt(x: number, y: number, z: number = this.map.z): boolean {
    return isBlocked(this.map, x, y, z)
      || (this.overrides?.blockedAt(x, y, z) ?? false)
      // Campo bloqueante (#560, Magic Wall/Wild Growth) — a terceira fonte, igual para
      // qualquer criatura: `canOccupy`/`move` não distinguem jogador de monstro aqui, ao
      // contrário do desvio de dano que só o monstro respeita (`#fieldBlocksMonster`, hunt.ts).
      || (this.fields?.blockedAt({ x, y, z }) ?? false);
  }

  floorChangeAt(x: number, y: number, z: number = this.map.z): WorldPoint | null {
    return this.overrides?.floorChangeAt(x, y, z) ?? floorChangeAt(this.map, x, y, z);
  }

  teleportAt(x: number, y: number, z: number = this.map.z): WorldPoint | null {
    return this.overrides?.teleportTargetAt(x, y, z) ?? null;
  }

  /**
   * Remonta a ocupação a partir de quem existe.
   *
   * Chamado UMA vez, quando a sessão nasce ou é restaurada de snapshot — `restore` não enxerga
   * os participantes, que a `Session` só reconstrói depois. Dali em diante a ocupação é
   * mantida por `move` e `place`, porque remontar a cada evento seriam dezenas de varreduras
   * por segundo.
   */
  reset(creatures: Iterable<{ readonly position: GridPoint; readonly alive: boolean }>): void {
    this.#occupied.clear();
    for (const creature of creatures) {
      if (!creature.alive) continue;
      const { position } = creature;
      this.#occupied.add(tileKey(position.x, position.y, zOf(position, this.map)));
    }
  }
}
