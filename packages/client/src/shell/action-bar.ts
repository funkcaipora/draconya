// O view-model PURO da barra de ações (AB-10, ADR 0032 d.1–5). Sem React, sem store e sem
// socket: recebe dados e devolve o que o `Slot` desenha — o mesmo desenho de `walk-keys.ts` e
// `drag-intent.ts`. A fiação (clique, teclado) fica na casca e é presa por inspeção, porque
// `prerender` não dispara evento (DT-03).
//
// **Nada é inventado.** Slot sem config vira vazio; suprimento não tem pilha nem contagem; o
// cooldown e o bloqueio vêm do `slot-state`. A barra mostra o que o servidor disse (invariante 4).

import type { BotConfigV2, BotSlot, BotTargetPolicy, BotTargeting } from '@draconya/content';
import type { Catalogue, SlotState } from '../state/hud.js';
import { slotKey } from '../state/hud.js';
import type { SlotProps } from './ui/Slot.js';
import { isSpellLearned } from './spell-shop.js';

/** A chave canônica `${set}:${slot}` — definida no estado e reexportada para a barra e o teste. */
export { slotKey };

/**
 * As teclas válidas do conteúdo (#418: 1–9, 0, F1–F12). `KeyboardEvent.code` e não `key`:
 * funciona em qualquer layout, como o WASD de `walk-keys.ts`. Qualquer outra tecla não é slot.
 */
const CODES: Readonly<Record<string, string>> = {
  Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6',
  Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0',
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6', F7: 'F7', F8: 'F8',
  F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
};

/**
 * `KeyboardEvent.code` (+ Shift) → a tecla como o conteúdo a escreve ("Digit1"→"1",
 * "Digit1"+shift→"shift+1", "F1"→"F1"). `shiftKey` é o ÚNICO modificador que compõe uma tecla
 * do kit — Ctrl/Alt/Meta continuam fora do vocabulário (ADR 0049 decisão 1, `BOT_HOTKEYS`).
 */
export function hotkeyForKey(code: string, shiftKey = false): string | null {
  const base = CODES[code] ?? null;
  if (base === null) return null;
  return shiftKey ? `shift+${base}` : base;
}

export interface SlotRef {
  readonly set: number;
  readonly slot: number;
}

/**
 * Que slot do conjunto ATIVO a tecla dispara. `null` quando a tecla não é de slot, o conjunto
 * não existe, ou nenhum slot do conjunto usa aquela tecla. Tecla repetida no conjunto é recusa
 * do schema v2: a barra não inventa precedência, devolve o primeiro (o editor do AB-11 é quem
 * impede a duplicata).
 */
export function slotForHotkey(
  sets: BotConfigV2['sets'],
  activeSet: number,
  code: string,
  shiftKey = false,
): SlotRef | null {
  const key = hotkeyForKey(code, shiftKey);
  if (key === null) return null;
  const set = sets[activeSet];
  if (set === undefined) return null;
  const slot = set.slots.findIndex((entry) => entry !== null && entry.hotkey === key);
  return slot < 0 ? null : { set: activeSet, slot };
}

export interface SlotView {
  readonly label: string;
  readonly hotkey: string | undefined;
  /** Sem fonte no catálogo v2 (nem magia nem suprimento trazem elemento), fica `undefined`. */
  readonly element: SlotProps['element'] | undefined;
  readonly cooldownMs: number;
  readonly blocked: boolean;
  readonly auto?: boolean;
  /**
   * O clique deste slot precisa de MIRA (ADR 0049 decisão 2) — a ação é de aliado
   * (`targets: 'friend'`, catálogo v2) ou a magia nomeia um personagem (`aim: 'character'`, o
   * Find Person), e o servidor não tem como adivinhar QUEM. Toda outra
   * ação dispara na hora, com o alvo default de sempre (fixado, senão o candidato do bot).
   */
  readonly needsAim: boolean;
  /**
   * A magia deste slot ainda NÃO foi aprendida (#624, ADR 0058 d.5): o slot continua na barra —
   * nada é escondido (ADR 0032 d.5) —, marcado, e o disparo é recusado pelo servidor. Só magia:
   * suprimento (poção, runa) não exige aprendizado. `false` também quando a tela ainda não sabe
   * o que o personagem aprendeu (`learned-spells` não chegou).
   */
  readonly unlearned: boolean;
  /**
   * O clique deste slot precisa da mira num ITEM do inventário (#621, `targets: 'item'`): a
   * Chameleon Rune veste a aparência do item apontado. O clique arma a mira de item, e o clique
   * seguinte num item da mochila/bolsa completa o `use-slot`.
   */
  readonly aimsAtItem: boolean;
}

