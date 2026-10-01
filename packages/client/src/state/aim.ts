// O estado de MIRA do disparo manual (AB-09, ADR 0049 decisão 2, #725) — e do "usar com…" da
// mochila (ADR 0049 decisão 3, #726).
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
// **A #726 reaproveita a MESMA máquina** (armar/resolver/cancelar) para "usar item com mira":
// `startAimForItem` arma um `ItemAim` em vez de um `SlotAim`, e `resolveAim` despacha para
// `use-item-on` em vez de `use-slot` — Viewport/BattlePanel continuam chamando só
// `resolveAim(creatureId, send)`, sem saber qual dos dois está armado.

import type { C2SMessage } from '@draconya/protocol';

/** Manda uma intenção C2S. O shell passa `sendIntent`; o teste, um espião. */
export type AimSender = (message: C2SMessage) => void;

export interface AimTarget {
  readonly set: number;
  readonly slot: number;
}

/** A referência de item/suprimento de um `use-item-on` (#726, ADR 0049 decisão 3). */
export type AimItemRef = { readonly instanceId: string } | { readonly supplyId: string };

interface SlotAim {
  readonly kind: 'slot';
  readonly set: number;
  readonly slot: number;
}

interface ItemAim {
  readonly kind: 'item';
  readonly ref: AimItemRef;
  readonly seq: number;
}

/**
 * A mira de um slot cujo alvo é um ITEM DO INVENTÁRIO (#621, a Chameleon Rune: `targets: 'item'` no
 * catálogo). Diferente das duas de cima, quem a completa NÃO é o mundo nem a Batalha, e sim um
 * clique num item da mochila/bolsa (`ContainerWindow`) — o "usar com" do Tibia sobre um item.
 */
interface SlotItemAim {
  readonly kind: 'slot-item';
  readonly set: number;
  readonly slot: number;
}

export interface AimTracker {
  /** Arma a mira para este slot — o próximo clique no mundo/Batalha a resolve. */
  startAim(set: number, slot: number): void;
  /**
   * Arma a mira para "usar com…" um item/suprimento (#726) — o próximo clique no mundo/Batalha
   * manda `use-item-on` com o `creatureId` clicado.
   */
  startAimForItem(ref: AimItemRef, seq: number): void;
  /** Cancela sem mandar nada (Esc, `session-ended`, reconexão). */
  cancelAim(): void;
  /** Há uma mira armada agora? É o que `Viewport`/`BattlePanel` conferem antes de `selectTarget`. */
  isAiming(): boolean;
  /**
   * Arma a mira de um slot que aponta um ITEM do inventário (#621, Chameleon Rune) — o próximo
   * clique num item da mochila/bolsa a resolve (`resolveItemAim`); o mundo e a Batalha a ignoram.
   */
  startItemAim(set: number, slot: number): void;
  /** Há uma mira de ITEM armada? É o que `ContainerWindow` confere antes de vestir o item clicado. */
  isAimingItem(): boolean;
  /**
   * O clique num item do inventário resolve a mira de item: manda `use-slot` com `target:
   * { instanceId }` e desarma. `false` quando não havia mira de item — o clique segue o fluxo de
   * sempre (vestir).
   */
  resolveItemAim(instanceId: string, send: AimSender): boolean;
  /**
   * O clique seguinte no mundo/Batalha resolve a mira: manda `use-slot`/`use-item-on` com o
   * `creatureId` clicado e desarma. `false` quando não havia mira ativa — quem chama continua
   * o fluxo de seleção de alvo de sempre (`targetTracker.selectTarget`). Uma mira de ITEM
   * (#621) não é deste clique: devolve `false` e continua armada.
   */
  resolveAim(creatureId: number, send: AimSender): boolean;
  /** A sessão acabou ou reanexou: a mira da anterior não pode sobreviver nem voltar. */
  reset(): void;
}

/** O rastreador de uma conexão. Sem I/O e sem relógio — testável sem socket. */
export function createAimTracker(): AimTracker {
  let active: SlotAim | ItemAim | SlotItemAim | null = null;

  return {
    startAim(set, slot) {
      active = { kind: 'slot', set, slot };
    },
    startAimForItem(ref, seq) {
      active = { kind: 'item', ref, seq };
    },
    startItemAim(set, slot) {
      active = { kind: 'slot-item', set, slot };
    },
    isAimingItem() {
      return active?.kind === 'slot-item';
    },
    resolveItemAim(instanceId, send) {
      if (active === null || active.kind !== 'slot-item') return false;
      const aim = active;
      active = null;
      send({ type: 'use-slot', set: aim.set, slot: aim.slot, target: { instanceId } });
      return true;
    },
    cancelAim() {
      active = null;
    },
    isAiming() {
      return active !== null;
    },
    resolveAim(creatureId, send) {
      // A mira de ITEM (#621) só sai num clique de item — o mundo não a consome nem a desarma.
      if (active === null || active.kind === 'slot-item') return false;
      const aim = active;
      active = null;
      if (aim.kind === 'slot') {
        send({ type: 'use-slot', set: aim.set, slot: aim.slot, target: { creatureId } });
      } else {
        send({ type: 'use-item-on', ref: aim.ref, seq: aim.seq, target: { creatureId } });
      }
      return true;
    },
    reset() {
      active = null;
    },
  };
}

/**
 * O rastreador da conexão em curso. Único, como `targetTracker`: o cliente tem um personagem
 * em jogo, e a barra, a mochila e o mundo precisam falar da MESMA mira.
 */
export const aimTracker = createAimTracker();
