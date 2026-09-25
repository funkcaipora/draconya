// As cargas de bloqueio do `combat-v3` (#548, ADR 0040) — o `blockCount` do
// `Creature::blockHit` do Canary.
//
// O Canary guarda um contador que ganha +1 a cada 1000 ms de `onThink` até um teto de 2, e o
// estágio de DEFESA (não o de armadura — ver `blockhit.ts`) só reduz o golpe enquanto o contador
// tem carga. Isso é literalmente "por tick" (`creature.cpp`: `blockTicks += interval; if
// (blockTicks >= 1000) { blockCount = min(blockCount+1, 2); blockTicks = 0; }`), e o invariante 2
// proíbe escrever assim aqui — nada soma por tick, tudo é calculado SOB DEMANDA a partir de um
// valor guardado e do instante do último evento (a mesma disciplina de `stamina.ts`).
//
// O modelo escolhido é equivalente em efeito, não literal: DUAS "vagas" independentes, cada uma
// um instante absoluto em que volta a ficar pronta. Uma vaga pronta (instante ≤ agora) é uma
// carga disponível; consumi-la marca a PRÓPRIA vaga como pronta de novo só 1000 ms depois DESTE
// consumo — não numa fase compartilhada por um relógio de "tick" que roda independente de uso.
// A diferença entre os dois modelos só aparece num padrão de uso adversarial (bloquear em
// instantes cuidadosamente espaçados para "roubar" uma carga extra do relógio compartilhado); ela
// não muda a propriedade que o `Creature::blockHit` documenta e que os vetores do #548 medem: no
// máximo DUAS cargas disponíveis a qualquer instante, cada uma levando 1000 ms para voltar depois
// de gasta.
//
// `FULL_BLOCK_CHARGE` (as duas vagas prontas desde o instante 0) é o estado AUSENTE do snapshot:
// um personagem ou monstro que nunca bloqueou — ou um snapshot gravado antes desta issue — entra
// com as duas cargas já disponíveis. Isso reproduz o caso comum do Canary (uma criatura já existe
// há muito mais que 2000 ms antes do primeiro golpe de uma hunt, então o contador dela já está no
// teto quando o combate começa) sem precisar guardar o instante de criação de cada defensor.

/** Os dois instantes (lógicos, ms) em que cada vaga de bloqueio volta a ficar pronta. */
export type BlockChargeState = readonly [number, number];

/** As duas cargas já disponíveis desde o instante 0 — o estado de quem nunca bloqueou. */
export const FULL_BLOCK_CHARGE: BlockChargeState = [0, 0];

/** Quanto tempo uma vaga gasta leva para voltar a ficar pronta, depois do consumo. */
const BLOCK_CHARGE_REFILL_MS = 1_000;

/** O teto de cargas simultâneas — o `min(blockCount + 1, 2)` do Canary. */
export const MAX_BLOCK_CHARGES = 2;

/** Quantas cargas estão disponíveis agora. Pura: não escreve nada, só lê o estado guardado. */
export function availableBlockCharges(state: BlockChargeState, nowMs: number): number {
  return state.reduce((count, readyAtMs) => count + (readyAtMs <= nowMs ? 1 : 0), 0);
}

/** O resultado de consumir uma carga: o estado NOVO (a devolver a quem escreve) e se havia carga. */
export interface BlockChargeConsumption {
  readonly state: BlockChargeState;
  readonly hadCharge: boolean;
}

/**
 * Consome uma carga, se houver. Pura a menos de nada — sem RNG, sem tempo de parede: só aranha e
 * devolve o estado NOVO, que é quem chama (a etapa que escreve recurso, `applyDamageOutcome`)
 * quem grava de volta no personagem ou monstro dono (invariante 9).
 *
 * Sem carga disponível, o estado devolvido é o MESMO objeto recebido — nada a escrever.
 */
export function consumeBlockCharge(state: BlockChargeState, nowMs: number): BlockChargeConsumption {
  const index = state.findIndex((readyAtMs) => readyAtMs <= nowMs);
  if (index < 0) return { state, hadCharge: false };
  const next: [number, number] = [state[0] as number, state[1] as number];
  next[index] = nowMs + BLOCK_CHARGE_REFILL_MS;
  return { state: next, hadCharge: true };
}
