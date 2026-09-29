// A definição ÚNICA de "em combate" para todo o endgame (#625): último ataque DADO ou
// RECEBIDO há no máximo `IN_FIGHT_WINDOW_MS` — a janela do `pzLocked` do Canary
// (config.lua.dist:36, `CONDITION_INFIGHT`), 60 000 ms. É esta função, e só ela, que a trava
// de saída da hunt (`rulesets/hunt.ts`, `#finishExit`) e o decaimento de imbuement fora de
// combate (#606) devem ler: uma segunda fórmula em outro lugar seria a mesma divergência que
// `Skills.merge`/`Bestiary.merge` evitam vivendo cada um num arquivo só.
//
// **É uma APROXIMAÇÃO por dano aplicado, e não o `CONDITION_INFIGHT` inteiro.** O carimbo só
// é escrito onde um golpe é APLICADO, dado ou recebido (`#applyHits`, `#land`,
// `#executeMonsterAbility`, em `rulesets/hunt.ts`). O Canary renova a condição em mais lugares
// (`addInFightTicks`, `player.cpp`): a cada `think` de quem tem alvo, ANTES da checagem de linha
// de visão (`Creature::onAttacking`) e ao escolher alvo (`Creature::setAttackedCreature`, que
// `Monster::selectTarget` chama — um monstro que só MIRA o jogador já o põe em combate); em
// qualquer magia agressiva conjurada, acertando ou não (`Spell::postCastSpell`); e em todo dano
// que o jogador sofre, inclusive campo e DoT (`Creature::blockHit`). Faltam aqui o monstro que
// mira sem ter batido, a magia agressiva sem acerto, o tiro sem visão livre e o dano de
// campo/DoT. Consequência para o `leave-hunt` (#802): nesses instantes o Canary recusaria o
// logout (`RETURNVALUE_YOUMAYNOTLOGOUTDURINGAFIGHT`) e a hunt do Draconya conclui a saída. Não
// descreva esta função como "o CONDITION_INFIGHT do Canary" — alargar os carimbos muda o
// decaimento de imbuement (#606) e as regras de saída, e é trabalho de acompanhamento do #625.
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
