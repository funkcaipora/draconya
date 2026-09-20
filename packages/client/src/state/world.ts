// Estado do mundo: o que o canvas desenha (FUN-22).
//
// AQUI NÃO EXISTE ASSINATURA. Não é esquecimento nem simplificação — é a garantia.
//
// `creature-move` chega dezenas de vezes por segundo, e o ADR 0007 diz que um HUD denso
// re-renderizando a cada um derruba a taxa de quadros. A forma usual de evitar isso é
// disciplina: "não assine criaturas". Disciplina dura até o quinto componente.
//
// Então criatura mora num lugar que NÃO TEM COMO notificar ninguém. Não há `subscribe` neste
// módulo. Um delta de movimento não pode causar render de React porque não existe caminho
// do movimento até o React — a propriedade é estrutural, não combinada.
//
// Quem lê isto é o laço de render do canvas (FUN-23), a cada quadro, direto. Nunca por prop.

import type { OutfitColors, S2CProps, DamageType } from '@draconya/protocol';
import {
  FLOATING_TEXT_MERGE_WINDOW_MS, mergeFloatingText,
} from '../world/effects.js';

/** Posição em tiles. Igual à do protocolo. */
export interface Point {
  x: number;
  y: number;
  z: number;
}

/**
 * Uma criatura visível.
 *
 * O passo é guardado como ORIGEM, DESTINO e DURAÇÃO, não como posição atual: o servidor manda
 * o passo uma vez e o cliente anima os ~400 ms (ADR 0001, e o `AGENTS.md` do pacote). Guardar
 * só a posição destruiria a informação de que existe um movimento em curso, e o personagem
 * teleportaria de tile em tile.
 */
export interface Creature {
  readonly id: number;
  readonly appearanceId: number;
  /**
   * As cores com que o outfit dela é pintado (FUN-104). O tipo é o do PROTOCOLO, e não o de
   * `assets/outfit.ts`, de propósito: o store guarda o que o servidor disse, e não pode
   * depender da camada de arte para descrever isso — é o viewport quem liga um ao outro.
   *
   * Ausente quando a criatura chegou sem cores — monstro, que é uma camada só, ou um nó
   * `game` anterior a esta issue —, e aí é o viewport quem escolhe as de reserva. O store não
   * inventa: guardar as padrão aqui faria "o servidor não disse" e "o servidor disse estas"
   * chegarem iguais ao desenho.
   */
  readonly colors?: OutfitColors;
  name: string;
  health: number;
  maxHealth: number;
  /** Onde ela está quando não há passo em curso. */
  position: Point;
  /** Passo em curso, ou `null` se parada. */
  step: CreatureStep | null;
}

export interface CreatureStep {
  readonly from: Point;
  readonly to: Point;
  readonly startedAtMs: number;
  readonly durationMs: number;
  /** Empurrão, não passo próprio — o canvas desenha diferente (§ guild war). */
  readonly pushed: boolean;
}

/** Como um golpe se lê: `heal` é cura, os outros são dano. Do protocolo, não copiado. */
export type HitKind = S2CProps<'creature-hit'>['kind'];

/**
 * Os três TRANSITÓRIOS do combate (FUN-106): o efeito num tile, o projétil de A a B e o número
 * que flutua sobre a criatura. Vivem em listas aqui — no mundo, nunca no HUD — porque chegam
 * dezenas por segundo numa hunt e o React não pode saber deles (ADR 0007).
 *
 * **Quem os expira é o viewport**, não este módulo: só o laço de quadro sabe que horas são, e
 * é ele que remove da lista o que acabou de tocar. Aqui só se guarda o INSTANTE em que cada
 * um começou; o resto é aritmética em `world/effects.ts`.
 *
 * O `id` é local e sequencial: é a chave do pool de sprites do viewport, e por isso NUNCA
 * reinicia — nem ao trocar de instância. Reiniciar faria um efeito novo herdar o sprite de um
 * antigo que ainda não saiu do pool.
 */
export interface Effect {
  readonly id: number;
  readonly position: Point;
  readonly effectId: number;
  readonly startedAtMs: number;
}

export interface Missile {
  readonly id: number;
  readonly from: Point;
  readonly to: Point;
  readonly missileId: number;
  readonly startedAtMs: number;
  readonly durationMs: number;
}

