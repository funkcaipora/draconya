// O estado de MIRA do disparo manual (AB-09, ADR 0049 decisão 2, #725).
//
// Um slot cuja ação é de ALIADO (`targets: 'friend'` no catálogo v2 — cura, suporte) não pode
// disparar sozinho: o servidor não tem como adivinhar QUEM. A barra entra em modo de mira ao
// clicar nesse slot, e o PRÓXIMO clique no mundo (Viewport) ou na Batalha (BattlePanel)
// completa a intenção — o mesmo gesto de "usar com mira" do Tibia (ADR 0049 decisão 2).
//
// PURO e sem `net/` (ADR 0007), como `state/target.ts` — mesmo diretório, mesma razão: a
// conexão nasce e morre num efeito, e este módulo não pode depender dela; o shell injeta
// `sendIntent` no ato de resolver. Mora em `state/`, e não em `shell/`, porque `apply.ts`
// precisa zerá-lo no mesmo `session-state` que já zera o `targetTracker` (ver `reset()`).
//
// Reutilizável de propósito: a #726 (`use-item`/`use-item-on`) reaproveita o MESMO estado para
// "usar item com mira" — só o `set`/`slot` mudam de sentido, a máquina (armar/resolver/
// cancelar) é a mesma.

import type { C2SMessage } from '@draconya/protocol';

/** Manda uma intenção C2S. O shell passa `sendIntent`; o teste, um espião. */
export type AimSender = (message: C2SMessage) => void;

export interface AimTarget {
  readonly set: number;
  readonly slot: number;
}

export interface AimTracker {
  /** Arma a mira para este slot — o próximo clique no mundo/Batalha a resolve. */
  startAim(set: number, slot: number): void;
  /** Cancela sem mandar nada (Esc, `session-ended`, reconexão). */
  cancelAim(): void;
  /** Há uma mira armada agora? É o que `Viewport`/`BattlePanel` conferem antes de `selectTarget`. */
  isAiming(): boolean;
  /**
   * O clique seguinte no mundo/Batalha resolve a mira: manda `use-slot` com o `creatureId`
   * clicado e desarma. `false` quando não havia mira ativa — quem chama continua o fluxo de
   * seleção de alvo de sempre (`targetTracker.selectTarget`).
   */
  resolveAim(creatureId: number, send: AimSender): boolean;
  /** A sessão acabou ou reanexou: a mira da anterior não pode sobreviver nem voltar. */
  reset(): void;
}

/** O rastreador de uma conexão. Sem I/O e sem relógio — testável sem socket. */
export function createAimTracker(): AimTracker {
  let active: AimTarget | null = null;

  return {
    startAim(set, slot) {
      active = { set, slot };
    },
    cancelAim() {
      active = null;
    },
    isAiming() {
      return active !== null;
    },
    resolveAim(creatureId, send) {
      if (active === null) return false;
      const { set, slot } = active;
      active = null;
      send({ type: 'use-slot', set, slot, target: { creatureId } });
      return true;
    },
    reset() {
      active = null;
    },
  };
}

/**
 * O rastreador da conexão em curso. Único, como `targetTracker`: o cliente tem um personagem
 * em jogo, e a barra e o mundo precisam falar da MESMA mira.
 */
export const aimTracker = createAimTracker();
