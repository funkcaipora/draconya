// As condições temporárias (#155, ADR 0026 decisão 5; generalizadas no CMB-07, #334).
//
// Haste, postura, magic shield, cura ao longo do tempo e dano ao longo do tempo são a MESMA
// coisa para o motor: um estado com prazo, que muda uma leitura (velocidade, dano causado, dano
// tomado, dano→mana) ou dispara um tique. A referência manda criar isto ANTES de haver muitas
// magias, e é o que faz veneno e paralisia serem mais uma chave aqui e não mais um campo no
// snapshot.
//
// **Nada de tempo aqui.** `expiresAtMs` é um instante LÓGICO da sessão; quem faz a condição
// vencer é a fila de eventos do ruleset (`CONDITION_EXPIRE`, invariante 2). Este módulo só
// guarda e responde.
//
// O CMB-07 generalizou o alvo: a condição passou a valer para PERSONAGEM e MONSTRO, e ganhou
// dano ao longo do tempo (DOT). O estado serializado continua com os campos planos que o #155
// gravou — o `tick` virou união `heal`/`damage` com `kind` OPCIONAL, de modo que um snapshot
// anterior a esta issue (sem `kind`) continua legível: ausente é `heal`, que era o único tique
// que existia. Por isso o `SNAPSHOT_FORMAT_VERSION` NÃO sobe.
//
// O conteúdo declara a condição como `ConditionSpec` (com o `effect` discriminado); o
// ruleset a compila para este estado, que é o que viaja no snapshot. A POLÍTICA de fusão
// (`merge`) é declarada por condição, e não um campo por efeito: `refresh` (relançar reinicia,
// o de sempre), `replace` (o novo substitui o antigo) e `strongest` (o mais forte vence).
//
// M31-02 (#557): o dano ao longo do tempo ganhou a forma do Tibia — uma FILA de tiques,
// possivelmente com valores DIFERENTES (a lista decrescente do Canary), em vez de um valor único
// repetido. `tick.amount`/`tick.intervalMs` continuam sendo o tique CORRENTE — todo código que já
// lia os dois campos direto continua funcionando sem mudança —, e `tick.queue` é o QUE FALTA
// depois dele, em ordem. Ausente é o tique antigo, infinito até `expiresAtMs` (cura ao longo do
// tempo, e qualquer snapshot anterior a esta issue); presente, mesmo vazio, é a fila do Tibia —
// esgotada, ela para de tiquetar ANTES do vencimento, como `ConditionDamage::executeCondition` do
// Canary faz quando `damageList` esvazia.

import type { ConditionEffect, ConditionSpec } from '@draconya/content';
import type { DamageType } from '@draconya/content';
// `generateDamageList`/`damageOverTimeTicks` moram em `content` (achado da revisão do #557):
// `conditionSpecSchema` também precisa delas para conferir `durationMs` contra o total da fila, e
// duas implementações do mesmo cálculo é o defeito que a DT-03 já nomeia noutro lugar do content.
import { damageOverTimeTicks, generateDamageList } from '@draconya/content';
import type { Direction } from './area.js';
import type { DamageSource } from './combat/damage.js';
import type { Rng } from './rng.js';

export type ConditionKind =
  | 'speed' | 'buff' | 'mana-shield' | 'heal-over-time' | 'damage-over-time' | 'drunk';

/**
 * A POLÍTICA de fusão de uma condição (CMB-07, DT-02). Declarada no conteúdo, nunca um campo
 * por efeito — é o que evita timers paralelos quando a mesma condição é relançada.
 *
 * - `refresh`: relançar reinicia o prazo (o comportamento de sempre do #155);
 * - `replace`: o novo estado substitui o antigo;
 * - `strongest`: o de maior magnitude vence; o mais fraco não derruba o que já está ativo.
 */
export type ConditionMerge = 'replace' | 'refresh' | 'strongest';

/**
 * A FAMÍLIA de golpe que a condição escala (`damageDealtPercent`). É vocabulário de skill, não
 * de resolução: `distance` cobre bow e munição, `spell` cobre magia, runa e wand. Não confundir
 * com o `DamageSource` canônico do resolver (CMB-02), que diz de ONDE o dano veio.
 */
export type DamageScaleSource = 'melee' | 'distance' | 'spell';

export interface DamagePercentBySource {
  readonly melee?: number | undefined;
  readonly distance?: number | undefined;
  readonly spell?: number | undefined;
}

