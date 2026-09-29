// Extraído de PartyMembers.tsx (#320): PartyModal precisa da MESMA leitura de HP para a aba
// "Na hunt" — duplicar a varredura de `world` divergiria no primeiro ajuste, como a colorização
// de outfit já divergiu uma vez por causa de um refactor separado (packages/client/AGENTS.md).
//
// Puro: lê `world` sem assinar (ADR 0007 — "ninguém avisa, quem quer saber olha").

import { world } from '../state/world.js';

/** HP % do companheiro pelo nome, buscado nas criaturas do mundo — `null` se ninguém bate. */
export function percentFromWorld(name: string): number | null {
  for (const creature of world.creatures.values()) {
    if (creature.name !== name || creature.maxHealth <= 0) continue;
    return Math.max(0, Math.min(100, Math.round((creature.health / creature.maxHealth) * 100)));
  }
  return null;
}