/**
 * O view-model do slot: o que o `Slot` desenha, ou `null` para vazio (nada inventado).
 * `slot.do` de suprimento busca o nome no catálogo v2; de magia, no catálogo de magias. O
 * cooldown e o bloqueio vêm do `slot-state`; o motivo, do `slot-result`. Não há contagem: o
 * suprimento é abstrato e o uso debita gold (ADR 0032 d.6/d.7).
 */
export function slotView(
  slot: BotSlot | null,
  catalogue: Catalogue,
  state: SlotState | null,
  learnedSpells: readonly string[] | null = null,
): SlotView | null {
  if (slot === null) return null;
  const action = slot.do;
  const spell = action.kind === 'spell'
    ? catalogue.bot.spells.find((entry) => entry.id === action.spellId)
    : undefined;
  const supply = action.kind === 'supply'
    ? catalogue.bot.supplies?.find((entry) => entry.id === action.supplyId)
    : undefined;
  const catalogued = spell ?? supply;
  const label = catalogued?.name ?? (action.kind === 'spell' ? action.spellId : action.supplyId);
  return {
    label,
    hotkey: slot.hotkey,
    element: undefined,
    cooldownMs: state?.remainingMs ?? 0,
    blocked: state?.state === 'blocked',
    auto: slot.auto,
    // Ação de aliado (`targets: 'friend'`) OU magia de mira manual (`aim: 'character'`, o Find
    // Person, #623) — dois campos porque só o primeiro abre o seletor de alvo do editor do bot.
    needsAim: catalogued?.targets === 'friend' || spell?.aim === 'character',
    aimsAtItem: catalogued?.targets === 'item',
    unlearned: action.kind === 'spell' && !isSpellLearned(action.spellId, learnedSpells),
  };
}

/** O `title` do slot: rótulo completo + cooldown + bloqueio + o motivo que o servidor mandou. */
export function slotTitle(view: SlotView, reason: string | null): string {
  const parts = [view.label];
  if (view.hotkey !== undefined) parts.push(view.hotkey);
  if (view.cooldownMs > 0) parts.push(`${String(Math.ceil(view.cooldownMs / 1000))}s`);
  if (view.blocked) parts.push('bloqueado');
  if (view.unlearned) parts.push('não aprendida');
  if (reason !== null && reason !== '') parts.push(reason);
  return parts.join(' · ');
}

/** O que o botão ⌖ promete para quem nunca tocou (Hud.jsx, "mín 4 · máx 8"). */
const DEFAULT_LURE: NonNullable<BotConfigV2['lure']> = { min: 4, max: 8 };

const POSTURE_TEXT: Readonly<Record<BotTargeting['posture']['kind'], string>> = {
  stand: 'PARADO NA ROTA',
  follow: 'SEGUIR ALVO',
  'keep-distance': 'MANTER DISTÂNCIA',
};

/** A legenda do ⌖: "MIN 4 · MAX 8 · SEGUIR ALVO" (a postura é a do bot). */
export function lureCaption(
  lure: BotConfigV2['lure'],
  posture: BotTargeting['posture'],
): string {
  const { min, max } = lure ?? DEFAULT_LURE;
  return `MIN ${String(min)} · MAX ${String(max)} · ${POSTURE_TEXT[posture.kind]}`;
}

/** Os rótulos do dropdown ALVO. O `follow` nomeia o alvo vivo quando o servidor disse qual é. */
export function policyLabel(policy: string, targetName: string | null): string {
  switch (policy) {
    case 'nearest': return 'Mais próximo';
    case 'lowest-hp': return 'Menor HP';
    case 'highest-hp': return 'Maior HP';
    case 'follow': return targetName === null ? 'Seguir alvo' : `Seguir ${targetName}`;
    default: return policy;
  }
}

/**
 * As políticas que o dropdown oferece — o vocabulário FECHADO de `@draconya/content`
 * (`botTargetPolicySchema`). #424 não publicou `catalogue.bot.targetPolicies`, então a lista
 * vem do conteúdo que o cliente já pode importar, na ordem do kit (seguir, mais próximo, menor HP).
 */
export const TARGET_POLICY_OPTIONS: readonly BotTargetPolicy[] = [
  'follow', 'nearest', 'lowest-hp', 'highest-hp',
];