/** Um tique AINDA por vir na fila do Tibia (M31-02) — sem `kind`/`damageType`/`source`: são os
 * mesmos do tique corrente, `queue` não os repete. */
export interface QueuedTick {
  readonly amount: number;
  readonly intervalMs: number;
}

/**
 * O tique de uma condição. `heal` repõe vida; `damage` (CMB-07) é um DANO AO LONGO DO TEMPO,
 * com tipo e origem próprios para entrar no MESMO resolver canônico do golpe.
 *
 * `kind` é OPCIONAL de propósito: um snapshot anterior ao CMB-07 gravou só `{ amount,
 * intervalMs }`, e o único tique que existia era cura. Ausente é `heal`, e é o que mantém o
 * formato antigo legível sem bump.
 *
 * `queue` (M31-02) é o QUE FALTA depois deste tique, em ordem — a lista do Tibia gerada por
 * `damageOverTimeTicks`. Ausente é o tique antigo, que se repete a `intervalMs` até
 * `expiresAtMs`; presente, mesmo `[]`, é a fila nova, que PARA de tiquetar quando esgota, antes
 * do vencimento se for o caso (`ConditionDamage::executeCondition` do Canary faz o mesmo).
 */
export interface ConditionTick {
  readonly amount: number;
  readonly intervalMs: number;
  readonly kind?: 'heal' | 'damage';
  readonly damageType?: DamageType;
  readonly source?: DamageSource;
  readonly queue?: readonly QueuedTick[];
}

export interface ConditionState {
  /**
   * Uma por chave: relançar segue a política `merge`. O #155 usava só os quatro tipos fixos;
   * o CMB-07 abre para string porque campo e ability também nomeiam a sua.
   */
  readonly key: string;
  /**
   * De QUEM é a condição (CMB-07). O container de `Conditions` já é por criatura, mas o id
   * viaja no estado para o snapshot e para o sujeito do evento. Ausente num snapshot anterior.
   */
  readonly targetId?: string;
  readonly spellId?: string;
  /** Quem aplicou — é ele que leva a atribuição de um tique de dano. Ausente em campo. */
  readonly sourceId?: string;
  /** Instante LÓGICO da sessão em que vence. Nunca relógio de processo. */
  readonly expiresAtMs: number;
  /** Próximo tique, para auditoria; quem manda é a fila de eventos. */
  readonly nextTickAtMs?: number;
  /** A política de fusão declarada. Ausente é `refresh`, o comportamento do #155. */
  readonly merge?: ConditionMerge;
  readonly speedPercent?: number;
  readonly damageDealtPercent?: DamagePercentBySource;
  readonly damageTakenPercent?: number;
  /** Tique periódico: `amount` a cada `intervalMs`, até `expiresAtMs`. */
  readonly tick?: ConditionTick;
}

/** O tique normalizado: um snapshot antigo sem `kind` é cura. */
export interface NormalizedTick {
  readonly amount: number;
  readonly intervalMs: number;
  readonly kind: 'heal' | 'damage';
  readonly damageType?: DamageType;
  readonly source?: DamageSource;
  readonly queue?: readonly QueuedTick[];
}

export function tickOf(condition: ConditionState): NormalizedTick | null {
  const tick = condition.tick;
  if (tick === undefined) return null;
  return {
    amount: tick.amount,
    intervalMs: tick.intervalMs,
    kind: tick.kind ?? 'heal',
    ...(tick.damageType === undefined ? {} : { damageType: tick.damageType }),
    ...(tick.source === undefined ? {} : { source: tick.source }),
    ...(tick.queue === undefined ? {} : { queue: tick.queue }),
  };
}

/**
 * O PRÓXIMO tique, avançando a fila do Tibia (M31-02) — puro, sem mexer no estado. `null` é "a
 * fila esgotou, pare de tiquetar": o chamador não reagenda, exatamente como o Canary faz quando
 * `damageList` (ou o `getNextDamage` do `periodDamage`) fica vazio. Sem `queue` (tique antigo,
 * infinito), devolve o MESMO tique — o comportamento de sempre, repetir até `expiresAtMs`.
 */
export function advanceTick(tick: NormalizedTick): { amount: number; intervalMs: number; queue?: readonly QueuedTick[] } | null {
  const queue = tick.queue;
  if (queue === undefined) return { amount: tick.amount, intervalMs: tick.intervalMs };
  if (queue.length === 0) return null;
  const [next, ...rest] = queue as [QueuedTick, ...QueuedTick[]];
  return { amount: next.amount, intervalMs: next.intervalMs, queue: rest };
}

