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

import type { ConditionEffect, ConditionSpec, DamageOverTimeEffect } from '@draconya/content';
import type { DamageType } from '@draconya/content';
import type { DamageSource } from './combat/damage.js';

export type ConditionKind = 'haste' | 'buff' | 'mana-shield' | 'heal-over-time' | 'damage-over-time';

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
 * A magnitude de uma condição, para a política `strongest`. Um DOT vale o dano TOTAL que falta
 * — o tique corrente mais a fila (M31-02, a mesma comparação de `ConditionDamage::
 * updateCondition` do Canary: `getTotalDamage()`, a soma do `damageList` inteiro, não só o
 * próximo elemento). Sem fila (tique antigo, infinito), é só o tique — a simplicidade de sempre,
 * porque não há total finito a somar. Haste vale o percentual, postura o que ela soma. Empate
 * fica com o novo.
 */
function strengthOf(condition: ConditionState): number {
  const tick = condition.tick;
  if (tick !== undefined) {
    const remaining = tick.queue?.reduce((sum, queued) => sum + queued.amount, 0) ?? 0;
    return tick.amount + remaining;
  }
  if (condition.speedPercent !== undefined) return condition.speedPercent;
  if (condition.damageTakenPercent !== undefined) return Math.abs(condition.damageTakenPercent);
  const dealt = condition.damageDealtPercent;
  if (dealt !== undefined) {
    return Math.abs(dealt.melee ?? 0) + Math.abs(dealt.distance ?? 0) + Math.abs(dealt.spell ?? 0);
  }
  return 0;
}

/**
 * A lista DECRESCENTE do Tibia (M31-02): o mecanismo de `ConditionDamage::generateDamageList`
 * do Canary (`src/creatures/combat/condition.cpp:2143-2160`), reescrito em TypeScript a partir do
 * comportamento descrito — nunca copiado (ADR 0019). Soma até `totalDamage`, começando em
 * `startDamage` e descendo até 1: para cada "banda" `n` (de 1 até `startDamage`), a média-alvo é
 * `n × totalDamage / startDamage`, e o valor da banda (`startDamage + 1 − n`) é repetido enquanto
 * isso aproxima a soma acumulada dessa média — pelo menos uma vez. `startDamage` maior que
 * `totalDamage` divide por um número maior que o total (o Canary clampa antes de chamar); o
 * schema já recusa essa combinação, então aqui é só a matemática.
 *
 * Exemplo (poison field do Canary, `items.xml` id 2121, `start=5 damage=100`):
 * `[5,5,5,5,4,4,4,4,4,3,3,3,3,3,3,3,2,2,2,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]`
 * — soma exata 100, `conditions.test.ts` prende esse vetor calculado à mão.
 */
export function generateDamageList(totalDamage: number, startDamage: number): readonly number[] {
  const amount = Math.abs(totalDamage);
  const start = Math.abs(startDamage);
  const list: number[] = [];
  let sum = 0;
  for (let i = start; i > 0; i -= 1) {
    const band = start + 1 - i;
    const target = Math.trunc((band * amount) / start);
    let closerWithOneMore: boolean;
    do {
      sum += i;
      list.push(i);
      const ifOneMore = Math.abs(1 - (sum + i) / target);
      const asIs = Math.abs(1 - sum / target);
      closerWithOneMore = ifOneMore < asIs;
    } while (closerWithOneMore);
  }
  return list;
}

/** O `startDamage` default do Canary quando o conteúdo o omite: `max(1, ceil(totalDamage/20))`. */
function defaultStartDamage(totalDamage: number): number {
  return Math.max(1, Math.ceil(totalDamage / 20));
}

/**
 * Expande um `DamageOverTimeEffect` (as duas formas do Tibia) para a fila ORDENADA de tiques que
 * o `sim` consome — puro, sem I/O, a mesma lista para a mesma entrada (invariante 1). A forma
 * `generated` vira UMA lista decrescente, cada elemento com o `intervalMs` declarado; `rounds`
 * concatena os grupos na ordem em que aparecem. Sempre pelo menos um elemento — o schema exige
 * `totalDamage`/`count` positivos.
 */
export function damageOverTimeTicks(effect: DamageOverTimeEffect): readonly QueuedTick[] {
  if (effect.form === 'generated') {
    const start = Math.min(effect.startDamage ?? defaultStartDamage(effect.totalDamage), effect.totalDamage);
    return generateDamageList(effect.totalDamage, start)
      .map((amount) => ({ amount, intervalMs: effect.intervalMs }));
  }
  return effect.rounds.flatMap((round) => Array.from(
    { length: round.count }, () => ({ amount: round.damage, intervalMs: round.intervalMs }),
  ));
}

/**
 * Compila um `ConditionSpec` do conteúdo para o estado de runtime (CMB-07). `nowMs` é o relógio
 * LÓGICO da sessão; o prazo é absoluto, como todo cooldown e condição daqui.
 *
 * `source` só entra no tique de dano — é o que decide de ONDE o DOT veio (magia, ability,
 * runa). Cura e leitura ignoram.
 */
export function conditionFromSpec(
  spec: ConditionSpec,
  targetId: string,
  sourceId: string,
  nowMs: number,
  source: DamageSource,
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
    case 'haste':
      return {
        ...base,
        speedPercent: effect.speedPercent,
        ...(effect.damageDealtPercent === undefined ? {} : { damageDealtPercent: effect.damageDealtPercent }),
      };
    case 'buff':
      return {
        ...base,
        ...(effect.damageDealtPercent === undefined ? {} : { damageDealtPercent: effect.damageDealtPercent }),
        ...(effect.damageTakenPercent === undefined ? {} : { damageTakenPercent: effect.damageTakenPercent }),
      };
    case 'mana-shield':
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
}