export interface FloatingText {
  readonly id: number;
  readonly creatureId: number;
  /**
   * O valor desenhado. MUTÁVEL desde a #479: números no mesmo tile e mesma cor, dentro de uma
   * janela curta, somam num só (RF-05) em vez de borrar um sobre o outro.
   */
  amount: number;
  readonly kind: HitKind;
  /**
   * O ELEMENTO do golpe, quando o servidor o mandou (RF-02, #479). Ausente é um nó `game`
   * anterior, e a cor cai no mapa por `kind`. Entra na chave do merge: dois números de cores
   * diferentes no mesmo tile NÃO se somam — o jogador não pode ler fogo como gelo.
   */
  readonly damageType?: DamageType;
  readonly startedAtMs: number;
  /**
   * Onde o texto está ancorado: o ponto do IMPACTO, fotografado quando o golpe chegou (RF-04).
   * NÃO acompanha a criatura — o número fica no tile em que ela estava, mesmo que ela ande ou
   * morra. `null` é criatura que este cliente nunca viu: nada a desenhar.
   */
  position: Point | null;
}

export interface World {
  /** Instância em que o personagem está, ou `null` antes de entrar em alguma. */
  instanceId: string | null;
  mapId: string | null;
  /** O ambiente da cena (FUN-121): `cavern` escurece o mundo. Superfície até alguém dizer. */
  ambience: 'surface' | 'cavern';
  /**
   * Qual criatura é o próprio jogador. A câmera segue esta; sem ela, não há em quem centrar.
   *
   * Fica `null` até a FUN-32 (`session-state`) dizer quem é: o `welcome` traz o
   * `characterId`, que é UUID, e as criaturas são numeradas por instância — não há como
   * ligar os dois no cliente sem o servidor dizer.
   */
  selfId: number | null;
  readonly creatures: Map<number, Creature>;
  /** Os itens no chão (FUN-123): cadáveres, pelo id do servidor. Desenhados na pilha do tile. */
  readonly groundItems: Map<number, GroundItem>;
  /**
   * Sobe a cada mudança em `groundItems`: o terreno só repinta quando a chave muda, e a chave
   * precisa saber que um cadáver caiu sem varrer o mapa a cada quadro.
   */
  groundItemsVersion: number;
  readonly effects: Effect[];
  readonly missiles: Missile[];
  readonly texts: FloatingText[];
}

/** Um item no chão: onde, e com que arte. */
export interface GroundItem {
  readonly id: number;
  readonly position: Point;
  readonly appearanceId: number;
}

export const world: World = {
  instanceId: null,
  mapId: null,
  ambience: 'surface',
  groundItems: new Map(),
  groundItemsVersion: 0,
  selfId: null,
  creatures: new Map(),
  effects: [],
  missiles: [],
  texts: [],
};

/**
 * Teto de cada lista de transitórios.
 *
 * Com o viewport rodando a lista nunca passa de algumas dezenas: tudo expira em cerca de um
 * segundo. O teto é para a aba de FUNDO, onde `requestAnimationFrame` para e o socket não —
 * horas de hunt entrariam sem ninguém expirar nada, e o sintoma seria "o jogo fica lento com
 * o tempo", que ninguém liga a um efeito de magia. Quando o teto corta, corta o mais antigo,
 * que é o que já teria acabado de tocar.
 */
export const TRANSIENT_CAP = 256;

let lastTransientId = 0;

function pushCapped<T>(list: T[], item: T): void {
  list.push(item);
  if (list.length > TRANSIENT_CAP) list.splice(0, list.length - TRANSIENT_CAP);
}

/** Um efeito começa a tocar em `position` agora. */
export function addEffect(position: Point, effectId: number, startedAtMs: number): Effect {
  lastTransientId += 1;
  const effect: Effect = { id: lastTransientId, position, effectId, startedAtMs };
  pushCapped(world.effects, effect);
  return effect;
}

/** Um projétil sai de `from` para `to` agora, e leva `durationMs` para chegar. */
export function addMissile(
  from: Point, to: Point, missileId: number, startedAtMs: number, durationMs: number,
): Missile {
  lastTransientId += 1;
  const missile: Missile = { id: lastTransientId, from, to, missileId, startedAtMs, durationMs };
  pushCapped(world.missiles, missile);
  return missile;
}

