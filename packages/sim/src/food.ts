// Comida (#726, ADR 0049 decisão 5, emenda ao ADR 0043).
//
// `fedMs` é a `CONDITION_REGENERATION` do Tibia: comer soma `duration` (o `value × 12` s do
// `foods.lua` do Canary, já em milissegundos no conteúdo — `ConsumableEffect` de `kind: 'food'`)
// a um contador, capado em `FOOD_CAP_MS` (1200 s — "You are full", recusa SEM consumir o item).
//
// **Drena por `dtMs` de hunt, nunca por tick** (invariante 2) — o mesmo argumento de
// `drainStamina`: um evento próprio só para "descontar o tempo" duplicaria a cadência que já
// existe em `#burnStamina` (`hunt.ts`), chamado a cada vencimento com o tempo LÓGICO decorrido
// desde a última cobrança. Ao contrário da stamina, não há recuperação fora de hunt — a Cidade
// não anda (ADR 0004/0023), e comer só acontece dentro da hunt (decisão 8 do ADR 0049).
//
// A REGENERAÇÃO em si (se ela CONSULTA `fedMs`) é `progression.regeneration.requiresFood`,
// lido em `HuntRuleset#onRegen` — este arquivo só mantém o contador; quem decide se alguém olha
// para ele é conteúdo, não este módulo.

import type { CharacterRuntime } from './character.js';

/** Teto de `fedMs` (`foods.lua`: `>= 1200` segundos recusa "You are full"). */
export const FOOD_CAP_MS = 1_200_000;

/** Drena o tempo de hunt decorrido. Nunca zera sozinho — comida acaba por CONSUMO, não por espera. */
export function drainFedMs(character: CharacterRuntime, dtMs: number): void {
  if (character.fedMs <= 0) return;
  character.fedMs = Math.max(0, character.fedMs - dtMs);
}

/**
 * Come UMA unidade de comida. Recusa `full` SEM consumir o item quando a soma estouraria o
 * teto — a checagem do `foods.lua` (`floor(ticks/1000 + itemFood[1]*12) >= 1200`), refeita aqui
 * em cima de `fedMs` já em milissegundos.
 */
export function feed(
  character: CharacterRuntime,
  durationMs: number,
): { readonly ok: true } | { readonly ok: false; readonly reason: 'full' } {
  if (character.fedMs + durationMs > FOOD_CAP_MS) return { ok: false, reason: 'full' };
  character.fedMs += durationMs;
  return { ok: true };
}