/**
 * O estado de uma condição depois que seu AGENDAMENTO de tique termina — por exaustão da fila do
 * Tibia (`advanceTick` devolvendo `null`) ou porque o próximo tique cairia depois de
 * `expiresAtMs`. `nextTickAtMs` sai: não sobra evento de tique pendente para o #334 proteger.
 *
 * Quando o tique tem fila (`queue` presente), a força que falta também vai a zero: nenhum tique
 * a mais será entregue por esta condição, e `strengthOf` precisa refletir isso — senão a
 * política `strongest` protege uma condição já esgotada (com o `amount` do ÚLTIMO tique já
 * entregue) contra uma reaplicação real com dano de fato pendente (M31-02, #557). Um tique
 * PLANO (sem `queue`, o `amount` que nunca muda ao longo da vida da condição) fica como estava
 * — não há nada obsoleto para limpar nele.
 */
export function retiredTick(condition: ConditionState): ConditionState {
  const { nextTickAtMs: _nextTickAtMs, ...withoutTick } = condition;
  if (condition.tick?.queue === undefined) return withoutTick;
  return { ...withoutTick, tick: { ...condition.tick, amount: 0, queue: [] } };
}

/**
 * Duas condições tiquetam no MESMO ritmo? É o que decide se relançar pode reaproveitar o
 * evento de tique pendente. Sem isto, relançar na mesma cadência do tique cancelaria e
 * reagendaria o evento para sempre, e o DOT nunca aconteceria — a inanição que o CMB-07 mediu.
 */
export function sameTick(a: ConditionState, b: ConditionState): boolean {
  const ta = tickOf(a);
  const tb = tickOf(b);
  if (ta === null || tb === null) return ta === tb;
  return ta.intervalMs === tb.intervalMs && ta.kind === tb.kind;
}

/**
/**
 * A magnitude de uma condição, para a política `strongest`. Um DOT vale o dano TOTAL que falta
 * — o tique corrente mais a fila (M31-02, a mesma comparação de `ConditionDamage::
 * updateCondition` do Canary: `getTotalDamage()`, a soma do `damageList` inteiro, não só o
 * próximo elemento). Sem fila (tique antigo, infinito), é só o tique. Haste/paralyze valem o
 * quanto DESVIAM de 1× velocidade — em módulo, porque `speedPercent` tem SINAL (CMB-11, #556):
 * um paralyze severo (`-80`) precisa vencer um haste fraco (`+5`) na comparação de `strongest`.
 * Postura o que ela soma. Empate fica com o novo.
 */
function strengthOf(condition: ConditionState): number {
  const tick = condition.tick;
  if (tick !== undefined) {
    const remaining = tick.queue?.reduce((sum, queued) => sum + queued.amount, 0) ?? 0;
    return tick.amount + remaining;
  }
  if (condition.speedPercent !== undefined) return Math.abs(condition.speedPercent);
  if (condition.damageTakenPercent !== undefined) return Math.abs(condition.damageTakenPercent);
  const dealt = condition.damageDealtPercent;
  if (dealt !== undefined) {
    return Math.abs(dealt.melee ?? 0) + Math.abs(dealt.distance ?? 0) + Math.abs(dealt.spell ?? 0);
  }
  return 0;
}

/**
 * `generateDamageList` (a lista DECRESCENTE do Tibia) e `damageOverTimeTicks` (a expansão das
 * duas formas para a fila ordenada de tiques) moram em `@draconya/content`, não aqui — achado da
 * revisão do #557: `conditionSpecSchema` também precisa delas para conferir `durationMs` contra
 * o total que a própria fila soma, e `content` não pode importar de `sim`. Reimplementar aqui
 * criaria DUAS contas para o mesmo número (o defeito que a DT-03 já nomeia no `content`), então
 * este módulo importa as funções de lá em vez de as ter — `QueuedTick` e o
 * `DamageOverTimeTick` de `content` têm a MESMA forma (`{ amount, intervalMs }`), então o retorno
 * de `damageOverTimeTicks` continua compatível com todo código abaixo sem conversão. Reexportadas
 * aqui porque quem já importava as duas de `./conditions.js` (o `sim` era a única origem antes do
 * #557) não deveria precisar saber que a origem mudou.
 */
