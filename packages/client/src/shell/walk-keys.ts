// Andar pelo teclado (FUN-122): que tecla é que direção, qual das teclas presas vale, e
// quando mandar o próximo passo. Puro — sem DOM, sem socket — para as três regras serem
// testadas com números; o `useWalkKeys` é a casca que liga isto à janela e ao `sendIntent`.
//
// É o que o Huntera faz (`docs/reference/huntera-observed.md` §14): setas e WASD, SÓ as quatro
// cardeais — com duas teclas presas vale a pressionada por último, nunca a diagonal —, e a
// tecla presa repete o passo no ritmo do passo. A repetição fica no CLIENTE: a Cidade é
// orientada a evento (`hz` 0), e um `walk-stop` com repetição no servidor exigiria um relógio
// na única sessão que não tem. Cada `walk` continua sendo a intenção de UM tile (invariante 4);
// o servidor recusa o que não cabe e limita a cadência (`SessionHost.#requestWalk`).

import type { C2SMessage } from '@draconya/protocol';

/** As quatro direções do `walk` — o tipo é o do protocolo, não uma cópia. */
export type Direction = Extract<C2SMessage, { type: 'walk' }>['direction'];

/** `KeyboardEvent.code` → direção. `code` e não `key`: WASD vale em qualquer layout. */
const KEY_DIRECTIONS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'north', KeyW: 'north',
  ArrowRight: 'east', KeyD: 'east',
  ArrowDown: 'south', KeyS: 'south',
  ArrowLeft: 'west', KeyA: 'west',
};

/**
 * O passo da Cidade quando nenhum passo próprio chegou para dizer o ritmo: é o `city.json`
 * (`stepDurationMs`, FUN-119) copiado à mão — o número não atravessa o protocolo, e
 * `walk-keys.test.ts` prende que os dois continuam iguais. Só decide com que frequência se
 * insiste contra uma parede; o ritmo de andar de verdade vem do `creature-move`.
 */
export const DEFAULT_STEP_MS = 150;

export function directionOf(code: string): Direction | null {
  return KEY_DIRECTIONS[code] ?? null;
}

/**
 * As teclas de andar presas agora, na ordem em que foram pressionadas — as TECLAS, pelo
 * `code`, e não as direções: ↑ e W são duas teclas para o mesmo norte, e soltar uma delas com
 * a outra ainda presa não pode parar ninguém. A direção ATIVA é a da última tecla: segurar ↑ e
 * depois → anda para leste; soltar → volta a andar para norte, porque ↑ continua presa. Nunca
 * duas ao mesmo tempo, nunca diagonal.
 */
export class WalkKeys {
  readonly #held: string[] = [];

  /** Uma tecla desceu. Devolve a direção ativa depois dela, ou `null` se não é tecla de andar. */
  press(code: string): Direction | null {
    if (directionOf(code) === null) return null;
    // O auto-repeat do sistema manda `keydown` de novo com a tecla já presa: não muda nada.
    const index = this.#held.indexOf(code);
    if (index !== -1) this.#held.splice(index, 1);
    this.#held.push(code);
    return this.active;
  }

  /**
   * Uma tecla subiu. Devolve a direção que continua ativa, ou `null` se nenhuma. Soltar uma
   * tecla que nunca desceu aqui — o `keydown` dela foi ignorado porque alguém digitava — não
   * mexe em nada: é por isso que o `keyup` não precisa do filtro de digitação.
   */
  release(code: string): Direction | null {
    const index = this.#held.indexOf(code);
    if (index !== -1) this.#held.splice(index, 1);
    return this.active;
  }

  get active(): Direction | null {
    const last = this.#held[this.#held.length - 1];
    return last === undefined ? null : directionOf(last);
  }

  /** Tudo solto — a janela perdeu o foco, e o `keyup` nunca vai chegar. */
  clear(): void {
    this.#held.length = 0;
  }
}

/** O passo próprio em curso, como o `world` o guarda: quando começou e quanto dura. */
export interface OwnStep {
  readonly startedAtMs: number;
  readonly durationMs: number;
}

/**
 * Daqui a quanto mandar o próximo `walk` com a tecla presa: quando o passo próprio ACABAR —
 * o `creature-move` do servidor diz o ritmo de verdade, e mandar antes é ser recusado pela
 * cadência do servidor —, ou `fallbackMs` depois do último envio se nenhum passo chegou
 * (parede à frente: o servidor recusou e não há o que esperar). Nunca zero: um passo que já
 * acabou manda no próximo quadro, não num laço apertado.
 */
export function nextWalkDelay(
  nowMs: number, sentAtMs: number, step: OwnStep | null, fallbackMs = DEFAULT_STEP_MS,
): number {
  // Só um passo que começou DEPOIS do envio é a resposta a ele; o anterior já era.
  const answered = step !== null && step.startedAtMs >= sentAtMs;
  const at = answered ? step.startedAtMs + step.durationMs : sentAtMs + fallbackMs;
  return Math.max(1, at - nowMs);
}
