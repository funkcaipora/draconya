// O familiar de vocação (M38-02, #599, ADR 0057 d.3; Canary `Player:CreateFamiliarSpell`,
// `data/libs/functions/player.lua`, e `data/scripts/creaturescripts/familiar/*.lua`).
//
// O familiar em si é uma invocação da SESSÃO (um `MonsterRuntime` com `masterId` de personagem,
// #598) — o que o personagem carrega de uma hunt para outra são só dois INSTANTES, ambos de
// relógio de PAREDE (epoch em milissegundos), como o Canary os guarda:
//
//   - `summonUntilMs` é o `familiar-summon-time` do Canary (`self:kv():set("familiar-summon-time",
//     os.time() + timeLeft)`): até quando a invocação vale. O `familiarOnLogin` recria o familiar
//     com o tempo que sobra, e o `FamiliarDeath` o zera (`os.time()`) quando ele morre — é o que
//     impede a recriação. O Draconya recria ao ENTRAR NA HUNT (`HuntRuleset#onEnter`), que é o
//     login dele: a Cidade não simula nada e não tem invocação (ADR 0057 d.3);
//   - `cooldownUntilMs` é a `CONDITION_SPELLCOOLDOWN` que `CreateFamiliarSpell` arma com `ticks =
//     2 × duração`, contada do LANÇAMENTO. Persistente e não removível na morte
//     (`Condition::isRemovableOnDeath`), então sobrevive à saída da hunt e à morte do personagem.
//
// **Por que instante de parede, e não o `Cooldowns` da sessão.** O `Cooldowns` guarda instante
// LÓGICO da sessão que o gravou, e o relógio lógico nasce em zero a cada sessão: um cooldown de 30
// min gravado na hunt A seria lido na hunt B como "daqui a 30 min de B" — ou, pior, como "daqui a
// quatro horas" se A durou uma. O carimbo de parede atravessa a sessão porque não pertence a
// nenhuma (ADR 0052 d.6). O `sim` não lê relógio nenhum (invariante 1): o instante de agora é
// `Session.createdAtMs + Session.nowMs`, os dois já dados pelo servidor na criação da sessão — e,
// na retomada de um snapshot, com o intervalo descartado (ADR 0018) somado ao `createdAtMs` pelo
// hospedeiro, para a soma continuar sendo "agora". Os carimbos que o `sim` GRAVA são sempre
// inteiros (o relógio lógico do hospedeiro é fracionário, e `isFamiliarState` recusa o resto).
//
// **Divergência registrada.** No Canary o tempo do cooldown só corre com o jogador ONLINE (a
// condição é gravada com os `ticks` restantes), e o Draconya o conta em relógio de parede também
// enquanto ele está na Cidade — a decisão do ADR 0052 d.6/0057 d.3, que é anterior a esta issue.
// Dentro da hunt os dois coincidem; ver `docs/product/combat.md`.

import type { Rng } from './rng.js';

/** Versão do registro (ADR 0052 d.1, como `botConfig.version`) — migra sem coluna nova. */
export const FAMILIAR_STATE_VERSION = 1;

/**
 * O que o personagem carrega do familiar entre hunts. Instantes de relógio de PAREDE; `0` é
 * "nenhum" (o personagem que nunca invocou, e o `FamiliarDeath` que zera a recriação).
 */
export interface FamiliarState {
  readonly version: number;
  /** Até quando a invocação vale (`familiar-summon-time`). Passado, nada a recriar. */
  readonly summonUntilMs: number;
  /** Até quando a magia não sai de novo (`CONDITION_SPELLCOOLDOWN` do familiar). */
  readonly cooldownUntilMs: number;
}

export const EMPTY_FAMILIAR_STATE: FamiliarState = {
  version: FAMILIAR_STATE_VERSION, summonUntilMs: 0, cooldownUntilMs: 0,
};

/** O registro é o vazio? Snapshot e extrato o omitem — a mesma degradação de `fedMs`/`charms`. */
export function isEmptyFamiliarState(state: FamiliarState): boolean {
  return state.summonUntilMs === 0 && state.cooldownUntilMs === 0;
}

/** Valida o que veio de fora (ticket, extrato, banco): forma, não conteúdo. */
export function isFamiliarState(value: unknown): value is FamiliarState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const instant = (field: unknown): boolean =>
    typeof field === 'number' && Number.isSafeInteger(field) && field >= 0;
  return typeof state['version'] === 'number' && Number.isInteger(state['version'])
    && instant(state['summonUntilMs']) && instant(state['cooldownUntilMs']);
}

/**
 * A distância a partir da qual o familiar é teleportado ao mestre (`Creature::checkSummonMove`,
 * `creature.cpp`): mais de 15 tiles em x ou em y, OU outro andar (`getDistanceZ > 0`). Quem passa
 * disso de longe é o familiar; a invocação comum some só além de 30 tiles / 2 andares, e o
 * familiar nunca.
 */
export const FAMILIAR_TELEPORT_DISTANCE = 15;

/**
 * As posições onde o familiar pode nascer em volta do mestre — a `extendedRelList` de
 * `Map::placeCreature` (o Canary chama `Game.createMonster(name, pos, extended = true, …)`): os
 * quatro tiles do norte primeiro ({0,−2}, {−1,−1}, {0,−1}, {1,−1}) e os outros oito depois. O Canary
 * embaralha os dois grupos por separado (`std::random_device`) e fica com o primeiro que serve — é
 * por isso que, com o norte livre, o familiar sempre nasce ao norte do mestre. Números do
 * mecanismo, nunca a tabela copiada (ADR 0019).
 */
const FAMILIAR_NORTH_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -2], [-1, -1], [0, -1], [1, -1],
];
const FAMILIAR_OTHER_OFFSETS: readonly (readonly [number, number])[] = [
  [-2, 0], [-1, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2],
];

/** Fisher-Yates completo, como o `std::uniform_int_distribution` do Canary: `size − 1` sorteios. */
function shuffled<T>(items: readonly T[], rng: Pick<Rng, 'integer'>): T[] {
  const order = items.slice();
  for (let i = order.length - 1; i > 0; i -= 1) {
    const pick = rng.integer(0, i);
    const chosen = order[pick] as T;
    order[pick] = order[i] as T;
    order[i] = chosen;
  }
  return order;
}

/**
 * A ordem de tentativa dos doze tiles: o grupo do norte embaralhado, depois o resto embaralhado.
 * Sempre consome os mesmos 10 sorteios (3 + 7), ache ou não um tile livre — como o Canary embaralha
 * antes de olhar qualquer tile.
 */
export function familiarTileOrder(rng: Pick<Rng, 'integer'>): readonly (readonly [number, number])[] {
  return [...shuffled(FAMILIAR_NORTH_OFFSETS, rng), ...shuffled(FAMILIAR_OTHER_OFFSETS, rng)];
}
