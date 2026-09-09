// O sistema de movimento (FUN-69, ADR 0009).
//
// **É o ÚNICO lugar do projeto que escreve posição de criatura.** Não é preferência de estilo:
// era a regra que faltava, e a falta dela aparecia em três lugares ao mesmo tempo — `walk` e
// `walk-to` sem dono porque implementá-las criaria um segundo escritor com regra de bloqueio
// própria, personagem nascendo dentro de parede porque colocação não passava por legalidade
// nenhuma, e `creature-move` sem emissor porque não havia um ponto por onde todo passo passasse.
//
// O padrão é o do §8 do documento de referência OpenTibia, e é conceitual — não a hierarquia OO
// do TFS:
//
//   VALIDATE → COMMIT ATÔMICO → EMITIR EVENTO
//
// `validate` responde sem tocar em nada. `commit` escreve, e é atômico: sai do tile antigo e
// entra no novo sem estado intermediário em que a criatura esteja nos dois ou em nenhum.
// O evento é DEVOLVIDO, não emitido daqui — quem sabe onde ele vai é o ruleset (§12).

import type { Tilemap } from '@draconya/content';
import { isBlocked } from '@draconya/content';
import type { GridPoint } from '../monster/step.js';

/**
 * O que o movimento precisa de uma criatura. Estreito de propósito: `MovementSystem` não sabe
 * o que é vida, alvo, loot ou vocação, e não deve passar a saber.
 *
 * Sem `id` aqui de propósito — a ocupação é indexada pela IDENTIDADE do objeto, o que dispensa
 * inventar um espaço de nomes comum entre personagem (uuid) e monstro (número da instância).
 * O id de domínio entra só onde ele importa, que é o evento.
 *
 * Genérico no tipo do ponto, e é decisão: o personagem carrega `z` porque ele atravessa
 * protocolo e banco; o monstro vive dentro de uma instância cujo mapa tem um andar só, e não
 * tem por que carregar. Forçar um dos dois formatos faria o sistema apagar `z` de quem o tem
 * ou inventar `z` para quem não tem — e transição de andar é não-objetivo declarado da FUN-69.
 */
export interface Movable<P extends GridPoint = GridPoint> {
  readonly alive: boolean;
  position: P;
}

/**
 * Por que um passo foi recusado. É a MESMA razão para o bot, para o monstro e para o `walk`
 * que chega do socket — um jogador recusado precisa ouvir o mesmo motivo que o bot ouviria,
 * senão são duas regras que divergem na terceira mudança.
 */
export type MoveRefusal =
  | 'dead'
  | 'same-tile'
  | 'not-adjacent'
  | 'out-of-bounds'
  | 'blocked-tile'
  | 'occupied';

/**
 * Evento de DOMÍNIO, produzido haja ou não alguém olhando (§12).
 *
 * Não é o `creature-move` do protocolo: quem traduz um no outro é o servidor, que é o único
 * lado que conhece socket e numeração de criatura do fio. A hunt desanexada produz estes
 * eventos exatamente como a anexada — o que muda é que ninguém os serializa.
 */
/** Ponto de mundo: o andar vem do MAPA, que é quem sabe. Ver `CreatureMoved`. */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CreatureMoved {
  readonly type: 'creature-moved';
  readonly creatureId: string;
  /**
   * Com `z`, sempre — e tirado do mapa, não da criatura.
   *
   * O personagem carrega o próprio `z` porque atravessa protocolo e banco; o monstro não
   * carrega, porque vive numa instância de um andar só. O evento fala para fora, onde o `z` é
   * obrigatório, e a única fonte de verdade sobre o andar da instância é o tilemap dela.
   */
  readonly from: WorldPoint;
  readonly to: WorldPoint;
  readonly durationMs: number;
}

/** Resposta de `validate`: legal ou não, sem evento — consultar não produz acontecimento. */
export type MoveCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: MoveRefusal };

