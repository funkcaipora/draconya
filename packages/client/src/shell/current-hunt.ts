// packages/client/src/shell/current-hunt.ts
//
// A identidade da caçada atual, do PONTO DE VISTA DO CLIENTE (#325, RC-12).
//
// O servidor não diz qual `catalogue.hunts[]` é a hunt ativa (Correção de premissa nº 2 desta
// spec; SV-05, M15, fecha isso de vez). Até lá, esta store guarda só o que O PRÓPRIO CLIENTE
// mandou em `enter-hunt` nesta aba — a lembrança da própria intenção enviada, o mesmo tipo de
// dado que `net/pending-ticket.ts` já guarda para a reconexão. Esvaziada por reload da página e
// por sair da hunt; nunca reconstruída por adivinhação.

import { createStore } from '../state/hud.js';

export interface CurrentHunt {
  readonly huntId: string;
  readonly difficulty: string;
}

export const currentHunt = createStore<CurrentHunt | null>(null);

export function setCurrentHunt(next: CurrentHunt | null): void {
  currentHunt.set(() => next);
}