export { damageOverTimeTicks, generateDamageList };

/**
 * Compila um `ConditionSpec` do conteúdo para o estado de runtime (CMB-07). `nowMs` é o relógio
 * LÓGICO da sessão; o prazo é absoluto, como todo cooldown e condição daqui.
 *
 * `source` só entra no tique de dano — é o que decide de ONDE o DOT veio (magia, ability,
 * runa). Cura e leitura ignoram.
 */
/**
 * O contexto que só a condição `speed` (CMB-11, #556) precisa: a velocidade BASE do alvo no
 * instante da aplicação (`Creature::getBaseSpeed()` do Canary/TFS — o `mover.speed` de
 * `movement.ts`, antes de qualquer `speedScale`) e o `Rng` da sessão, para a mesma rolagem que
 * `ConditionSpeed::startCondition` faz. Nenhum outro efeito usa isto.
 */
export interface SpeedContext {
  readonly baseSpeed: number;
  readonly rng: Rng;
}

/**
 * Resolve o percentual de velocidade de um efeito `speed` (CMB-11, #556) reproduzindo
 * `ConditionSpeed` do CANARY (`src/creatures/combat/condition.cpp`) — a classe existe também no
 * TFS, mas o `−40` e o piso abaixo são mecanismo só do Canary; o TFS usa `baseSpeed` direto, sem
 * deslocamento nem piso (`monsters.cpp`). A precedência é a do ADR 0037 decisão 4.
 *
 * - `delta` (o `speedChange` do ATAQUE/DEFESA de monstro, em milésimos) vira a MESMA fórmula
 *   aleatória que o Canary deriva sozinho em `Monsters::deserializeSpell` — nunca menos que
 *   -1000 ("Cant be slower than 100%"), `multiplier = 1 + delta/1000`, `mina = multiplier/2`,
 *   `maxa = multiplier`, `minb = maxb = 40`.
 * - `formula` (a RUNA/MAGIA) é usada como está, copiada direto do `setFormula` do Lua.
 *
 * As duas convergem no MESMO cálculo: `difference = baseSpeed − 40`; `min`/`max` são LINEARES
 * nele e TRUNCADOS para inteiro — como o C++ trunca ao atribuir um `float` a `int32_t`, nunca
 * arredonda —; o resultado é sorteado INTEIRO e inclusivo no intervalo (`min === max` não
 * consome sorteio, como `uniform_random` do Canary não consome quando os limites coincidem).
 *
 * O piso (`speedDelta < 40 − baseSpeed`) é aplicado SEMPRE, não só quando `effect.type ===
 * 'paralyze'`: no Canary ele é condicionado ao `ConditionType_t`, mas aqui `type` é um campo de
 * CONTEÚDO — nada impede um `formula`/`delta` de sinal de paralyze rotulado por engano como
 * `haste` (o schema em `packages/content/src/schemas.ts` recusa a maioria desses casos, mas o
 * caso geral de `formula` não é sempre decidível estaticamente). Sem o piso incondicional, esse
 * erro de conteúdo produziria `speedDelta` arbitrariamente negativo e um `speedScale` NEGATIVO
 * (`1 + percent/100 < 0`), que `movement.ts` (`Math.max(1, mover.speed * speedScale)`) trata como
 * velocidade zero — o personagem congela em vez de só receber o rótulo errado. Aplicar sempre é
 * seguro: para `haste`/formulas legítimas o resultado nunca chega perto de `40 − baseSpeed`, e a
 * escala do nosso `speed` já é a do TFS (ADR 0037 decisão 4: Dragon 172, jogador 220), então "40"
 * é o valor real do Canary, não um número reescalado.
 */
export function resolveSpeedPercent(
  effect: Extract<ConditionEffect, { kind: 'speed' }>, baseSpeed: number, rng: Rng,
): number {
  let mina: number; let minb: number; let maxa: number; let maxb: number;
  if (effect.formula !== undefined) {
    ({ mina, minb, maxa, maxb } = effect.formula);
  } else {
    const speedChange = Math.max(-1000, effect.delta ?? 0);
    const multiplier = 1 + speedChange / 1000;
    mina = multiplier / 2; minb = 40; maxa = multiplier; maxb = 40;
  }
  const difference = baseSpeed - 40;
  let min = Math.trunc(mina * difference + minb);
  let max = Math.trunc(maxa * difference + maxb);
  if (min > max) { const swap = min; min = max; max = swap; }
  let speedDelta = (min === max ? min : rng.integer(min, max)) - baseSpeed;
  if (speedDelta < 40 - baseSpeed) speedDelta = 40 - baseSpeed;
  return baseSpeed === 0 ? 0 : (speedDelta / baseSpeed) * 100;
}

