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
import { isBlocked } from '@draconya/content';
import type { GridPoint } from './monster/step.js';

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
  | 'same-tile';

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
  /** `true` se ALGUÉM ocupa o tile. Quem chama já excluiu quem está se movendo. */
  occupied(x: number, y: number): boolean;
  vacate(x: number, y: number): void;
  occupy(x: number, y: number): void;
}

/**
 * Genérico no tipo do ponto, e é decisão: o personagem carrega `z` porque atravessa protocolo
 * e banco; o monstro vive numa instância de um andar só e não tem por que carregar. Forçar um
 * dos dois formatos apagaria `z` de um ou inventaria para o outro — e transição de andar é
 * não-objetivo declarado desta task.
 */
export interface Movable<P extends GridPoint = GridPoint> {
  position: P;
  /** Milissegundos por tile. Vem do conteúdo, nunca de constante em código. */
  readonly stepDurationMs: number;
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

/**
 * Quanto tempo um passo leva. **Uma função, usada por humano, bot, monstro e auto-walk**
 * (§10.1 da referência).
 *
 * Hoje a diagonal custa o mesmo que a reta. No Tibia ela custa mais, e mudar isso é decisão
 * de balanceamento, não de arquitetura — o que esta função garante é que, quando mudar, muda
 * num lugar só, em vez de em quatro que já divergiram.
 */
export function movementDuration(
  mover: Movable<GridPoint>, _from: GridPoint, _to: GridPoint,
): number {
  return mover.stepDurationMs;
}

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
  return tileAdmits(world, to);
}

/**
 * O tile aceita alguém? É a metade da legalidade que NÃO depende de onde se vem, e por isso
 * vale igual para um passo e para uma colocação.
 *
 * `isBlocked` já cobre fora do mapa: `packages/content/src/map.ts` devolve `true` para
 * coordenada fora dos limites. As duas razões ficam separadas mesmo assim — "andei para fora
 * do mapa" e "bati numa parede" são bugs diferentes de quem chamou.
 */
function tileAdmits(world: MovementWorld, to: GridPoint): MoveRejection | null {
  const { map } = world;
  if (to.x < 0 || to.y < 0 || to.x >= map.width || to.y >= map.height) return 'out-of-bounds';
  if (isBlocked(map, to.x, to.y)) return 'tile-blocked';
  if (world.occupied(to.x, to.y)) return 'tile-occupied';
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
  world.vacate(from.x, from.y);
  mover.position = to;
  world.occupy(to.x, to.y);

  const z = world.map.z;
  return {
    ok: true,
    from: { x: from.x, y: from.y, z },
    to: { x: to.x, y: to.y, z },
    durationMs: movementDuration(mover, from, to),
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
  const rejection = tileAdmits(world, at);
  if (rejection !== null) return rejection;
  mover.position = at;
  world.occupy(at.x, at.y);
  return null;
}

/**
 * Chave numérica de tile. String (`\`${x},${y}\``) alocaria por consulta, e a ocupação é
 * consultada até três vezes por passo de cada criatura. Só é chamada com coordenada dentro
 * do mapa — `tileAdmits` pergunta ao tilemap antes.
 */
const tileKey = (x: number, y: number): number => x * 100_000 + y;

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
  readonly #occupied = new Set<number>();

  constructor(map: Tilemap) {
    this.map = map;
  }

  occupied(x: number, y: number): boolean {
    return this.#occupied.has(tileKey(x, y));
  }

  occupy(x: number, y: number): void {
    this.#occupied.add(tileKey(x, y));
  }

  vacate(x: number, y: number): void {
    this.#occupied.delete(tileKey(x, y));
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
      if (creature.alive) this.#occupied.add(tileKey(creature.position.x, creature.position.y));
    }
  }
}