/** Resposta de `move` e `place`: o evento existe só quando algo de fato aconteceu. */
export type MoveOutcome =
  | { readonly ok: true; readonly event: CreatureMoved }
  | { readonly ok: false; readonly refusal: MoveRefusal };

const refuse = (refusal: MoveRefusal): { readonly ok: false; readonly refusal: MoveRefusal } =>
  ({ ok: false, refusal });
const LEGAL = { ok: true } as const;

/**
 * Quanto tempo um passo leva. **Uma função, usada por humano, bot, monstro e auto-walk** (§10.1).
 *
 * Hoje a diagonal custa o mesmo que a reta. No Tibia ela custa mais, e mudar isso é decisão de
 * balanceamento, não de arquitetura — o que esta função garante é que, quando mudar, muda num
 * lugar só, em vez de em quatro que já divergiram.
 */
export function movementDuration(
  stepDurationMs: number, _from: GridPoint, _to: GridPoint,
): number {
  return stepDurationMs;
}

/** Adjacência de rei: um tile em qualquer das oito direções. */
function isAdjacent(from: GridPoint, to: GridPoint): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dx <= 1 && dy <= 1 && dx + dy > 0;
}

/**
 * Chave numérica de tile. String (`\`${x},${y}\``) alocaria por consulta, e a ocupação é
 * consultada até três vezes por passo de cada criatura. Ver a nota de custo em
 * `packages/sim/AGENTS.md`.
 *
 * Só é chamada com coordenada dentro do mapa — a legalidade pergunta ao tilemap antes.
 */
const tileKey = (x: number, y: number): number => x * 100_000 + y;

export class MovementSystem {
  readonly #map: Tilemap;
  /** tile → quem está nele. Por identidade: ver `Movable`. */
  readonly #occupants = new Map<number, Movable<never>>();

  constructor(map: Tilemap) {
    this.#map = map;
  }

  /**
   * Reconstrói a ocupação a partir de quem existe.
   *
   * Chamado UMA vez, quando a sessão nasce ou é restaurada de snapshot — `restore` não enxerga
   * os participantes, que a `Session` só reconstrói depois. Dali em diante a ocupação é mantida
   * de forma incremental, porque remontar a cada evento seria dezenas de varreduras por segundo.
   */
  reset(creatures: Iterable<Movable<GridPoint>>): void {
    this.#occupants.clear();
    for (const creature of creatures) {
      if (!creature.alive) continue;
      this.#occupants.set(tileKey(creature.position.x, creature.position.y), creature as Movable<never>);
    }
  }

  /** Quem está neste tile, ou `null`. */
  occupantAt(x: number, y: number): Movable<GridPoint> | null {
    return this.#occupants.get(tileKey(x, y)) ?? null;
  }

