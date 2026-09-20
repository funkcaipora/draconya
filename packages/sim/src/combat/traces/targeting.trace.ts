// Trace de alvo (RF-01 da #469; protocolo fechado na #470).
//
// A referência é o Canary/OTClient: escolher alvo, cancelar (toggle), re-selecionar, perder o
// alvo quando ele morre ou sai de cena, e MANTER o alvo quando ele está fora do alcance
// melee mas dentro do alcance da magia/runa.
//
// O protocolo de alvo que faltava na #469 chegou com a #470: `select-target` aceita
// `creatureId: 0` como cancelamento, e o servidor confirma com `target-changed` ou recusa com
// `target-cancel` — mensagens dedicadas, fora do `player-stats`. Aqui o oráculo continua sendo
// de ESTADO, porque este pacote é PURO (invariante 1): ele prende a escolha e a apresentação,
// não o fio. O contrato do fio mora em `packages/protocol/src/messages.ts` e o round-trip em
// `packages/server/src/game/host.test.ts`.
//
// A última caso prende o coração do requisito: a arma não "limpa" o alvo, ela só não o
// alcança — quem decide se o alvo é visto é o raio da busca, e um raio maior (magia/runa)
// continua enxergando. É a mesma separação que `selectedTargetOf`/`attackTargetOf` fazem na
// `HuntRuleset` (`hunt.test.ts`).

import type { BotTargeting } from '@draconya/content';
import { compileTargeting, countTargets, selectTarget } from '../../targeting.js';
import type { TargetLike } from '../../targeting.js';

/** Um candidato do oráculo: o mínimo que a escolha precisa saber. */
export interface TraceTarget extends TargetLike {
  /** O rótulo humano do candidato, para o relatório do teste. */
  readonly label: string;
}

export interface TargetingOracleCase {
  readonly id: string;
  readonly description: string;
  readonly targeting: BotTargeting;
  readonly from: { readonly x: number; readonly y: number };
  readonly maxDistance: number;
  readonly monsters: readonly TraceTarget[];
  /** O `label` do escolhido, ou `null`. Escrito à mão. */
  readonly expected: string | null;
}

const target = (
  id: string, monsterId: string, x: number, y: number, health = 100,
): TraceTarget => ({ label: id, monsterId, position: { x, y }, health, alive: true });

const nearest: BotTargeting = { policy: 'nearest', prioritize: [], ignore: [], posture: { kind: 'stand' } };

export const TARGETING_ORACLE: readonly TargetingOracleCase[] = [
  {
    id: 'nearest-wins',
    description: 'A política padrão escolhe o mais próximo dentro do raio',
    targeting: nearest,
    from: { x: 0, y: 0 }, maxDistance: 4,
    monsters: [target('far', 'orc', 4, 0), target('near', 'orc', 2, 0)],
    expected: 'near',
  },
  {
    id: 'tie-keeps-birth-order',
    description: 'Empate mantém o campeão: a comparação é estrita, e a ordem é a de nascimento',
    targeting: nearest,
    from: { x: 0, y: 0 }, maxDistance: 4,
    monsters: [target('first', 'orc', 2, 0), target('second', 'orc', 0, 2)],
    expected: 'first',
  },
  {
    id: 'prioritized-beats-nearer',
    description: 'Priorizado ganha ANTES da política, mesmo mais longe',
    targeting: { ...nearest, prioritize: ['mage'] },
    from: { x: 0, y: 0 }, maxDistance: 8,
    monsters: [target('rat', 'rat', 1, 0), target('mage', 'mage', 5, 0)],
    expected: 'mage',
  },
  {
    id: 'ignored-is-skipped',
    description: 'Ignorado não é escolhido nem contado',
    targeting: { ...nearest, ignore: ['rat'] },
    from: { x: 0, y: 0 }, maxDistance: 8,
    monsters: [target('rat', 'rat', 1, 0), target('orc', 'orc', 3, 0)],
    expected: 'orc',
  },
  {
    id: 'weapon-range-out-of-melee',
    description: 'Fora do alcance melee a escolha é vazia PARA A ARMA',
    targeting: nearest,
    from: { x: 0, y: 0 }, maxDistance: 1,
    monsters: [target('orc', 'orc', 3, 0)],
    expected: null,
  },
  {
    id: 'spell-range-still-sees',
    description: 'O MESMO alvo é visto por um raio maior (magia/runa): a arma não o apaga',
    targeting: nearest,
    from: { x: 0, y: 0 }, maxDistance: 4,
    monsters: [target('orc', 'orc', 3, 0)],
    expected: 'orc',
  },
];

/** O escolhido de um caso, como o teste e a revisão o leem. */
export function chooseOracleTarget(case_: TargetingOracleCase): string | null {
  const chosen = selectTarget(
    compileTargeting(case_.targeting), case_.monsters, case_.from, case_.maxDistance,
  );
  return chosen?.label ?? null;
}

/** Quantos alvos válidos dentro do raio, ignorados de fora. */
export function countOracleTargets(case_: TargetingOracleCase): number {
  return countTargets(
    compileTargeting(case_.targeting), case_.monsters, case_.from, case_.maxDistance,
  );
}