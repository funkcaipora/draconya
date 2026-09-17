// A identidade da caçada atual, do ponto de vista do cliente (#325, RC-12).
//
// O servidor ainda não diz qual `catalogue.hunts[]` é a hunt ativa (SV-05 fecha isso). Até lá,
// esta store guarda somente a intenção `enter-hunt` que o próprio cliente conseguiu enviar nesta
// aba, como `pending-ticket.ts` guarda uma reconexão. Ela nunca é persistida, reconstruída por
// adivinhação ou enviada de volta ao servidor.

import { createStore } from '../state/hud.js';

export interface CurrentHunt {
  readonly huntId: string;
  readonly difficulty: string;
}

export const currentHunt = createStore<CurrentHunt | null>(null);

export function setCurrentHunt(next: CurrentHunt | null): void {
  currentHunt.set(() => next);
}