  /**
   * O tile impede a passagem? Parede, borda do mapa, ou outra criatura.
   *
   * `mover` é excluído da conta: a criatura ocupa o tile de onde está saindo, e sem esta
   * exceção ela nunca sairia dele.
   */
  isBlockedFor(x: number, y: number, mover?: Movable<GridPoint>): boolean {
    if (isBlocked(this.#map, x, y)) return true;
    const occupant = this.#occupants.get(tileKey(x, y));
    return occupant !== undefined && (occupant as unknown) !== mover;
  }

  /**
   * O passo é legal? Responde sem tocar em nada — é o `queryAdd` do §8.
   *
   * A ordem das checagens é a do §10, e ela importa para a RAZÃO devolvida: "fora do mapa" é
   * mais útil que "ocupado" quando as duas valem, porque a segunda sugere esperar e a primeira
   * sugere que quem pediu está errado sobre a geometria.
   */
  validate<P extends GridPoint>(creature: Movable<P>, to: P): MoveCheck {
    if (!creature.alive) return refuse('dead');
    const from = creature.position;
    if (from.x === to.x && from.y === to.y) return refuse('same-tile');
    if (!isAdjacent(from, to)) return refuse('not-adjacent');
    return this.#tileAdmits(creature, to);
  }

  /**
   * O tile aceita esta criatura? É a metade da legalidade que NÃO depende de de onde ela vem,
   * e por isso vale igual para um passo e para uma colocação.
   */
  #tileAdmits<P extends GridPoint>(creature: Movable<P>, to: P): MoveCheck {
    if (isBlocked(this.#map, to.x, to.y)) {
      // O tilemap trata fora dos limites como bloqueado; separar as duas razões aqui é o que
      // faz a recusa dizer algo a quem a lê.
      const outside = to.x < 0 || to.y < 0 || to.x >= this.#map.width || to.y >= this.#map.height;
      return refuse(outside ? 'out-of-bounds' : 'blocked-tile');
    }
    const occupant = this.#occupants.get(tileKey(to.x, to.y));
    if (occupant !== undefined && (occupant as unknown) !== creature) return refuse('occupied');
    return LEGAL;
  }

  /** Sai de um tile e entra noutro, sem ponto intermediário. Ver `move`. */
  #commit<P extends GridPoint>(creature: Movable<P>, to: P): P {
    const from = creature.position;
    this.#occupants.delete(tileKey(from.x, from.y));
    creature.position = to;
    this.#occupants.set(tileKey(to.x, to.y), creature as Movable<never>);
    return from;
  }

  /**
   * Valida e, se puder, MOVE. É a única escrita de `position` do projeto.
   *
   * O commit é atômico por construção: sair e entrar acontecem sem ponto intermediário em que
   * a criatura esteja em dois tiles ou em nenhum — que é o estado que produz monstro
   * atravessando parede e dois corpos no mesmo lugar.
   */
  move<P extends GridPoint>(
    creature: Movable<P>,
    to: P,
    options: { readonly creatureId: string; readonly durationMs: number },
  ): MoveOutcome {
    const check = this.validate(creature, to);
    if (!check.ok) return check;
    const from = this.#commit(creature, to);
    return { ok: true, event: this.#moved(options.creatureId, from, to, options.durationMs) };
  }

  /**
   * Coloca uma criatura num tile sem exigir adjacência — nascer, entrar numa hunt, reentrar na
   * rota. A LEGALIDADE é a mesma de um passo, e é isso que fecha a FUN-60: um personagem
   * colocado em `(0,0)`, que é parede na borda de qualquer tilemap, é recusado aqui em vez de
   * descoberto quando alguém tentar andar.
   */
  place<P extends GridPoint>(
    creature: Movable<P>, to: P, options: { readonly creatureId: string },
  ): MoveOutcome {
    if (!creature.alive) return refuse('dead');
    const check = this.#tileAdmits(creature, to);
    if (!check.ok) return check;
    const from = this.#commit(creature, to);
    return { ok: true, event: this.#moved(options.creatureId, from, to, 0) };
  }

  /**
   * O primeiro tile livre a partir de um centro, na ordem fixa de `candidates`.
   *
   * Existe para quem precisa de "um lugar por perto" — spawn, e depois teleporte e reentrada.
   * Devolver `null` é resposta legítima: sem lugar agora, tenta mais tarde. Empilhar duas
   * criaturas no mesmo tile é pior.
   */
  firstFree<P extends GridPoint>(candidates: Iterable<P>, mover?: Movable<GridPoint>): P | null {
    for (const tile of candidates) {
      if (!this.isBlockedFor(tile.x, tile.y, mover)) return tile;
    }
    return null;
  }

  #moved(
    creatureId: string, from: GridPoint, to: GridPoint, durationMs: number,
  ): CreatureMoved {
    const z = this.#map.z;
    return {
      type: 'creature-moved',
      creatureId,
      from: { x: from.x, y: from.y, z },
      to: { x: to.x, y: to.y, z },
      durationMs,
    };
  }

  /** A criatura saiu do mundo — morreu, foi recolhida, trocou de instância. Libera o tile. */
  remove(creature: Movable<GridPoint>): void {
    const key = tileKey(creature.position.x, creature.position.y);
    if ((this.#occupants.get(key) as unknown) === creature) this.#occupants.delete(key);
  }
}


