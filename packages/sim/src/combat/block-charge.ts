// As cargas de bloqueio do `combat-v3` (#548, ADR 0040) — o `blockCount` do
// `Creature::blockHit` do Canary.
//
// O Canary guarda um contador ÚNICO, compartilhado pelas duas "vagas" possíveis, que ganha +1 a
// cada 1000 ms de `onThink` até um teto de 2 (`creature.cpp`: `blockTicks += interval; if
// (blockTicks >= 1000) { blockCount = min(blockCount+1, 2); blockTicks = 0; }`) — e esse relógio
// roda INDEPENDENTE de bloqueio nenhum ter acontecido: `Creature::blockHit` (`creature.cpp:944`)
// só decrementa `blockCount`, nunca toca `blockTicks` nem reinicia o relógio. Isso é literalmente
// "por tick", e o invariante 2 proíbe escrever assim aqui — nada soma por tick, tudo é calculado
// SOB DEMANDA a partir de um valor guardado e do instante do último evento (a mesma disciplina de
// `stamina.ts`, que já resolve um problema formalmente idêntico para um recurso contínuo).
//
// A primeira versão deste arquivo (revisão da #548, PR #642) modelava DUAS vagas INDEPENDENTES,
// cada uma reagendando o PRÓPRIO relógio a partir do instante do PRÓPRIO consumo. Isso é um
// mecanismo diferente do Canary, não uma reescrita equivalente: o Canary tem um relógio
// COMPARTILHADO que nunca se importa com quando cada carga foi gasta, então duas cargas gastas em
// instantes próximos (um padrão comum de combate — dois atacantes, ou um personagem e uma
// ability de monstro quase juntos) podem voltar no MESMO instante do relógio compartilhado, mais
// cedo do que qualquer um dos dois consumos "individualmente" devolveria — e um golpe que o
// Canary ainda bloquearia (o relógio compartilhado já recarregou) o modelo de duas vagas
// independentes recusava (nenhuma das duas tinha completado os próprios 1000 ms ainda). A
// diferença NÃO é limitada a um padrão adversarial de RNG — aparece em combate comum com mais de
// um atacante — por isso a correção: ver `docs/adr/0040-combat-v3-canary-block-hit-pipeline.md`.
//
// O modelo agora é um banco de cargas (o mesmo desenho de `stamina.ts`, discretizado em passos de
// 1000 ms em vez de uma taxa contínua): guarda-se quantas cargas já estão CREDITADAS e o instante
// a partir do qual o relógio ainda não creditou nada — a leitura calcula quantos períodos de
// 1000 ms terminaram desde ali e credita cada um, até o teto. Consumir uma carga só desconta do
// banco; o relógio NUNCA reinicia por causa de um consumo — exatamente a propriedade do
// `blockTicks` do Canary, que continua contando (e "gira em falso" quando o banco já está no
// teto) independente de quantas vagas alguém gastou nesse meio-tempo.
//
// `FULL_BLOCK_CHARGE` (o banco já no teto desde o instante 0) é o estado AUSENTE do snapshot: um
// personagem ou monstro que nunca bloqueou — ou um snapshot gravado antes desta issue — entra com
// as duas cargas já disponíveis. Isso reproduz o caso comum do Canary (uma criatura já existe há
// muito mais que 2000 ms antes do primeiro golpe de uma hunt, então o contador dela já está no
// teto quando o combate começa) sem precisar guardar o instante de criação de cada defensor — uma
// simplificação deliberada e documentada, não um efeito colateral do modelo: ela NÃO reproduz o
// primeiro ~2 s de vida de uma criatura recém-spawnada do Canary (que nasce em `blockCount = 0` e
// sobe até o teto), e journal de produto nenhum pediu essa janela de vulnerabilidade ainda.