export function conditionFromSpec(
  spec: ConditionSpec,
  targetId: string,
  sourceId: string,
  nowMs: number,
  source: DamageSource,
  speed?: SpeedContext,
): ConditionState {
  const base = {
    key: spec.key,
    targetId,
    sourceId,
    expiresAtMs: nowMs + spec.durationMs,
    merge: spec.merge,
  } as const;
  const effect: ConditionEffect = spec.effect;
  switch (effect.kind) {
    case 'speed': {
      if (speed === undefined) {
        throw new Error(`condição speed "${spec.key}" precisa do contexto de velocidade (baseSpeed/rng)`);
      }
      return {
        ...base,
        speedPercent: resolveSpeedPercent(effect, speed.baseSpeed, speed.rng),
        ...(effect.damageDealtPercent === undefined ? {} : { damageDealtPercent: effect.damageDealtPercent }),
      };
    }
    case 'buff':
      return {
        ...base,
        ...(effect.damageDealtPercent === undefined ? {} : { damageDealtPercent: effect.damageDealtPercent }),
        ...(effect.damageTakenPercent === undefined ? {} : { damageTakenPercent: effect.damageTakenPercent }),
      };
    case 'mana-shield':
      return { ...base };
    case 'drunk':
      // Sem campo próprio (M31-03, #558): a chave RESERVADA (`DRUNK_CONDITION_KEY`, exigida pelo
      // schema) é o que `Conditions.hasDrunk` reconhece — o mesmo desenho de `hasManaShield`.
      return { ...base };
    case 'heal-over-time':
      return { ...base, tick: { kind: 'heal', amount: effect.amount, intervalMs: effect.intervalMs } };
    case 'damage-over-time': {
      // M31-02: a fila inteira sai pré-calculada AQUI, pura — o primeiro elemento é o tique
      // corrente, o resto é `queue`. Sempre >= 1 elemento (`damageOverTimeTicks`).
      const [first, ...rest] = damageOverTimeTicks(effect) as [QueuedTick, ...QueuedTick[]];
      return {
        ...base,
        tick: {
          kind: 'damage', amount: first.amount, intervalMs: first.intervalMs,
          damageType: effect.damageType, source, queue: rest,
        },
      };
    }
  }
}

/** O intervalo do PRIMEIRO tique de um `ConditionSpec`, para o campo agendar o próprio evento —
 * o campo (CMB-07) regenera a condição a cada pulso e nunca acompanha a fila (M31-02: um campo
 * com a forma `generated` sempre bate o valor de `startDamage`, nunca decresce; o Dragon Lord usa
 * `rounds` com valor constante, e por isso não diverge). */
export function specTickIntervalMs(spec: ConditionSpec): number | null {
  const effect = spec.effect;
  if (effect.kind === 'heal-over-time') return effect.intervalMs;
  if (effect.kind !== 'damage-over-time') return null;
  return effect.form === 'generated' ? effect.intervalMs : (effect.rounds[0]?.intervalMs ?? null);
}

export class Conditions {
  readonly #active = new Map<string, ConditionState>();

  static fromState(state: readonly ConditionState[] | undefined): Conditions {
    const conditions = new Conditions();
    if (state === undefined) return conditions;
    for (const condition of state) conditions.#active.set(condition.key, condition);
    return conditions;
  }