/**
 * Um número começa a subir sobre a criatura agora.
 *
 * A posição é fotografada AQUI, e não só no primeiro quadro: o golpe que mata chega no mesmo
 * lote que o `creature-disappear`, e quando o viewport olhasse a criatura já não existiria —
 * justamente o número que o jogador mais quer ver ficaria sem lugar para cair.
 */
export function addFloatingText(
  creatureId: number, amount: number, kind: HitKind, startedAtMs: number,
  damageType?: DamageType,
): FloatingText {
  // A posição é fotografada AQUI, e não só no primeiro quadro: o golpe que mata chega no mesmo
  // lote que o `creature-disappear`, e quando o viewport olhasse a criatura já não existiria —
  // justamente o número que o jogador mais quer ver ficaria sem lugar para cair. É também o
  // ponto de IMPACTO ao qual o texto fica ancorado (RF-04): ele não segue a criatura depois.
  const creature = world.creatures.get(creatureId);
  const position = creature === undefined ? null : interpolate(creature, startedAtMs);
  const merged = mergeTargetAt(position, kind, damageType, startedAtMs);
  if (merged !== null) {
    mergeFloatingText(merged, amount);
    return merged;
  }
  lastTransientId += 1;
  const text: FloatingText = {
    id: lastTransientId,
    creatureId,
    amount,
    kind,
    ...(damageType === undefined ? {} : { damageType }),
    startedAtMs,
    position,
  };
  pushCapped(world.texts, text);
  return text;
}

/**
 * O texto recente de MESMO tile e MESMA cor em que este número se funde (RF-05), ou `null`.
 *
 * Sem posição não há merge: não existe "mesmo tile" de uma criatura que o cliente nunca viu. A
 * varredura é de trás para a frente porque o candidato é o mais RECENTE — e o `kind` e o
 * `damageType` entram na chave porque cores diferentes não podem virar uma soma só.
 */
function mergeTargetAt(
  position: Point | null, kind: HitKind, damageType: DamageType | undefined, nowMs: number,
): FloatingText | null {
  if (position === null) return null;
  for (let i = world.texts.length - 1; i >= 0; i -= 1) {
    const text = world.texts[i] as FloatingText;
    if (text.kind !== kind || text.damageType !== damageType) continue;
    const anchor = text.position;
    if (anchor === null) continue;
    if (anchor.x !== position.x || anchor.y !== position.y || anchor.z !== position.z) continue;
    if (nowMs - text.startedAtMs > FLOATING_TEXT_MERGE_WINDOW_MS) continue;
    return text;
  }
  return null;
}

/** Esvazia os três transitórios. O que estava no ar pertence à cena anterior. */
export function clearTransients(): void {
  world.effects.length = 0;
  world.missiles.length = 0;
  world.texts.length = 0;
}

/**
 * Troca de instância limpa TUDO. Carregar por cima deixaria criatura do mapa anterior
 * desenhada no novo, e o sintoma é um monstro parado que nunca some.
 */
export function enterInstance(
  instanceId: string, mapId: string, ambience: 'surface' | 'cavern' = 'surface',
): void {
  world.instanceId = instanceId;
  world.mapId = mapId;
  world.ambience = ambience;
  world.groundItems.clear();
  world.groundItemsVersion += 1;
  world.selfId = null;
  world.creatures.clear();
  clearTransients();
}

/**
 * Posição interpolada num instante. É o que o canvas chama por criatura por quadro.
 *
 * Passa do fim da duração devolve o destino, e não uma extrapolação: o próximo passo chega
 * por mensagem, e adivinhar para onde a criatura ia é exatamente a predição que o
 * `AGENTS.md` do pacote proíbe — previsão só do próprio passo.
 */
export function interpolate(creature: Creature, nowMs: number): Point {
  const step = creature.step;
  if (step === null) return creature.position;

  const elapsed = nowMs - step.startedAtMs;
  if (elapsed >= step.durationMs) return step.to;
  if (elapsed <= 0) return step.from;

  const t = elapsed / step.durationMs;
  return {
    x: step.from.x + (step.to.x - step.from.x) * t,
    y: step.from.y + (step.to.y - step.from.y) * t,
    // Andar não muda de andar. Um passo entre `z` diferentes é teleporte, e o servidor manda
    // isso como desaparecer e aparecer, não como passo.
    z: step.to.z,
  };
}