/** Quantas cargas estão banco, e desde quando o relógio ainda não creditou nenhuma nova. */
export interface BlockChargeState {
  /** Cargas já creditadas e não gastas, sempre em `[0, MAX_BLOCK_CHARGES]`. */
  readonly charges: number;
  /** O instante (lógico, ms) a partir do qual o próximo crédito de 1000 ms ainda não contou. */
  readonly anchorMs: number;
}

/** O teto de cargas simultâneas — o `min(blockCount + 1, 2)` do Canary. */
export const MAX_BLOCK_CHARGES = 2;

/** Quanto tempo o relógio compartilhado leva para creditar UMA carga nova, até o teto. */
const BLOCK_CHARGE_REFILL_MS = 1_000;

/** O banco já no teto desde o instante 0 — o estado de quem nunca bloqueou. */
export const FULL_BLOCK_CHARGE: BlockChargeState = { charges: MAX_BLOCK_CHARGES, anchorMs: 0 };

/**
 * `true` quando o estado é BIT A BIT o default (`FULL_BLOCK_CHARGE`) — o que `character.ts` e
 * `monster.ts` usam para OMITIR o campo do snapshot (o construtor já repõe o default sozinho na
 * ausência). Comparação exata, não "equivalente em efeito": um banco no teto com o relógio
 * deslocado (`anchorMs` diferente de 0) carrega fase que reconstruir do default perderia.
 */
export function isFullBlockCharge(state: BlockChargeState): boolean {
  return state.charges === FULL_BLOCK_CHARGE.charges && state.anchorMs === FULL_BLOCK_CHARGE.anchorMs;
}

/**
 * Dobra os períodos de 1000 ms já COMPLETOS desde `anchorMs` para dentro do banco, sem nunca
 * ultrapassar o teto — o `blockTicks >= 1000` do Canary, calculado sob demanda em vez de somado a
 * cada `onThink`. Devolve o MESMO objeto quando nenhum período terminou ainda, para quem chama
 * poder detectar "nada mudou" por igualdade de referência (a mesma convenção que a versão
 * anterior deste arquivo já usava).
 */
function credit(state: BlockChargeState, nowMs: number): BlockChargeState {
  const elapsedMs = nowMs - state.anchorMs;
  if (elapsedMs < BLOCK_CHARGE_REFILL_MS) return state;
  const periods = Math.floor(elapsedMs / BLOCK_CHARGE_REFILL_MS);
  return {
    charges: Math.min(MAX_BLOCK_CHARGES, state.charges + periods),
    // O relógio avança pelos períodos INTEIROS que já creditou, mesmo quando o banco já estava
    // no teto — a fase nunca reinicia por causa do teto, a mesma coisa que o `blockTicks` do
    // Canary faz ao resetar para 0 todo período, esteja `blockCount` no teto ou não.
    anchorMs: state.anchorMs + periods * BLOCK_CHARGE_REFILL_MS,
  };
}

/** Quantas cargas estão disponíveis agora. Pura: não escreve nada, só lê o estado guardado. */
export function availableBlockCharges(state: BlockChargeState, nowMs: number): number {
  return credit(state, nowMs).charges;
}

/** O resultado de consumir uma carga: o estado NOVO (a devolver a quem escreve) e se havia carga. */
export interface BlockChargeConsumption {
  readonly state: BlockChargeState;
  readonly hadCharge: boolean;
}

/**
 * Consome uma carga, se houver. Pura a menos de nada — sem RNG, sem tempo de parede: só credita o
 * que o relógio já rendeu e devolve o estado NOVO, que é quem chama (a etapa que escreve recurso,
 * `applyDamageOutcome`) quem grava de volta no personagem ou monstro dono (invariante 9).
 *
 * Sem carga disponível, o estado devolvido é o MESMO objeto recebido — nada a escrever.
 */
export function consumeBlockCharge(state: BlockChargeState, nowMs: number): BlockChargeConsumption {
  const credited = credit(state, nowMs);
  if (credited.charges <= 0) return { state, hadCharge: false };
  return { state: { charges: credited.charges - 1, anchorMs: credited.anchorMs }, hadCharge: true };
}
