// Golden traces de combate (M24-01, #469; ADRs 0019, 0020 e 0031).
//
// Uma fixture é uma CENA determinística: semente fixa, plano de avanço em tempo lógico e uma
// lista de eventos escritos à mão que a cena tem de reproduzir. É o oráculo do CMB-10 levado
// ao combate inteiro — a matriz de `combat/conformance.test.ts` prende fórmula e ordem de RNG;
// aqui prende-se a ORDEM DE EMISSÃO dos eventos, que uma média de dano não vê (DT-01 da #469).
//
// O que estes tipos NÃO são: snapshot da implementação. O esperado é dado legível, revisável
// contra a referência do Canary/OTClient, e é a diferença entre os dois que o teste reporta.
// Onde a referência ainda não foi implementada (área de 37 tiles, fórmula de runa, protocolo
// de alvo), o trace carrega um `gap`: o fato de referência, o comportamento atual e a issue
// que fecha a lacuna. O trace vira o contrato daquela issue.
//
// Puro (invariante 1): nada aqui lê I/O, relógio de processo ou framework. `DomainEvent` é o
// vocabulário que a sessão já produz sem visualizador nenhum (invariante 3).

import type { DomainEvent } from '../../session.js';

/**
 * O vocabulário de um trace de combate. É o recorte de APRESENTAÇÃO do `DomainEvent`: o host
 * traduz `spell-cast`/`supply-used`/`monster-ability-cast`/`shot` em efeito e projétil, e é
 * essa tradução que o OTClient v8 usa como referência de ordem (M24-10, #479).
 */
export type CombatTraceEventKind =
  | 'creature-hit'
  | 'creature-healed'
  | 'creature-health'
  | 'spell-cast'
  | 'supply-used'
  | 'monster-ability-cast'
  | 'shot'
  /** O protocolo de alvo ainda não existe (#470): a referência está em `targeting.trace.ts`. */
  | 'target-changed';

/**
 * Um evento do trace: QUANDO (relógio lógico), O QUÊ e os campos que a referência fixa.
 *
 * `payload` é deliberadamente frouxo: cada `kind` tem o seu contrato, e um tipo discriminado
 * por evento obrigaria a manter, no oráculo, a mesma forma da implementação — exatamente o
 * acoplamento que a DT-01 da #469 recusa.
 */
export interface CombatTraceEvent {
  readonly atMs: number;
  readonly kind: CombatTraceEventKind;
  /** Quem produziu o fato: id do alvo, na convenção `m:<id>` para monstro. */
  readonly subject: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type CombatTraceReferenceSource = 'canary' | 'otclient' | 'tibiawiki' | 'draconya';

/** De onde o valor esperado veio, para a revisão conseguir conferir sem abrir o código. */
export interface CombatTraceReference {
  readonly source: CombatTraceReferenceSource;
  readonly sections: readonly string[];
  readonly note: string;
}

/**
 * Uma lacuna nomeada entre a referência e o que o motor entrega hoje. `task` é a issue do M24
 * que fecha a lacuna — e que deve atualizar este trace, porque o trace é o contrato dela.
 */
export interface CombatTraceGap {
  readonly id: string;
  readonly reference: string;
  readonly current: string;
  readonly task: string;
}

/** Uma cena determinística, com o oráculo e o observado. */
export interface CombatGoldenTrace {
  readonly id: string;
  readonly description: string;
  readonly reference: CombatTraceReference;
  readonly seed: string;
  readonly advancePlanMs: readonly number[];
  readonly expected: readonly CombatTraceEvent[];
  readonly gaps: readonly CombatTraceGap[];
  /** Roda a cena do zero e devolve o que o motor emitiu, na ordem em que emitiu. */
  readonly run: () => readonly CombatTraceEvent[];
}

const COMBAT_KINDS: ReadonlySet<string> = new Set([
  'creature-hit', 'creature-healed', 'creature-health-changed',
  'spell-cast', 'supply-used', 'monster-ability-cast', 'shot',
]);

/**
 * Projeta um `DomainEvent` no vocabulário do trace. Devolve `null` para o que não é combate —
 * movimento, presença, party e equipamento têm os próprios contratos.
 *
 * `atMs` entra por fora porque o `DomainEvent` é o fato, não o instante: quem drena conhece o
 * relógio lógico, e é ele que carimba.
 */
export function combatTraceEventOf(atMs: number, event: DomainEvent): CombatTraceEvent | null {
  if (!COMBAT_KINDS.has(event.kind)) return null;
  switch (event.kind) {
    case 'creature-hit':
      return {
        atMs, kind: 'creature-hit', subject: String(event.creatureId),
        payload: {
          creatureId: event.creatureId, attackerId: event.attackerId,
          amount: event.amount, source: event.source, position: event.position,
        },
      };
    case 'creature-healed':
      return {
        atMs, kind: 'creature-healed', subject: String(event.creatureId),
        payload: { creatureId: event.creatureId, amount: event.amount, source: event.source },
      };
    case 'creature-health-changed':
      return {
        atMs, kind: 'creature-health', subject: String(event.creatureId),
        payload: {
          creatureId: event.creatureId, health: event.health, maxHealth: event.maxHealth,
        },
      };
    case 'spell-cast':
      return {
        atMs, kind: 'spell-cast', subject: String(event.casterId),
        payload: {
          casterId: event.casterId, spellId: event.spellId,
          targets: event.targets.map((target) => target.creatureId),
          tileCount: event.tiles.length,
        },
      };
    case 'supply-used':
      return {
        atMs, kind: 'supply-used', subject: String(event.characterId),
        payload: {
          characterId: event.characterId, supplyId: event.supplyId,
          targets: event.targets.map((target) => target.creatureId),
          tileCount: event.tiles.length,
        },
      };
    case 'monster-ability-cast':
      return {
        atMs, kind: 'monster-ability-cast', subject: String(event.casterId),
        payload: {
          casterId: event.casterId, abilityId: event.abilityId,
          targets: event.targets.map((target) => target.creatureId),
          tileCount: event.tiles.length,
          missileKey: event.missileKey ?? null, impactKey: event.impactKey ?? null,
        },
      };
    case 'shot':
      return {
        atMs, kind: 'shot', subject: String(event.attackerId),
        payload: {
          attackerId: event.attackerId, targetId: event.targetId,
          weaponItemId: event.weaponItemId, ammoId: event.ammoId ?? null,
        },
      };
    default:
      return null;
  }
}