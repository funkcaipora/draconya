// A definição ÚNICA de "em combate" para todo o endgame (#625): último ataque DADO ou
// RECEBIDO há no máximo `IN_FIGHT_WINDOW_MS` — o `pzLocked` do Canary (config.lua.dist:36,
// `CONDITION_INFIGHT`), 60 000 ms. É esta função, e só ela, que a trava de saída da hunt
// (`rulesets/hunt.ts`, `#finishExit`) e o decaimento de imbuement fora de combate (#606) devem
// ler: uma segunda fórmula em outro lugar seria a mesma divergência que `Skills.merge`/
// `Bestiary.merge` evitam vivendo cada um num arquivo só.
//
// Não é um `ConditionState` (`conditions.ts`): aquele sistema é para efeito DECLARADO em
// conteúdo (magia, ability, campo), com política de fusão por tipo e leitura de stats. Aqui não
// há conteúdo nenhum para configurar — a janela é uma constante do MOTOR, como o `pzLocked` do
// Canary —, e o valor é só um carimbo de instante em `CharacterRuntime.lastCombatActionAtMs`,
// no molde de `CharacterRuntime.attackLockedUntil` (stairhop, #554) e de
// `Runner.lastCombatActionAtMs` (`rulesets/hunt.ts` — ver a nota de distinção lá).

/** `pzLocked` do Canary: 60 s, contados do último ataque, dado ou recebido. */
export const IN_FIGHT_WINDOW_MS = 60_000;

/**
 * `nowMs` é o relógio LÓGICO da sessão (invariantes 1/2); `lastCombatActionAtMs` é `null` para
 * quem nunca deu nem levou um golpe nesta sessão — e `null` nunca está em combate.
 */
export function isInFight(nowMs: number, lastCombatActionAtMs: number | null): boolean {
  return lastCombatActionAtMs !== null && nowMs - lastCombatActionAtMs < IN_FIGHT_WINDOW_MS;
}