  getState(): readonly ConditionState[] {
    return [...this.#active.values()];
  }

  /**
   * Aplica seguindo a política `merge` e devolve o estado ANTERIOR. Quando `strongest` mantém o
   * anterior, o mapa não muda e o devolvido é ele mesmo — quem chama compara a identidade de
   * `get(key)` com o objeto aplicado para saber se precisa reagendar o evento.
   */
  apply(condition: ConditionState): ConditionState | null {
    const previous = this.#active.get(condition.key) ?? null;
    if (
      previous !== null
      && (condition.merge ?? 'refresh') === 'strongest'
      && strengthOf(previous) > strengthOf(condition)
    ) {
      return previous;
    }
    this.#active.set(condition.key, condition);
    return previous;
  }

  remove(key: string): ConditionState | null {
    const previous = this.#active.get(key) ?? null;
    this.#active.delete(key);
    return previous;
  }

  /** Substitui sem aplicar a política de fusão — usado para atualizar `nextTickAtMs`. */
  replace(condition: ConditionState): void {
    this.#active.set(condition.key, condition);
  }

  get(key: string): ConditionState | null {
    return this.#active.get(key) ?? null;
  }

  get size(): number {
    return this.#active.size;
  }

  /** `1 + Σ speedPercent/100` das condições de haste, ou 1. */
  speedScale(): number {
    let percent = 0;
    for (const condition of this.#active.values()) percent += condition.speedPercent ?? 0;
    return percent === 0 ? 1 : 1 + percent / 100;
  }

  /** O multiplicador de dano CAUSADO por fonte: haste (Swift Foot) e postura somam. */
  damageDealtScale(source: DamageScaleSource): number {
    let percent = 0;
    for (const condition of this.#active.values()) {
      percent += condition.damageDealtPercent?.[source] ?? 0;
    }
    return 1 + percent / 100;
  }

  /** O multiplicador de dano TOMADO. */
  damageTakenScale(): number {
    let percent = 0;
    for (const condition of this.#active.values()) percent += condition.damageTakenPercent ?? 0;
    return 1 + percent / 100;
  }

  hasManaShield(): boolean {
    return this.#active.has('mana-shield');
  }

  /** A condição `drunk` (M31-03, #558) está ativa? Reconhecida pela chave reservada, como
   * `hasManaShield` — nenhum campo do estado distingue as duas condições sem tique. */
  hasDrunk(): boolean {
    return this.#active.has('drunk');
  }
}

/**
 * As direções cardeais, na ORDEM do enum `Direction` do Canary/TFS (`game/movement/
 * position.hpp`: `NORTH = 0, EAST = 1, SOUTH = 2, WEST = 3`) — é essa ordem que
 * `rollDrunkDeviation` usa para transformar o sorteio no rótulo de direção.
 */
const DRUNK_CARDINALS: readonly Direction[] = ['north', 'east', 'south', 'west'];

/** O que um passo com drunk ativo decide (M31-03, #558). */
export interface DrunkDeviation {
  /**
   * A direção CARDEAL para onde o passo é desviado, ou `null` quando o sorteio não desvia nada
   * — inclusive o caso `r === 4` do Canary, que também não desvia (só fala).
   */
  readonly direction: Direction | null;
  /**
   * `r <= 4`: no Canary é quando a criatura fala "Hicks!" (`Creature::onWalk`). Devolvido para
   * quando o evento de fala de criatura existir no protocolo; hoje nada o consome (ver
   * `docs/product/combat.md`) — é presentação, não regra de hunt (ADR 0037 d.6).
   */
  readonly speak: boolean;
}

/**
 * O desvio de passo da condição `drunk` (M31-03, #558), reproduzindo `Creature::onWalk` do
 * Canary/TFS (`creatures/creature.cpp:291-301`): sorteia UM `r` com o `Rng` da sessão em [0, 60]
 * — 61 valores, `uniform_random(0, 60)` do Canary, inclusive nos dois extremos, como
 * `Rng.integer` já é. Só `r <= 4` (`DIRECTION_DIAGONAL_MASK`, `game/movement/position.hpp`) tem
 * qualquer efeito; dentro disso, só `r < 4` troca a direção — para a CARDEAL do PRÓPRIO `r`
 * (índice na ordem do enum do Canary, nunca relacionada à direção que o passo já ia tomar). O
 * caso `r === 4` representaria uma diagonal lá (`DIRECTION_SOUTHWEST`), que o Canary também NÃO
 * aplica (`r < DIRECTION_DIAGONAL_MASK` dá falso) — só fala; o Draconya não tem diagonal (ADR
 * 0009, passo sempre cardeal), então este caso nunca precisaria de tratamento especial mesmo se
 * o Canary trocasse a direção nele.
 *
 * Quem chama SÓ rola quando a criatura tem drunk (`Conditions.hasDrunk`) — uma criatura sem a
 * condição nunca consome este sorteio, a mesma regra do `chance` ausente de uma ability (CMB-06).
 */
export function rollDrunkDeviation(rng: Rng): DrunkDeviation {
  const r = rng.integer(0, 60);
  if (r > 4) return { direction: null, speak: false };
  return { direction: r < 4 ? (DRUNK_CARDINALS[r] as Direction) : null, speak: true };
}
