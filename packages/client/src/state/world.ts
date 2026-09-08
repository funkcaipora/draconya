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

export interface World {
  /** Instância em que o personagem está, ou `null` antes de entrar em alguma. */
  instanceId: string | null;
  mapId: string | null;
  /**
   * Qual criatura é o próprio jogador. A câmera segue esta; sem ela, não há em quem centrar.
   *
   * Fica `null` até a FUN-32 (`session-state`) dizer quem é: o `welcome` traz o
   * `characterId`, que é UUID, e as criaturas são numeradas por instância — não há como
   * ligar os dois no cliente sem o servidor dizer.
   */
  selfId: number | null;
  readonly creatures: Map<number, Creature>;
}

export const world: World = {
  instanceId: null,
  mapId: null,
  selfId: null,
  creatures: new Map(),
};

/**
 * Troca de instância limpa TUDO. Carregar por cima deixaria criatura do mapa anterior
 * desenhada no novo, e o sintoma é um monstro parado que nunca some.
 */
export function enterInstance(instanceId: string, mapId: string): void {
  world.instanceId = instanceId;
  world.mapId = mapId;
  world.selfId = null;
  world.creatures.clear();
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
